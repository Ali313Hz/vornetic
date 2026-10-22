# Vornetic — AI agent rules

These instructions apply to Claude, Codex, Gemini and all contributors.

## Objective
Maintain a secure, easy-to-use Spanish/English e-commerce store. Prefer small, testable changes preserving existing behavior. Do not assume deployment readiness.

## Current architecture
This repository currently uses Node.js, Express, Node's built-in SQLite, and HTML/CSS/browser JavaScript. Do not assume Next.js, Medusa or a hosted database is installed.

## Mandatory workflow
1. Read README.md, package.json and impacted files.
2. State scope, risks, assumptions, and acceptance tests before changing commerce-sensitive code.
3. Use an isolated branch and a pull request. Never push agent changes straight to main.
4. Claude may implement; Codex and Gemini may independently review. Do not claim that either has reviewed unless an actual review result exists and is linked.
5. Resolve disagreements using reproducible tests and evidence, not an invented AI consensus.
6. Run syntax checks, tests and security review. Report commands that could not be run.
7. Leave production deployment and merging subject to explicit owner approval.
8. Do not commit secrets, credentials, customer exports, databases, or private keys.

## Security boundaries
- No production payment, refund, deployment, destructive database, or credential operations without explicit owner approval.
- Use Stripe test mode for tests. Never invent successful payments.
- Treat all client-provided price, variant, stock, order status and permissions as untrusted; enforce validation on server.
- When touching checkout, verify idempotency, verified payment state, inventory consistency and concurrent orders.
- When touching admin auth, verify no usable default production password and properly protected endpoints.
- Audit file uploads by content and type; do not rely on extension alone.
- Review CSRF/origin protections for all state-changing cookie-authenticated routes.
- Never invent product fitment, road legality, GPSR manufacturer information, shipping conditions or legal/tax claims. Mark unknowns for owner verification.
- Avoid adding new dependencies without clear reason.

## Required PR summary
- Goal and changed files
- Risks and rollback instructions
- Tests performed and results
- Unverified claims / owner decisions needed
- Independent review links, if actually completed
