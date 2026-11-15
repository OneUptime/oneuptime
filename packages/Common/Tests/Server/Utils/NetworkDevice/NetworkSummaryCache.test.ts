import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import NetworkSummaryCache, {
  NETWORK_SUMMARY_CACHE_TTL_MS,
  PROJECT_WIDE_SCOPE,
} from "../../../../Server/Utils/NetworkDevice/NetworkSummaryCache";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "../../../../Models/DatabaseModels/NetworkEndpoint";
import NetworkSite from "../../../../Models/DatabaseModels/NetworkSite";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import UserType from "../../../../Types/UserType";

/*
 * THE NETWORK OVERVIEW AND THE SUMMARY STRIPS, KEPT FOR HALF A MINUTE
 * (NetworkSummaryCache).
 *
 * What is built is kept per view, project and viewer scope for 30 seconds,
 * built once for requests that arrive together, and never kept when the
 * build fails. Two callers share an entry only when the read-permission
 * pipeline narrows neither's read of the records the view counts; a caller
 * it narrows is kept apart, under their own user or API key and their
 * permissions; and the pipeline refuses, before anything is served, a
 * caller who may not read them at all. The scopes are worked out here by
 * the real permission code, with no database.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const OTHER_USER_ID: ObjectID = ObjectID.generate();
const TEAM_ID: ObjectID = ObjectID.generate();
const LABEL_ID: ObjectID = ObjectID.generate();
const OTHER_LABEL_ID: ObjectID = ObjectID.generate();

const OVERVIEW_MODELS: Array<{ new (): BaseModel }> = [
  NetworkDevice,
  NetworkSite,
  NetworkEndpoint,
  MonitorStatus,
];

function grant(
  permission: Permission,
  scope: PermissionScope = PermissionScope.All,
  labelIds: Array<ObjectID> = [],
  isBlockPermission: boolean = false,
): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    scope,
    labelIds,
    isBlockPermission,
    teamId: TEAM_ID,
  };
}

function propsFor(
  permissions: Array<UserPermission>,
  extra?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userTeamIds: [TEAM_ID],
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions,
      },
    },
    ...extra,
  };
}

async function scopeOf(
  props: DatabaseCommonInteractionProps,
  modelTypes: Array<{ new (): BaseModel }> = OVERVIEW_MODELS,
): Promise<string | null> {
  return await NetworkSummaryCache.getViewerScope({
    projectId: PROJECT_ID,
    props: props,
    modelTypes: modelTypes,
  });
}

/*
 * The labels' join tables, as TypeORM's metadata names them on a connected
 * server: a label grant or block narrows a read through them.
 */
function stubLabelJoinTables(): void {
  jest
    .spyOn(QueryUtil, "getManyToManyRelationMetadata")
    .mockImplementation(((modelType: { new (): BaseModel }) => {
      const tableName: string = new modelType().tableName || "Record";

      return {
        joinTableName: `${tableName}Label`,
        ownerColumnName: `${tableName.charAt(0).toLowerCase()}${tableName.slice(1)}Id`,
        relationColumnName: "labelId",
      };
    }) as never);
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((error: Error) => void) | null = null;
  const promise: Promise<T> = new Promise<T>(
    (yes: (value: T) => void, no: (error: Error) => void) => {
      resolve = yes;
      reject = no;
    },
  );
  return { promise, resolve: resolve!, reject: reject! };
}

beforeEach(() => {
  NetworkSummaryCache.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  NetworkSummaryCache.clear();
});

