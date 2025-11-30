import type { Response } from 'express';

type SSEClient = {
  res: Response;
  participantId: string;
};

class SSEManager {
  private clients: Map<string, SSEClient[]> = new Map(); // electionId -> clients

  addClient(electionId: string, participantId: string, res: Response) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');

    const clients = this.clients.get(electionId) || [];
    clients.push({ res, participantId });
    this.clients.set(electionId, clients);

    res.on('close', () => {
      this.removeClient(electionId, res);
    });
  }

  removeClient(electionId: string, res: Response) {
    const clients = this.clients.get(electionId) || [];
    const filtered = clients.filter((c) => c.res !== res);
    if (filtered.length === 0) {
      this.clients.delete(electionId);
    } else {
      this.clients.set(electionId, filtered);
    }
  }

  broadcast(electionId: string, event: string, data: unknown) {
    const clients = this.clients.get(electionId) || [];
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      client.res.write(payload);
    }
  }

  // Send to specific participant
  sendTo(electionId: string, participantId: string, event: string, data: unknown) {
    const clients = this.clients.get(electionId) || [];
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      if (client.participantId === participantId) {
        client.res.write(payload);
      }
    }
  }
}

export const sseManager = new SSEManager();
