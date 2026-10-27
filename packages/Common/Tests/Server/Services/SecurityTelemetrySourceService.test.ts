import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityTelemetrySource from "../../../Models/DatabaseModels/SecurityTelemetrySource";
import SecurityTelemetrySourceService from "../../../Server/Services/SecurityTelemetrySourceService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { SecurityTelemetrySourceKind } from "../../../Types/SecurityEvent/SecurityTelemetrySource";
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
 * "Your OneUptime data" as security sources, saved through the whole write
 * as the people who turn them on: one per kind per project, reading from
 * the moment each is turned on (and again when turned back on), the kind
 * fixed, the cursor and the last error OneUptime's own to write.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b811-9dad-41d1-80b4-00c04fd43301",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b811-9dad-41d1-80b4-00c04fd43302",
);
const SOURCE_ID: string = "6ba7b812-9dad-41d1-80b4-00c04fd43301";
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");

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

function newSource(
  kind: SecurityTelemetrySourceKind | string | undefined,
  projectId: ObjectID = OTHER_PROJECT_ID,
): SecurityTelemetrySource {
  const source: SecurityTelemetrySource = new SecurityTelemetrySource();
  source.projectId = projectId;

  if (kind !== undefined) {
    source.kind = kind as SecurityTelemetrySourceKind;
  }

  return source;
}

describe("SecurityTelemetrySourceService, through the whole write", () => {
  let sources: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({});
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    sources = useInMemoryTable(SecurityTelemetrySourceService, [
      {
        _id: SOURCE_ID,
        projectId: PROJECT_ID.toString(),
        kind: SecurityTelemetrySourceKind.Traces,
        isEnabled: false,
        cursor: "2026-10-01T00:00:00.000Z",
        lastError: "Span table unreachable",
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
    "%s turns one on: on, and reading from now",
    async (_who: string, permissions: Array<Permission>) => {
      await SecurityTelemetrySourceService.create({
        data: newSource(SecurityTelemetrySourceKind.NetworkFlows),
        props: member(permissions, OTHER_PROJECT_ID),
      });

      const row: StoredRow = sources.inserts[0]!;

      expect(row["isEnabled"]).toBe(true);
      expect(row["kind"]).toBe(SecurityTelemetrySourceKind.NetworkFlows);
      expect(row["cursor"]).toBe(NOW.toISOString());
    },
  );

  test.each<[string, Array<Permission>]>([
    ["a security member", [Permission.SecurityMember]],
    ["a security viewer", [Permission.SecurityViewer]],
    ["a telemetry admin", [Permission.TelemetryAdmin]],
  ])(
    "%s cannot turn one on",
    async (_who: string, permissions: Array<Permission>) => {
      await expect(
        SecurityTelemetrySourceService.create({
          data: newSource(SecurityTelemetrySourceKind.AuditLog),
          props: member(permissions, OTHER_PROJECT_ID),
        }),
      ).rejects.toThrow();
      expect(sources.inserts).toHaveLength(0);
    },
  );

  test("a project has one of each kind: a second of a kind is refused, another kind is not", async () => {
    await expect(
      SecurityTelemetrySourceService.create({
        data: newSource(SecurityTelemetrySourceKind.Traces, PROJECT_ID),
        props: member([Permission.SecurityAdmin]),
      }),
    ).rejects.toThrow("already a security source");

    await SecurityTelemetrySourceService.create({
      data: newSource(SecurityTelemetrySourceKind.RumSessions, PROJECT_ID),
      props: member([Permission.SecurityAdmin]),
    });

    expect(sources.inserts).toHaveLength(1);
  });

  test.each<[string, string | undefined]>([
    ["no kind", undefined],
    ["a kind that is not one", "logs"],
  ])("%s is refused", async (_case: string, kind: string | undefined) => {
    await expect(
      SecurityTelemetrySourceService.create({
        data: newSource(kind),
        props: member([Permission.SecurityAdmin], OTHER_PROJECT_ID),
      }),
    ).rejects.toThrow();
    expect(sources.inserts).toHaveLength(0);
  });

  test("turned back on, it reads from now - not from where it stopped - and the old error is gone", async () => {
    await SecurityTelemetrySourceService.updateOneById({
      id: new ObjectID(SOURCE_ID),
      data: { isEnabled: true },
      props: member([Permission.SecurityAdmin]),
    });

    expect(sources.get(SOURCE_ID)!["isEnabled"]).toBe(true);
    expect(sources.get(SOURCE_ID)!["cursor"]).toBe(NOW.toISOString());
    expect(sources.get(SOURCE_ID)!["lastError"]).toBeNull();
  });

  test("turned off, it keeps its place", async () => {
    await SecurityTelemetrySourceService.updateOneById({
      id: new ObjectID(SOURCE_ID),
      data: { isEnabled: false },
      props: member([Permission.SecurityAdmin]),
    });

    expect(sources.get(SOURCE_ID)!["cursor"]).toBe("2026-10-01T00:00:00.000Z");
  });

  test("nobody changes its kind or writes its cursor but OneUptime", async () => {
    await expect(
      SecurityTelemetrySourceService.updateOneById({
        id: new ObjectID(SOURCE_ID),
        data: { kind: SecurityTelemetrySourceKind.AuditLog },
        props: member([Permission.ProjectOwner]),
      }),
    ).rejects.toThrow();

    await expect(
      SecurityTelemetrySourceService.updateOneById({
        id: new ObjectID(SOURCE_ID),
        data: { cursor: "2020-01-01T00:00:00.000Z" },
        props: member([Permission.ProjectOwner]),
      }),
    ).rejects.toThrow();
  });

  test("every Security tier can read how it is doing", async () => {
    for (const permission of [
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
    ]) {
      const found: SecurityTelemetrySource | null =
        await SecurityTelemetrySourceService.findOneById({
          id: new ObjectID(SOURCE_ID),
          select: {
            kind: true,
            isEnabled: true,
            lastScannedAt: true,
            lastScanResult: true,
            lastError: true,
          },
          props: member([permission]),
        });

      expect([permission, found?.kind]).toEqual([
        permission,
        SecurityTelemetrySourceKind.Traces,
      ]);
    }
  });
});
