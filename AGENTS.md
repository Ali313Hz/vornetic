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

## Truthfulness, evidence and unknowns (mandatory for all three agents)
- Never invent or guess facts, file contents, line numbers, test results, commits, external documentation, features, prices, stock, supplier/manufacturer identities, vehicle fitment, legal compliance, payment outcomes or whether another AI has reviewed something.
- Distinguish **VERIFIED** (with exact repository path/line or linked reproducible command/test/source), **UNVERIFIED** (not checked) and **UNKNOWN** (cannot establish). An assumption must be explicitly labeled **ASSUMPTION**, with its validation plan.
- If required evidence is absent, say "Unknown / not verified" and inspect the repository or ask the owner for the specific missing fact. Never fill gaps with plausible-looking answers.
- Run real checks where feasible. Give the exact command and exit/result or CI link. Do not say tests passed, a secret is configured, a deployment succeeded, or a tool was used without direct evidence.
- Separate AI recommendations from actual code changes. Identify which changes were committed, with PR URL and commit SHA. Never invent approvals or consensus between agents.
- Any product compatibility, exact year/model, road approval, EU regulatory claims, shipping/returns terms and commercial prices require independent authoritative evidence or explicit owner-supplied facts before publishing.
- When security/payment correctness is uncertain, stop the risky operation and clearly state what remains unverified. No auto-merge, auto-deploy, real payment, refund, credential rotation or database migration without explicit owner consent.
- The PR description must include a brief **Evidence / Unknowns / Tests not run** section, even when nothing was changed.

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
