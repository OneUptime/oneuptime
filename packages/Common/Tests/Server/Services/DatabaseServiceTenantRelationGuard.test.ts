import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorService from "../../../Server/Services/MonitorService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PasswordHash has a known TS5.9 compile failure under ts-jest that breaks any
 * suite whose import graph reaches it (see ApiKeyPermissionSecurity.test.ts).
 * Nothing here touches password hashing; stub it before the service import
 * graph drags it into compilation.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

/*
 * Cross-tenant write via the tenant RELATION (confused deputy).
 *
 * A tenant model declares its tenant twice — the scalar `projectId` column and
 * the `project` @ManyToOne relation joined on that same column — and both are
 * writable by an ordinary member on create. `DatabaseService.create` stamps
 * only the scalar to `props.tenantId`; TypeORM then lets the relation object
 * override the scalar join value on the INSERT, so a member of project A who
 * posts `project: { _id: B }` writes the row into project B.
 *
 * `enforceTenantRelationMatchesScalar` rejects a tenant relation pointing at a
 * different project and deletes it so the stamped scalar is the only thing
 * that reaches the database. These tests drive the real `create()` pipeline
 * (only the IO/validation neighbours that are orthogonal to tenancy are
 * stubbed) and the guard directly for the update-shaped (plain object) input.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const PROJECT_B: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

function userPermission(permission: Permission): UserPermission {
  return {
    permission,
    labelIds: [],
    isBlockPermission: false,
    _type: "UserPermission",
  };
}

function memberProps(
  tenantId: ObjectID = PROJECT_A,
): DatabaseCommonInteractionProps {
  return {
    userId: new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
    tenantId,
    ignoreHooks: true,
    userGlobalAccessPermission: {
      projectIds: [tenantId],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [tenantId.toString()]: {
        projectId: tenantId,
        permissions: [userPermission(Permission.ProjectMember)],
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true, ignoreHooks: true };
}

type Target = {
  name: string;
  service: typeof MonitorService | typeof IncidentService;
  build: () => Monitor | Incident;
};

const TARGETS: Array<Target> = [
  {
    name: "Monitor",
    service: MonitorService,
    build: () => {
      const monitor: Monitor = new Monitor();
      monitor.name = "guard-test";
      return monitor;
    },
  },
  {
    name: "Incident",
    service: IncidentService,
    build: () => {
      const incident: Incident = new Incident();
      incident.title = "guard-test";
      return incident;
    },
  },
];

function projectRelation(id: ObjectID): Project {
  const project: Project = new Project();
  project._id = id.toString();
  return project;
}

describe("DatabaseService tenant-relation cross-tenant write guard", () => {
  describe.each(TARGETS)("$name create()", (target: Target) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service: any = target.service;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let save: jest.Mock<(entity: any) => Promise<any>>;

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      save = jest.fn(async (entity: any) => {
        return entity;
      }) as any;
      getJestSpyOn(service, "getRepository").mockReturnValue({
        save,
      } as never);
      // Count-backed validators (unique/limit checks) must not hit Postgres.
      getJestSpyOn(service, "countBy").mockResolvedValue(
        new PositiveNumber(0) as never,
      );
      /*
       * Required-field validation is orthogonal to the tenancy guard under
       * test; keep it from failing on unrelated columns.
       */
      getJestSpyOn(service, "checkRequiredFields").mockImplementation(((
        data: unknown,
      ) => {
        return data;
      }) as never);
      // Fire-and-forget side effects that would otherwise reach the network.
      getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
        undefined as never,
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("rejects a create whose project relation points at another project", async () => {
      const data: Monitor | Incident = target.build();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data as any).project = projectRelation(PROJECT_B);

      await expect(
        service.create({ data, props: memberProps(PROJECT_A) }),
      ).rejects.toThrow(BadDataException);

      expect(save).not.toHaveBeenCalled();
    });

    test("drops a matching project relation and persists under the request tenant only", async () => {
      const data: Monitor | Incident = target.build();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data as any).project = projectRelation(PROJECT_A);

      await service.create({ data, props: memberProps(PROJECT_A) });

      expect(save).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const saved: any = save.mock.calls[0]![0];
      expect(saved.project).toBeUndefined();
      expect(saved.projectId?.toString()).toBe(PROJECT_A.toString());
    });

    test("leaves the project relation untouched for a root/internal caller", async () => {
      const data: Monitor | Incident = target.build();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data as any).project = projectRelation(PROJECT_B);

      await service.create({ data, props: rootProps() });

      expect(save).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const saved: any = save.mock.calls[0]![0];
      expect(saved.project).toBeInstanceOf(Project);
      expect(saved.project._id).toBe(PROJECT_B.toString());
    });
  });

  /*
   * The same guard runs on the update path, where the payload is a plain
   * object (BaseAPI.updateItem deserializes rather than fromJSON'ing), so the
   * relation arrives as `{ _id: ... }` rather than a Project instance.
   */
  describe("enforceTenantRelationMatchesScalar (update-shaped input)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const guard: any = MonitorService;

    test("throws when a plain-object project relation points at another project", () => {
      const data: Record<string, unknown> = {
        name: "x",
        project: { _id: PROJECT_B.toString() },
      };

      expect(() => {
        guard.enforceTenantRelationMatchesScalar(data, memberProps(PROJECT_A));
      }).toThrow(BadDataException);
    });

    test("strips a matching plain-object project relation", () => {
      const data: Record<string, unknown> = {
        name: "x",
        project: { _id: PROJECT_A.toString() },
      };

      guard.enforceTenantRelationMatchesScalar(data, memberProps(PROJECT_A));

      expect(data["project"]).toBeUndefined();
      expect(data["name"]).toBe("x");
    });

    test("is a no-op when no project relation is supplied", () => {
      const data: Record<string, unknown> = { name: "x" };

      expect(() => {
        guard.enforceTenantRelationMatchesScalar(data, memberProps(PROJECT_A));
      }).not.toThrow();
      expect(data).toEqual({ name: "x" });
    });

    test("does not touch the relation for a root/internal caller", () => {
      const data: Record<string, unknown> = {
        project: { _id: PROJECT_B.toString() },
      };

      guard.enforceTenantRelationMatchesScalar(data, rootProps());

      expect(data["project"]).toEqual({ _id: PROJECT_B.toString() });
    });
  });
});
