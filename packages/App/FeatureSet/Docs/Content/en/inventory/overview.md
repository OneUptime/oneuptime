# Inventory

## Overview

**Inventory** is one list of everything OneUptime knows about your estate — services, hosts, containers, Kubernetes objects, network devices, cloud resources, IoT devices, serverless functions, and the things that emit no telemetry at all.

Most of it fills itself in. OneUptime is already watching your estate to monitor it, so the catalog is built from what it observes rather than from what someone remembered to type. What you add by hand is the part observation cannot supply: what a thing is *for*, who owns it, when its warranty runs out.

Find it in the dashboard under **Inventory**.

## Where Items Come From

Every item carries a **source**, and the source decides who owns that row's lifecycle. This is the single most useful thing to understand about the catalog, because it explains why some rows can be edited and some cannot, and why some disappear on their own.

| Source | Where it comes from | Lifecycle |
| ------ | ------------------- | --------- |
| **Discovered** | OpenTelemetry resource attributes, at ingest. A service, host, pod, container, or process that is sending telemetry. | Re-registered on every batch. Goes away on its own once it has been silent past its type's retention window. |
| **Inventory** | Mirrored from a OneUptime table that a poller already maintains — Network Devices, Cloud Resources, IoT Devices, Serverless Functions, RUM Applications, Docker Hosts, Podman Hosts. Refreshed every 15 minutes. | The owning record is the source of truth. Delete the device and its catalog row follows. |
| **Manual** | Created by you, for something OneUptime cannot see: a third-party API, a vendor-managed database, an appliance in a rack. | Never expires. It lives until you delete it. |

A discovered or mirrored row cannot be renamed or re-typed, because the reconciler would overwrite the edit on its next pass. What you *can* always add to any item, whatever its source, is **custom field values** — see [Custom Fields](/docs/inventory/custom-fields).

### Manually Creatable Types

Hand-created items are restricted to three types:

- `external.service` — a third-party API or SaaS dependency
- `external.database` — a managed database outside your telemetry
- `appliance` — hardware or software with no agent

The restriction exists to stop duplicates. A hand-made row of an observable type — a `host`, say — would be keyed on the name you typed, while the discovered row for the same machine is keyed on its semantic attributes. The two could never converge, so you would have the same host in your list twice, forever.

## Archiving vs Deleting

**Archiving** takes an item out of the default list while keeping its identity, its history, and its custom field values. It is a note that says "I have seen this and I do not want it in my list."

**Deleting** a discovered or mirrored item does not stick. Ingest re-creates it on the next batch; the mirror re-creates it on the next sweep. Archive those instead — it is the only disposal that survives.

Archived items live under **Inventory → Archived**.

> If a mirrored device is removed from its owning table, OneUptime removes the catalog row too — **unless that row is carrying custom field values you entered.** In that case it is archived rather than deleted, because those values are the only copy and there is no undo. You will find it under Archived with everything you typed intact.

## Relationships and Topology

Items are linked by a directed relationship graph — `runs-on`, `member-of`, `hosted-on`, `part-of`, `instance-of`, `depends-on` — built from telemetry as it is observed. **Inventory → Topology Map** draws it.

## What You Can Do With an Item

Open any item for its overview, its observed attributes, its connections, and its custom fields. Where the item corresponds to a richer record — a service, host, or Kubernetes cluster — its logs, traces, metrics, profiles, exceptions, incidents, alerts, and scheduled maintenance are on the same page.

## Next

- [Custom Fields](/docs/inventory/custom-fields) — track serial numbers, warranty expiry, owner, and lifecycle status
- [Exporting to a CMDB](/docs/inventory/cmdb-sync) — pull the catalog into an external system of record
