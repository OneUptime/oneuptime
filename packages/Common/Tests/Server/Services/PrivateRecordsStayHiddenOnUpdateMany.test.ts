// Every write here is made on purpose; @CaptureSpan logs each refusal's stack.
jest.mock("../../../Server/Utils/Logger");

import AuditLogService from "../../../Server/Services/AuditLogService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  applyUpdateValues,
  returnedColumns,
} from "../TestingUtils/RowWriteSql";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import { idsNamedBy as idsNamedByCondition } from "../TestingUtils/QueryConditions";

/*
 * One write to many incidents or episodes - a workflow's Update Many, which
 * writes as root within its project - that turns Visible on Status Page on
 * shows the ones that are not private and leaves every private one hidden
 * (StatusPageVisibility), whatever the others are. The database decides
 * each record in its own row's write (getRowWriteSql): the switch is stored
 * on only while the record is not private as it is then - a privacy write
 * landing at any moment before, even right before that row's write, is
 * never overtaken. Nothing is stored that is then put back, and each
 * record's workflow trigger and audit log entry say what the write stored
 * (handed back by the write itself): never that a private one was shown.
 * The same holds for an update of one record.
 *
 * The service runs as written, DatabaseService's update loop and both
 * services' hooks included; only the database is a stand-in: the rows every
 * read finds, the repository each row is written through (working out the
 * SQL a row is written with on the row as it is then, as Postgres does -
 * RowWriteSql), the conditional hook-free write, and what the workflows and
 * the audit log are handed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-2222-4aaa-8bbb-000000000001",
);
const PRIVATE_ID: string = "0193c0de-2222-4aaa-8bbb-0000000000a1";
const PUBLIC_ID: string = "0193c0de-2222-4aaa-8bbb-0000000000a2";
const SECOND_PRIVATE_ID: string = "0193c0de-2222-4aaa-8bbb-0000000000a3";

// The members of a service these tests stub that its type keeps private.
interface StubbableService {
  _findBy: (...args: Array<unknown>) => Promise<unknown>;
  getRepository: () => unknown;
  onTriggerWorkflow: (...args: Array<unknown>) => Promise<unknown>;
  onTriggerRealtime: (...args: Array<unknown>) => Promise<unknown>;
}

type StoredRow = Record<string, unknown>;

interface FakeTable {
  rows: Map<string, StoredRow>;
  // The rows each on-update workflow was triggered for, with what it was told.
  workflowTriggers: Array<{ id: string; updatedFields: unknown }>;
  // The rows the audit log recorded an update of, with what was written.
  auditedUpdates: Array<{ id: string; updatedFields: unknown }>;
  // Each row's columns as one repository write set them, by row id.
  repositoryWrites: Array<{ id: string; data: StoredRow }>;
  // Each conditional hook-free write: its row, what it set, what it expected.
  conditionalWrites: Array<{
    id: string;
    data: StoredRow;
    expectedData: StoredRow;
    written: boolean;
  }>;
  /*
   * Rows created while the update's hooks ran: no read finds them until the
   * update reads the rows it writes.
   */
  arrivingAtWrite: Set<string>;
  /*
   * What changes between the update's hooks and its own read of the rows it
   * writes - a privacy rule landing - applied right before that read.
   */
  beforeWriteRead: Array<(rows: Map<string, StoredRow>) => void>;
  /*
   * What changes once the update has written a row and before it writes the
   * next - a privacy rule landing while it works through them - applied
   * after the next repository write.
   */
  afterNextWrite: Array<(rows: Map<string, StoredRow>) => void>;
  /*
   * What lands on a row after the update read it and right before its own
   * write reaches it - a privacy rule committing first - by row id: the
   * write then finds the row so.
   */
  rightBeforeWrite: Map<string, (row: StoredRow) => void>;
  // What each repository write was asked to hand back, by row id.
  returningAsked: Array<{ id: string; returning: unknown }>;
}

// The ids a query's _id condition names: one id, or a list (In / any).
function idsNamedBy(condition: unknown): Array<string> | null {
  if (condition === undefined || condition === null) {
    return null;
  }

  // "Any of" (QueryHelper.any): a raw condition over the ids it names.
  if (
    condition instanceof FindOperator &&
    typeof (condition as FindOperator<unknown>).getSql === "function"
  ) {
    return idsNamedByCondition(condition);
  }

  if (condition instanceof FindOperator) {
    const value: unknown = condition.value;

    return (Array.isArray(value) ? value : [value]).map(
      (id: unknown): string => {
        return String(id);
      },
    );
  }

  return [String(condition)];
}

