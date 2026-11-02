import ObjectID from "../ObjectID";

/*
 * EVERY KIND OF RECORD THAT HOLDS CUSTOM FIELD VALUES, AND WHERE ITS FIELDS
 * ARE DEFINED.
 *
 * A record keeps its values in a `customFields` bag keyed by each field's
 * name; the fields themselves - their names and types - are rows of one of
 * nine definition tables. A template holds values for the fields of what it
 * creates (an incident template, an incident's), and a person's profile in a
 * project (ProjectUserProfile) holds the team member fields.
 *
 * What needs the pairing: the server, to know which of a write's values are
 * files (Server/Utils/CustomField/CustomFieldFiles) and to serve one only to
 * someone who may read its record; the dashboard, to link a file to that
 * route. Common/Tests/Types/CustomField/CustomFieldRecordKinds fails when a
 * model gains a `customFields` column without being listed here.
 *
 * Pure, with no database or React imports.
 */
export interface CustomFieldRecordKind {
  // The record's table: "Incident".
  recordTableName: string;
  // The table its fields are defined in: "IncidentCustomField".
  definitionTableName: string;
  /*
   * The record kind in a file's download address,
   * /api/custom-field-file/<projectId>/<routeName>/<recordId>/<fileId>.
   */
  routeName: string;
}

export const CUSTOM_FIELD_RECORD_KINDS: ReadonlyArray<CustomFieldRecordKind> = [
  {
    recordTableName: "Incident",
    definitionTableName: "IncidentCustomField",
    routeName: "incident",
  },
  {
    recordTableName: "IncidentTemplate",
    definitionTableName: "IncidentCustomField",
    routeName: "incident-template",
  },
  {
    recordTableName: "Alert",
    definitionTableName: "AlertCustomField",
    routeName: "alert",
  },
  {
    recordTableName: "Monitor",
    definitionTableName: "MonitorCustomField",
    routeName: "monitor",
  },
  {
    recordTableName: "MonitorTemplate",
    definitionTableName: "MonitorCustomField",
    routeName: "monitor-template",
  },
  {
    recordTableName: "ScheduledMaintenance",
    definitionTableName: "ScheduledMaintenanceCustomField",
    routeName: "scheduled-maintenance",
  },
  {
    recordTableName: "ScheduledMaintenanceTemplate",
    definitionTableName: "ScheduledMaintenanceCustomField",
    routeName: "scheduled-maintenance-template",
  },
  {
    recordTableName: "StatusPage",
    definitionTableName: "StatusPageCustomField",
    routeName: "status-page",
  },
  {
    recordTableName: "OnCallDutyPolicy",
    definitionTableName: "OnCallDutyPolicyCustomField",
    routeName: "on-call-duty-policy",
  },
  {
    recordTableName: "Team",
    definitionTableName: "TeamCustomField",
    routeName: "team",
  },
  {
    recordTableName: "ProjectUserProfile",
    definitionTableName: "TeamMemberCustomField",
    routeName: "team-member",
  },
  {
    recordTableName: "InventoryItem",
    definitionTableName: "InventoryItemCustomField",
    routeName: "inventory-item",
  },
];

export type GetCustomFieldRecordKindFunction = (
  recordTableName: string | null | undefined,
) => CustomFieldRecordKind | undefined;

// The kind of record a table holds, when its records have custom fields.
export const getCustomFieldRecordKind: GetCustomFieldRecordKindFunction = (
  recordTableName: string | null | undefined,
): CustomFieldRecordKind | undefined => {
  if (!recordTableName) {
    return undefined;
  }

  return CUSTOM_FIELD_RECORD_KINDS.find(
    (kind: CustomFieldRecordKind): boolean => {
      return kind.recordTableName === recordTableName;
    },
  );
};

export type GetCustomFieldRecordKindByRouteNameFunction = (
  routeName: unknown,
) => CustomFieldRecordKind | undefined;

// The kind of record a download address names.
export const getCustomFieldRecordKindByRouteName: GetCustomFieldRecordKindByRouteNameFunction =
  (routeName: unknown): CustomFieldRecordKind | undefined => {
    if (typeof routeName !== "string") {
      return undefined;
    }

    return CUSTOM_FIELD_RECORD_KINDS.find(
      (kind: CustomFieldRecordKind): boolean => {
        return kind.routeName === routeName;
      },
    );
  };

// Where a file custom field's file is downloaded, under the API's root.
export const CUSTOM_FIELD_FILE_ROUTE: string = "/custom-field-file";

export type GetCustomFieldFileDownloadPathFunction = (data: {
  recordTableName: string | null | undefined;
  projectId: ObjectID | string | null | undefined;
  recordId: ObjectID | string | null | undefined;
  fileId: string | null | undefined;
}) => string | null;

/**
 * The path, under the API's root, that downloads one file a record's file
 * custom field holds - "/custom-field-file/<projectId>/incident/<incidentId>/
 * <fileId>" - or null when one of them is missing or not an id, or the
 * record's kind has no custom fields.
 */
export const getCustomFieldFileDownloadPath: GetCustomFieldFileDownloadPathFunction =
  (data: {
    recordTableName: string | null | undefined;
    projectId: ObjectID | string | null | undefined;
    recordId: ObjectID | string | null | undefined;
    fileId: string | null | undefined;
  }): string | null => {
    const kind: CustomFieldRecordKind | undefined = getCustomFieldRecordKind(
      data.recordTableName,
    );

    const ids: Array<string> = [data.projectId, data.recordId, data.fileId].map(
      (id: ObjectID | string | null | undefined): string => {
        return id ? id.toString().trim().toLowerCase() : "";
      },
    );

    if (
      !kind ||
      !ids.every((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      })
    ) {
      return null;
    }

    return `${CUSTOM_FIELD_FILE_ROUTE}/${ids[0]}/${kind.routeName}/${ids[1]}/${ids[2]}`;
  };
