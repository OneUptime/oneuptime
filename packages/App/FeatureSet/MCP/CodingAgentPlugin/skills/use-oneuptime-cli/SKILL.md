---
name: use-oneuptime-cli
description: Use the OneUptime CLI (@oneuptime/cli) in scripts and CI pipelines, with ONEUPTIME_API_KEY and ONEUPTIME_URL, where no MCP client is available. Use when someone wants a pipeline, cron job or shell script to read or change OneUptime records, stop a deploy while an incident is open, or record a deploy.
---

# Use the OneUptime CLI in scripts and CI

The `oneuptime` command works with the same records as the MCP server, with a project API key instead of a sign-in. Use it where nobody is there to sign in.

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

`oneuptime whoami` shows what the next command will use without calling OneUptime, so it does not prove that the key works. `oneuptime incident count` does.

## Commands

Every kind of record is a command: `oneuptime <resource> <operation>`. `oneuptime resources` lists them.

| Operation                 | Records | Telemetry |
| ------------------------- | ------- | --------- |
| `list`, `count`, `create` | Yes     | Yes       |
| `get`, `update`, `delete` | Yes     | No        |

`delete` takes effect at once: it does not ask, and there is no undo.

```bash
oneuptime incident list --limit 20 -o json
oneuptime incident get <incident-id> -o json
oneuptime monitor create --data '{"name":"Checkout API","monitorType":"Manual"}' -o json
oneuptime monitor create --file monitors/checkout-api.json
oneuptime monitor update <monitor-id> --data '{"name":"Checkout API (EU)"}'
oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}'
```

- `--query` takes a filter: `{"title":"Checkout is down"}` matches a value exactly, and `{"title":{"_type":"Search","value":"checkout"}}` compares.
- `--sort` takes `{"createdAt":"ASC"}` or `"DESC"`. The default is newest first.
- `--limit` defaults to 10. To read everything, raise `--skip` by `--limit` until a page comes back empty.
- Write `-o json` in scripts. In JSON, dates are objects: `.createdAt.value`.
- Wrap JSON in single quotes in Bash and zsh.

To move an incident along, as the dashboard's buttons do, update its state. A state before its current one is refused.

```bash
RESOLVED=$(oneuptime incident-state list --query '{"isResolvedState":true}' --sort '{"order":"ASC"}' --limit 1 -o json | jq -r '.[0]._id')
oneuptime incident update <incident-id> --data "{\"currentIncidentStateId\":\"$RESOLVED\"}"
```

An update answers with an empty object. Run `get` to see the result. To add a note, use `incident-internal-note create` or, for the status page, `incident-public-note create`, with `incidentId` and `note`.

## Exit codes

| Code | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| `0`  | It worked, including a list that finds nothing                              |
| `1`  | It failed: OneUptime refused the request, or the JSON or an option is wrong |
| `2`  | No usable API key: none set, invalid, or a key below its plan               |
| `3`  | Not found: no such record, or the key may not read it                       |

Errors go to standard error, so standard output holds only the answer.

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
- There is no command for putting a monitor on a status page, or for creating an ingestion key. Both are done in the dashboard.
