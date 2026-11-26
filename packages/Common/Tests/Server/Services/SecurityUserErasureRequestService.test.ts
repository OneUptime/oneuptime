import SecurityUserErasureRequestService, {
  getErasureTokens,
  readErasureRequestNames,
  readErasureRequestTokens,
  toStoredErasureNames,
} from "../../../Server/Services/SecurityUserErasureRequestService";
import { MAX_USER_VAULT_USER_LENGTH } from "../../../Server/Services/SecurityUserVaultService";
import ColumnPermission from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ScrubHashToken from "../../../Server/Utils/Telemetry/ScrubHashToken";
import SecurityUserErasureRequest from "../../../Models/DatabaseModels/SecurityUserErasureRequest";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  SECURITY_USER_ERASURE_MAX_REFERENCE_LENGTH,
  SECURITY_USER_ERASURE_MAX_USER_LENGTH,
  SecurityUserErasureRequestStatus,
} from "../../../Types/SecurityEvent/SecurityUserErasure";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { columnsTheCreateWrote } from "../TestingUtils/ColumnsSetByServer";

/*
 * Security Events' erasure requests (#10908), through the create path
 * DatabaseService.create() drives - onBeforeCreate, the column permission
 * check that runs after it, checkRequiredFields - and the table's access
 * lists, as the server reads them:
 *
 *   - what a request keeps of the person: the tokens the project's Hash
 *     rules make of what was typed (an email address in lower case too, a
 *     user id only as typed, a pasted token as itself), what was typed
 *     only until the request is over, and never anything the client sent
 *     in its place - status, counters, tokens, when, who;
 *   - what it refuses, with words that say what to do;
 *   - who may file one (Project Owners and Admins, the Security Admin
 *     tier, Create Security Erasure Request) and who may only read them
 *     (every Security tier, Read Security Erasure Request) - and that
 *     nobody reads back what was typed, or changes or deletes a request.
 */

beforeEach(() => {
  stubProjectDirectory({});
});

const projectId: ObjectID = new ObjectID(
  "10908000-0000-4000-8000-0000000000b1",
);
const userId: ObjectID = ObjectID.generate();

function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission" as const,
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

interface CreatePathAccess {
  checkRequiredFields: (
    data: SecurityUserErasureRequest,
  ) => SecurityUserErasureRequest;
  onBeforeCreate: (
    createBy: CreateBy<SecurityUserErasureRequest>,
  ) => Promise<OnCreate<SecurityUserErasureRequest>>;
}

const createPath: CreatePathAccess =
  SecurityUserErasureRequestService as unknown as CreatePathAccess;

function createByOf(data: {
  userToErase?: string | undefined;
  reference?: string | undefined;
  permissions?: Array<Permission> | undefined;
}): CreateBy<SecurityUserErasureRequest> {
  const model: SecurityUserErasureRequest = new SecurityUserErasureRequest();
  model.projectId = projectId;

  if (data.userToErase !== undefined) {
    model.userToErase = data.userToErase;
  }

  if (data.reference !== undefined) {
    model.reference = data.reference;
  }

  return {
    data: model,
    props: propsWith(data.permissions || [Permission.SecurityAdmin]),
  };
}

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId, value });
}

describe("the tokens a request erases", () => {
  test("an email address: as typed, and in lower case", () => {
    expect(
      getErasureTokens({ projectId, user: "  Alice@Example.com " }).sort(),
    ).toEqual(
      [tokenOf("Alice@Example.com"), tokenOf("alice@example.com")].sort(),
    );
  });

  test("an email address already in lower case: one token", () => {
    expect(getErasureTokens({ projectId, user: "alice@example.com" })).toEqual([
      tokenOf("alice@example.com"),
    ]);
  });

  test("a user id only as typed: Alice and alice can be two accounts", () => {
    expect(getErasureTokens({ projectId, user: "Alice" })).toEqual([
      tokenOf("Alice"),
    ]);
    expect(getErasureTokens({ projectId, user: "auth0|5F7C8EC7" })).toEqual([
      tokenOf("auth0|5F7C8EC7"),
    ]);
  });

  test("a pasted token: itself, never hashed again", () => {
    const token: string = tokenOf("alice@example.com");

    expect(getErasureTokens({ projectId, user: ` ${token} ` })).toEqual([
      token,
    ]);
  });

  test("keyed per project, as the Hash rule's tokens are", () => {
    const other: ObjectID = ObjectID.generate();

    expect(
      getErasureTokens({ projectId: other, user: "alice@example.com" }),
    ).not.toEqual(getErasureTokens({ projectId, user: "alice@example.com" }));
  });

  test("nothing, or more than the vault keeps: none", () => {
    expect(getErasureTokens({ projectId, user: "   " })).toEqual([]);
    expect(
      getErasureTokens({
        projectId,
        user: "a".repeat(SECURITY_USER_ERASURE_MAX_USER_LENGTH + 1),
      }),
    ).toEqual([]);
  });

  test("the longest user a request takes is the longest the vault keeps", () => {
    expect(SECURITY_USER_ERASURE_MAX_USER_LENGTH).toBe(
      MAX_USER_VAULT_USER_LENGTH,
    );
  });

  test("a request's stored tokens are read back defensively", () => {
    const request: SecurityUserErasureRequest =
      new SecurityUserErasureRequest();
    const token: string = tokenOf("alice@example.com");

    request.tokens = [token, "alice@example.com", 7, null] as never;
    expect(readErasureRequestTokens(request)).toEqual([token]);

    request.tokens = "not a list" as never;
    expect(readErasureRequestTokens(request)).toEqual([]);
  });
});

