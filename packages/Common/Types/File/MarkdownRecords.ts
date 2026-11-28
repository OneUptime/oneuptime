import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  CustomFieldRecordKind,
  getCustomFieldRecordKind,
} from "../CustomField/CustomFieldRecordKinds";
import { TableColumnMetadata } from "../Database/TableColumn";
import TableColumnType from "../Database/TableColumnType";

/*
 * WHICH RECORDS CAN SHOW FILES IN MARKDOWN, read from the models themselves
 * (Types/File/MarkdownFiles says what is done with them, #11256).
 *
 * A record shows files in Markdown when its model has a Markdown column - an
 * incident's description, a note - or holds custom fields, any of which may
 * be a Markdown field. Only a record of a project: an image is a file of
 * the project it was uploaded in, and a record holds only those.
 *
 * The server gives every such model its markdown-files route, and a Get
 * Files From Markdown step reads the ones a workflow can read (Find One):
 * the same rule, here, so the builder offers exactly the record types the
 * step accepts. Pure: the server and the dashboard both read it.
 */

// The column every record keeps its custom field values in.
export const CUSTOM_FIELDS_COLUMN: string = "customFields";

/*
 * The record types people paste pictures into most, in the order the Record
 * Type list leads with. Every other record type follows, by name.
 */
export const COMMON_MARKDOWN_RECORD_TABLE_NAMES: ReadonlyArray<string> = [
  "Incident",
  "IncidentPublicNote",
  "IncidentInternalNote",
  "IncidentStateTimeline",
  "Alert",
  "AlertInternalNote",
  "ScheduledMaintenance",
  "ScheduledMaintenancePublicNote",
  "ScheduledMaintenanceInternalNote",
  "IncidentEpisode",
  "IncidentEpisodePublicNote",
  "IncidentEpisodeInternalNote",
  "AlertEpisode",
  "AlertEpisodeInternalNote",
  "StatusPageAnnouncement",
];

export type GetMarkdownColumnsFunction = (model: BaseModel) => Array<string>;

/*
 * A model's Markdown columns, in the order it declares them: the order their
 * files are handed out in.
 */
export const getMarkdownColumns: GetMarkdownColumnsFunction = (
  model: BaseModel,
): Array<string> => {
  return model
    .getTableColumns()
    .columns.filter((columnName: string): boolean => {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(columnName);

      return metadata?.type === TableColumnType.Markdown;
    });
};

export type GetMarkdownCustomFieldKindFunction = (
  model: BaseModel,
) => CustomFieldRecordKind | undefined;

// The kind of custom fields a model's records hold, when they hold them.
export const getMarkdownCustomFieldKind: GetMarkdownCustomFieldKindFunction = (
  model: BaseModel,
): CustomFieldRecordKind | undefined => {
  if (!model.getTableColumns().columns.includes(CUSTOM_FIELDS_COLUMN)) {
    return undefined;
  }

  return getCustomFieldRecordKind(model.tableName);
};

export type CanShowMarkdownFilesFunction = (model: BaseModel) => boolean;

/*
 * Whether a model's records can show files in Markdown: records of a project
 * with a Markdown column, or with custom fields. These get the
 * markdown-files route.
 */
export const canShowMarkdownFiles: CanShowMarkdownFilesFunction = (
  model: BaseModel,
): boolean => {
  return (
    Boolean(model.tableName) &&
    Boolean(model.getTenantColumn()) &&
    (getMarkdownColumns(model).length > 0 ||
      Boolean(getMarkdownCustomFieldKind(model)))
  );
};

/*
 * MARKDOWN THAT A RECORD KEEPS INSIDE A JSON COLUMN, by table: the incident
 * and the alert a monitor's criteria open (their description and
 * remediation notes, in the monitor's steps), and a playbook's steps (a
 * note to add, an announcement to post). The dashboard edits each with the
 * Markdown editor, which uploads a pasted picture as it does for any
 * Markdown field, so the record shows that image to whoever may read it
 * (#11478). A column named here must be one of the model's JSON columns, or
 * its Monitor Steps (MarkdownRecords.test).
 */
