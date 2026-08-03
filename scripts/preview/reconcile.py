#!/usr/bin/env python3
"""PR preview reconciler.

Converges running Docker containers + Caddy site blocks to match the set of
open (non-fork) PRs on a GitHub repo. Designed to run periodically from a
systemd timer as an unprivileged user. See scripts/preview/README.md.

Usage: reconcile.py /etc/pr-preview/<project>.json

Stdlib only (Python 3.10+). External commands used: gh, git, docker,
and the configured caddy reload command (sudo systemctl reload caddy).
"""

import fcntl
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------- helpers


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] {msg}", flush=True)


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    """Run a command, raising on failure, capturing text output."""
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def try_run(cmd: list[str], **kw) -> subprocess.CompletedProcess | None:
    """Like run() but returns None on failure (after logging stderr)."""
    try:
        return run(cmd, **kw)
    except subprocess.CalledProcessError as e:
        log(f"FAILED: {' '.join(cmd)}\n{e.stderr.strip()[-2000:]}")
        return None


# ---------------------------------------------------------------- config


class Config:
    def __init__(self, path: str):
        raw = json.loads(Path(path).read_text())
        self.project: str = raw["project"]          # e.g. "officer-votes"
        self.repo: str = raw["repo"]                # e.g. "neolefty/officer-votes"
        self.domain: str = raw["domain"]            # e.g. "preview.wlbahai.org"
        self.port_base: int = raw["port_base"]      # e.g. 4000 -> PR 123 gets 4123
        self.internal_port: int = raw["internal_port"]  # container port, e.g. 8080
        self.preview_key: str = raw["preview_key"]  # cookie-gate secret
        self.caddy_dir: Path = Path(raw["caddy_dir"])    # e.g. /etc/caddy/preview
        self.state_dir: Path = Path(raw["state_dir"]).expanduser()
        self.env: dict = raw.get("env", {})         # extra container env vars
        self.data_mount: str | None = raw.get("data_mount")  # e.g. /app/data
        self.memory: str = raw.get("memory", "1g")
        self.cpus: str = raw.get("cpus", "1")
        self.caddy_reload: list[str] = raw.get(
            "caddy_reload", ["sudo", "-n", "systemctl", "reload", "caddy"]
        )

    def container(self, pr: int) -> str:
        return f"pp-{self.project}-pr{pr}"

    def volume(self, pr: int) -> str:
        return f"ppdata-{self.project}-pr{pr}"

    def image(self, pr: int, sha: str) -> str:
        return f"pr-preview/{self.project}:pr{pr}-{sha[:12]}"

    def host(self, pr: int) -> str:
        return f"pr-{pr}.{self.domain}"

    def port(self, pr: int) -> int:
        port = self.port_base + pr
        if not (1024 < port < 65536) or pr >= 1000:
            raise ValueError(f"PR {pr} outside supported port range (base {self.port_base})")
        return port

    def caddy_file(self, pr: int) -> Path:
        return self.caddy_dir / f"{self.project}-pr{pr}.caddy"

    def url(self, pr: int) -> str:
        return f"https://{self.host(pr)}/?pp={self.preview_key}"


# ---------------------------------------------------------------- github


def open_prs(cfg: Config) -> dict[int, dict]:
    """Open non-fork PRs as {number: {"sha": ..., "branch": ...}}."""
    out = run([
        "gh", "pr", "list", "--repo", cfg.repo, "--state", "open", "--limit", "100",
        "--json", "number,headRefOid,headRefName,isCrossRepository",
    ]).stdout
    prs = {}
    for pr in json.loads(out):
        if pr["isCrossRepository"]:
            log(f"PR #{pr['number']}: skipping fork PR (never auto-deployed)")
            continue
        prs[pr["number"]] = {"sha": pr["headRefOid"], "branch": pr["headRefName"]}
    return prs


COMMENT_MARKER_TMPL = "<!-- pr-preview:{project} -->"


