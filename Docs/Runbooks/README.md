# Runbooks

Runbooks are reusable response procedures — ordered lists of manual or automated steps — that you attach to incidents, alerts, or scheduled maintenance events. They turn ad-hoc "what do we do now?" Slack threads into something a teammate can pick up cold at 3am.

## At a glance

- **Top-level feature** in the OneUptime dashboard under **Analytics & Automation → Runbooks**.
- **Four step types**: Manual checklist, JavaScript (sandboxed), HTTP request, Bash (gated by env flag).
- **Three trigger paths**: rules that match incidents/alerts/scheduled maintenance, or a manual "Run Runbook" button on any event.
- **Snapshot semantics**: when a runbook starts, its steps are copied onto the execution. Editing the template later never mutates an in-flight run.

## Where to read next

- [Authoring a runbook](./authoring.md) — creating runbooks, the four step types, and what each does.
- [Runbook rules](./rules.md) — auto-attaching runbooks to incidents, alerts, and scheduled maintenance events.
- [Running a runbook](./running.md) — manual triggers, the execution view, and how manual steps interact with automated ones.
- [Configuration & safety](./configuration.md) — environment flags, the bash escape hatch, output limits.