export const MARKDOWN_IN_JSON_COLUMNS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  Monitor: ["monitorSteps"],
  MonitorTemplate: ["monitorSteps"],
  SecurityPlaybook: ["steps"],
};

export type GetMarkdownInJsonColumnsFunction = (
  model: BaseModel,
) => Array<string>;

// The JSON columns of a model that hold Markdown people write, when any.
export const getMarkdownInJsonColumns: GetMarkdownInJsonColumnsFunction = (
  model: BaseModel,
): Array<string> => {
  const columns: ReadonlyArray<string> =
    (model.tableName &&
      Object.prototype.hasOwnProperty.call(
        MARKDOWN_IN_JSON_COLUMNS,
        model.tableName,
      ) &&
      MARKDOWN_IN_JSON_COLUMNS[model.tableName]) ||
    [];

  const tableColumns: Array<string> = model.getTableColumns().columns;

  return columns.filter((column: string): boolean => {
    return tableColumns.includes(column);
  });
};

export type GetImageColumnsFunction = (model: BaseModel) => Array<string>;

/*
 * The columns a record can show an inline image in, to the people who may
 * read them (#11478): its Markdown columns, the Markdown it keeps in JSON
 * columns, and its custom fields, any of which may be a Markdown field.
 * Wider than what a Get Files From Markdown step reads (its Markdown
 * columns and Markdown custom fields): the image's address opens it for a
 * person wherever the dashboard shows it to them.
 */
export const getImageColumns: GetImageColumnsFunction = (
  model: BaseModel,
): Array<string> => {
  return [
    ...getMarkdownColumns(model),
    ...getMarkdownInJsonColumns(model),
    ...(getMarkdownCustomFieldKind(model) ? [CUSTOM_FIELDS_COLUMN] : []),
  ];
};

export type CanShowImagesFunction = (model: BaseModel) => boolean;

/*
 * Whether a model's records can show inline images to the people who may
 * read them: records of a project with a column of getImageColumns. Every
 * write of one is read for the images it shows (Server/Utils/File/
 * ShownImages).
 */
export const canShowImages: CanShowImagesFunction = (
  model: BaseModel,
): boolean => {
  return (
    Boolean(model.tableName) &&
    Boolean(model.getTenantColumn()) &&
    getImageColumns(model).length > 0
  );
};

export type IsMarkdownFilesRecordTypeFunction = (model: BaseModel) => boolean;

/*
 * Whether a Get Files From Markdown step reads this kind of record: one that
 * can show files, and that a workflow reads at all (its Find One step).
 */
export const isMarkdownFilesRecordType: IsMarkdownFilesRecordTypeFunction = (
  model: BaseModel,
): boolean => {
  return canShowMarkdownFiles(model) && Boolean(model.enableWorkflowOn?.read);
};

export type GetMarkdownFilesRecordTypesFunction = (
  models: Array<BaseModel>,
) => Array<BaseModel>;

/*
 * The record types a Get Files From Markdown step reads, as its Record Type
 * list shows them: the common ones first, in their order, then the rest by
 * name. Each once.
 */
export const getMarkdownFilesRecordTypes: GetMarkdownFilesRecordTypesFunction =
  (models: Array<BaseModel>): Array<BaseModel> => {
    const byTable: Map<string, BaseModel> = new Map();

    for (const model of models) {
      if (
        model.tableName &&
        !byTable.has(model.tableName) &&
        isMarkdownFilesRecordType(model)
      ) {
        byTable.set(model.tableName, model);
      }
    }

    const common: Array<BaseModel> = [];

    for (const tableName of COMMON_MARKDOWN_RECORD_TABLE_NAMES) {
      const model: BaseModel | undefined = byTable.get(tableName);

      if (model) {
        common.push(model);
        byTable.delete(tableName);
      }
    }

    const rest: Array<BaseModel> = Array.from(byTable.values()).sort(
      (left: BaseModel, right: BaseModel): number => {
        return (left.singularName || left.tableName || "").localeCompare(
          right.singularName || right.tableName || "",
        );
      },
    );

    return [...common, ...rest];
  };
