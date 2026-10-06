// Every write here is made on purpose; @CaptureSpan logs each refusal's stack.
jest.mock("../../../Server/Utils/Logger");

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * One write to many incidents or episodes - a workflow's Update Many, which
 * writes as root within its project - that turns Visible on Status Page on
 * shows the ones that are not private and leaves every private one hidden
 * (StatusPageVisibility), whatever the others are.
 *
 * The service runs as written, DatabaseService's update loop and both
 * services' hooks included; only the database is a stand-in: the rows every
 * read finds, the repository each row is written through, and the
 * conditional hook-free write.
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
  // Each row's columns as one repository write set them, by row id.
  repositoryWrites: Array<{ id: string; data: StoredRow }>;
  // Each conditional hook-free write: its row, what it set, what it expected.
  conditionalWrites: Array<{
    id: string;
    data: StoredRow;
    expectedData: StoredRow;
    written: boolean;
  }>;
}

// The ids a query's _id condition names: one id, or a list (In / any).
function idsNamedBy(condition: unknown): Array<string> | null {
  if (condition === undefined || condition === null) {
    return null;
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
 * (or all of them), as the model; every repository update and conditional
 * write changes what later reads find.
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
  };

  const stubbable: StubbableService = service as unknown as StubbableService;

  jest.spyOn(stubbable, "_findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }): Promise<Array<BaseModel>> => {
    const wanted: Array<string> | null = idsNamedBy(findBy.query?.["_id"]);

    return Array.from(table.rows.values())
      .filter((row: StoredRow): boolean => {
        return !wanted || wanted.includes(String(row["_id"]));
      })
      .map((row: StoredRow): BaseModel => {
        const model: BaseModel = new modelType();

        for (const [column, value] of Object.entries(row)) {
          (model as unknown as Record<string, unknown>)[column] = value;
        }

        return model;
      });
  }) as never);

  const repositoryUpdate: MockFunction = getJestMockFunction();
  repositoryUpdate.mockImplementation((async (
    criteria: { _id: string },
    data: StoredRow,
  ): Promise<unknown> => {
    const id: string = String(criteria._id);
    const row: StoredRow | undefined = table.rows.get(id);

    if (!row) {
      return { affected: 0 };
    }

    const set: StoredRow = {};

    for (const [column, value] of Object.entries(data)) {
      if (column !== "version") {
        set[column] = value;
        row[column] = value;
      }
    }

    table.repositoryWrites.push({ id: id, data: set });

    return { affected: 1 };
  }) as never);

  jest.spyOn(stubbable, "getRepository").mockReturnValue({
    update: repositoryUpdate,
    save: repositoryUpdate,
  } as never);

  jest
    .spyOn(stubbable, "onTriggerWorkflow")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(stubbable, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);

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
  test("the public incident is shown; the private one ends up hidden, switched back off only while it is still private", async () => {
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

    // One switch-back, for the private one, guarded by its privacy.
    expect(table.conditionalWrites).toEqual([
      {
        id: PRIVATE_ID,
        data: { isVisibleOnStatusPage: false },
        expectedData: { isPrivate: true },
        written: true,
      },
    ]);
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
});

describe("Update Many on episodes turns their Status Pages switch on", () => {
  test("the public episode is shown; the private one ends up hidden", async () => {
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
    expect(table.conditionalWrites).toEqual([
      {
        id: PRIVATE_ID,
        data: { isVisibleOnStatusPage: false },
        expectedData: { isPrivate: true },
        written: true,
      },
    ]);
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
});
