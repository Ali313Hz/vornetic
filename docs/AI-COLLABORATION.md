# Vornetic three-agent workflow

## Status
This document defines a target process, **not** proof that Claude, Codex or Gemini are connected. GitHub Actions currently performs baseline CI only.

## Responsibilities
- Claude Code: implement approved features in feature branches; add tests.
- Codex: independently review architecture, security and changed code in PRs.
- Gemini: independently inspect UX, integration assumptions and test coverage in PRs.
- Owner: approve business facts, payment credentials, legal wording, production deployment and final merges.

## Collaboration lifecycle
1. Open a scoped issue with acceptance criteria.
2. Claude proposes and implements on a feature branch.
3. Open a PR and run baseline CI. Failed checks block further work.
4. Request independent Codex and Gemini reviews through their official supported integrations once installed/configured. Each review must link to its real output.
5. Classify findings as blocker/high/medium/low, resolve blockers with tests, rerun checks, and request follow-up reviews.
6. Owner reviews the summary and authorizes merge/deployment. A PR approval is not a substitute for real integration tests.

## Initial audit priorities
1. Remove production fallback admin credentials and assess cookie-authenticated route CSRF.
2. Audit Stripe session verification, payment state transitions, and server-side price calculation.
3. Prove inventory cannot oversell under concurrent checkout; distinguish per-product and per-variant stock.
4. Add transaction, refund/cancellation, checkout, variant and login integration tests.
5. Validate upload content/type and set a consistent size/resource policy.
6. Verify Spanish/EU required business information and product safety information with actual documentation.
7. Add staging and backup/restore drills before live operations.

## Limitations
CI syntax checking and npm audit cannot prove business logic or payment safety. Do not activate auto-merge or auto-deploy based on this baseline. Third-party agent tokens/permissions should be scoped minimally; never expose repository secrets in untrusted PR workflows.
