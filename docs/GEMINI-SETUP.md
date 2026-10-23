# Vornetic: restricted Gemini code review

## Status
Staged in **draft PR #3**. Not yet merged or run. GitHub Actions will only use the workflow on the `main` branch after approval.

## Protect the Gemini API key
1. In GitHub > Settings > Environments, configure environment `gemini-review`.
2. Under Deployment branches and tags, choose Selected branches and tags and allow **only `main`**. The repository owner reports that this is complete.
3. Add **environment secret** `GEMINI_API_KEY` with the key value. The repository owner reports that this is complete.
4. **Remove the old repository-level `GEMINI_API_KEY`** from Settings > Secrets and variables > Actions > Repository secrets. Keep the environment secret.
5. Never paste keys into chat, commits, tickets, pull requests or build logs.

## Review workflow
- Manual dispatch only, on `main`, with read-only GitHub permissions and protected environment.
- Only inspect public PR code; **never send confidential/private diffs to the unpaid Gemini API**.
- Reject large, incomplete, binary and changing PR diffs instead of pretending a complete review.
- Load review guidance from `GEMINI.md` on the trusted default branch.
- Generate Gemini suggestions through an API request, without giving Gemini CLI or shell tools.
- Reject truncated or blocked responses; show reviewed SHA and output in job summary.
- No auto-merge, checkout of untrusted PR code, production deployment or live payment operations.

## After review and merge
In GitHub > Actions > Gemini manual PR review (restricted API) > Run workflow, select `main`, enter an existing small public PR number and trigger once. Inspect job outcome and summary. **A green run is a review, not proof the e-commerce system is safe.**

## 0 EUR requirement
Keep Google billing disabled. Even with no billing, quotas and model availability can change, and free-tier API calls may fail. Do not enable paid usage automatically. Verify Google's current pricing and data handling before enabling any non-public review.

## Limitations
Claude automated implementation is a separate integration and is not yet connected. Codex findings and security approvals remain independent of Gemini output.
