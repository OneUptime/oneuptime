# Import and Export Label Rules

Every **Label Rules** page has **Export JSON** and **Import JSON** actions in its **More options** (⋯) menu, including Incidents, Alerts, Monitors, and Network Devices.

## Export rules

Open **More options** and select **Export JSON** to download all rules of that type in the current project. The export includes rules on other table pages and ignores table filters. It preserves enabled status, conditions, labels to add, and label inheritance options. Project IDs, rule IDs, and audit fields are excluded.

Linked labels, monitors, and severities are represented by their exact names. These resources are not created by an import.

## Import rules

1. Open the destination project's **Label Rules** page and select **More options → Import JSON**.
2. Upload a JSON export file or paste its contents.
3. Select **Validate and preview**. All rules are checked before any are created. Referenced resources must exist with unique, matching names in the destination project.
4. Review the rule names, enabled status, labels, and conditions. Large batches have a paginated preview. Select **Edit JSON** to make corrections and validate again.
5. Select **Import** to create the rules. Keep the window open until the results appear.

Imports add new rules and keep existing rules. Importing the same file again creates another copy. The normal create permissions and server validation apply to every rule.

If some rules fail, select **Download failed rules** to save only those rows. Correct them and import that file again. When a request times out, check the rule list before retrying, because the server may have saved the rule before its response was lost.

## Create a batch in JSON

Export an existing rule to get an example for your resource type, then edit or add entries in the `items` array. This example creates two monitor label rules. The labels `Production` and `Infrastructure` must already exist in the destination project.

```json
{
  "fileType": "oneuptime-label-rules",
  "schemaVersion": 1,
  "resourceType": "MonitorLabelRule",
  "items": [
    {
      "name": "Production API monitors",
      "description": "Label production API monitors automatically",
      "isEnabled": true,
      "monitorNamePattern": "^api-prod-",
      "monitorLabels": [],
      "labelsToAdd": ["Production"]
    },
    {
      "name": "Database monitors",
      "isEnabled": false,
      "monitorNamePattern": "^database-",
      "labelsToAdd": ["Infrastructure"]
    }
  ]
}
```

Use JSON booleans for `isEnabled`, text for patterns, and arrays of names for linked resources. Invalid patterns, unknown fields, missing names, and ambiguous references prevent the whole batch from reaching the import step. Files and pasted JSON are limited to 10 MB.

## Copy between resource types

Keep the original `resourceType` in the file and open **Import JSON** on the destination page. Compatible primary name/title patterns, description patterns, and prerequisite labels are mapped to the destination's fields. Incident and alert severity references are matched against the destination severity names.

Configured conditions or actions that the destination does not support block the import. For example, an incident rule restricted to specific monitors cannot be copied to Network Device rules without editing those conditions. The preview lists field mappings so they can be reviewed.

Network Device rules support wildcard matching as well as regular expressions. Transfers between Network Device rules and other rule types reject patterns containing `*` or surrounding whitespace, where the matching behavior differs. Edit those patterns explicitly for the destination, or keep the rule within the same resource type.
