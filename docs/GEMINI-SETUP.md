# Gemini review connection — staged setup

This workflow is **manual, read-only, and not active on main** until the PR is reviewed and merged.
It never checks out or executes pull-request code, grants only read permissions, and writes the review to the GitHub Actions job summary.

Owner steps after merge:
1. Create an API key using Google's official Google AI Studio account. Check provider quotas, costs, and data-handling terms.
2. In GitHub -> vornetic -> Settings -> Secrets and variables -> Actions -> New repository secret, enter name **GEMINI_API_KEY** and the key as the value. Never paste a key into chat, issues, PRs or files.
3. Open Actions -> Gemini manual PR review -> Run workflow; choose main, enter PR number 2 and run.
4. Inspect the Actions run summary. Do not regard a run as a code change or a security guarantee.

The run-gemini-cli action is an official Google GitHub Action. For full automatic reviews, use the official dispatch + pr-review templates after this manual, restricted integration has been verified. Granting write permissions or auto-merging requires a separate security review.