/*
 * The table behind a service: every read returns the rows its _id names
 * (or all of them), as the model, with only the columns it selects, as the
 * database does; every repository update and conditional write changes what
 * later reads find.
 */
function fakeTable(
  service: DatabaseService<BaseModel>,
  modelType: { new (): BaseModel },
  rows: Array<StoredRow>,
): FakeTable {
  const table: FakeTable = {
    rows: new Map<string, StoredRow>(
      rows.map((row: StoredRow): [string, StoredRow] => {
        return [String(row["_id"]), { ...row }];
      }),
    ),
    repositoryWrites: [],
    conditionalWrites: [],
    workflowTriggers: [],
    auditedUpdates: [],
    arrivingAtWrite: new Set<string>(),
    beforeWriteRead: [],
    afterNextWrite: [],
    rightBeforeWrite: new Map(),
    returningAsked: [],
  };

  const stubbable: StubbableService = service as unknown as StubbableService;

  jest.spyOn(stubbable, "_findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
    select?: Record<string, unknown>;
    props?: { ignoreHooks?: boolean };
  }): Promise<Array<BaseModel>> => {
    // The update's own read of the rows it writes, right before writing them.
    if (findBy.props?.ignoreHooks && findBy.select?.["isVisibleOnStatusPage"]) {
      for (const change of table.beforeWriteRead.splice(0)) {
        change(table.rows);
      }

      table.arrivingAtWrite.clear();
    }

    const wanted: Array<string> | null = idsNamedBy(findBy.query?.["_id"]);

    return Array.from(table.rows.values())
      .filter((row: StoredRow): boolean => {
        return (
          !table.arrivingAtWrite.has(String(row["_id"])) &&
          (!wanted || wanted.includes(String(row["_id"])))
        );
      })
      .map((row: StoredRow): BaseModel => {
        const model: BaseModel = new modelType();

        for (const [column, value] of Object.entries(row)) {
          if (column === "_id" || !findBy.select || findBy.select[column]) {
            (model as unknown as Record<string, unknown>)[column] = value;
          }
        }

        return model;
      });
  }) as never);

  /*
   * One row's UPDATE, as Postgres runs it: what lands right before it is
   * there first, every value - an SQL expression too - is worked out on the
   * row as the write finds it, and the write hands back what it stored.
   */
  const repositoryUpdate: MockFunction = getJestMockFunction();
  repositoryUpdate.mockImplementation((async (
    criteria: { _id: string },
    data: StoredRow,
    options?: { returning?: unknown },
  ): Promise<unknown> => {
    const id: string = String(criteria._id);
    const row: StoredRow | undefined = table.rows.get(id);

    if (!row) {
      return { affected: 0, raw: [] };
    }

    table.rightBeforeWrite.get(id)?.(row);
    table.rightBeforeWrite.delete(id);

    const set: StoredRow = applyUpdateValues(row, data);

    table.repositoryWrites.push({ id: id, data: set });
    table.returningAsked.push({ id: id, returning: options?.returning });

    for (const change of table.afterNextWrite.splice(0)) {
      change(table.rows);
    }

    return { affected: 1, raw: returnedColumns(row, options) };
  }) as never);

  jest.spyOn(stubbable, "getRepository").mockReturnValue({
    update: repositoryUpdate,
    metadata: undefined,
  } as never);

  jest.spyOn(stubbable, "onTriggerWorkflow").mockImplementation((async (
    id: ObjectID,
    _tenantId: ObjectID,
    _trigger: string,
    data: { updatedFields?: unknown },
  ): Promise<void> => {
    table.workflowTriggers.push({
      id: id.toString(),
      updatedFields: data?.updatedFields,
    });
  }) as never);
  jest
    .spyOn(stubbable, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);

  jest.spyOn(AuditLogService, "recordUpdate").mockImplementation((async (data: {
    itemId: ObjectID;
    updatedFields: unknown;
  }): Promise<void> => {
    table.auditedUpdates.push({
      id: data.itemId.toString(),
      updatedFields: data.updatedFields,
    });
  }) as never);

  jest
    .spyOn(service, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (input: {
      id: ObjectID;
      data: StoredRow;
      expectedData: StoredRow;
    }): Promise<boolean> => {
      const id: string = input.id.toString();
      const row: StoredRow | undefined = table.rows.get(id);

      const matches: boolean =
        Boolean(row) &&
        Object.entries(input.expectedData).every(
          ([column, value]: [string, unknown]): boolean => {
            return row![column] === value;
          },
        );

      if (matches) {
        Object.assign(row!, input.data);
      }

      table.conditionalWrites.push({
        id: id,
        data: input.data,
        expectedData: input.expectedData,
        written: matches,
      });

      return matches;
    }) as never);

  return table;
}