describe("filing a request", () => {
  test("keeps the tokens, what was typed (until the worker wipes it), and starts Pending at zero", async () => {
    const before: number = OneUptimeDate.getCurrentDate().getTime();
    const onCreate: OnCreate<SecurityUserErasureRequest> =
      await createPath.onBeforeCreate(
        createByOf({
          userToErase: "  Alice@Example.com  ",
          reference: "  DSR-1042 ",
        }),
      );
    const data: SecurityUserErasureRequest = onCreate.createBy.data;

    expect(data.tokens?.sort()).toEqual(
      [tokenOf("Alice@Example.com"), tokenOf("alice@example.com")].sort(),
    );
    expect(data.userToErase).toBe("Alice@Example.com");
    expect(data.reference).toBe("DSR-1042");
    expect(data.status).toBe(SecurityUserErasureRequestStatus.Pending);
    expect(data.attempts).toBe(0);
    expect(data.vaultEntriesDeleted).toBe(0);
    expect(data.eventsUnnamed).toBe(0);
    expect(data.casesUnnamed).toBe(0);
    expect(data.proposalsWithdrawn).toBe(0);
    expect(data.requestedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.requestedByUserId?.toString()).toBe(userId.toString());
  });

  test("a pasted token keeps nothing typed: the worker needs only the token", async () => {
    const token: string = tokenOf("alice@example.com");
    const onCreate: OnCreate<SecurityUserErasureRequest> =
      await createPath.onBeforeCreate(createByOf({ userToErase: token }));

    expect(onCreate.createBy.data.tokens).toEqual([token]);
    expect(onCreate.createBy.data.userToErase).toBeNull();
  });

  test("overwrites everything a requester could lie about", async () => {
    const createBy: CreateBy<SecurityUserErasureRequest> = createByOf({
      userToErase: "alice@example.com",
    });

    createBy.data.status = SecurityUserErasureRequestStatus.Completed;
    createBy.data.tokens = ["[HASHED:0000000000000000]"];
    createBy.data.vaultEntriesDeleted = 999;
    createBy.data.eventsUnnamed = 999;
    createBy.data.casesUnnamed = 999;
    createBy.data.proposalsWithdrawn = 999;
    createBy.data.attempts = 4;
    createBy.data.requestedAt = OneUptimeDate.fromString(
      "2000-01-01T00:00:00.000Z",
    );
    createBy.data.requestedByUserId = ObjectID.generate();

    const data: SecurityUserErasureRequest = (
      await createPath.onBeforeCreate(createBy)
    ).createBy.data;

    expect(data.status).toBe(SecurityUserErasureRequestStatus.Pending);
    expect(data.tokens).toEqual([tokenOf("alice@example.com")]);
    expect(data.vaultEntriesDeleted).toBe(0);
    expect(data.eventsUnnamed).toBe(0);
    expect(data.casesUnnamed).toBe(0);
    expect(data.proposalsWithdrawn).toBe(0);
    expect(data.attempts).toBe(0);
    expect(data.requestedAt!.getFullYear()).toBeGreaterThan(2000);
    expect(data.requestedByUserId?.toString()).toBe(userId.toString());
  });

  test("an API key names nobody as having asked", async () => {
    const createBy: CreateBy<SecurityUserErasureRequest> = createByOf({
      userToErase: "alice@example.com",
    });

    createBy.props = {
      ...createBy.props,
      userId: undefined,
      userType: UserType.API,
    };

    expect(
      (await createPath.onBeforeCreate(createBy)).createBy.data
        .requestedByUserId,
    ).toBeUndefined();
  });

  test("passes the column permission check and the required fields once the hook ran", async () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.CreateSecurityUserErasureRequest,
    ]) {
      const onCreate: OnCreate<SecurityUserErasureRequest> =
        await createPath.onBeforeCreate(
          createByOf({
            userToErase: "alice@example.com",
            reference: "DSR-7",
            permissions: [permission],
          }),
        );

      expect(() => {
        return ColumnPermission.checkDataColumnPermissions(
          SecurityUserErasureRequest,
          onCreate.createBy.data,
          onCreate.createBy.props,
          DatabaseRequestType.Create,
          columnsTheCreateWrote(onCreate.createBy.data),
        );
      }).not.toThrow();

      expect(() => {
        return createPath.checkRequiredFields(onCreate.createBy.data);
      }).not.toThrow();
    }
  });

  test.each([
    ["nothing", ""],
    ["only spaces", "   "],
  ])(
    "refuses %s, saying what to enter",
    async (_what: string, typed: string) => {
      await expect(
        createPath.onBeforeCreate(createByOf({ userToErase: typed })),
      ).rejects.toThrow(
        "Enter the user ID, email address or token of the person to erase.",
      );
    },
  );

  test("refuses no user at all", async () => {
    await expect(createPath.onBeforeCreate(createByOf({}))).rejects.toThrow(
      "Enter the user ID, email address or token of the person to erase.",
    );
  });

  test("refuses a user longer than the vault keeps", async () => {
    await expect(
      createPath.onBeforeCreate(
        createByOf({
          userToErase: "a".repeat(SECURITY_USER_ERASURE_MAX_USER_LENGTH + 1),
        }),
      ),
    ).rejects.toThrow("That is longer than any user Security Events keeps.");
  });

  test("refuses a reference longer than a ticket number", async () => {
    await expect(
      createPath.onBeforeCreate(
        createByOf({
          userToErase: "alice@example.com",
          reference: "x".repeat(SECURITY_USER_ERASURE_MAX_REFERENCE_LENGTH + 1),
        }),
      ),
    ).rejects.toThrow(
      `A reference is at most ${SECURITY_USER_ERASURE_MAX_REFERENCE_LENGTH} characters`,
    );
  });
});

