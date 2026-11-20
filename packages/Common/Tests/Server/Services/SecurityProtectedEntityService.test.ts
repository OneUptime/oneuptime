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
 * The project's protected users, hosts and addresses: what a row may hold,
 * that a value is listed once, and the list as the target rule reads it.
 * Who may change it is the model's: the Admin tier and whoever may set up
 * playbooks.
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
        data: entry(SecurityEntityType.Domain, "evil.example.com"),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/a User, a Host or an IP Address/);
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
    ).rejects.toThrow(/a User, a Host or an IP Address/);
  });

  /*
   * An address entry (#10338) is an address or a range, written the one
   * way blocks are - an IPv6 address compressed in lowercase, a range as
   * its first address and its length - so two spellings of one address are
   * one entry, and a blocked value is matched against it as a range.
   */
  test("keeps an address or a range, written the one way blocks are", async () => {
    const address: SecurityProtectedEntity = entry(
      SecurityEntityType.IpAddress,
      " 2001:DB8:0:0:0:0:0:1 ",
    );
    const range: SecurityProtectedEntity = entry(
      SecurityEntityType.IpAddress,
      "203.0.113.7/24",
    );
    const mapped: SecurityProtectedEntity = entry(
      SecurityEntityType.IpAddress,
      "::ffff:198.51.100.4",
    );

    await service.onBeforeCreate({ data: address, props: { isRoot: true } });
    await service.onBeforeCreate({ data: range, props: { isRoot: true } });
    await service.onBeforeCreate({ data: mapped, props: { isRoot: true } });

    expect(address.value).toBe("2001:db8::1");
    expect(range.value).toBe("203.0.113.0/24");
    expect(mapped.value).toBe("198.51.100.4");
  });

  test("refuses an address entry that is no address or range, a pattern included", async () => {
    for (const value of ["web-3", "203.0.113.*", "203.0.113.0/33", "   "]) {
      await expect(
        service.onBeforeCreate({
          data: entry(SecurityEntityType.IpAddress, value),
          props: { isRoot: true },
        }),
      ).rejects.toThrow(
        "Enter an IPv4 or IPv6 address to protect, such as 203.0.113.7, or a range written as an address and a length, such as 203.0.113.0/24.",
      );
    }
  });

  test("lists an address once, however it is spelled", async () => {
    getJestSpyOn(SecurityProtectedEntityService, "findBy").mockImplementation(
      async (input: unknown) => {
        const kind: unknown = (input as { query: { entityType?: unknown } })
          .query.entityType;

        return [
          row(SecurityEntityType.IpAddress, "2001:db8::1", ROW_ID),
        ].filter((model: SecurityProtectedEntity): boolean => {
          return model.entityType === kind;
        }) as never;
      },
    );

    await expect(
      service.onBeforeCreate({
        data: entry(SecurityEntityType.IpAddress, "2001:DB8:0000::1"),
        props: { isRoot: true },
      }),
    ).rejects.toThrow('IP Address "2001:db8::1" is already protected.');

    // Another address, or the same text as a host's name, is another entry.
    await expect(
      service.onBeforeCreate({
        data: entry(SecurityEntityType.IpAddress, "2001:db8::2"),
        props: { isRoot: true },
      }),
    ).resolves.toBeTruthy();
    await expect(
      service.onBeforeCreate({
        data: entry(SecurityEntityType.Host, "2001:db8::1"),
        props: { isRoot: true },
      }),
    ).resolves.toBeTruthy();
  });

  test("an edit that turns an entry into an address reads its value as one", async () => {
    getJestSpyOn(
      SecurityProtectedEntityService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([
      row(SecurityEntityType.Host, "VPN-GW-*", ROW_ID),
    ] as never);

    const toAddress: UpdateBy<SecurityProtectedEntity> = {
      query: { _id: ROW_ID.toString() },
      data: { entityType: SecurityEntityType.IpAddress } as never,
      skip: 0,
      limit: 1,
      props: { isRoot: true },
    };

    // A host's pattern is no address: the row cannot become one as it is.
    await expect(service.onBeforeUpdate(toAddress)).rejects.toThrow(
      /Enter an IPv4 or IPv6 address to protect/,
    );

    // With an address given beside the kind, it is kept the one way.
    const withValue: UpdateBy<SecurityProtectedEntity> = {
      ...toAddress,
      data: {
        entityType: SecurityEntityType.IpAddress,
        value: "203.0.113.7/24",
      } as never,
    };

    await service.onBeforeUpdate(withValue);

    expect((withValue.data as { value: string }).value).toBe("203.0.113.0/24");
    expect((withValue.data as { entityType: string }).entityType).toBe(
      SecurityEntityType.IpAddress,
    );
  });

  test("an address entry's new value is read as an address", async () => {
    getJestSpyOn(
      SecurityProtectedEntityService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([
      row(SecurityEntityType.IpAddress, "203.0.113.0/24", ROW_ID),
    ] as never);

    const edit: UpdateBy<SecurityProtectedEntity> = {
      query: { _id: ROW_ID.toString() },
      data: { value: "2001:DB8::7" } as never,
      skip: 0,
      limit: 1,
      props: { isRoot: true },
    };

    await service.onBeforeUpdate(edit);

    expect((edit.data as { value: string }).value).toBe("2001:db8::7");

    await expect(
      service.onBeforeUpdate({
        ...edit,
        data: { value: "not-an-address" } as never,
      }),
    ).rejects.toThrow(/Enter an IPv4 or IPv6 address to protect/);
  });

  /*
   * One write gives every row it changes the same value. It is read as
   * each row's kind, so it must read the same for all of them, and no two
   * rows of one kind may get it: a value is listed once.
   */
  test("one value written to rows of different kinds must read the same for each", async () => {
    getJestSpyOn(
      SecurityProtectedEntityService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([
      row(SecurityEntityType.Host, "vpn-gw"),
      row(SecurityEntityType.IpAddress, "203.0.113.0/24"),
    ] as never);

    const update: UpdateBy<SecurityProtectedEntity> = {
      query: {},
      data: { value: "2001:DB8::1" } as never,
      skip: 0,
      limit: 2,
      props: { isRoot: true },
    };

    // A host's name keeps its case; an address is written the one way.
    await expect(service.onBeforeUpdate(update)).rejects.toThrow(
      "Change the value of one protected entity at a time: it reads differently as a user, a host and an IP address.",
    );

    // The same text, the same for both: written as it reads.
    const same: UpdateBy<SecurityProtectedEntity> = {
      ...update,
      data: { value: "  10.0.0.1  " } as never,
    };

    await service.onBeforeUpdate(same);

    expect((same.data as { value: string }).value).toBe("10.0.0.1");
  });

  test("one value is never written to two rows of one kind", async () => {
    getJestSpyOn(
      SecurityProtectedEntityService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([
      row(SecurityEntityType.IpAddress, "203.0.113.7"),
      row(SecurityEntityType.IpAddress, "203.0.113.8"),
    ] as never);

    await expect(
      service.onBeforeUpdate({
        query: {},
        data: { value: "198.51.100.4" } as never,
        skip: 0,
        limit: 2,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      'IP Address "198.51.100.4" can be protected only once. Change one protected entity\'s value at a time.',
    );
  });

  test("a change of kind alone spells a row's value again, one row at a time", async () => {
    const hold: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityProtectedEntityService,
      "findRowsAndHoldUpdateToThem",
    );

    // One row, its address spelled another way: the change writes it the one way.
    hold.mockResolvedValue([
      row(SecurityEntityType.Host, "2001:DB8:0::1", ROW_ID),
    ] as never);

    const one: UpdateBy<SecurityProtectedEntity> = {
      query: { _id: ROW_ID.toString() },
      data: { entityType: SecurityEntityType.IpAddress } as never,
      skip: 0,
      limit: 1,
      props: { isRoot: true },
    };

    await service.onBeforeUpdate(one);

    expect((one.data as { value: string }).value).toBe("2001:db8::1");

    // Two rows: one value cannot be both rows' own.
    hold.mockResolvedValue([
      row(SecurityEntityType.Host, "2001:DB8:0::1"),
      row(SecurityEntityType.Host, "10.0.0.9"),
    ] as never);

    await expect(
      service.onBeforeUpdate({
        query: {},
        data: { entityType: SecurityEntityType.IpAddress } as never,
        skip: 0,
        limit: 2,
        props: { isRoot: true },
      }),
    ).rejects.toThrow("Change the kind of one protected entity at a time.");

    // Two rows already spelled the one way: their values stay, unwritten.
    hold.mockResolvedValue([
      row(SecurityEntityType.Host, "10.0.0.8"),
      row(SecurityEntityType.Host, "10.0.0.9"),
    ] as never);

    const both: UpdateBy<SecurityProtectedEntity> = {
      query: {},
      data: { entityType: SecurityEntityType.IpAddress } as never,
      skip: 0,
      limit: 2,
      props: { isRoot: true },
    };

    await service.onBeforeUpdate(both);

    expect((both.data as { value?: string }).value).toBeUndefined();
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
