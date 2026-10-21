/*
 * An incident's columns as /workflow/model-schema/Incident describes them:
 * the record's own fields, a relation to one record (its state, its
 * severity) with the column holding that record's ID beside it, relations to
 * many (labels, monitors), what OneUptime fills in, the project, and the
 * always-empty Deleted At.
 */

import TableColumnType from "../../../../../Types/Database/TableColumnType";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";

type ColumnFunction = (
  column: Partial<ModelSchemaColumn> & { id: string; title: string },
) => ModelSchemaColumn;

export const column: ColumnFunction = (
  overrides: Partial<ModelSchemaColumn> & { id: string; title: string },
): ModelSchemaColumn => {
  return {
    type: TableColumnType.ShortText,
    isRelation: false,
    ...overrides,
  };
};

type RelatedFieldsFunction = () => Array<ModelSchemaColumn>;

// The fields every related record has.
export const relatedFields: RelatedFieldsFunction =
  (): Array<ModelSchemaColumn> => {
    return [
      column({
        id: "_id",
        title: "ID",
        type: TableColumnType.ObjectID,
        isSystemColumn: true,
      }),
      column({ id: "color", title: "Color", type: TableColumnType.Color }),
      column({
        id: "createdAt",
        title: "Created At",
        type: TableColumnType.Date,
        isSystemColumn: true,
      }),
      column({
        id: "deletedAt",
        title: "Deleted At",
        type: TableColumnType.Date,
        isSystemColumn: true,
      }),
      column({
        id: "description",
        title: "Description",
        type: TableColumnType.LongText,
      }),
      column({ id: "name", title: "Name" }),
      column({
        id: "projectId",
        title: "Project ID",
        type: TableColumnType.ObjectID,
        isTenantColumn: true,
      }),
    ];
  };

export const INCIDENT_COLUMNS: Array<ModelSchemaColumn> = [
  column({
    id: "_id",
    title: "ID",
    type: TableColumnType.ObjectID,
    isSystemColumn: true,
  }),
  column({
    id: "title",
    title: "Title",
    type: TableColumnType.LongText,
    required: true,
  }),
  column({
    id: "description",
    title: "Description",
    type: TableColumnType.Markdown,
  }),
  column({
    id: "declaredAt",
    title: "Declared At",
    type: TableColumnType.Date,
    required: true,
    description: "Date and time when this incident was declared.",
  }),
  column({
    id: "currentIncidentState",
    title: "Current Incident State",
    type: TableColumnType.Entity,
    isRelation: true,
    isSystemColumn: true,
    relationIdColumn: "currentIncidentStateId",
    relatedTableName: "IncidentState",
    relatedColumns: relatedFields(),
  }),
  column({
    id: "currentIncidentStateId",
    title: "Current Incident State ID",
    type: TableColumnType.ObjectID,
    required: true,
  }),
  column({
    id: "incidentSeverity",
    title: "Incident Severity",
    type: TableColumnType.Entity,
    isRelation: true,
    relationIdColumn: "incidentSeverityId",
    relatedTableName: "IncidentSeverity",
    relatedColumns: relatedFields(),
  }),
  column({
    id: "incidentSeverityId",
    title: "Incident Severity ID",
    type: TableColumnType.ObjectID,
    required: true,
  }),
  column({
    id: "labels",
    title: "Labels",
    type: TableColumnType.EntityArray,
    isRelation: true,
    relatedTableName: "Label",
    relatedColumns: relatedFields(),
  }),
  column({
    id: "monitors",
    title: "Monitors",
    type: TableColumnType.EntityArray,
    isRelation: true,
    relatedTableName: "Monitor",
    relatedColumns: relatedFields(),
  }),
  column({
    id: "createdByProbe",
    title: "Created By Probe",
    type: TableColumnType.Entity,
    isRelation: true,
    relationIdColumn: "createdByProbeId",
    relatedTableName: "Probe",
    relatedColumns: relatedFields(),
  }),
  column({
    id: "createdByProbeId",
    title: "Created By Probe ID",
    type: TableColumnType.ObjectID,
  }),
  column({
    id: "createdAt",
    title: "Created At",
    type: TableColumnType.Date,
    isSystemColumn: true,
  }),
  column({
    id: "updatedAt",
    title: "Updated At",
    type: TableColumnType.Date,
    isSystemColumn: true,
  }),
  column({
    id: "createdByUserId",
    title: "Created by User ID",
    type: TableColumnType.ObjectID,
    isSystemColumn: true,
  }),
  column({
    id: "deletedAt",
    title: "Deleted At",
    type: TableColumnType.Date,
    isSystemColumn: true,
  }),
  column({
    id: "incidentNumber",
    title: "Incident Number",
    type: TableColumnType.Number,
    isSystemColumn: true,
  }),
  column({
    id: "incidentNumberWithPrefix",
    title: "Incident Number With Prefix",
    type: TableColumnType.ShortText,
    isSystemColumn: true,
  }),
  column({
    id: "isPrivate",
    title: "Is Private?",
    type: TableColumnType.Boolean,
  }),
  column({
    id: "project",
    title: "Project",
    type: TableColumnType.Entity,
    isRelation: true,
    isTenantColumn: true,
    relationIdColumn: "projectId",
    relatedColumns: relatedFields(),
  }),
  column({
    id: "projectId",
    title: "Project ID",
    type: TableColumnType.ObjectID,
    required: true,
    isTenantColumn: true,
  }),
];
