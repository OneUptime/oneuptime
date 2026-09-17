# Exporting Inventory to a CMDB

## Overview

If you already run a CMDB or asset register, OneUptime is not trying to replace it. What OneUptime has that a CMDB usually does not is a continuously observed picture of what is actually running — discovered from telemetry and from the pollers that already watch your network and cloud accounts, refreshed without anyone maintaining it.

This page is the recipe for pulling that picture into your own system of record.

## What You Can Pull

Three REST resources, all standard CRUD endpoints:

| Resource | Endpoint | What it holds |
| -------- | -------- | ------------- |
| Inventory Item | `/api/inventory-item` | One row per thing in the estate |
| Custom Field definitions | `/api/inventory-item-custom-field` | Your project's own field vocabulary |
| Relationships | `/api/inventory-item-relationship` | The directed edges between items |

Useful columns on an inventory item:

| Column | Meaning |
| ------ | ------- |
| `_id` | OneUptime's id — use it as your external reference |
| `entityType` | `host`, `k8s.pod`, `network.device`, `appliance`, … |
| `entityKey` | Stable identity hash. Survives renames, so it is the better correlation key |
| `displayName` | Human-readable name |
| `source` | `discovered`, `inventory`, or `manual` |
| `description` | Free text |
| `identifyingAttributes` | The immutable attribute set that defines this thing's identity |
| `descriptiveAttributes` | Mutable observed metadata — image tag, version, IP |
| `customFields` | Your own fields, keyed by field name |
| `resourceType` / `resourceId` | Pointer to the richer OneUptime record, when one exists |
| `firstSeenAt` / `lastSeenAt` | Observation window |
| `isArchived` | Whether it has been taken out of the live list |

## Authentication

Create an API key under **Project Settings → API Keys** and grant it **Read Telemetry Service**. Inventory reuses the telemetry permission family rather than having one of its own, so that single permission is what a read-only export needs.

Send it as two headers:

```
apikey: <your-api-key>
projectid: <your-project-id>
```

## Pulling the Catalog

`POST` to the list endpoint with the columns you want. `select` is required — the API returns only what you ask for.

```bash
curl -X POST 'https://oneuptime.com/api/inventory-item/get-list' \
  -H 'apikey: YOUR_API_KEY' \
  -H 'projectid: YOUR_PROJECT_ID' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": { "isArchived": false },
    "select": {
      "_id": true,
      "entityType": true,
      "entityKey": true,
      "displayName": true,
      "source": true,
      "customFields": true,
      "descriptiveAttributes": true,
      "lastSeenAt": true
    },
    "sort": { "displayName": "ASC" },
    "limit": 100,
    "skip": 0
  }'
```

Page by increasing `skip` until you get fewer rows back than your `limit`.

### Just the network devices

Narrow by `entityType`:

```bash
curl -X POST 'https://oneuptime.com/api/inventory-item/get-list' \
  -H 'apikey: YOUR_API_KEY' \
  -H 'projectid: YOUR_PROJECT_ID' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": { "entityType": "network.device", "isArchived": false },
    "select": { "_id": true, "entityKey": true, "displayName": true, "customFields": true },
    "limit": 100,
    "skip": 0
  }'
```

The discovered hardware detail — vendor, model, serial number, firmware, site — lives on the Network Device record itself. Follow `resourceId` to `/api/network-device/:id/get-item` for it, or pull `/api/network-device/get-list` directly.

### As CSV

Any list endpoint will return CSV instead of JSON with `?output-type=csv`:

```bash
curl -X POST 'https://oneuptime.com/api/inventory-item/get-list?output-type=csv' \
  -H 'apikey: YOUR_API_KEY' \
  -H 'projectid: YOUR_PROJECT_ID' \
  -H 'Content-Type: application/json' \
  -d '{ "query": {}, "select": { "displayName": true, "entityType": true, "customFields": true }, "limit": 500, "skip": 0 }' \
  -o inventory.csv
```

The inventory list in the dashboard exports the same way, including whichever custom field columns you have turned on.

## Correlating With Your CMDB

Use **`entityKey`**, not `displayName`. It is a hash of the thing's identifying attributes, so it survives renames and re-tagging — a host that gets relabelled keeps the same key, while its display name changes. `_id` is equally stable and is the simplest foreign key if you only ever talk to one project.

Dates in `customFields` are ISO-8601 UTC strings, and the CSV export writes them in that form rather than the humanised form shown in the UI, so they import without parsing surprises.

## Keeping It Fresh

There is no change feed. Poll the list endpoint on whatever interval suits you and diff on `entityKey`. `lastSeenAt` tells you when a thing was last observed, which is usually the cheapest way to spot what has gone quiet since your last run.

Rows that disappear between runs have either aged out (a discovered item silent past its retention window) or had their owning record deleted. Rows that carry custom field values are archived rather than deleted, so query with `"isArchived": true` if you want to see what has been retired without losing the asset data attached to it.

## Writing Back

The same endpoints accept writes, so an integration can push values into `customFields` — stamping the asset tag your CMDB already owns onto the matching OneUptime item, for example. Grant the key **Edit Telemetry Service** to do that.

You can also create items for things OneUptime cannot see, using `POST /api/inventory-item` with `entityType` of `external.service`, `external.database`, or `appliance`, plus a `displayName`. OneUptime derives the identity key for you; those rows are never expired.