describe("what is kept", () => {
  test("a second request within the half minute is answered from what the first built", async () => {
    let builds: number = 0;
    const build: () => Promise<{ built: number }> = async (): Promise<{
      built: number;
    }> => {
      builds++;
      return { built: builds };
    };

    const first: { built: number } = await NetworkSummaryCache.getOrBuild({
      view: "overview",
      projectId: PROJECT_ID,
      scope: PROJECT_WIDE_SCOPE,
      build: build,
    });
    const second: { built: number } = await NetworkSummaryCache.getOrBuild({
      view: "overview",
      projectId: PROJECT_ID,
      scope: PROJECT_WIDE_SCOPE,
      build: build,
    });

    expect(builds).toBe(1);
    // The very object: shared, not rebuilt or copied.
    expect(second).toBe(first);
  });

  test("is kept for 30 seconds, and built again once they pass", async () => {
    expect(NETWORK_SUMMARY_CACHE_TTL_MS).toBe(30_000);
    expect(NetworkSummaryCache.TTL_MS).toBe(30_000);

    let now: number = Date.UTC(2026, 10, 14, 12, 0, 0);
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    let builds: number = 0;
    const read: () => Promise<number> = (): Promise<number> => {
      return NetworkSummaryCache.getOrBuild({
        view: "overview",
        projectId: PROJECT_ID,
        scope: PROJECT_WIDE_SCOPE,
        build: async (): Promise<number> => {
          builds++;
          return builds;
        },
      });
    };

    expect(await read()).toBe(1);

    now += 29_000;
    expect(await read()).toBe(1);

    now += 1_000;
    expect(await read()).toBe(1);

    now += 1;
    expect(await read()).toBe(2);
    expect(builds).toBe(2);

    // The new build is kept for its own 30 seconds.
    now += 29_999;
    expect(await read()).toBe(2);
  });

  test("requests that miss together share one build, and all get its answer", async () => {
    const pending: Deferred<{ value: string }> = deferred<{ value: string }>();
    const counted: { builds: number } = { builds: 0 };
    const build: () => Promise<{ value: string }> = (): Promise<{
      value: string;
    }> => {
      counted.builds++;
      return pending.promise;
    };

    const reads: Array<Promise<{ value: string }>> = [];

    for (let index: number = 0; index < 5; index++) {
      reads.push(
        NetworkSummaryCache.getOrBuild({
          view: "overview",
          projectId: PROJECT_ID,
          scope: PROJECT_WIDE_SCOPE,
          build: build,
        }),
      );
    }

    expect(counted.builds).toBe(1);

    const answer: { value: string } = { value: "built once" };
    pending.resolve(answer);

    const answers: Array<{ value: string }> = await Promise.all(reads);

    expect(counted.builds).toBe(1);
    for (const each of answers) {
      expect(each).toBe(answer);
    }
  });

  test("a failed build is never kept: requests sharing it all fail, and the next builds again", async () => {
    const pending: Deferred<number> = deferred<number>();
    let builds: number = 0;

    const sharing: Array<Promise<number>> = [1, 2, 3].map(() => {
      return NetworkSummaryCache.getOrBuild({
        view: "overview",
        projectId: PROJECT_ID,
        scope: PROJECT_WIDE_SCOPE,
        build: (): Promise<number> => {
          builds++;
          return pending.promise;
        },
      });
    });

    const failure: Error = new Error("statement timeout");
    pending.reject(failure);

    for (const each of sharing) {
      await expect(each).rejects.toBe(failure);
    }

    expect(builds).toBe(1);

    expect(
      await NetworkSummaryCache.getOrBuild({
        view: "overview",
        projectId: PROJECT_ID,
        scope: PROJECT_WIDE_SCOPE,
        build: async (): Promise<number> => {
          builds++;
          return 42;
        },
      }),
    ).toBe(42);
    expect(builds).toBe(2);
  });

  test("a build that throws before it answers is not kept either", async () => {
    await expect(
      NetworkSummaryCache.getOrBuild({
        view: "overview",
        projectId: PROJECT_ID,
        scope: PROJECT_WIDE_SCOPE,
        build: async (): Promise<number> => {
          throw new Error("refused");
        },
      }),
    ).rejects.toThrow("refused");

    expect(
      await NetworkSummaryCache.getOrBuild({
        view: "overview",
        projectId: PROJECT_ID,
        scope: PROJECT_WIDE_SCOPE,
        build: async (): Promise<number> => {
          return 7;
        },
      }),
    ).toBe(7);
  });

  test("each project, view and scope is kept apart", async () => {
    const built: Array<string> = [];

    const read: (data: {
      view: string;
      projectId: ObjectID;
      scope: string;
    }) => Promise<string> = (data: {
      view: string;
      projectId: ObjectID;
      scope: string;
    }): Promise<string> => {
      const label: string = `${data.view}/${data.projectId.toString()}/${data.scope}`;
      return NetworkSummaryCache.getOrBuild({
        ...data,
        build: async (): Promise<string> => {
          built.push(label);
          return label;
        },
      });
    };

    const cases: Array<{ view: string; projectId: ObjectID; scope: string }> = [
      { view: "overview", projectId: PROJECT_ID, scope: PROJECT_WIDE_SCOPE },
      {
        view: "overview",
        projectId: OTHER_PROJECT_ID,
        scope: PROJECT_WIDE_SCOPE,
      },
      {
        view: "fleet-scan",
        projectId: PROJECT_ID,
        scope: PROJECT_WIDE_SCOPE,
      },
      { view: "overview", projectId: PROJECT_ID, scope: "viewer:a:1" },
      { view: "overview", projectId: PROJECT_ID, scope: "viewer:b:1" },
    ];

    for (const each of cases) {
      expect(await read(each)).toBe(
        `${each.view}/${each.projectId.toString()}/${each.scope}`,
      );
    }

    // Each once, and each read again from what it kept.
    for (const each of cases) {
      await read(each);
    }

    expect(built).toHaveLength(cases.length);
  });

  test("a caller with no scope is never kept: every request builds", async () => {
    const counted: { builds: number } = { builds: 0 };
    const build: () => Promise<number> = async (): Promise<number> => {
      counted.builds++;
      return counted.builds;
    };

    for (let index: number = 0; index < 3; index++) {
      await NetworkSummaryCache.getOrBuild({
        view: "overview",
        projectId: PROJECT_ID,
        scope: null,
        build: build,
      });
    }

    expect(counted.builds).toBe(3);
  });

  test("clear forgets what was kept", async () => {
    let builds: number = 0;
    const read: () => Promise<number> = (): Promise<number> => {
      return NetworkSummaryCache.getOrBuild({
        view: "overview",
        projectId: PROJECT_ID,
        scope: PROJECT_WIDE_SCOPE,
        build: async (): Promise<number> => {
          builds++;
          return builds;
        },
      });
    };

    await read();
    NetworkSummaryCache.clear();
    await read();

    expect(builds).toBe(2);
  });
});

