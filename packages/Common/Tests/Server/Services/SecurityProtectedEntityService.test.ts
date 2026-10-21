import SecurityProtectedEntityService from "../../../Server/Services/SecurityProtectedEntityService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import SecurityProtectedEntity from "../../../Models/DatabaseModels/SecurityProtectedEntity";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
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
 * The project's protected users and hosts: what a row may hold, that a value
 * is listed once, and the list as the target rule reads it. Who may change
 * it is the model's: the Admin tier and whoever may set up playbooks.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ROW_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<SecurityProtectedEntity>,
  ) => Promise<OnCreate<SecurityProtectedEntity>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<SecurityProtectedEntity>,
  ) => Promise<OnUpdate<SecurityProtectedEntity>>;
};

const service: HookCaller =
  SecurityProtectedEntityService as unknown as HookCaller;

function row(
  type: SecurityEntityType,
  value: string,
  id: ObjectID = ObjectID.generate(),
): SecurityProtectedEntity {
  const model: SecurityProtectedEntity = new SecurityProtectedEntity();
  model._id = id.toString();
  model.projectId = PROJECT_ID;
  model.entityType = type;
  model.value = value;
  return model;
}

function entry(type: unknown, value: unknown): SecurityProtectedEntity {
  const model: SecurityProtectedEntity = new SecurityProtectedEntity();
  model.projectId = PROJECT_ID;
  model.entityType = type as SecurityEntityType;
  model.value = value as string;
  return model;
}

beforeEach(() => {
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
    undefined as never,
  );
  // The project lists one host; a query asks for one kind of entity.
  getJestSpyOn(SecurityProtectedEntityService, "findBy").mockImplementation(
    async (input: unknown) => {
      const kind: unknown = (input as { query: { entityType?: unknown } }).query
        .entityType;

      return [row(SecurityEntityType.Host, "VPN-GW-*", ROW_ID)].filter(
        (model: SecurityProtectedEntity): boolean => {
          return model.entityType === kind;
        },
      ) as never;
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityProtectedEntityService", () => {
  test("keeps a user or a host, its value trimmed and its wildcards folded", async () => {
    const created: SecurityProtectedEntity = entry(
      SecurityEntityType.User,
      "  svc-**  ",
    );

    await service.onBeforeCreate({ data: created, props: { isRoot: true } });

    expect(created.entityType).toBe(SecurityEntityType.User);
    expect(created.value).toBe("svc-*");
  });

  test("refuses another kind of entity, and an empty or over-long value", async () => {
    await expect(
      service.onBeforeCreate({
        data: entry(SecurityEntityType.IpAddress, "10.0.0.1"),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/a User or a Host/);
    await expect(
      service.onBeforeCreate({
        data: entry(SecurityEntityType.Host, "   "),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/Enter the user's sign-in name or the host's name/);
    await expect(
      service.onBeforeCreate({
        data: entry(SecurityEntityType.Host, "h".repeat(501)),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/at most 500 characters/);
  });

  test("lists a value once per kind, whatever its case", async () => {
    await expect(
      service.onBeforeCreate({
        data: entry(SecurityEntityType.Host, "vpn-gw-*"),
        props: { isRoot: true },
      }),
    ).rejects.toThrow('Host "vpn-gw-*" is already protected.');

    // The same value as a user is another entry.
    await expect(
      service.onBeforeCreate({
        data: entry(SecurityEntityType.User, "vpn-gw-*"),
        props: { isRoot: true },
      }),
    ).resolves.toBeTruthy();
  });

  test("an edit is held to the same rules, and is not a duplicate of itself", async () => {
    getJestSpyOn(
      SecurityProtectedEntityService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([
      row(SecurityEntityType.Host, "VPN-GW-*", ROW_ID),
    ] as never);

    const rename: UpdateBy<SecurityProtectedEntity> = {
      query: { _id: ROW_ID.toString() },
      data: { value: " vpn-gw-* " } as never,
      skip: 0,
      limit: 1,
      props: { isRoot: true },
    };

    await service.onBeforeUpdate(rename);

    expect((rename.data as { value: string }).value).toBe("vpn-gw-*");

    await expect(
      service.onBeforeUpdate({
        ...rename,
        data: { entityType: SecurityEntityType.Domain } as never,
      }),
    ).rejects.toThrow(/a User or a Host/);
  });

  test("hands the target rule the project's entries of a kind", async () => {
    const findBy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityProtectedEntityService,
      "findBy",
    ).mockResolvedValue([
      row(SecurityEntityType.Host, "VPN-GW-*"),
      row(SecurityEntityType.Host, ""),
    ] as never);

    expect(
      await SecurityProtectedEntityService.getRules({
        projectId: PROJECT_ID,
        entityType: SecurityEntityType.Host,
      }),
    ).toEqual([{ type: SecurityEntityType.Host, value: "VPN-GW-*" }]);
    expect(
      (findBy.mock.calls[0]![0] as { query: { entityType: string } }).query
        .entityType,
    ).toBe(SecurityEntityType.Host);
  });

  test("is changed by the Admin tier and whoever may set up playbooks, and read by every Security tier", () => {
    const model: SecurityProtectedEntity = new SecurityProtectedEntity();

    for (const permissions of [
      model.getCreatePermissions(),
      model.getUpdatePermissions(),
      model.getDeletePermissions(),
    ]) {
      expect(permissions).toContain(Permission.SecurityAdmin);
      expect(permissions).not.toContain(Permission.SecurityMember);
      expect(permissions).not.toContain(Permission.ProjectMember);
    }

    expect(model.getReadPermissions()).toEqual(
      expect.arrayContaining([
        Permission.SecurityAdmin,
        Permission.SecurityMember,
        Permission.SecurityViewer,
      ]),
    );
    expect(model.getReadPermissions()).not.toContain(Permission.ProjectMember);
    expect(model.enableAuditLogOn?.update).toBe(true);
  });
});
