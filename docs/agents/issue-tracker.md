# GitHub Issues

Use GitHub Issues for `j0yk1ll/sensewell`. Pass `--repo j0yk1ll/sensewell` to `gh issue` commands so they target this repository.

- To publish a ticket or spec, use `gh issue create --title "..." --body-file <path>`.
- To fetch a ticket, use `gh issue view <number> --json number,title,body,labels,comments`.
- To find tickets, use `gh issue list` with the relevant `--state` and `--label` filters.
- To update triage labels, use `gh issue edit <number>` with `--add-label` or `--remove-label`.
- To close a ticket, post the explanation with `gh issue comment <number> --body-file <path>`, then run `gh issue close <number>`.

## Sub-issues and dependencies

- Create a child with `gh issue create --parent <parent> ...` or link an existing child with `gh issue edit <parent> --add-sub-issue <child>`.
- Add a blocker with `gh issue create --blocked-by <blocker> ...` or `gh issue edit <child> --add-blocked-by <blocker>`.
- Check open blockers with `gh issue view <number> --json blockedBy --jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`. A ticket is unblocked when the count is zero.
- If native relationships are unavailable, add `Part of #<parent>` or `Blocked by: #<blocker>` at the top of the child issue body.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding

- Create the map as an issue labelled `wayfinder:map`. Keep its notes, decisions, and open questions in the issue body.
- Link tickets as sub-issues and label them `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Pick the first open, unassigned child without an open blocker in map order. Claim it with `gh issue edit <number> --add-assignee @me`.
- Record the outcome on the ticket, close it, and add a summary and issue link to the map's decisions.