def upsert_comment(cfg: Config, pr: int, body: str) -> None:
    """Create or update the single sticky preview comment on a PR."""
    marker = COMMENT_MARKER_TMPL.format(project=cfg.project)
    body = f"{marker}\n{body}"
    # per_page=100 instead of --paginate: --paginate concatenates JSON arrays,
    # which json.loads can't parse; the sticky comment lands in the first 100.
    res = try_run(["gh", "api", f"repos/{cfg.repo}/issues/{pr}/comments?per_page=100"])
    if res is None:
        return
    existing = next((c for c in json.loads(res.stdout) if marker in c.get("body", "")), None)
    if existing:
        try_run(["gh", "api", "--method", "PATCH",
                 f"repos/{cfg.repo}/issues/comments/{existing['id']}", "-f", f"body={body}"])
    else:
        try_run(["gh", "api", "--method", "POST",
                 f"repos/{cfg.repo}/issues/{pr}/comments", "-f", f"body={body}"])


# ---------------------------------------------------------------- docker


def running_previews(cfg: Config) -> dict[int, dict]:
    """Existing preview containers as {pr: {"sha": ..., "state": ...}}."""
    out = run([
        "docker", "ps", "-a",
        "--filter", f"label=pr-preview.project={cfg.project}",
        "--format", '{{.Label "pr-preview.pr"}}\t{{.Label "pr-preview.sha"}}\t{{.State}}',
    ]).stdout
    actual = {}
    for line in out.splitlines():
        pr, sha, state = line.split("\t")
        actual[int(pr)] = {"sha": sha, "state": state}
    return actual


def build_image(cfg: Config, pr: int, sha: str) -> str | None:
    """Fetch the PR head and build an image from it. Returns image tag or None."""
    repo_dir = cfg.state_dir / "repo.git"
    if not repo_dir.exists():
        run(["git", "clone", "--bare", f"https://github.com/{cfg.repo}.git", str(repo_dir)])
    git = ["git", "-C", str(repo_dir)]
    if try_run(git + ["fetch", "origin", f"pull/{pr}/head"]) is None:
        return None
    fetched = run(git + ["rev-parse", "FETCH_HEAD"]).stdout.strip()
    if fetched != sha:
        log(f"PR #{pr}: head moved during reconcile ({sha[:7]} -> {fetched[:7]}); building newer")
        sha = fetched
    tag = cfg.image(pr, sha)
    archive = subprocess.Popen(git + ["archive", "FETCH_HEAD"], stdout=subprocess.PIPE)
    build = subprocess.run(
        ["docker", "build", "-t", tag,
         "--label", f"pr-preview.project={cfg.project}", "-"],
        stdin=archive.stdout, capture_output=True, text=True,
    )
    archive.wait()
    if build.returncode != 0:
        log(f"PR #{pr}: docker build failed\n{build.stderr.strip()[-3000:]}")
        return None
    return tag


def start_container(cfg: Config, pr: int, sha: str, tag: str) -> bool:
    subprocess.run(["docker", "rm", "-f", cfg.container(pr)], capture_output=True)
    cmd = [
        "docker", "run", "-d",
        "--name", cfg.container(pr),
        "--restart", "unless-stopped",
        "--memory", cfg.memory, "--cpus", cfg.cpus, "--pids-limit", "512",
        "-p", f"127.0.0.1:{cfg.port(pr)}:{cfg.internal_port}",
        "--label", f"pr-preview.project={cfg.project}",
        "--label", f"pr-preview.pr={pr}",
        "--label", f"pr-preview.sha={sha}",
    ]
    if cfg.data_mount:
        cmd += ["-v", f"{cfg.volume(pr)}:{cfg.data_mount}"]
    for k, v in cfg.env.items():
        cmd += ["-e", f"{k}={v}"]
    cmd.append(tag)
    return try_run(cmd) is not None