function visibilityOf(table: FakeTable): Record<string, unknown> {
  const visibility: Record<string, unknown> = {};

  for (const [id, row] of table.rows.entries()) {
    visibility[id] = row["isVisibleOnStatusPage"];
  }

  return visibility;
}

beforeEach(() => {
  stubProjectDirectory({ projectId: PROJECT_ID });

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/i") as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function updateManyIncidents(data: StoredRow): Promise<number> {
  return await IncidentService.updateBy({
    query: { projectId: PROJECT_ID },
    data: data as never,
    limit: new PositiveNumber(100),
    skip: new PositiveNumber(0),
    props: { isRoot: true, tenantId: PROJECT_ID },
  });
}

async function updateManyEpisodes(data: StoredRow): Promise<number> {
  return await IncidentEpisodeService.updateBy({
    query: { projectId: PROJECT_ID },
    data: data as never,
    limit: new PositiveNumber(100),
    skip: new PositiveNumber(0),
    props: { isRoot: true, tenantId: PROJECT_ID },
  });
}

function incidentRow(id: string, isPrivate: boolean): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID,
    incidentNumber: 1,
    incidentNumberWithPrefix: "INC-1",
    title: "Checkout errors",
    isVisibleOnStatusPage: false,
    isPrivate: isPrivate,
  };
}

function episodeRow(id: string, isPrivate: boolean): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID,
    episodeNumber: 1,
    title: "Checkout errors",
    isVisibleOnStatusPage: false,
    isPrivate: isPrivate,
  };
}

