import { jest } from "@jest/globals";
import WorkspaceHomeChoice from "../../Models/DatabaseModels/WorkspaceHomeChoice";
import WorkspaceHomeChoiceService from "../../Server/Services/WorkspaceHomeChoiceService";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";

/*
 * THE WORKSPACEHOMECHOICE TABLE, IN MEMORY, FOR SUITES THAT DRAW A HOME.
 *
 * Which project a person's Slack or Microsoft Teams Home opens on is kept in
 * Postgres (WorkspaceHomeChoice, WorkspaceHomeProject). Suites that drive the
 * real Home code without a database put this table in its place: the real
 * WorkspaceHomeChoiceService runs - its find, its write again or its create -
 * against rows held here, read as Postgres would answer its queries (an id,
 * QueryHelper.any's ids, the newest choice first). WorkspaceHomeChoicePostgres
 * runs the same service against a migrated Postgres.
 *
 * Call it in a beforeEach: the spies are restored with jest.restoreAllMocks.
 */

export interface InMemoryHomeChoiceRow {
  projectId: string;
  workspaceType: WorkspaceType;
  workspaceUserId: string;
  chosenAt: Date;
  /*
   * When it was last written, among the table's writes: two choices in the
   * same millisecond are told apart by it, the later one first.
   */
  writtenAs?: number | undefined;
}

export interface InMemoryWorkspaceHomeChoices {
  rows: Array<InMemoryHomeChoiceRow>;
  // How many times the table was written (a row made, or written again).
  writes: () => number;
  // How many times it was read.
  reads: () => number;
  // Reads and writes refuse, as a database that cannot be reached does.
  failWith: (error: Error | null) => void;
}

// The ids a query's value names: an id, or QueryHelper.any's values.
function idsOf(value: unknown): Array<string> {
  if (value === undefined || value === null) {
    return [];
  }

  if (value instanceof ObjectID || typeof value === "string") {
    return [value.toString().toLowerCase()];
  }

  const parameters: JSONObject | undefined = (
    value as { objectLiteralParameters?: JSONObject }
  ).objectLiteralParameters;

  return Object.values(parameters || {})
    .flatMap((entry: unknown): Array<unknown> => {
      return Array.isArray(entry) ? entry : [entry];
    })
    .map((entry: unknown): string => {
      return String(entry).toLowerCase();
    });
}

function matches(row: InMemoryHomeChoiceRow, query: JSONObject): boolean {
  const projectIds: Array<string> = idsOf(query["projectId"]);

  return (
    (query["workspaceType"] === undefined ||
      row.workspaceType === query["workspaceType"]) &&
    (query["workspaceUserId"] === undefined ||
      row.workspaceUserId === query["workspaceUserId"]) &&
    (query["projectId"] === undefined || projectIds.includes(row.projectId))
  );
}

function toModel(row: InMemoryHomeChoiceRow, index: number): WorkspaceHomeChoice {
  const model: WorkspaceHomeChoice = new WorkspaceHomeChoice();
  model.id = new ObjectID(
    `e0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  model.projectId = new ObjectID(row.projectId);
  model.workspaceType = row.workspaceType;
  model.workspaceUserId = row.workspaceUserId;
  model.chosenAt = row.chosenAt;
  return model;
}

export function useInMemoryWorkspaceHomeChoices(): InMemoryWorkspaceHomeChoices {
  const rows: Array<InMemoryHomeChoiceRow> = [];
  let writeCount: number = 0;
  let readCount: number = 0;
  let failure: Error | null = null;

  const refuseIfFailing: () => void = (): void => {
    if (failure) {
      throw failure;
    }
  };

  jest
    .spyOn(WorkspaceHomeChoiceService, "findOneBy")
    .mockImplementation((async (findOneBy: { query: JSONObject }) => {
      readCount++;
      refuseIfFailing();

      const index: number = rows.findIndex(
        (row: InMemoryHomeChoiceRow): boolean => {
          return matches(row, findOneBy.query);
        },
      );

      return index >= 0 ? toModel(rows[index]!, index) : null;
    }) as never);

  jest
    .spyOn(WorkspaceHomeChoiceService, "findBy")
    .mockImplementation((async (findBy: {
      query: JSONObject;
      limit?: number;
    }) => {
      readCount++;
      refuseIfFailing();

      return rows
        .map((row: InMemoryHomeChoiceRow, index: number) => {
          return { row, index };
        })
        .filter((entry: { row: InMemoryHomeChoiceRow }): boolean => {
          return matches(entry.row, findBy.query);
        })
        .sort(
          (
            a: { row: InMemoryHomeChoiceRow },
            b: { row: InMemoryHomeChoiceRow },
          ): number => {
            // The newest choice first (the service sorts by chosenAt, descending).
            return (
              b.row.chosenAt.getTime() - a.row.chosenAt.getTime() ||
              (b.row.writtenAs || 0) - (a.row.writtenAs || 0)
            );
          },
        )
        .slice(0, findBy.limit || rows.length)
        .map((entry: { row: InMemoryHomeChoiceRow; index: number }) => {
          return toModel(entry.row, entry.index);
        });
    }) as never);

  jest
    .spyOn(WorkspaceHomeChoiceService, "updateOneById")
    .mockImplementation((async (update: {
      id: ObjectID;
      data: { chosenAt: Date };
    }) => {
      writeCount++;
      refuseIfFailing();

      const index: number = Number(update.id.toString().split("-").pop()) - 1;
      rows[index]!.chosenAt = update.data.chosenAt;
      rows[index]!.writtenAs = writeCount;
    }) as never);

  jest
    .spyOn(WorkspaceHomeChoiceService, "create")
    .mockImplementation((async (create: { data: WorkspaceHomeChoice }) => {
      writeCount++;
      refuseIfFailing();

      rows.push({
        projectId: create.data.projectId!.toString().toLowerCase(),
        workspaceType: create.data.workspaceType!,
        workspaceUserId: create.data.workspaceUserId!,
        chosenAt: create.data.chosenAt!,
        writtenAs: writeCount,
      });

      return create.data;
    }) as never);

  return {
    rows: rows,
    writes: (): number => {
      return writeCount;
    },
    reads: (): number => {
      return readCount;
    },
    failWith: (error: Error | null): void => {
      failure = error;
    },
  };
}
