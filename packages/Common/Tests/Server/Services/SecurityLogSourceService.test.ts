import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityLogSource from "../../../Models/DatabaseModels/SecurityLogSource";
import SecurityLogSourceService from "../../../Server/Services/SecurityLogSourceService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * "Your logs" as a security source, saved through the whole write as the
 * people who turn it on: one per project, reading from the moment it is
 * turned on (and again when it is turned back on), its cursor and its
 * last error OneUptime's own to write.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b811-9dad-41d1-80b4-00c04fd43201",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b811-9dad-41d1-80b4-00c04fd43202",
);
const SOURCE_ID: string = "6ba7b812-9dad-41d1-80b4-00c04fd43201";
const NOW: Date = new Date("2026-10-19T12:00:00.000Z");

function member(
  permissions: Array<Permission>,
  projectId: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: projectId,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            } as UserPermission;
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function newSource(projectId: ObjectID = OTHER_PROJECT_ID): SecurityLogSource {
  const source: SecurityLogSource = new SecurityLogSource();
  source.projectId = projectId;
  return source;
}

describe("SecurityLogSourceService, through the whole write", () => {
  let sources: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({});
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    sources = useInMemoryTable(SecurityLogSourceService, [
      {
        _id: SOURCE_ID,
        projectId: PROJECT_ID.toString(),
        isEnabled: false,
        cursor: "2026-10-01T00:00:00.000Z",
        lastError: "Log table unreachable",
        version: 1,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each<[string, Array<Permission>]>([
    ["a project owner", [Permission.ProjectOwner]],
    ["a project admin", [Permission.ProjectAdmin]],
    ["a security admin", [Permission.SecurityAdmin]],
  ])(
    "%s turns it on: on, and reading from now",
    async (_who: string, permissions: Array<Permission>) => {
      await SecurityLogSourceService.create({
        data: newSource(),
        props: member(permissions, OTHER_PROJECT_ID),
      });

      const row: StoredRow = sources.inserts[0]!;

      expect(row["isEnabled"]).toBe(true);
      expect(row["cursor"]).toBe(NOW.toISOString());
    },
  );

  test.each<[string, Array<Permission>]>([
    ["a security member", [Permission.SecurityMember]],
    ["a security viewer", [Permission.SecurityViewer]],
    ["a telemetry admin", [Permission.TelemetryAdmin]],
  ])(
    "%s cannot turn it on",
    async (_who: string, permissions: Array<Permission>) => {
      await expect(
        SecurityLogSourceService.create({
          data: newSource(),
          props: member(permissions, OTHER_PROJECT_ID),
        }),
      ).rejects.toThrow();
      expect(sources.inserts).toHaveLength(0);
    },
  );

  test("a project has one: a second is refused", async () => {
    await expect(
      SecurityLogSourceService.create({
        data: newSource(PROJECT_ID),
        props: member([Permission.SecurityAdmin]),
      }),
    ).rejects.toThrow("already a security source");
  });

  test("turned back on, it reads from now - not from where it stopped - and the old error is gone", async () => {
    await SecurityLogSourceService.updateOneById({
      id: new ObjectID(SOURCE_ID),
      data: { isEnabled: true },
      props: member([Permission.SecurityAdmin]),
    });

    expect(sources.get(SOURCE_ID)!["isEnabled"]).toBe(true);
    expect(sources.get(SOURCE_ID)!["cursor"]).toBe(NOW.toISOString());
    expect(sources.get(SOURCE_ID)!["lastError"]).toBeNull();
  });

  test("turned off, it keeps its place", async () => {
    await SecurityLogSourceService.updateOneById({
      id: new ObjectID(SOURCE_ID),
      data: { isEnabled: false },
      props: member([Permission.SecurityAdmin]),
    });

    expect(sources.get(SOURCE_ID)!["cursor"]).toBe("2026-10-01T00:00:00.000Z");
  });

  test("a security member cannot turn it on or off", async () => {
    await expect(
      SecurityLogSourceService.updateOneById({
        id: new ObjectID(SOURCE_ID),
        data: { isEnabled: true },
        props: member([Permission.SecurityMember]),
      }),
    ).rejects.toThrow();
  });

  test("nobody writes its cursor but OneUptime", async () => {
    await expect(
      SecurityLogSourceService.updateOneById({
        id: new ObjectID(SOURCE_ID),
        data: { cursor: "2020-01-01T00:00:00.000Z" },
        props: member([Permission.ProjectOwner]),
      }),
    ).rejects.toThrow();
  });

  test("every Security tier can read how it is doing", async () => {
    const found: SecurityLogSource | null =
      await SecurityLogSourceService.findOneById({
        id: new ObjectID(SOURCE_ID),
        select: {
          isEnabled: true,
          lastScannedAt: true,
          lastScanResult: true,
          lastError: true,
        },
        props: member([Permission.SecurityViewer]),
      });

    expect(found?.lastError).toBe("Log table unreachable");
  });

  test("findForProject finds the project's one, as OneUptime", async () => {
    const found: SecurityLogSource | null =
      await SecurityLogSourceService.findForProject(PROJECT_ID);

    expect(found?.id?.toString()).toBe(SOURCE_ID);
    expect(
      await SecurityLogSourceService.findForProject(OTHER_PROJECT_ID),
    ).toBe(null);
  });
});
