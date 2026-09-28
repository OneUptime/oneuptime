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
| `descriptiveAttributes` | Mutable observed metadata — see [Host asset attributes](#host-asset-attributes) and [Network device asset attributes](#network-device-asset-attributes) below |
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

Each network device's `descriptiveAttributes` carries its serial number, MAC address, make, model and firmware — see [Network device asset attributes](#network-device-asset-attributes) below. Anything else the poller knows (site, role, interfaces, neighbors) lives on the Network Device record itself: follow `resourceId` to `/api/network-device/:id/get-item`, or pull `/api/network-device/get-list` directly.

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

## Host Asset Attributes

`descriptiveAttributes` on a **host** carries the asset facts a CMDB row usually wants, keyed by their OpenTelemetry attribute name:

| Field | Key | Collected by default? |
| ----- | --- | --------------------- |
| IP addresses | `host.ip` | Yes — comma-separated when the machine has several |
| MAC addresses | `host.mac` | Yes — comma-separated, one per interface that is up, as `AC-DE-48-23-45-67` |
| Architecture | `host.arch` | Yes |
| Machine id | `host.id` | Yes — the machine GUID on Windows, `/etc/machine-id` on Linux |
| Operating system | `os.type`, `os.description`, `os.version` | Yes |
| Cloud placement | `cloud.provider`, `cloud.region`, `cloud.availability_zone` | Only with a cloud detector |
| Serial number | `host.serial_number` | Needs one config step |
| Make | `device.manufacturer` | Needs one config step |
| Model | `device.model.name` | Needs one config step |
| Firmware (BIOS / UEFI) version | `device.firmware.version` | Needs one config step |

Everything marked *Yes* comes from the collector's `resourcedetection` processor and is already in the config OneUptime generates for you.

The `cloud.*` keys need a cloud detector in that processor — `detectors: [system, env, ec2]`, or `gcp` / `azure` for the others. The shipped config runs `[system, env]` only, so those three stay empty until you add one.

The last four have no resource detector — they live in the machine's firmware, read through WMI on Windows and DMI on Linux — so they are stamped onto the resource once, when the machine is provisioned. [Inventory attributes](/docs/telemetry/host-otel-collector#inventory-attributes-ip-mac-serial-number-make-model-firmware) has the exact snippet for each OS. `host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys (and `device.serial_number` under `host.serial_number`), so a sync only ever has to read one key per fact.

`host.id` is worth a look as a correlation key if your CMDB already keys on a hardware identifier — unlike `entityKey` it is the machine's own id, so it matches what an endpoint management tool reports for the same box.

Attributes are additive: one that stops being reported stays on the row rather than being blanked, so a value your sync has already read never silently disappears.

## Network Device Asset Attributes

A **network device** (`entityType: network.device`) is mirrored from its Network Device record, and its `descriptiveAttributes` use the same keys a host uses for the same facts — so one CMDB column holds the serial number whether the row is a server or a switch:

| Field | Key | Where it comes from |
| ----- | --- | ------------------- |
| Hostname / IP | `net.device.hostname` | The address OneUptime polls |
| DNS name | `net.device.dns_name` | The reverse-DNS name found at discovery |
| MAC address | `host.mac` | Typed on the device, or learned from a walked router's ARP table |
| Make | `device.manufacturer` | ENTITY-MIB `entPhysicalMfgName`, else the vendor of the `sysObjectID` |
| Model | `device.model.name` | ENTITY-MIB `entPhysicalModelName` |
| Serial number | `host.serial_number` | ENTITY-MIB `entPhysicalSerialNum` |
| Firmware version | `device.firmware.version` | ENTITY-MIB `entPhysicalFirmwareRev` |
| Software / OS version | `os.version` | ENTITY-MIB `entPhysicalSoftwareRev` |
| System description | `os.description` | `sysDescr` |

The hardware rows fill in after the device's first SNMP walk, so a device monitored by ping alone — or one added but not yet polled — shows only its hostname. A device that does not implement ENTITY-MIB has no serial, model or firmware to report; its `sysDescr` usually still names the software version.

These are copied from the Network Device record every fifteen minutes and **replace** the previous values rather than adding to them, so a value cleared on the device (a MAC removed, say) also leaves the inventory item.

There is no *available upgrade* version: SNMP has no standard object for one, so OneUptime records the version the device is running.

## Correlating With Your CMDB

Use **`entityKey`**, not `displayName`. It is a hash of the thing's identifying attributes, so it survives renames and re-tagging — a host that gets relabelled keeps the same key, while its display name changes. `_id` is equally stable and is the simplest foreign key if you only ever talk to one project.

Dates in `customFields` are ISO-8601 UTC strings, and the CSV export writes them in that form rather than the humanised form shown in the UI, so they import without parsing surprises.

## Keeping It Fresh

There is no change feed. Poll the list endpoint on whatever interval suits you and diff on `entityKey`. `lastSeenAt` tells you when a thing was last observed, which is usually the cheapest way to spot what has gone quiet since your last run.

Rows that disappear between runs have either aged out (a discovered item silent past its retention window) or had their owning record deleted. Rows that carry custom field values are archived rather than deleted, so query with `"isArchived": true` if you want to see what has been retired without losing the asset data attached to it.

## Writing Back

The same endpoints accept writes, so an integration can push values into `customFields` — stamping the asset tag your CMDB already owns onto the matching OneUptime item, for example. Grant the key **Edit Telemetry Service** to do that.

You can also create items for things OneUptime cannot see, using `POST /api/inventory-item` with `entityType` of `external.service`, `external.database`, or `appliance`, plus a `displayName`. OneUptime derives the identity key for you; those rows are never expired.
