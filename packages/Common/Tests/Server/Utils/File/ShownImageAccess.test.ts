import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import CallerPlan from "../../../../Server/Utils/Billing/CallerPlan";
import MarkdownFiles from "../../../../Server/Utils/File/MarkdownFiles";
import ShownImageAccess, {
  SHOWN_TO_FOR_MS,
} from "../../../../Server/Utils/File/ShownImageAccess";
import ShownImages, {
  RecordShowingImage,
} from "../../../../Server/Utils/File/ShownImages";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * WHETHER A RECORD OF THE IMAGE'S PROJECT SHOWS IT TO THE PERSON (#11478),
 * with the records, the services and the database fakes: which records are
 * read, as whom, in what order, what is kept, and what is read once however
 * many images ask. Against Postgres, over HTTP, it is
 * FileImageRecordAccessPostgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("a0000000-0000-4000-8000-000000000001");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000002",
);
const FILE_ID: string = "f0000000-0000-4000-8000-000000000001";
const OTHER_FILE_ID: string = "f0000000-0000-4000-8000-000000000002";
const INCIDENT_ID: string = "b0000000-0000-4000-8000-000000000001";
const OTHER_INCIDENT_ID: string = "b0000000-0000-4000-8000-000000000002";
const NOTE_ID: string = "c0000000-0000-4000-8000-000000000001";
const TOKEN: string = "ab".repeat(32);
const OTHER_TOKEN: string = "cd".repeat(32);
const TEAM_ID: ObjectID = new ObjectID("d0000000-0000-4000-8000-000000000001");

const PERMISSION: UserTenantAccessPermission = {
  projectId: PROJECT_ID,
  permissions: [],
} as unknown as UserTenantAccessPermission;

const GLOBAL_PERMISSION: UserGlobalAccessPermission = {
  projectIds: [PROJECT_ID],
} as unknown as UserGlobalAccessPermission;

// A service of each table the records are in.
const services: Record<string, DatabaseService<BaseModel>> = {
  Incident: { modelType: Incident } as unknown as DatabaseService<BaseModel>,
  IncidentInternalNote: {
    modelType: Incident,
  } as unknown as DatabaseService<BaseModel>,
};

interface ReadAsked {
  service: DatabaseService<BaseModel>;
  recordIds: Array<string>;
  projectId: string;
  props: DatabaseCommonInteractionProps;
}

let recordsOf: Record<string, Array<RecordShowingImage>> = {};
// What each record shows the person who reads it, by its id.
let shows: Record<string, Array<string>> = {};
let reads: Array<ReadAsked> = [];
let lookups: Array<string> = [];
let refuseTables: Set<DatabaseService<BaseModel>> = new Set();
let failReads: Error | null = null;

const ask: (
  data?: Partial<{
    userId: ObjectID;
    fileId: string;
    token: string;
  }>,
) => Promise<boolean> = async (
  data: Partial<{ userId: ObjectID; fileId: string; token: string }> = {},
): Promise<boolean> => {
  return await ShownImageAccess.isShownTo({
    userId: data.userId || USER_ID,
    projectId: PROJECT_ID,
    permission: PERMISSION,
    file: { fileId: data.fileId || FILE_ID, token: data.token || TOKEN },
  });
};