describe("Update Many on incidents turns Visible on Status Page on", () => {
  test("the public incident is shown; the private one is written hidden, in its own write", async () => {
    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [incidentRow(PRIVATE_ID, true), incidentRow(PUBLIC_ID, false)],
    );

    const updated: number = await updateManyIncidents({
      isVisibleOnStatusPage: true,
    });

    expect(updated).toBe(2);
    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [PUBLIC_ID]: true,
    });

    // Each row's own write says what it stores; nothing is put back after.
    expect(
      table.repositoryWrites.map((write: { id: string; data: StoredRow }) => {
        return [write.id, write.data["isVisibleOnStatusPage"]];
      }),
    ).toEqual([
      [PRIVATE_ID, false],
      [PUBLIC_ID, true],
    ]);
    expect(table.conditionalWrites).toEqual([]);
  });

  test("each incident's workflow trigger and audit log entry say what was stored: shown for the public one, hidden for the private one", async () => {
    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [incidentRow(PRIVATE_ID, true), incidentRow(PUBLIC_ID, false)],
    );

    await updateManyIncidents({ isVisibleOnStatusPage: true });

    for (const recorded of [table.workflowTriggers, table.auditedUpdates]) {
      const byId: Record<string, unknown> = {};

      for (const entry of recorded) {
        byId[entry.id] = (entry.updatedFields as Record<string, unknown>)[
          "isVisibleOnStatusPage"
        ];
      }

      expect(byId[PUBLIC_ID]).toBe(true);
      // Never told it was shown: at most, that it stays hidden.
      expect(byId[PRIVATE_ID] === undefined || byId[PRIVATE_ID] === false).toBe(
        true,
      );
    }
  });

  test("an update that also changes something else tells the private incident's workflows it stays hidden", async () => {
    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [incidentRow(PRIVATE_ID, true), incidentRow(PUBLIC_ID, false)],
    );

    await updateManyIncidents({
      isVisibleOnStatusPage: true,
      title: "Checkout errors in Europe",
    });

    const privateTrigger: { id: string; updatedFields: unknown } | undefined =
      table.workflowTriggers.find(
        (trigger: { id: string; updatedFields: unknown }): boolean => {
          return trigger.id === PRIVATE_ID;
        },
      );

    /*
     * The workflow is told what the update changed on the private incident:
     * its title. Its visibility was off and stays off, so it is no change -
     * and it is never told the update's true.
     */
    expect(privateTrigger?.updatedFields).toEqual({
      title: "Checkout errors in Europe",
    });

    // The audit entry is handed what the write stored: still hidden.
    const privateAudit: { id: string; updatedFields: unknown } | undefined =
      table.auditedUpdates.find(
        (entry: { id: string; updatedFields: unknown }): boolean => {
          return entry.id === PRIVATE_ID;
        },
      );

    expect(privateAudit?.updatedFields).toEqual(
      expect.objectContaining({
        isVisibleOnStatusPage: false,
        title: "Checkout errors in Europe",
      }),
    );
    expect(table.rows.get(PRIVATE_ID)!["title"]).toBe(
      "Checkout errors in Europe",
    );
    expect(visibilityOf(table)[PRIVATE_ID]).toBe(false);
  });

  test("when every incident it writes is private, each is written hidden and nothing is switched back", async () => {
    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [incidentRow(PRIVATE_ID, true), incidentRow(SECOND_PRIVATE_ID, true)],
    );

    await updateManyIncidents({ isVisibleOnStatusPage: true });

    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [SECOND_PRIVATE_ID]: false,
    });
    expect(
      table.repositoryWrites.map((write: { id: string; data: StoredRow }) => {
        return write.data["isVisibleOnStatusPage"];
      }),
    ).toEqual([false, false]);
    expect(table.conditionalWrites).toEqual([]);
  });

  test("when none is private, all are shown and nothing is switched back", async () => {
    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [incidentRow(PUBLIC_ID, false)],
    );

    await updateManyIncidents({ isVisibleOnStatusPage: true });

    expect(visibilityOf(table)).toEqual({ [PUBLIC_ID]: true });
    expect(table.conditionalWrites).toEqual([]);
  });

  test("written with Private on, every incident is hidden with it", async () => {
    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [
        { ...incidentRow(PRIVATE_ID, false), isVisibleOnStatusPage: true },
        { ...incidentRow(PUBLIC_ID, false), isVisibleOnStatusPage: true },
      ],
    );

    await updateManyIncidents({ isPrivate: true });

    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [PUBLIC_ID]: false,
    });
  });
  test("one private incident updated on its own (the API, Terraform) is written hidden", async () => {
    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [incidentRow(PRIVATE_ID, true), incidentRow(PUBLIC_ID, false)],
    );

    await IncidentService.updateOneBy({
      query: { _id: PRIVATE_ID },
      data: { isVisibleOnStatusPage: true } as never,
      props: { isRoot: true, tenantId: PROJECT_ID },
    });

    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [PUBLIC_ID]: false,
    });

    for (const recorded of [table.workflowTriggers, table.auditedUpdates]) {
      for (const entry of recorded) {
        expect(
          (entry.updatedFields as Record<string, unknown>)[
            "isVisibleOnStatusPage"
          ],
        ).not.toBe(true);
      }
    }
  });

  test("each incident is decided by the database in its own write, whatever else the update reads", async () => {
    // Nothing about images decides what the update writes of each row.
    jest.spyOn(PublishedImages, "isWrittenBy").mockReturnValue(false);

    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [incidentRow(PRIVATE_ID, true), incidentRow(PUBLIC_ID, false)],
    );

    await updateManyIncidents({ isVisibleOnStatusPage: true });

    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [PUBLIC_ID]: true,
    });
  });

  test("an incident made private while the update runs is written hidden: the row as the database holds it when written decides", async () => {
    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [incidentRow(PRIVATE_ID, false), incidentRow(PUBLIC_ID, false)],
    );

    // A privacy rule makes it private after the update's hooks have read it.
    table.beforeWriteRead.push((rows: Map<string, StoredRow>): void => {
      rows.get(PRIVATE_ID)!["isPrivate"] = true;
    });

    await updateManyIncidents({ isVisibleOnStatusPage: true });

    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [PUBLIC_ID]: true,
    });
  });

  test("an incident the update's hooks did not see is decided by itself, not by the others", async () => {
    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [incidentRow(PRIVATE_ID, true), incidentRow(PUBLIC_ID, false)],
    );

    // Created while the update's hooks ran: they saw only a private incident.
    table.arrivingAtWrite.add(PUBLIC_ID);

    await updateManyIncidents({ isVisibleOnStatusPage: true });

    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [PUBLIC_ID]: true,
    });
  });
  test("an incident made private while the update writes the ones before it is written hidden: each row is decided in its own write", async () => {
    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [incidentRow(PUBLIC_ID, false), incidentRow(PRIVATE_ID, false)],
    );

    // A privacy rule lands once the first incident is written.
    table.afterNextWrite.push((rows: Map<string, StoredRow>): void => {
      rows.get(PRIVATE_ID)!["isPrivate"] = true;
    });

    await updateManyIncidents({ isVisibleOnStatusPage: true });

    expect(visibilityOf(table)).toEqual({
      [PUBLIC_ID]: true,
      [PRIVATE_ID]: false,
    });

    // Its workflow is never told it was shown.
    for (const trigger of table.workflowTriggers) {
      if (trigger.id === PRIVATE_ID) {
        expect(
          (trigger.updatedFields as Record<string, unknown>)[
            "isVisibleOnStatusPage"
          ],
        ).not.toBe(true);
      }
    }
  });
});