describe("who may file and read erasure requests", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.CreateSecurityUserErasureRequest,
  ])("%s may file one", (permission: Permission) => {
    expect(() => {
      return TablePermission.checkTableLevelPermissions(
        SecurityUserErasureRequest,
        propsWith([permission]),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });

  test.each([
    Permission.SecurityMember,
    Permission.SecurityViewer,
    Permission.ReadSecurityUserErasureRequest,
    Permission.ProjectMember,
    Permission.TelemetryAdmin,
    Permission.EditSecurityCase,
  ])(
    "%s may not file one: an erasure changes stored security evidence for good",
    (permission: Permission) => {
      expect(() => {
        return TablePermission.checkTableLevelPermissions(
          SecurityUserErasureRequest,
          propsWith([permission]),
          DatabaseRequestType.Create,
        );
      }).toThrow("You do not have permissions to create Erasure Request");
    },
  );

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.SecurityViewer,
    Permission.ReadSecurityUserErasureRequest,
  ])("%s may read them", (permission: Permission) => {
    expect(() => {
      return TablePermission.checkTableLevelPermissions(
        SecurityUserErasureRequest,
        propsWith([permission]),
        DatabaseRequestType.Read,
      );
    }).not.toThrow();
  });

  test.each([Permission.ProjectMember, Permission.TelemetryAdmin])(
    "%s may not read them: Security Events' data reaches its own tiers only",
    (permission: Permission) => {
      expect(() => {
        return TablePermission.checkTableLevelPermissions(
          SecurityUserErasureRequest,
          propsWith([permission]),
          DatabaseRequestType.Read,
        );
      }).toThrow();
    },
  );

  test("nobody changes or deletes a request: it is the proof, and its tokens the vault's refusal", () => {
    for (const type of [
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
    ]) {
      expect(() => {
        return TablePermission.checkTableLevelPermissions(
          SecurityUserErasureRequest,
          propsWith([Permission.ProjectOwner, Permission.SecurityAdmin]),
          type,
        );
      }).toThrow();
    }
  });

  test("nobody reads back what was typed, and it is kept encrypted", () => {
    const model: SecurityUserErasureRequest = new SecurityUserErasureRequest();
    const columns: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    expect(columns["userToErase"]?.read).toEqual([]);
    expect(columns["userToErase"]?.update).toEqual([]);
    expect(model.getTableColumnMetadata("userToErase").encrypted).toBe(true);
    // Readers see the tokens: what the logs already hold in the person's place.
    expect(columns["tokens"]?.read).toContain(Permission.SecurityViewer);
    // Only the server writes them.
    expect(columns["tokens"]?.create).toEqual([]);
  });

  test("nobody reads back, sends or changes who the worker found the person named as, and it is kept encrypted (#11044)", () => {
    const model: SecurityUserErasureRequest = new SecurityUserErasureRequest();
    const columns: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    expect(columns["namesToErase"]?.read).toEqual([]);
    expect(columns["namesToErase"]?.create).toEqual([]);
    expect(columns["namesToErase"]?.update).toEqual([]);
    expect(model.getTableColumnMetadata("namesToErase").encrypted).toBe(true);
    // Filled in by the worker alone.
    expect(model.getTableColumnMetadata("namesToErase").computed).toBe(true);
  });

  test("names sent with a request are refused, even by those who may file one (#11044)", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.SecurityAdmin,
      Permission.CreateSecurityUserErasureRequest,
    ]) {
      const sent: SecurityUserErasureRequest = new SecurityUserErasureRequest();

      sent.projectId = projectId;
      sent.userToErase = "alice@example.com";
      sent.namesToErase = toStoredErasureNames([
        { named: "bob@example.com", hashed: tokenOf("bob@example.com") },
      ]);

      expect(() => {
        return ColumnPermission.checkComputedColumnsSentOnCreate(
          SecurityUserErasureRequest,
          sent,
          propsWith([permission]),
        );
      }).toThrow();
    }
  });
});

