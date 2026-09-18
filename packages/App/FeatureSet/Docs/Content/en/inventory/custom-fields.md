# Inventory Custom Fields

## Overview

OneUptime discovers *what* is in your estate. Custom fields are how you record everything about it that no amount of observation can tell you — the serial number on the sticker, the date the warranty runs out, which team owns it, whether it is in service or sitting in a spare parts drawer.

Define the fields once for the project, then fill them in per item. They become filter chips on the inventory list, optional table columns, and columns in the CSV export.

Custom fields are available on the **Growth** plan and above.

## Defining Fields

Go to **Inventory → Settings → Custom Fields** and add a field. Each one has a name, an optional description, and a type:

| Type | Use it for |
| ---- | ---------- |
| **Text** | Serial number, asset tag, rack position, purchase order number |
| **Number** | Cost, rack unit, port count |
| **Boolean** | Under support, PCI scope |
| **Dropdown (single select)** | Lifecycle status, environment, criticality — one answer from a fixed list |
| **Dropdown (multi-select)** | Compliance scopes, tags — several answers from a fixed list |
| **Date** | Purchase date, warranty expiry, end-of-life date |
| **Date and time** | Last audited at, decommissioned at |

Dropdown options can each carry a colour, which is used consistently in the table cell and in the filter chip.

## A Worked Asset Vocabulary

A typical hardware asset register maps onto these fields directly:

| Field name | Type | Example |
| ---------- | ---- | ------- |
| `Serial Number` | Text | `FDO24160ABC` |
| `Asset Tag` | Text | `IT-004821` |
| `Purchase Date` | Date | 2024-03-11 |
| `Warranty Expiry` | Date | 2027-03-10 |
| `Lifecycle Status` | Dropdown | In Service / Spare / In Repair / Retired |
| `Assigned Site` | Dropdown | London DC / Frankfurt DC / Office HQ |
| `Owner Team` | Dropdown | Network / Platform / Security |
| `Cost Centre` | Text | `CC-4410` |

Set the values on an item under its **Custom Fields** tab. Values can be set on **any** item regardless of its source, so your discovered switches and mirrored network devices can carry the same asset vocabulary as the appliances you added by hand.

## Filtering

Every custom field becomes a filter chip above the inventory list, and the operators offered match the type:

- **Text** — is, is not, contains, does not contain, starts with, ends with, is empty, is not empty
- **Number** — is, is not, greater than, greater than or equal, less than, less than or equal, is empty, is not empty
- **Dropdown** — is, is not, is empty, is not empty
- **Date and Date/time** — is, is before, is after, is between, is empty, is not empty

Chips combine with AND, so *"Warranty Expiry is before 2026-10-01 AND Lifecycle Status is In Service"* is one view of the list. That is the question an asset register exists to answer, and it is the reason the date types are worth using instead of putting a date in a text field — a text field will happily store `2026-10-01` and then refuse to tell you what expires next quarter.

Custom field columns are hidden by default and can be turned on from the column picker. They cannot be sorted: the values live inside a single JSON column, which the query path cannot order by.

## Notes and Limits

- Values are stored per item under the field's **name**. Renaming a field does not migrate the values already stored under the old name.
- There is no uniqueness constraint. Two items can carry the same serial number; nothing will stop you.
- Dates are stored as ISO-8601 UTC timestamps and displayed in your own timezone.
- Deleting a field definition removes it from the list and from the filter bar. The values already written stay in the underlying record.

## Next

- [Exporting to a CMDB](/docs/inventory/cmdb-sync)