describe("Update Many on episodes turns their Status Pages switch on", () => {
  test("the public episode is shown; the private one is written hidden, in its own write", async () => {
    const table: FakeTable = fakeTable(
      IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
      IncidentEpisode as unknown as { new (): BaseModel },
      [episodeRow(PRIVATE_ID, true), episodeRow(PUBLIC_ID, false)],
    );

    const updated: number = await updateManyEpisodes({
      isVisibleOnStatusPage: true,
    });

    expect(updated).toBe(2);
    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [PUBLIC_ID]: true,
    });
    expect(table.conditionalWrites).toEqual([]);
    // The private episode's workflows are never told it was shown.
    for (const trigger of table.workflowTriggers) {
      expect(
        (trigger.updatedFields as Record<string, unknown>)[
          "isVisibleOnStatusPage"
        ],
      ).toBe(trigger.id === PUBLIC_ID);
    }
  });

  test("when every episode it writes is private, each is written hidden", async () => {
    const table: FakeTable = fakeTable(
      IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
      IncidentEpisode as unknown as { new (): BaseModel },
      [episodeRow(PRIVATE_ID, true), episodeRow(SECOND_PRIVATE_ID, true)],
    );

    await updateManyEpisodes({ isVisibleOnStatusPage: true });

    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [SECOND_PRIVATE_ID]: false,
    });
    expect(table.conditionalWrites).toEqual([]);
  });

  test("written with Private on, every episode is hidden with it", async () => {
    const table: FakeTable = fakeTable(
      IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
      IncidentEpisode as unknown as { new (): BaseModel },
      [
        { ...episodeRow(PRIVATE_ID, false), isVisibleOnStatusPage: true },
        { ...episodeRow(PUBLIC_ID, false), isVisibleOnStatusPage: true },
      ],
    );

    await updateManyEpisodes({ isPrivate: true });

    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [PUBLIC_ID]: false,
    });
  });

  test("one private episode updated on its own is written hidden", async () => {
    const table: FakeTable = fakeTable(
      IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
      IncidentEpisode as unknown as { new (): BaseModel },
      [episodeRow(PRIVATE_ID, true), episodeRow(PUBLIC_ID, false)],
    );

    await IncidentEpisodeService.updateOneBy({
      query: { _id: PRIVATE_ID },
      data: { isVisibleOnStatusPage: true } as never,
      props: { isRoot: true, tenantId: PROJECT_ID },
    });

    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [PUBLIC_ID]: false,
    });
  });

  test("each episode is decided by the database in its own write, whatever else the update reads", async () => {
    jest.spyOn(PublishedImages, "isWrittenBy").mockReturnValue(false);

    const table: FakeTable = fakeTable(
      IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
      IncidentEpisode as unknown as { new (): BaseModel },
      [episodeRow(PRIVATE_ID, true), episodeRow(PUBLIC_ID, false)],
    );

    await updateManyEpisodes({ isVisibleOnStatusPage: true });

    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [PUBLIC_ID]: true,
    });
  });

  test("an episode made private while the update runs is written hidden", async () => {
    const table: FakeTable = fakeTable(
      IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
      IncidentEpisode as unknown as { new (): BaseModel },
      [episodeRow(PRIVATE_ID, false), episodeRow(PUBLIC_ID, false)],
    );

    table.beforeWriteRead.push((rows: Map<string, StoredRow>): void => {
      rows.get(PRIVATE_ID)!["isPrivate"] = true;
    });

    await updateManyEpisodes({ isVisibleOnStatusPage: true });

    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [PUBLIC_ID]: true,
    });
  });

  test("an episode the update's hooks did not see is decided by itself, not by the others", async () => {
    const table: FakeTable = fakeTable(
      IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
      IncidentEpisode as unknown as { new (): BaseModel },
      [episodeRow(PRIVATE_ID, true), episodeRow(PUBLIC_ID, false)],
    );

    table.arrivingAtWrite.add(PUBLIC_ID);

    await updateManyEpisodes({ isVisibleOnStatusPage: true });

    expect(visibilityOf(table)).toEqual({
      [PRIVATE_ID]: false,
      [PUBLIC_ID]: true,
    });
  });

  test("an episode made private while the update writes the ones before it is written hidden", async () => {
    const table: FakeTable = fakeTable(
      IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
      IncidentEpisode as unknown as { new (): BaseModel },
      [episodeRow(PUBLIC_ID, false), episodeRow(PRIVATE_ID, false)],
    );

    table.afterNextWrite.push((rows: Map<string, StoredRow>): void => {
      rows.get(PRIVATE_ID)!["isPrivate"] = true;
    });

    await updateManyEpisodes({ isVisibleOnStatusPage: true });

    expect(visibilityOf(table)).toEqual({
      [PUBLIC_ID]: true,
      [PRIVATE_ID]: false,
    });
  });
});