describe("who the worker found the person named as (#11044)", () => {
  test("is kept as the worker wrote it, each name with what the rule left in its place", () => {
    const request: SecurityUserErasureRequest =
      new SecurityUserErasureRequest();
    const names: Array<{ named: string; hashed: string }> = [
      { named: "alice@example.com", hashed: tokenOf("alice@example.com") },
      {
        named: "auth0|alice@example.com",
        hashed: `auth0|${tokenOf("alice@example.com")}`,
      },
    ];

    request.namesToErase = toStoredErasureNames(names);

    expect(readErasureRequestNames(request)).toEqual(names);
  });

  test("keeps nothing of a name but the name and what the rule left", () => {
    expect(
      JSON.parse(
        toStoredErasureNames([
          {
            named: "alice@example.com",
            hashed: tokenOf("alice@example.com"),
            extra: "kept nowhere",
          } as never,
        ]),
      ),
    ).toEqual([
      { named: "alice@example.com", hashed: tokenOf("alice@example.com") },
    ]);
  });

  test("reads back nothing that is no name, whatever the column held", () => {
    const request: SecurityUserErasureRequest =
      new SecurityUserErasureRequest();

    for (const stored of [
      undefined,
      "",
      "   ",
      "not json",
      "{}",
      "7",
      JSON.stringify([
        null,
        7,
        "alice@example.com",
        { named: "alice@example.com" },
        { hashed: tokenOf("alice@example.com") },
        { named: "", hashed: tokenOf("alice@example.com") },
        { named: "same", hashed: "same" },
        { named: ["alice"], hashed: tokenOf("alice") },
      ]),
    ]) {
      request.namesToErase = stored as never;
      expect(readErasureRequestNames(request)).toEqual([]);
    }
  });
});

describe("the worker's moves keep and wipe the names (#11044)", () => {
  let written: Array<Record<string, unknown>>;

  beforeEach(() => {
    written = [];

    jest
      .spyOn(SecurityUserErasureRequestService, "updateOneById")
      .mockImplementation((async (data: {
        data: Record<string, unknown>;
      }): Promise<void> => {
        written.push(data.data);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const counts: {
    vaultEntriesDeleted: number;
    eventsUnnamed: number;
    casesUnnamed: number;
    proposalsWithdrawn: number;
  } = {
    vaultEntriesDeleted: 1,
    eventsUnnamed: 4,
    casesUnnamed: 1,
    proposalsWithdrawn: 0,
  };

  test("a run keeps the names it found with its counts, and a run that found none clears them", async () => {
    const names: Array<{ named: string; hashed: string }> = [
      { named: "alice@example.com", hashed: tokenOf("alice@example.com") },
    ];

    await SecurityUserErasureRequestService.markInProgress({
      requestId: ObjectID.generate(),
      counts,
      names,
    });
    await SecurityUserErasureRequestService.markInProgress({
      requestId: ObjectID.generate(),
      counts,
      names: [],
    });

    expect(written[0]!["namesToErase"]).toBe(toStoredErasureNames(names));
    expect(written[0]!["eventsUnnamed"]).toBe(4);
    expect(written[1]!["namesToErase"]).toBeNull();
  });

  test("counts kept without names leave the names as they are", async () => {
    await SecurityUserErasureRequestService.markInProgress({
      requestId: ObjectID.generate(),
      counts,
    });

    expect(Object.keys(written[0]!)).not.toContain("namesToErase");
  });

  test("Completed and Failed both wipe them, with what was typed", async () => {
    await SecurityUserErasureRequestService.markCompleted({
      requestId: ObjectID.generate(),
      counts,
    });
    await SecurityUserErasureRequestService.markFailed({
      requestId: ObjectID.generate(),
      attempts: 5,
      failureReason: "ClickHouse is down",
    });

    for (const data of written) {
      expect(data["namesToErase"]).toBeNull();
      expect(data["userToErase"]).toBeNull();
    }
  });
});
