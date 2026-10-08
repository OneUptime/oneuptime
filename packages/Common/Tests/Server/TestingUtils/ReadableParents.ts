import { jest } from "@jest/globals";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ObjectID from "../../../Types/ObjectID";

/*
 * Answers the read a create makes of the record it is created under, the
 * way the database would, without one.
 *
 * A record read through another one - an incident's notes and state
 * timeline, an alert's, an episode's - is created only under a parent its
 * creator may read (CreatePermission.checkParentPermission). A caller whose
 * read of the parent is narrowed is looked up: by labels, by Owned scope, by
 * a block with labels, and - on an incident, an alert or an episode, whose
 * private records only their owners and project owners and admins see -
 * anyone who is not a project owner or admin. The lookup is one read of the
 * parent's table as the caller (DatabaseService.findReadableParentIds),
 * which a suite about something else answers here:
 *
 *   stubReadableParents();               // every parent named is readable
 *   stubReadableParents([INCIDENT_ID]);  // only these are
 *
 * Ids are compared lower-cased, as Postgres renders a uuid.
 */

export interface ReadableParentLookup {
  // The parent's table name ("Incident").
  parentTable: string;
  ids: Array<string>;
}

// A lookup by OneUptime, of records by id: the table read and the ids.
export interface RecordLookup {
  table: string;
  ids: Array<string>;
}

/*
 * Answers the reads OneUptime makes of records in the write's project,
 * without a database (DatabaseService.findIdsInProject): a parent whose read
 * the caller is not held to, or a listed record of a model they hold no read
 * of, on a service that checks no reference itself.
 *
 *   stubRecordsInProject();               // every record named is the project's
 *   stubRecordsInProject([INCIDENT_ID]);  // only these are
 */
export function stubRecordsInProject(
  inProjectIds?: Array<ObjectID | string> | undefined,
): Array<RecordLookup> {
  const lookups: Array<RecordLookup> = [];
  const found: Set<string> | null = inProjectIds
    ? new Set<string>(
        inProjectIds.map((id: ObjectID | string): string => {
          return id.toString().toLowerCase();
        }),
      )
    : null;

  jest
    .spyOn(
      DatabaseService as unknown as {
        findIdsInProject: (data: {
          modelType: { new (): DatabaseBaseModel };
          ids: Array<string>;
        }) => Promise<Array<string>>;
      },
      "findIdsInProject",
    )
    .mockImplementation(
      async (data: {
        modelType: { new (): DatabaseBaseModel };
        ids: Array<string>;
      }): Promise<Array<string>> => {
        lookups.push({
          table: new data.modelType().tableName || "",
          ids: [...data.ids],
        });

        return data.ids.filter((id: string): boolean => {
          return !found || found.has(id.toLowerCase());
        });
      },
    );

  return lookups;
}

/*
 * Answers the read of the labels the records a new record names carry
 * (DatabaseService.findRecordLabels), by record id: a create under a
 * permission limited to labels, or a block with labels, on a model that
 * carries no labels of its own (CreateScopePermission). A record not listed
 * carries none.
 */
export function stubRecordLabels(
  labelsByRecordId: Record<string, Array<ObjectID | string>> = {},
): Array<RecordLookup> {
  const lookups: Array<RecordLookup> = [];

  jest
    .spyOn(
      DatabaseService as unknown as {
        findRecordLabels: (data: {
          modelType: { new (): DatabaseBaseModel };
          ids: Array<string>;
        }) => Promise<Record<string, Array<string>>>;
      },
      "findRecordLabels",
    )
    .mockImplementation(
      async (data: {
        modelType: { new (): DatabaseBaseModel };
        ids: Array<string>;
      }): Promise<Record<string, Array<string>>> => {
        lookups.push({
          table: new data.modelType().tableName || "",
          ids: [...data.ids],
        });

        const labels: Record<string, Array<string>> = {};

        for (const id of data.ids) {
          const entry: [string, Array<ObjectID | string>] | undefined =
            Object.entries(labelsByRecordId).find(
              ([recordId]: [string, Array<ObjectID | string>]): boolean => {
                return recordId.toLowerCase() === id.toLowerCase();
              },
            );

          if (entry) {
            labels[id.toLowerCase()] = entry[1].map(
              (labelId: ObjectID | string): string => {
                return labelId.toString().toLowerCase();
              },
            );
          }
        }

        return labels;
      },
    );

  return lookups;
}

/*
 * Answers the read of label names a refusal of a create outside its labels
 * makes (DatabaseService.findLabelNames): each label named by `names`, or by
 * its id.
 */
export function stubLabelNames(names: Record<string, string> = {}): void {
  jest
    .spyOn(
      DatabaseService as unknown as {
        findLabelNames: (data: {
          labelIds: Array<string>;
        }) => Promise<Array<string>>;
      },
      "findLabelNames",
    )
    .mockImplementation(
      async (data: { labelIds: Array<string> }): Promise<Array<string>> => {
        return data.labelIds.map((labelId: string): string => {
          const entry: [string, string] | undefined = Object.entries(
            names,
          ).find(([id]: [string, string]): boolean => {
            return id.toLowerCase() === labelId.toLowerCase();
          });

          return entry ? entry[1] : labelId;
        });
      },
    );
}

export function stubReadableParents(
  readableIds?: Array<ObjectID | string> | undefined,
): Array<ReadableParentLookup> {
  const lookups: Array<ReadableParentLookup> = [];
  const readable: Set<string> | null = readableIds
    ? new Set<string>(
        readableIds.map((id: ObjectID | string): string => {
          return id.toString().toLowerCase();
        }),
      )
    : null;

  jest
    .spyOn(
      DatabaseService as unknown as {
        findReadableParentIds: (data: {
          parentModelType: { new (): DatabaseBaseModel };
          ids: Array<string>;
        }) => Promise<Array<string>>;
      },
      "findReadableParentIds",
    )
    .mockImplementation(
      async (data: {
        parentModelType: { new (): DatabaseBaseModel };
        ids: Array<string>;
      }): Promise<Array<string>> => {
        lookups.push({
          parentTable: new data.parentModelType().tableName || "",
          ids: [...data.ids],
        });

        return data.ids.filter((id: string): boolean => {
          return !readable || readable.has(id.toLowerCase());
        });
      },
    );

  return lookups;
}
