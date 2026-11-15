---
name: use-oneuptime-cli
description: Use the OneUptime CLI (@oneuptime/cli) in scripts and CI pipelines, with ONEUPTIME_API_KEY and ONEUPTIME_URL, where no MCP client is available. Use when someone wants a pipeline, cron job or shell script to read or change OneUptime records, acknowledge or resolve an incident, stop a deploy while an incident is open, or record a deploy.
---

# Use the OneUptime CLI in scripts and CI

The `oneuptime` command does what the OneUptime API does, with a project API key instead of a sign-in: every resource of the API is a command. Use it where nobody is there to sign in.

The person's own instructions come before these steps: where they ask for something else, do what they ask.

## Before you start

- It needs Node.js 22 or later: `npm install -g @oneuptime/cli`. On a self-hosted OneUptime, install the version of the OneUptime it talks to: `npm install -g @oneuptime/cli@<version>`.
- It needs a project API key. The person creates one under **Project Settings → Advanced → API Keys**, with only the access the job needs. A check that only reads needs a key that only reads. Never use a master key.
- On OneUptime Cloud, connecting an MCP client and using API keys need the Growth plan or higher. Below it, every command with a key is refused with `402`. The public status page tools need no credential. They are MCP tools, not CLI commands.

## Give it its credentials

Set both variables from the CI system's secrets. Nothing else is needed: no `oneuptime login`, no configuration file.

| Variable            | Value                                                              |
| ------------------- | ------------------------------------------------------------------ |
| `ONEUPTIME_API_KEY` | The API key                                                        |
| `ONEUPTIME_URL`     | `https://oneuptime.com`, or the address of a self-hosted OneUptime |

Do not pass the key with `--api-key` in a script: it lands in the shell history and the process list. Do not write the key into a file you commit.

`oneuptime whoami --check` asks OneUptime whether it takes the key, and shows the key's project and the versions of OneUptime and the CLI. A key it refuses stops it with exit code `2`. Without `--check`, `whoami` only shows what the next command will use.

## Find what to run

Every resource is a command: `oneuptime <resource> <subcommand>`. A resource takes the subcommands the API takes for it: `list`, `get` and `count` to read it, and `create`, `update` and `delete` to change it. The ones OneUptime writes itself, such as an email log, are read only.

| Command                                    | What it shows                                                   |
| ------------------------------------------ | --------------------------------------------------------------- |
| `oneuptime resources --json`               | Every resource, with its subcommands                            |
| `oneuptime <resource> fields --json`       | Its fields: which ones a create needs, and the flag of each one |
| `oneuptime <resource> <subcommand> --help` | A subcommand's options                                          |

## Read and change records

```bash
oneuptime incident list --limit 20 --json
oneuptime incident list --all --fields title,currentIncidentState.name,createdAt --json
oneuptime incident get <incident-id> --json
oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}'
oneuptime monitor create --name "Checkout API" --monitor-type Manual --json
oneuptime monitor create --file monitors/checkout-api.json --json
oneuptime monitor update <monitor-id> --name "Checkout API (EU)"
```

- Add `--json` to every command in a script. A command that answers with a sentence, such as `delete`, answers in JSON with it. In JSON, dates are objects: `.createdAt.value`.
- `create` and `update` take a flag for each field. `--data` takes the fields as JSON instead, and `--file` reads them from a file; flags go on top of either. The project comes from the key.
- A field that names a person by user ID takes an email address too: `--user-email` beside `--user-id`, `--owner-user-emails` beside `--owner-users`. The CLI looks for them among the members of the key's project and the people invited to it.
- `--query` takes a filter: `{"title":"Checkout is down"}` matches a value exactly, and `{"title":{"_type":"Search","value":"checkout"}}` compares.
- `--sort` takes `{"createdAt":"ASC"}` or `"DESC"`. The default is newest first.
- `--limit` defaults to 10. `--all` reads every page of records, up to 100,000 of them. `--fields` names the fields to return, and after a dot a field of a related record: `currentIncidentState.name`.
- Wrap JSON in single quotes in Bash and zsh.
- An update answers with an empty object. Run `get` to see the result.
- `delete` takes effect at once: it does not ask, and there is no undo.

## Acknowledge, resolve and add notes

These do what the dashboard's buttons do, so a script needs no state IDs:

```bash
oneuptime incident acknowledge <incident-id> --json
oneuptime incident resolve <incident-id> --json
oneuptime incident add-note <incident-id> --note "Rolled back the 14:05 deploy."
oneuptime incident add-note <incident-id> --note "A fix is rolling out." --public
```

Alerts and the episodes of incidents and alerts take the same three, and a maintenance event (`scheduled-maintenance-event`) takes `start`, `end` and `add-note`. A record already in the state is left as it is, and the command still exits with `0`: in JSON, `changed` says whether it moved. A note is for the team, unless `--public` posts it on the status pages, which tells their subscribers. Alerts and their episodes have no public notes.

## Exit codes

| Code | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| `0`  | It worked, including a list that finds nothing                              |
| `1`  | It failed: OneUptime refused the request, or the JSON or an option is wrong |
| `2`  | No usable API key: none set, invalid, or a key below its plan               |
| `3`  | Not found: no such record, or the key may not read it                       |

Errors go to standard error, so standard output holds only the answer. With `--json`, an error is one JSON object, with what to do about it:

```json
{
  "error": {
    "message": "API error (404): Incident not found.",
    "status": 404,
    "exitCode": 3,
    "hint": "`oneuptime incident list` shows the ones this key may read."
  }
}
```

## Stop a deploy while an incident is open

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: lts/*
- name: Install the OneUptime CLI
  run: npm install -g @oneuptime/cli
- name: Stop while an incident is open
  env:
    ONEUPTIME_API_KEY: ${{ secrets.ONEUPTIME_API_KEY }}
    ONEUPTIME_URL: https://oneuptime.com
  run: |
    OPEN=$(oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}')
    if [ "$OPEN" -gt 0 ]; then
      echo "$OPEN incidents are open: not deploying."
      exit 1
    fi
```

## Record a deploy

`oneuptime deploy` draws a deploy on the service's charts, and OneUptime AI reads it during an investigation. It writes with a telemetry ingestion key, not an API key: `ONEUPTIME_TELEMETRY_INGESTION_KEY`, from **Project Settings → Telemetry & APM → Ingestion Keys**.

```bash
oneuptime deploy --service checkout --service-version 2.3.1 --commit "$GIT_SHA" --environment production
```

## What it does not do

- Each run of `create` makes new records. To keep monitors and status pages in step with files, use the Terraform provider.
- A command reaches only what the key's permissions allow. A `422` names the permissions that would let the request in.