def remove_preview(cfg: Config, pr: int) -> None:
    subprocess.run(["docker", "rm", "-f", cfg.container(pr)], capture_output=True)
    subprocess.run(["docker", "volume", "rm", cfg.volume(pr)], capture_output=True)
    cfg.caddy_file(pr).unlink(missing_ok=True)


# ---------------------------------------------------------------- caddy

CADDY_TMPL = """\
# managed by pr-preview reconciler -- do not edit (regenerated each deploy)
{host} {{
\t@withkey query pp={key}
\thandle @withkey {{
\t\theader +Set-Cookie "pp={key}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax"
\t\tredir * {{path}}
\t}}
\t@unlocked header_regexp Cookie pp={key}
\thandle @unlocked {{
\t\treverse_proxy localhost:{port}
\t}}
\thandle {{
\t\trespond "PR preview gate: open the preview link from the pull request comment (it carries ?pp=<key>)." 401
\t}}
}}
"""


def write_caddy_block(cfg: Config, pr: int) -> bool:
    """Write the per-PR Caddy site block. Returns True if the file changed."""
    content = CADDY_TMPL.format(host=cfg.host(pr), key=cfg.preview_key, port=cfg.port(pr))
    path = cfg.caddy_file(pr)
    if path.exists() and path.read_text() == content:
        return False
    path.write_text(content)
    return True


# ---------------------------------------------------------------- reconcile


def reconcile(cfg: Config) -> None:
    state_file = cfg.state_dir / "state.json"
    state = json.loads(state_file.read_text()) if state_file.exists() else {"failed": {}}

    desired = open_prs(cfg)
    actual = running_previews(cfg)
    caddy_changed = False

    for pr in sorted(set(actual) - set(desired)):
        log(f"PR #{pr}: closed; tearing down")
        remove_preview(cfg, pr)
        state["failed"].pop(str(pr), None)
        caddy_changed = True

    for pr, info in sorted(desired.items()):
        sha = info["sha"]
        current = actual.get(pr)
        up_to_date = current and current["sha"] == sha and current["state"] == "running"
        if up_to_date:
            caddy_changed |= write_caddy_block(cfg, pr)  # heal a missing/stale block
            continue
        if state["failed"].get(str(pr)) == sha:
            continue  # this exact sha already failed to build; wait for a new push

        log(f"PR #{pr} ({info['branch']}): deploying {sha[:7]}")
        tag = build_image(cfg, pr, sha)
        ok = bool(tag) and start_container(cfg, pr, sha, tag)
        if ok:
            caddy_changed |= write_caddy_block(cfg, pr)
            state["failed"].pop(str(pr), None)
            upsert_comment(
                cfg, pr,
                f"**Preview:** {cfg.url(pr)}\n\n"
                f"Deployed `{sha[:7]}` at {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC. "
                f"Updates automatically on push (within ~3 min); data persists across pushes; "
                f"removed when the PR closes.",
            )
            log(f"PR #{pr}: live at {cfg.host(pr)}")
        else:
            state["failed"][str(pr)] = sha
            upsert_comment(
                cfg, pr,
                f"**Preview build failed** for `{sha[:7]}`. "
                f"Logs: `journalctl -u pr-preview@{cfg.project}` on the preview host. "
                f"A new push will retry.",
            )

    if caddy_changed:
        if try_run(cfg.caddy_reload) is None:
            log("WARNING: caddy reload failed; site blocks on disk are ahead of running config")
        else:
            log("caddy reloaded")

    # Prune preview images no longer used by any container (old SHAs, closed PRs).
    subprocess.run(
        ["docker", "image", "prune", "-af",
         "--filter", f"label=pr-preview.project={cfg.project}"],
        capture_output=True,
    )
    state_file.write_text(json.dumps(state, indent=2))


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    cfg = Config(sys.argv[1])
    cfg.state_dir.mkdir(parents=True, exist_ok=True)
    lock = open(cfg.state_dir / "lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("another reconcile is still running; skipping")
        return 0
    reconcile(cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