describe("who shares what is kept", () => {
  test.each([
    ["an owner", [grant(Permission.ProjectOwner)]],
    ["an admin", [grant(Permission.ProjectAdmin)]],
    ["a member", [grant(Permission.ProjectMember)]],
    ["a viewer", [grant(Permission.Viewer)]],
    [
      "a member granted each read by name",
      [
        grant(Permission.ReadNetworkDevice),
        grant(Permission.ReadNetworkSite),
        grant(Permission.ReadNetworkEndpoint),
        grant(Permission.ReadProjectMonitorStatus),
      ],
    ],
    [
      "a legacy grant with no scope",
      [{ ...grant(Permission.ProjectMember), scope: undefined }],
    ],
  ])(
    "%s, whose reads nothing narrows, shares the project's entry",
    async (_label: string, permissions: Array<UserPermission>) => {
      expect(await scopeOf(propsFor(permissions))).toBe(PROJECT_WIDE_SCOPE);
    },
  );

  test("two such callers share it, whoever they are", async () => {
    expect(await scopeOf(propsFor([grant(Permission.ProjectAdmin)]))).toBe(
      await scopeOf(
        propsFor([grant(Permission.ProjectOwner)], { userId: OTHER_USER_ID }),
      ),
    );
  });

  test("OneUptime's own reads and a server admin's read the whole project", async () => {
    expect(await scopeOf({ tenantId: PROJECT_ID, isRoot: true })).toBe(
      PROJECT_WIDE_SCOPE,
    );
    expect(
      await scopeOf({
        tenantId: PROJECT_ID,
        isMasterAdmin: true,
        userId: USER_ID,
      }),
    ).toBe(PROJECT_WIDE_SCOPE);
  });

  test.each([
    [
      "a grant limited to labels",
      [grant(Permission.ProjectMember, PermissionScope.Labels, [LABEL_ID])],
    ],
    [
      "a block with labels",
      [
        grant(Permission.ProjectMember),
        grant(
          Permission.ReadNetworkDevice,
          PermissionScope.Labels,
          [LABEL_ID],
          true,
        ),
      ],
    ],
  ])(
    "%s narrows the read: an entry of the caller's own",
    async (_label: string, permissions: Array<UserPermission>) => {
      stubLabelJoinTables();

      const scope: string | null = await scopeOf(propsFor(permissions));

      expect(scope).not.toBe(PROJECT_WIDE_SCOPE);
      expect(scope).toMatch(
        new RegExp(`^viewer:${USER_ID.toString()}:[0-9a-f]{32}$`),
      );
    },
  );

  test("two callers with the same narrowed grant do not share: each their own", async () => {
    stubLabelJoinTables();

    const permissions: Array<UserPermission> = [
      grant(Permission.ProjectMember, PermissionScope.Labels, [LABEL_ID]),
    ];

    const mine: string | null = await scopeOf(propsFor(permissions));
    const theirs: string | null = await scopeOf(
      propsFor(permissions, { userId: OTHER_USER_ID }),
    );

    expect(mine).not.toBe(theirs);
  });

  test("the same caller's entry changes with their permissions, so a change takes effect at once", async () => {
    stubLabelJoinTables();

    const before: string | null = await scopeOf(
      propsFor([
        grant(Permission.ProjectMember, PermissionScope.Labels, [LABEL_ID]),
      ]),
    );
    const after: string | null = await scopeOf(
      propsFor([
        grant(Permission.ProjectMember, PermissionScope.Labels, [
          OTHER_LABEL_ID,
        ]),
      ]),
    );

    expect(before).not.toBe(after);
  });

  test("an API key whose read is narrowed is kept under the key", async () => {
    stubLabelJoinTables();

    const apiKeyId: ObjectID = ObjectID.generate();
    const scope: string | null = await scopeOf(
      propsFor(
        [grant(Permission.ProjectMember, PermissionScope.Labels, [LABEL_ID])],
        { userId: undefined, apiKeyId: apiKeyId, userType: UserType.API },
      ),
    );

    expect(scope).toMatch(
      new RegExp(`^viewer:${apiKeyId.toString()}:[0-9a-f]{32}$`),
    );
  });

  /*
   * Whatever narrows a read - a grant scoped to owned records, a rule not
   * written yet - narrows it by a condition the pipeline adds: any such
   * condition keeps the caller apart.
   */
  test("any condition the pipeline adds to a read keeps the caller apart", async () => {
    const realCheck: typeof ModelPermission.checkReadQueryPermission =
      ModelPermission.checkReadQueryPermission.bind(ModelPermission);

    jest
      .spyOn(ModelPermission, "checkReadQueryPermission")
      .mockImplementation((async (...args: Array<unknown>) => {
        const checked: { query: Record<string, unknown> } = (await (
          realCheck as (...a: Array<unknown>) => Promise<unknown>
        )(...args)) as { query: Record<string, unknown> };

        // The device read only, narrowed to the records the caller owns.
        if (args[0] === NetworkDevice) {
          return { ...checked, query: { ...checked.query, _id: "owned" } };
        }

        return checked;
      }) as never);

    expect(await scopeOf(propsFor([grant(Permission.ProjectMember)]))).toMatch(
      new RegExp(`^viewer:${USER_ID.toString()}:`),
    );
    // Not narrowed for the view that does not count devices.
    expect(
      await scopeOf(propsFor([grant(Permission.ProjectMember)]), [
        NetworkSite,
        MonitorStatus,
      ]),
    ).toBe(PROJECT_WIDE_SCOPE);
  });

  test("a narrowed caller who is no user and no key is not kept at all", async () => {
    jest.spyOn(ModelPermission, "checkReadQueryPermission").mockResolvedValue({
      query: { projectId: PROJECT_ID, _id: "owned" },
      select: null,
      relationSelect: null,
    } as never);

    expect(await scopeOf({ tenantId: PROJECT_ID, isRoot: false })).toBeNull();
  });

  test("a read across projects is not the project's whole read", async () => {
    jest.spyOn(ModelPermission, "checkReadQueryPermission").mockResolvedValue({
      query: [{ projectId: PROJECT_ID }, { projectId: OTHER_PROJECT_ID }],
      select: null,
      relationSelect: null,
    } as never);

    expect(await scopeOf(propsFor([grant(Permission.ProjectOwner)]))).toMatch(
      /^viewer:/,
    );
  });

  test("a caller who is no user and no key is refused by the pipeline itself", async () => {
    await expect(
      scopeOf({
        tenantId: PROJECT_ID,
        userTenantAccessPermission: propsFor([grant(Permission.ProjectOwner)])
          .userTenantAccessPermission,
      }),
    ).rejects.toThrow();
  });

  test("a caller who may not read the records at all is refused before anything is served", async () => {
    await expect(
      scopeOf(propsFor([grant(Permission.ReadNetworkDevice)])),
    ).rejects.toThrow();

    // The device read alone, for the fleet scan: that caller may.
    expect(
      await scopeOf(propsFor([grant(Permission.ReadNetworkDevice)]), [
        NetworkDevice,
      ]),
    ).toBe(PROJECT_WIDE_SCOPE);
  });

  test("a block with no labels on a read takes it away: refused", async () => {
    await expect(
      scopeOf(
        propsFor([
          grant(Permission.ProjectMember),
          grant(Permission.ReadNetworkDevice, PermissionScope.All, [], true),
        ]),
      ),
    ).rejects.toThrow();
  });
});

