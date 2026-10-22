import { jest } from "@jest/globals";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../Server/Services/DatabaseService";
import { ArchivedValueRow } from "../../../Server/Utils/Database/ArchivedValueCheck";
import ObjectID from "../../../Types/ObjectID";

/*
 * Answers the read a write makes of the archived values it picks, the way
 * the database would, without one.
 *
 * A create or an update a person, an API key or the admin dashboard makes
 * that sets a state, a severity, a monitor status, a label or an incident
 * role reads which of those values are archived
 * (DatabaseService.findArchivedValues, ArchivedValueCheck), and refuses the
 * write when one is and the record does not already have it. A suite about
 * something else answers that read here:
 *
 *   stubArchivedValues();                       // nothing is archived
 *   stubArchivedValues([{ table: "IncidentState", id, name, projectId }]);
 *
 * Ids are compared lower-cased, as Postgres renders a uuid.
 */

export interface ArchivedValueStub {
  // The value's table: "IncidentState", "Label".
  table: string;
  id: ObjectID | string;
  name: string;
  projectId: ObjectID | string;
}

// One read of one value table: its name and the ids asked for.
export interface ArchivedValueLookup {
  table: string;
  ids: Array<string>;
}

export function stubArchivedValues(
  archived: Array<ArchivedValueStub> = [],
): Array<ArchivedValueLookup> {
  const lookups: Array<ArchivedValueLookup> = [];

  jest
    .spyOn(
      DatabaseService as unknown as {
        findArchivedValues: (data: {
          modelType: { new (): DatabaseBaseModel };
          ids: Array<string>;
        }) => Promise<Array<ArchivedValueRow>>;
      },
      "findArchivedValues",
    )
    .mockImplementation(
      async (data: {
        modelType: { new (): DatabaseBaseModel };
        ids: Array<string>;
      }): Promise<Array<ArchivedValueRow>> => {
        const table: string = new data.modelType().tableName || "";
        const ids: Array<string> = data.ids.map((id: string): string => {
          return id.toLowerCase();
        });

        lookups.push({ table: table, ids: [...ids] });

        return archived
          .filter((value: ArchivedValueStub): boolean => {
            return (
              value.table === table &&
              ids.includes(value.id.toString().toLowerCase())
            );
          })
          .map((value: ArchivedValueStub): ArchivedValueRow => {
            return {
              id: value.id.toString().toLowerCase(),
              name: value.name,
              projectId: value.projectId.toString().toLowerCase(),
            };
          });
      },
    );

  return lookups;
}