/*
 * The moment a read cannot cover: a record made private after the update
 * read it and right before its own row's write. The database decides the
 * switch in that write, so the record is stored hidden - never both private
 * and visible - and every account of the write (workflow, realtime, audit
 * log, images) is told what was stored, not what the update asked for.
 */
describe("a record made private right before its own write", () => {
  const image: (token: string) => string = (token: string): string => {
    return `![shot](https://oneuptime.example/file/image/access-token/${token})`;
  };

  // What each image was asked to be: "aaa111:public", "bbb222:private".
  function imagesAsked(setImagesVisibility: MockFunction): Array<string> {
    return setImagesVisibility.mock.calls.flatMap(
      (call: Array<unknown>): Array<string> => {
        const request: {
          publish: Iterable<string>;
          unpublish: Iterable<string>;
        } = call[0] as {
          publish: Iterable<string>;
          unpublish: Iterable<string>;
        };

        return [
          ...Array.from(request.publish).map((token: string): string => {
            return `${token}:public`;
          }),
          ...Array.from(request.unpublish).map((token: string): string => {
            return `${token}:private`;
          }),
        ];
      },
    );
  }

  function recordImages(): MockFunction {
    const setImagesVisibility: MockFunction = getJestMockFunction();
    setImagesVisibility.mockResolvedValue(undefined as never);

    jest
      .spyOn(PublishedImages, "setImagesVisibility")
      .mockImplementation(setImagesVisibility as never);

    return setImagesVisibility;
  }

  test("an incident is stored hidden, and its workflow and audit log are told so", async () => {
    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [incidentRow(PUBLIC_ID, false), incidentRow(PRIVATE_ID, false)],
    );

    // A privacy rule commits first: the write finds the incident private.
    table.rightBeforeWrite.set(PRIVATE_ID, (row: StoredRow): void => {
      row["isPrivate"] = true;
    });

    await updateManyIncidents({ isVisibleOnStatusPage: true });

    expect(visibilityOf(table)).toEqual({
      [PUBLIC_ID]: true,
      [PRIVATE_ID]: false,
    });
    expect(table.rows.get(PRIVATE_ID)!["isPrivate"]).toBe(true);

    for (const recorded of [table.workflowTriggers, table.auditedUpdates]) {
      const byId: Record<string, unknown> = {};

      for (const entry of recorded) {
        byId[entry.id] = (entry.updatedFields as Record<string, unknown>)[
          "isVisibleOnStatusPage"
        ];
      }

      expect(byId[PUBLIC_ID]).toBe(true);
      expect(byId[PRIVATE_ID] === undefined || byId[PRIVATE_ID] === false).toBe(
        true,
      );
    }
  });

  test("an episode is stored hidden too", async () => {
    const table: FakeTable = fakeTable(
      IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
      IncidentEpisode as unknown as { new (): BaseModel },
      [episodeRow(PUBLIC_ID, false), episodeRow(PRIVATE_ID, false)],
    );

    table.rightBeforeWrite.set(PRIVATE_ID, (row: StoredRow): void => {
      row["isPrivate"] = true;
    });

    await updateManyEpisodes({ isVisibleOnStatusPage: true });

    expect(visibilityOf(table)).toEqual({
      [PUBLIC_ID]: true,
      [PRIVATE_ID]: false,
    });

    for (const trigger of table.workflowTriggers) {
      expect(
        (trigger.updatedFields as Record<string, unknown>)[
          "isVisibleOnStatusPage"
        ],
      ).toBe(trigger.id === PUBLIC_ID);
    }
  });

  test("its images stay private: they are decided by what the write stored, not by what it asked for", async () => {
    const setImagesVisibility: MockFunction = recordImages();

    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [
        { ...incidentRow(PUBLIC_ID, false), description: image("aaa111") },
        { ...incidentRow(PRIVATE_ID, false), description: image("bbb222") },
      ],
    );

    table.rightBeforeWrite.set(PRIVATE_ID, (row: StoredRow): void => {
      row["isPrivate"] = true;
    });

    await updateManyIncidents({ isVisibleOnStatusPage: true });

    const asked: Array<string> = imagesAsked(setImagesVisibility);

    expect(asked).toContain("aaa111:public");
    expect(asked).not.toContain("bbb222:public");
  });

  test("each row's write asks back what decides it, and what the row shows", async () => {
    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [incidentRow(PRIVATE_ID, true), incidentRow(PUBLIC_ID, false)],
    );

    await updateManyIncidents({ isVisibleOnStatusPage: true });

    expect(table.returningAsked).toHaveLength(2);

    for (const asked of table.returningAsked) {
      expect(asked.returning).toEqual(
        expect.arrayContaining(["isVisibleOnStatusPage", "isPrivate"]),
      );
    }

    // The switch is written as an expression, never as the value asked for.
    expect(
      table.repositoryWrites.map((write: { id: string; data: StoredRow }) => {
        return [write.id, write.data["isVisibleOnStatusPage"]];
      }),
    ).toEqual([
      [PRIVATE_ID, false],
      [PUBLIC_ID, true],
    ]);
  });

  test("a write that cannot tell what it stored claims nothing about the switch", async () => {
    const setImagesVisibility: MockFunction = recordImages();

    const table: FakeTable = fakeTable(
      IncidentService as unknown as DatabaseService<BaseModel>,
      Incident as unknown as { new (): BaseModel },
      [{ ...incidentRow(PUBLIC_ID, false), description: image("ccc333") }],
    );

    // The write hands nothing back.
    const repository: {
      update: MockFunction;
    } = (
      IncidentService as unknown as { getRepository: () => unknown }
    ).getRepository() as { update: MockFunction };
    const update: MockFunction = repository.update;
    const writeAndForget: (
      criteria: unknown,
      data: unknown,
      options: unknown,
    ) => Promise<unknown> = update.getMockImplementation() as (
      criteria: unknown,
      data: unknown,
      options: unknown,
    ) => Promise<unknown>;

    update.mockImplementation((async (
      criteria: unknown,
      data: unknown,
      options: unknown,
    ): Promise<unknown> => {
      await writeAndForget(criteria, data, options);
      return { affected: 1 };
    }) as never);

    await updateManyIncidents({
      isVisibleOnStatusPage: true,
      title: "Checkout errors in Europe",
    });

    // Stored as the database decided...
    expect(visibilityOf(table)).toEqual({ [PUBLIC_ID]: true });

    // ...but told to nobody as written, and never taken as shown.
    for (const recorded of [table.workflowTriggers, table.auditedUpdates]) {
      for (const entry of recorded) {
        expect(entry.updatedFields).not.toHaveProperty("isVisibleOnStatusPage");
        expect(entry.updatedFields).toEqual(
          expect.objectContaining({ title: "Checkout errors in Europe" }),
        );
      }
    }

    expect(imagesAsked(setImagesVisibility)).not.toContain("ccc333:public");
  });
});
