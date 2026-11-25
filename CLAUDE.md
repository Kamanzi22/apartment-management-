# C:\dev workspace

Apartment Manager (owner Kamanzi). All project state is in C:\dev\HANDOFF.md; product rules are in apartment-manager/CLAUDE.md.

## Handoff (applies to every agent)
RULE: At the start of every session read C:\dev\HANDOFF.md first. Every agent updates HANDOFF.md (DONE, IN PROGRESS with the exact next step, REMAINING, TEST STATUS, LAST UPDATED) after every finished task, after every commit, at least every 30 minutes while working, and IMMEDIATELY when usage is running low or a limit message appears. Keep it short, accurate and secret-free. Never stop work without updating it first.

USAGE LOW RULE: on any usage warning or limit message, first write your exact next step into HANDOFF.md, commit your work to your feature branch, then stop.
