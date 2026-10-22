# Vornetic Gemini review setup (manual, restricted)

This is a staged workflow in draft PR #3, not active on main. It calls the Gemini HTTPS generateContent API directly; it does NOT launch Gemini CLI, shell tools or third-party AI actions.

## Safety properties
- Only manual workflow_dispatch; read-only GitHub token.
- No PR code checked out or executed. The PR diff is only text sent to Gemini.
- Rejects PRs over 30 changed files, 1,500 added/deleted lines, or 75 KB captured diff.
- Requires the number of diff headers to match GitHub's changed file count; binary/rename-only diffs may need manual review.
- API key stays in GitHub Actions secret; it is never printed or committed.
- Review text appears in GitHub Actions job summary only; no automatic merge.
- Treat Gemini output as suggestions, never a proof of security or correctness.

## Activation after security review
1. Verify the workflow and Codex findings have been reviewed. Do not merge PR #3 before review.
2. After approval and merging this workflow to main, set secret GEMINI_API_KEY in GitHub > Settings > Secrets and variables > Actions (owner reports this is already done).
3. Actions > Gemini manual PR review (restricted API) > Run workflow > branch main, PR number.
4. Read job summary and assess findings. A failed run or quota rejection must not be mistaken for a completed review.

## Costs & privacy
This uses gemini-2.5-flash and makes API requests that are subject to current Google pricing/free limits, which must be independently checked. To avoid charges, do not enable billing; a no-billing project may refuse requests when free usage is unavailable. Diff source code will be sent to Google; do not use with confidential code without approval.

## Future automation
This does not connect Claude or create a fully autonomous multi-AI system. Add independent review gates and tightly scoped developer workflows only after completing baseline audits and CI.