beforeEach(() => {
  ShownImageAccess.forget();
  recordsOf = {};
  shows = {};
  reads = [];
  lookups = [];
  refuseTables = new Set();
  failReads = null;

  jest
    .spyOn(ShownImages, "findRecords")
    .mockImplementation(
      async (data: {
        fileId: ObjectID | string;
      }): Promise<Array<RecordShowingImage>> => {
        lookups.push(data.fileId.toString());
        return recordsOf[data.fileId.toString()] || [];
      },
    );

  jest
    .spyOn(ShownImageAccess, "getServiceOf")
    .mockImplementation((tableName: string) => {
      return services[tableName] || null;
    });

  jest
    .spyOn(MarkdownFiles, "readShownTokens")
    .mockImplementation((async (data: {
      service: DatabaseService<BaseModel>;
      recordIds: Array<ObjectID>;
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<Map<string, Set<string>>> => {
      reads.push({
        service: data.service,
        recordIds: data.recordIds.map((id: ObjectID): string => {
          return id.toString();
        }),
        projectId: data.projectId.toString(),
        props: data.props,
      });

      // As a database would answer, after a moment.
      await Promise.resolve();

      if (failReads) {
        throw failReads;
      }

      if (refuseTables.has(data.service)) {
        throw new NotAuthorizedException("You do not have permissions to read");
      }

      const shown: Map<string, Set<string>> = new Map();

      for (const id of data.recordIds) {
        const tokens: Array<string> | undefined = shows[id.toString()];

        if (tokens) {
          shown.set(id.toString(), new Set(tokens));
        }
      }

      return shown;
    }) as never);

  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockResolvedValue(GLOBAL_PERMISSION);
  jest
    .spyOn(TeamMemberService, "getTeamIdsForUser")
    .mockResolvedValue([TEAM_ID]);
  jest
    .spyOn(CallerPlan, "withPlan")
    .mockImplementation(async (props: DatabaseCommonInteractionProps) => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ShownImageAccess.isShownTo", () => {
  test("yes when a record the person may read shows the image", async () => {
    recordsOf[FILE_ID] = [{ tableName: "Incident", recordId: INCIDENT_ID }];
    shows[INCIDENT_ID] = [TOKEN];

    expect(await ask()).toBe(true);
  });

  test("no when no record shows it", async () => {
    expect(await ask()).toBe(false);
    // Nothing to read as the person.
    expect(reads).toEqual([]);
  });

  test("no when the record no longer shows it, or shows another image", async () => {
    recordsOf[FILE_ID] = [{ tableName: "Incident", recordId: INCIDENT_ID }];
    shows[INCIDENT_ID] = [OTHER_TOKEN];

    expect(await ask()).toBe(false);
  });

  test("no when the person may not read the record: their read finds nothing", async () => {
    recordsOf[FILE_ID] = [{ tableName: "Incident", recordId: INCIDENT_ID }];

    expect(await ask()).toBe(false);
  });

  test("no when the person may not read the table at all: the refusal is a no, not an error", async () => {
    recordsOf[FILE_ID] = [{ tableName: "Incident", recordId: INCIDENT_ID }];
    shows[INCIDENT_ID] = [TOKEN];
    refuseTables.add(services["Incident"]!);

    expect(await ask()).toBe(false);
  });

  test("a read that fails for another reason is an error", async () => {
    recordsOf[FILE_ID] = [{ tableName: "Incident", recordId: INCIDENT_ID }];
    failReads = new Error("the database is unreachable");

    await expect(ask()).rejects.toThrow("the database is unreachable");
  });

  test("a table with no service of its own is not read at all", async () => {
    recordsOf[FILE_ID] = [{ tableName: "NoSuchTable", recordId: INCIDENT_ID }];
    shows[INCIDENT_ID] = [TOKEN];

    expect(await ask()).toBe(false);
    expect(reads).toEqual([]);
  });

  test("an image with no id or no token is shown to nobody, and nothing is looked up", async () => {
    expect(
      await ShownImageAccess.isShownTo({
        userId: USER_ID,
        projectId: PROJECT_ID,
        permission: PERMISSION,
        file: { fileId: "", token: TOKEN },
      }),
    ).toBe(false);
    expect(
      await ShownImageAccess.isShownTo({
        userId: USER_ID,
        projectId: PROJECT_ID,
        permission: PERMISSION,
        file: { fileId: FILE_ID, token: "" },
      }),
    ).toBe(false);
    expect(lookups).toEqual([]);
  });

  test("reads the records as the person: their permission in the project, their teams, the project's plan", async () => {
    recordsOf[FILE_ID] = [{ tableName: "Incident", recordId: INCIDENT_ID }];
    shows[INCIDENT_ID] = [TOKEN];

    await ask();

    expect(reads).toHaveLength(1);
    expect(reads[0]!.projectId).toBe(PROJECT_ID.toString());
    expect(reads[0]!.props).toEqual({
      userId: USER_ID,
      userType: UserType.User,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: { [PROJECT_ID.toString()]: PERMISSION },
      userGlobalAccessPermission: GLOBAL_PERMISSION,
      userTeamIds: [TEAM_ID],
    });
    expect(reads[0]!.props.isRoot).toBeUndefined();
    expect(CallerPlan.withPlan).toHaveBeenCalledTimes(1);
  });

  test("a person with no global permission reads with none", async () => {
    (
      AccessTokenService.getUserGlobalAccessPermission as unknown as jest.Mock
    ).mockResolvedValue(null as never);
    recordsOf[FILE_ID] = [{ tableName: "Incident", recordId: INCIDENT_ID }];
    shows[INCIDENT_ID] = [TOKEN];

    await ask();

    expect(reads[0]!.props.userGlobalAccessPermission).toBeUndefined();
  });

  test("the tables people paste images into most are read first, and the first that shows it ends the search", async () => {
    recordsOf[FILE_ID] = [
      { tableName: "NoSuchTable", recordId: NOTE_ID },
      { tableName: "IncidentInternalNote", recordId: NOTE_ID },
      { tableName: "Incident", recordId: INCIDENT_ID },
    ];
    shows[INCIDENT_ID] = [TOKEN];

    expect(await ask()).toBe(true);
    // Incident leads the common tables: the note was never read.
    expect(
      reads.map((read: ReadAsked): DatabaseService<BaseModel> => {
        return read.service;
      }),
    ).toEqual([services["Incident"]]);
  });

  test("every record of one table is read in one read", async () => {
    recordsOf[FILE_ID] = [
      { tableName: "Incident", recordId: INCIDENT_ID },
      { tableName: "Incident", recordId: OTHER_INCIDENT_ID },
      { tableName: "Incident", recordId: INCIDENT_ID },
    ];
    shows[OTHER_INCIDENT_ID] = [TOKEN];

    expect(await ask()).toBe(true);
    expect(reads).toHaveLength(1);
    expect(reads[0]!.recordIds).toEqual([INCIDENT_ID, OTHER_INCIDENT_ID]);
  });

  test("goes on to the next table when one shows the person nothing", async () => {
    recordsOf[FILE_ID] = [
      { tableName: "Incident", recordId: INCIDENT_ID },
      { tableName: "IncidentInternalNote", recordId: NOTE_ID },
    ];
    shows[NOTE_ID] = [TOKEN];

    expect(await ask()).toBe(true);
    expect(reads).toHaveLength(2);
  });
});

describe("what is kept, for SHOWN_TO_FOR_MS", () => {
  test("half a minute", () => {
    expect(SHOWN_TO_FOR_MS).toBe(30_000);
  });

  test("the answer for each person and image: asked again, nothing is looked up or read", async () => {
    recordsOf[FILE_ID] = [{ tableName: "Incident", recordId: INCIDENT_ID }];
    shows[INCIDENT_ID] = [TOKEN];

    expect(await ask()).toBe(true);
    expect(await ask()).toBe(true);

    expect(lookups).toEqual([FILE_ID]);
    expect(reads).toHaveLength(1);
  });

  test("a no is kept too", async () => {
    expect(await ask()).toBe(false);
    expect(await ask()).toBe(false);

    expect(lookups).toEqual([FILE_ID]);
  });

  test("what a record shows the person: another image of it is decided without reading it again", async () => {
    recordsOf[FILE_ID] = [{ tableName: "Incident", recordId: INCIDENT_ID }];
    recordsOf[OTHER_FILE_ID] = [
      { tableName: "Incident", recordId: INCIDENT_ID },
    ];
    shows[INCIDENT_ID] = [TOKEN, OTHER_TOKEN];

    expect(await ask()).toBe(true);
    expect(await ask({ fileId: OTHER_FILE_ID, token: OTHER_TOKEN })).toBe(true);

    expect(lookups).toEqual([FILE_ID, OTHER_FILE_ID]);
    expect(reads).toHaveLength(1);
  });

  test("kept for each person apart: another person's read is their own", async () => {
    recordsOf[FILE_ID] = [{ tableName: "Incident", recordId: INCIDENT_ID }];
    shows[INCIDENT_ID] = [TOKEN];

    await ask();
    await ask({ userId: OTHER_USER_ID });

    expect(reads).toHaveLength(2);
    expect(reads[1]!.props.userId).toBe(OTHER_USER_ID);
  });

  test("an error is not kept: the next request asks again", async () => {
    recordsOf[FILE_ID] = [{ tableName: "Incident", recordId: INCIDENT_ID }];
    shows[INCIDENT_ID] = [TOKEN];
    failReads = new Error("the database is unreachable");

    await expect(ask()).rejects.toThrow();

    failReads = null;

    expect(await ask()).toBe(true);
  });

  test("forgotten when asked: the next request decides again", async () => {
    recordsOf[FILE_ID] = [{ tableName: "Incident", recordId: INCIDENT_ID }];
    shows[INCIDENT_ID] = [TOKEN];

    await ask();
    ShownImageAccess.forget();
    await ask();

    expect(reads).toHaveLength(2);
  });
});

describe("a page that asks for many images at once", () => {
  test("twenty images of one incident read it once, and work out the person's props once", async () => {
    const files: Array<{ fileId: string; token: string }> = [];

    for (let index: number = 0; index < 20; index++) {
      const fileId: string = `f0000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`;
      const token: string = String(index).padStart(2, "0").repeat(32);

      files.push({ fileId: fileId, token: token });
      recordsOf[fileId] = [{ tableName: "Incident", recordId: INCIDENT_ID }];
    }

    shows[INCIDENT_ID] = files.map((file: { token: string }): string => {
      return file.token;
    });

    const answers: Array<boolean> = await Promise.all(
      files.map((file: { fileId: string; token: string }) => {
        return ask(file);
      }),
    );

    expect(answers).toEqual(
      files.map((): boolean => {
        return true;
      }),
    );
    expect(reads).toHaveLength(1);
    expect(TeamMemberService.getTeamIdsForUser).toHaveBeenCalledTimes(1);
    expect(CallerPlan.withPlan).toHaveBeenCalledTimes(1);
  });

  test("the same image asked twice at once is decided once", async () => {
    recordsOf[FILE_ID] = [{ tableName: "Incident", recordId: INCIDENT_ID }];
    shows[INCIDENT_ID] = [TOKEN];

    expect(await Promise.all([ask(), ask(), ask()])).toEqual([
      true,
      true,
      true,
    ]);
    expect(lookups).toEqual([FILE_ID]);
  });
});

describe("ShownImageAccess.groupByTable", () => {
  test("each table once, each record once, the common tables first, the rest in the order they came", () => {
    expect(
      ShownImageAccess.groupByTable([
        { tableName: "Team", recordId: "1" },
        { tableName: "IncidentInternalNote", recordId: "2" },
        { tableName: "Monitor", recordId: "3" },
        { tableName: "Incident", recordId: "4" },
        { tableName: "IncidentInternalNote", recordId: "5" },
        { tableName: "Incident", recordId: "4" },
      ]),
    ).toEqual([
      ["Incident", ["4"]],
      ["IncidentInternalNote", ["2", "5"]],
      ["Team", ["1"]],
      ["Monitor", ["3"]],
    ]);
  });
});

describe("ShownImageAccess.getServiceOf", () => {
  test("a table whose records cannot show images, or no table, has none", () => {
    jest.restoreAllMocks();

    expect(ShownImageAccess.getServiceOf("User")).toBeNull();
    expect(ShownImageAccess.getServiceOf("ShownImage")).toBeNull();
    expect(ShownImageAccess.getServiceOf("NoSuchTable")).toBeNull();
  });
});
