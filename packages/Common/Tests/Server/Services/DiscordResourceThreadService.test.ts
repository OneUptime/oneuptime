import DiscordResourceThreadService from "../../../Server/Services/DiscordResourceThreadService";
import Model, {
  DiscordResourceThreadState,
  DiscordResourceType,
} from "../../../Models/DatabaseModels/DiscordResourceThread";
import ObjectID from "../../../Types/ObjectID";
import { WorkspaceChannel } from "../../../Server/Utils/Workspace/WorkspaceBase";
import FindBy from "../../../Server/Types/Database/FindBy";
import PositiveNumber from "../../../Types/PositiveNumber";
import { EntityManager } from "typeorm";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * writeRow is the only UPDATE behind persist, adopt and every fence, and it
 * assembles the SET list by hand. Neither the compiler nor the schema-drift
 * check can see a placeholder written as "state" = 1 instead of "state" = $1;
 * only the statement text can. This pins the statement that reaches the
 * driver, with no database.
 */

type WriteRow = (
  manager: EntityManager,
  id: ObjectID,
  patch: Partial<Model>,
) => Promise<void>;

const writeRow: WriteRow = (
  DiscordResourceThreadService as unknown as { writeRow: WriteRow }
).writeRow.bind(DiscordResourceThreadService);

describe("DiscordResourceThreadService.writeRow", () => {
  test("binds every patched column and the id as numbered parameters", async () => {
    const query: jest.Mock<Promise<[]>, [string, Array<unknown>]> = jest.fn<
      Promise<[]>,
      [string, Array<unknown>]
    >(async (): Promise<[]> => {
      return [];
    });
    const id: ObjectID = ObjectID.generate();
    const installationId: ObjectID = ObjectID.generate();

    await writeRow({ query } as unknown as EntityManager, id, {
      state: DiscordResourceThreadState.Active,
      threadId: "400000000000000001",
      installationId,
      failureReason: null as unknown as string,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain('"state" = $1');
    expect(sql).toContain('"threadId" = $2');
    expect(sql).toContain('"installationId" = $3');
    expect(sql).toContain('"failureReason" = $4');
    expect(sql).toMatch(/WHERE "_id" = \$5\s*$/);
    expect(params).toEqual([
      DiscordResourceThreadState.Active,
      "400000000000000001",
      installationId.toString(),
      null,
      id.toString(),
    ]);
    /*
     * Postgres rejects the statement unless the placeholder count is the
     * parameter count exactly; a bare number in the SET list is what broke.
     */
    expect(new Set(sql.match(/\$\d+/g) || []).size).toBe(params.length);
  });

  test("writes nothing when the patch touches no whitelisted column", async () => {
    const query: jest.Mock<Promise<[]>, [string, Array<unknown>]> = jest.fn<
      Promise<[]>,
      [string, Array<unknown>]
    >(async (): Promise<[]> => {
      return [];
    });
    /*
     * resourceId is the row's identity; a recreate rotates operationKey, so
     * that column is writable now and no longer a valid example here.
     */
    await writeRow({ query } as unknown as EntityManager, ObjectID.generate(), {
      resourceId: ObjectID.generate(),
    } as Partial<Model>);
    expect(query).not.toHaveBeenCalled();
  });
});

/*
 * channelsForResource feeds the rule lookup's fence. Reading one page of 50
 * rows leaves every later row unfenced, so a stale cached thread beyond the
 * page stays eligible for posting. The lookup must walk the whole ownership
 * set for the resource.
 */
// FindBy allows a PositiveNumber or a plain number for paging fields.
const page: (value: PositiveNumber | number) => number = (
  value: PositiveNumber | number,
): number => {
  return typeof value === "number" ? value : value.toNumber();
};

describe("DiscordResourceThreadService.channelsForResource", () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("fences every owned thread past the first page of 50", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const resourceId: ObjectID = ObjectID.generate();
    const rows: Array<Model> = Array.from(
      { length: 60 },
      (_: unknown, index: number): Model => {
        const row: Model = new Model();
        row.id = ObjectID.generate();
        row.projectId = projectId;
        row.resourceType = DiscordResourceType.Incident;
        row.resourceId = resourceId;
        row.threadId = `4000000000000${String(index + 1).padStart(4, "0")}`;
        row.state = DiscordResourceThreadState.Stale;
        return row;
      },
    );
    const findBy: jest.SpyInstance<
      Promise<Array<Model>>,
      [FindBy<Model>]
    > = jest
      .spyOn(DiscordResourceThreadService, "findBy")
      .mockImplementation(
        async (data: FindBy<Model>): Promise<Array<Model>> => {
          return rows.slice(
            page(data.skip),
            page(data.skip) + page(data.limit),
          );
        },
      );
    jest
      .spyOn(
        DiscordResourceThreadService as unknown as {
          liveInstallation: () => Promise<null>;
        },
        "liveInstallation",
      )
      .mockResolvedValue(null);

    const result: { active: Array<WorkspaceChannel>; fenced: Array<string> } =
      await DiscordResourceThreadService.channelsForResource({
        projectId,
        resource: { resourceType: DiscordResourceType.Incident, resourceId },
      });

    expect(result.active).toEqual([]);
    expect(result.fenced.length).toBe(60);
    expect(new Set(result.fenced).size).toBe(60);
    expect(
      findBy.mock.calls.map((call: [FindBy<Model>]): number => {
        return page(call[0].skip);
      }),
    ).toEqual([0, 50]);
  });
});