describe("the read a scope is decided by", () => {
  test("is the project's whole read only with one condition, on the project", () => {
    expect(
      NetworkSummaryCache.isProjectWideRead({ projectId: PROJECT_ID }),
    ).toBe(true);

    for (const query of [
      { projectId: PROJECT_ID, labels: [LABEL_ID] },
      { projectId: PROJECT_ID, _id: "x" },
      { labels: [LABEL_ID] },
      [{ projectId: PROJECT_ID }],
      {},
      null,
      undefined,
      "projectId",
    ]) {
      expect(NetworkSummaryCache.isProjectWideRead(query)).toBe(false);
    }
  });

  test("a fingerprint of the caller's permissions ignores their order, and reads every part of a row", () => {
    const rows: Array<UserPermission> = [
      grant(Permission.ProjectMember, PermissionScope.Labels, [
        LABEL_ID,
        OTHER_LABEL_ID,
      ]),
      grant(Permission.ReadNetworkDevice),
    ];
    const fingerprint: string = NetworkSummaryCache.getPermissionsFingerprint(
      propsFor(rows),
      PROJECT_ID,
    );

    expect(
      NetworkSummaryCache.getPermissionsFingerprint(
        propsFor([
          rows[1]!,
          {
            ...rows[0]!,
            labelIds: [OTHER_LABEL_ID, LABEL_ID],
          },
        ]),
        PROJECT_ID,
      ),
    ).toBe(fingerprint);

    for (const changed of [
      [{ ...rows[0]!, labelIds: [LABEL_ID] }, rows[1]!],
      [{ ...rows[0]!, scope: PermissionScope.Owned }, rows[1]!],
      [{ ...rows[0]!, teamId: ObjectID.generate() }, rows[1]!],
      [{ ...rows[0]!, isBlockPermission: true }, rows[1]!],
      [{ ...rows[0]!, permission: Permission.ProjectAdmin }, rows[1]!],
      [rows[0]!],
    ]) {
      expect(
        NetworkSummaryCache.getPermissionsFingerprint(
          propsFor(changed),
          PROJECT_ID,
        ),
      ).not.toBe(fingerprint);
    }

    // Root and master admin are part of it too.
    expect(
      NetworkSummaryCache.getPermissionsFingerprint(
        propsFor(rows, { isMasterAdmin: true }),
        PROJECT_ID,
      ),
    ).not.toBe(fingerprint);
  });

  test("a caller with no permissions in the project has a fingerprint of their own too", () => {
    expect(
      NetworkSummaryCache.getPermissionsFingerprint(
        { tenantId: PROJECT_ID, userId: USER_ID },
        PROJECT_ID,
      ),
    ).toMatch(/^[0-9a-f]{32}$/);
  });
});
