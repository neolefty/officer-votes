# Accessibility Notes

## Implemented
- Semantic HTML (headings, nav, fieldset/legend, labels)
- ARIA attributes (role, aria-label, aria-modal, aria-pressed, aria-describedby)
- Focus management for modals (auto-focus on open)
- Escape key closes modals
- Click outside modal to close
- Error messages use role="alert"
- Screen reader only text (sr-only) for context

## Known Issues / TODO
- [ ] Focus trap in modals (focus can currently escape to background)
- [ ] Return focus to trigger element when modal closes
- [ ] Live region for vote count updates (aria-live="polite")
- [ ] Skip link to main content
- [ ] Color contrast audit (current blue-600 should be fine, but verify)
- [ ] Touch target size audit (buttons are 44px+ but verify)
- [ ] Reduced motion support (@media prefers-reduced-motion)
- [ ] High contrast mode testing
- [ ] Screen reader testing (VoiceOver, NVDA)
- [ ] Keyboard navigation audit (tab order, visible focus)

## Recommendations for External Audit
- WCAG 2.1 AA compliance check
- Screen reader compatibility (VoiceOver, NVDA, JAWS)
- Keyboard-only navigation
- Color blindness simulation
- Mobile accessibility (touch targets, gestures)
