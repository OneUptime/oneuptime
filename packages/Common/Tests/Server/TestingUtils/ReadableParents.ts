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
