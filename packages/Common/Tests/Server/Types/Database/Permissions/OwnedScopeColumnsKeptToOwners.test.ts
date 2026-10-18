import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import OwnerTableRegistry from "../../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import QueryPermission from "../../../../../Server/Types/Database/Permissions/QueryPermission";
import QueryHelper from "../../../../../Server/Types/Database/QueryHelper";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Probe from "../../../../../Models/DatabaseModels/Probe";
import Runner from "../../../../../Models/DatabaseModels/Runner";
import RunnerOwnerUser from "../../../../../Models/DatabaseModels/RunnerOwnerUser";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MultiSearch from "../../../../../Types/BaseDatabase/MultiSearch";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { meetsCondition } from "../../../TestingUtils/QueryConditions";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { withLabelJoinTables } from "../../../TestingUtils/LabelJoinTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A COLUMN ONLY THOSE WHO MAY CHANGE A KIND READ FOLLOWS ITS OWNERS, EVEN
 * WHERE EVERY READER READS THE KIND.
 *
 * The Owned scope leaves the reads of the kinds other records are set up
 * with alone (OwnedScopePermission.leavesReadsAlone): whoever may read a
 * Runner reads every Runner, so a runbook step can pick one. A Runner's key
 * is not like the rest of it. Presenting it to OneUptime claims the work
 * meant for that Runner, with the runbook secrets and credentials that come
 * with the work - so it is read only by those who may change the Runner,
 * and a grant scoped to Owned reads it only on the Runners its holder or
 * their teams own (getColumnsKeptToOwners):
 *
 *   - the column is left out of every other Runner the member reads
 *     (withholdColumnsKeptToOwners, which every read runs);
 *   - a filter on it - by its name or in a free-text search - reaches only
 *     the Runners the member owns (the record rule);
 *   - nobody orders Runners by it, nor filters another record by it through
 *     a relation, on such a grant: an order or a match is read one guess at
 *     a time.
 *
 * A grant over the whole project, or limited to labels (which narrow the
 * read of the kind itself), reads it as before, and so do Project Owners and
 * Admins, OneUptime itself and master admins. The columns kept to owners are
 * pinned below, so a new one is a deliberate change.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

const PROJECT_ID: ObjectID = new ObjectID(
  "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
);
const USER_ID: ObjectID = new ObjectID("8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a");
const TEAM_ID: ObjectID = new ObjectID("9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b");
const LABEL_ID: ObjectID = new ObjectID("0f1a2b3c-4d5e-4f6a-9b7c-8d9e0f1a2b3c");

// A Runner the member's team owns, and one another team owns.
const OWNED_ID: string = "1a2b3c4d-5e6f-4a7b-8c8d-9e0f1a2b3c4d";
const OTHER_ID: string = "2b3c4d5e-6f7a-4b8c-9d9e-0f1a2b3c4d5e";

const ZERO_ID: string = ObjectID.getZeroObjectID().toString();

/*
 * The columns of the kinds every reader reads that only those who may
 * change the kind read, by kind - each with why it follows the owners.
 */
const COLUMNS_KEPT_TO_OWNERS: Record<string, Record<string, string>> = {
  Runner: {
    key: "The Runner's identity: presenting it claims the work meant for the Runner, with the secrets and credentials that come with it.",
  },
};

function row(
  permission: Permission,
  scope: PermissionScope,
  labelIds: Array<ObjectID> = [],
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: labelIds,
    isBlockPermission: false,
    scope: scope,
  };
}

// A member of the project whose team holds `rows`.
function memberWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTeamIds: [TEAM_ID],
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
    ...ON_HIGHEST_PLAN,
  } as DatabaseCommonInteractionProps;
}

// The same rows held by no person: what an API key's request carries.
function noPersonWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = memberWith(rows);

  delete props.userId;
  delete props.userType;
  delete props.userTeamIds;

  return props;
}

// The grant shapes a member may read a Runner's key with, and what they keep.
const GRANT_SHAPES: Array<{
  name: string;
  rows: Array<UserPermission>;
  isKeptToOwners: boolean;
}> = [
  {
    name: "Runbook Admin scoped to Owned",
    rows: [row(Permission.RunbookAdmin, PermissionScope.Owned)],
    isKeptToOwners: true,
  },
  {
    name: "Runbook Viewer over the whole project beside Runbook Admin scoped to Owned",
    rows: [
      row(Permission.RunbookViewer, PermissionScope.All),
      row(Permission.RunbookAdmin, PermissionScope.Owned),
    ],
    isKeptToOwners: true,
  },
  {
    name: "Read Runner over the whole project beside Runbook Admin scoped to Owned",
    rows: [
      row(Permission.ReadRunner, PermissionScope.All),
      row(Permission.RunbookAdmin, PermissionScope.Owned),
    ],
    isKeptToOwners: true,
  },
  {
    name: "Runbook Admin over the whole project",
    rows: [row(Permission.RunbookAdmin, PermissionScope.All)],
    isKeptToOwners: false,
  },
  {
    name: "Runbook Admin scoped to Owned beside the same over the whole project",
    rows: [
      row(Permission.RunbookAdmin, PermissionScope.Owned),
      row(Permission.RunbookAdmin, PermissionScope.All),
    ],
    isKeptToOwners: false,
  },
  {
    name: "Runbook Admin limited to labels (the read of Runners keeps to them)",
    rows: [row(Permission.RunbookAdmin, PermissionScope.Labels, [LABEL_ID])],
    isKeptToOwners: false,
  },
  {
    name: "a stray Owned row of Project Admin, which no scope narrows",
    rows: [row(Permission.ProjectAdmin, PermissionScope.Owned)],
    isKeptToOwners: false,
  },
  {
    name: "Runbook Viewer scoped to Owned, who reads no key at all",
    rows: [row(Permission.RunbookViewer, PermissionScope.Owned)],
    isKeptToOwners: false,
  },
];

// Whether a row whose `column` is `value` is one the query reaches.
function reaches(
  query: Dictionary<unknown>,
  column: string,
  value: string,
): boolean {
  if (query["_id"] !== undefined && meetsCondition(query["_id"], ZERO_ID)) {
    return false;
  }

  if (query[column] === undefined) {
    return true;
  }

  return meetsCondition(query[column], value);
}

// The query a read of Runners filtered by `filter` runs with.
async function readScopeOf(
  props: DatabaseCommonInteractionProps,
  filter: Dictionary<unknown>,
): Promise<Dictionary<unknown>> {
  TablePermission.checkTableLevelPermissions(
    Runner,
    props,
    DatabaseRequestType.Read,
  );

  return (await BasePermission.addRecordScopeToQuery(
    Runner,
    { ...filter },
    null,
    props,
    DatabaseRequestType.Read,
  )) as Dictionary<unknown>;
}

// What the member owns: OWNED_ID, of every kind.
function ownsOnly(id: string): void {
  jest
    .spyOn(OwnedScopePermission as never, "getAllowedResourceIds")
    .mockResolvedValue([new ObjectID(id)] as never);
}

function runner(id: string | null, key: string): Runner {
  const record: Runner = new Runner();

  if (id) {
    record._id = id;
  }

  record.name = `Runner ${key}`;
  record.key = key;

  return record;
}

beforeEach(() => {
  withLabelJoinTables();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which columns follow the owners where every reader reads the kind", () => {
  test("of the kinds every reader reads, only the pinned columns are read by those alone who may change the kind", () => {
    const found: Record<string, Array<string>> = {};

    for (const modelType of MODEL_TYPES) {
      if (!OwnedScopePermission.leavesReadsAlone(modelType)) {
        continue;
      }

      const model: BaseModel = new modelType();
      const changers: Array<Permission> = model.getUpdatePermissions();

      for (const column of model.getTableColumns().columns) {
        const readers: Array<Permission> =
          model.getColumnAccessControlFor(column)?.read || [];

        if (
          readers.length > 0 &&
          readers.every((permission: Permission): boolean => {
            return changers.includes(permission);
          }) &&
          readers.some((permission: Permission): boolean => {
            return PermissionHelper.isScopeApplicable(permission);
          })
        ) {
          found[modelType.name] = [...(found[modelType.name] || []), column];
        }
      }
    }

    expect(found).toEqual(
      Object.fromEntries(
        Object.entries(COLUMNS_KEPT_TO_OWNERS).map(
          ([kind, columns]: [string, Record<string, string>]): [
            string,
            Array<string>,
          ] => {
            return [kind, Object.keys(columns)];
          },
        ),
      ),
    );

    // Each pinned one says why.
    for (const columns of Object.values(COLUMNS_KEPT_TO_OWNERS)) {
      for (const reason of Object.values(columns)) {
        expect(reason.length).toBeGreaterThan(20);
      }
    }
  });

  test("no kind with a column kept to its owners is read across projects: each project's grants decide it, and a read across projects has none", () => {
    for (const kind of Object.keys(COLUMNS_KEPT_TO_OWNERS)) {
      const modelType: ModelType | undefined = MODEL_TYPES.find(
        (each: ModelType): boolean => {
          return each.name === kind;
        },
      );

      expect([kind, Boolean(modelType)]).toEqual([kind, true]);
      expect([kind, new modelType!().canQueryMultiTenant()]).toEqual([
        kind,
        false,
      ]);
    }
  });

  test("a Runner is read by every reader of Runners, and its key only by those who may change it", () => {
    expect(OwnedScopePermission.leavesReadsAlone(Runner)).toBe(true);

    const keyReaders: Array<Permission> =
      new Runner().getColumnAccessControlFor("key")?.read || [];

    expect(keyReaders).toContain(Permission.RunbookAdmin);

    for (const permission of keyReaders) {
      expect(new Runner().getUpdatePermissions()).toContain(permission);
    }
  });

  test.each(GRANT_SHAPES)("$name", (shape: (typeof GRANT_SHAPES)[number]) => {
    expect(
      OwnedScopePermission.getColumnsKeptToOwners(
        Runner,
        memberWith(shape.rows),
      ),
    ).toEqual(shape.isKeptToOwners ? ["key"] : []);
  });

  test("OneUptime itself, a master admin and an API key read every Runner's key", () => {
    const owned: Array<UserPermission> = [
      row(Permission.RunbookAdmin, PermissionScope.Owned),
    ];

    expect(
      OwnedScopePermission.getColumnsKeptToOwners(Runner, {
        ...memberWith(owned),
        isRoot: true,
      }),
    ).toEqual([]);
    expect(
      OwnedScopePermission.getColumnsKeptToOwners(Runner, {
        ...memberWith(owned),
        isMasterAdmin: true,
      }),
    ).toEqual([]);
    // An API key's rows carry no scope of Owned: they reach the whole project.
    expect(
      OwnedScopePermission.getColumnsKeptToOwners(
        Runner,
        noPersonWith([row(Permission.RunbookAdmin, PermissionScope.All)]),
      ),
    ).toEqual([]);
  });

  test("a kind whose reads the Owned scope narrows keeps no column apart: its records are read only where owned already", () => {
    for (const kind of Array.from(OwnerTableRegistry.keys())) {
      const modelType: ModelType | undefined = MODEL_TYPES.find(
        (each: ModelType): boolean => {
          return each.name === kind;
        },
      );

      expect([kind, Boolean(modelType)]).toEqual([kind, true]);

      if (OwnedScopePermission.leavesReadsAlone(modelType!)) {
        continue;
      }

      const everyGrant: Array<UserPermission> = [
        DatabaseRequestType.Read,
        DatabaseRequestType.Update,
      ]
        .flatMap((type: DatabaseRequestType): Array<Permission> => {
          return TablePermission.getTablePermission(modelType!, type);
        })
        .filter((permission: Permission): boolean => {
          return PermissionHelper.isScopeApplicable(permission);
        })
        .map((permission: Permission): UserPermission => {
          return row(permission, PermissionScope.Owned);
        });

      expect([
        kind,
        OwnedScopePermission.getColumnsKeptToOwners(
          modelType!,
          memberWith(everyGrant),
        ),
      ]).toEqual([kind, []]);
    }

    expect(
      OwnedScopePermission.getColumnsKeptToOwners(
        Monitor,
        memberWith([row(Permission.MonitorAdmin, PermissionScope.Owned)]),
      ),
    ).toEqual([]);
  });

  test("a probe's key is read by Project Owners and Admins alone, whom no scope narrows: nothing is kept apart", () => {
    expect(
      OwnedScopePermission.getColumnsKeptToOwners(
        Probe,
        memberWith([
          row(Permission.ProjectMember, PermissionScope.Owned),
          row(Permission.MonitorAdmin, PermissionScope.Owned),
        ]),
      ),
    ).toEqual([]);
  });
});

describe("a Runner's key, read under a grant scoped to Owned", () => {
  const owned: () => DatabaseCommonInteractionProps =
    (): DatabaseCommonInteractionProps => {
      return memberWith([row(Permission.RunbookAdmin, PermissionScope.Owned)]);
    };

  test("every Runner is listed, but the key only of the ones the member owns", async () => {
    const getOwnedIds: SpyInstance<typeof OwnedScopePermission.getOwnedIds> =
      jest
        .spyOn(OwnedScopePermission, "getOwnedIds")
        .mockResolvedValue([new ObjectID(OWNED_ID)]);

    const rows: Array<Runner> =
      await OwnedScopePermission.withholdColumnsKeptToOwners({
        modelType: Runner,
        rows: [
          runner(OWNED_ID, "owned-key"),
          runner(OTHER_ID, "other-key"),
          // Upper case, as an id may be written: the same record.
          runner(OWNED_ID.toUpperCase(), "owned-key-upper"),
        ],
        select: { _id: true, name: true, key: true },
        props: owned(),
      });

    expect(
      rows.map((each: Runner): [string | undefined, string | undefined] => {
        return [each.name, each.key];
      }),
    ).toEqual([
      ["Runner owned-key", "owned-key"],
      ["Runner other-key", undefined],
      ["Runner owned-key-upper", "owned-key-upper"],
    ]);
    expect(getOwnedIds).toHaveBeenCalledTimes(1);
  });

  test("a Runner read without its id cannot be told to be theirs: no key", async () => {
    jest
      .spyOn(OwnedScopePermission, "getOwnedIds")
      .mockResolvedValue([new ObjectID(OWNED_ID)]);

    const rows: Array<Runner> =
      await OwnedScopePermission.withholdColumnsKeptToOwners({
        modelType: Runner,
        rows: [runner(null, "key-without-id")],
        select: { key: true },
        props: owned(),
      });

    expect(rows[0]!.key).toBeUndefined();
  });

  test("a read that does not select the key, or by a grant over the whole project, is left as it is - and looks nothing up", async () => {
    const getOwnedIds: SpyInstance<typeof OwnedScopePermission.getOwnedIds> =
      jest.spyOn(OwnedScopePermission, "getOwnedIds").mockResolvedValue([]);

    for (const [select, props] of [
      [{ _id: true, name: true }, owned()],
      [
        { _id: true, key: true },
        memberWith([row(Permission.RunbookAdmin, PermissionScope.All)]),
      ],
      [
        { _id: true, key: true },
        { ...owned(), isRoot: true },
      ],
    ] as Array<[Dictionary<boolean>, DatabaseCommonInteractionProps]>) {
      const rows: Array<Runner> =
        await OwnedScopePermission.withholdColumnsKeptToOwners({
          modelType: Runner,
          rows: [runner(OTHER_ID, "other-key")],
          select: select,
          props: props,
        });

      expect(rows[0]!.key).toBe("other-key");
    }

    expect(getOwnedIds).not.toHaveBeenCalled();
  });

  test("a filter on the key reaches only the Runners the member owns; a read without one reaches every Runner", async () => {
    ownsOnly(OWNED_ID);

    for (const filter of [
      { key: "other-key" },
      { key: QueryHelper.search("other") },
      { search: new MultiSearch({ value: "other", fields: ["name", "key"] }) },
    ] as Array<Dictionary<unknown>>) {
      expect(
        OwnedScopePermission.namesColumnsKeptToOwners(
          Runner,
          filter as never,
          owned(),
        ),
      ).toBe(true);

      const query: Dictionary<unknown> = await readScopeOf(owned(), filter);

      expect([filter, reaches(query, "_id", OWNED_ID)]).toEqual([filter, true]);
      expect([filter, reaches(query, "_id", OTHER_ID)]).toEqual([
        filter,
        false,
      ]);
    }

    for (const filter of [
      {},
      { name: "Build runner" },
      {
        search: new MultiSearch({
          value: "build",
          fields: ["name", "description"],
        }),
      },
    ] as Array<Dictionary<unknown>>) {
      expect(
        OwnedScopePermission.namesColumnsKeptToOwners(
          Runner,
          filter as never,
          owned(),
        ),
      ).toBe(false);

      const query: Dictionary<unknown> = await readScopeOf(owned(), filter);

      expect([filter, reaches(query, "_id", OTHER_ID)]).toEqual([filter, true]);
    }
  });

  test("with a grant over the whole project, a filter on the key reaches every Runner", async () => {
    ownsOnly(OWNED_ID);

    const props: DatabaseCommonInteractionProps = memberWith([
      row(Permission.RunbookAdmin, PermissionScope.All),
    ]);

    const query: Dictionary<unknown> = await readScopeOf(props, {
      key: "other-key",
    });

    expect(reaches(query, "_id", OTHER_ID)).toBe(true);
  });

  test("Runners are not ordered by the key", () => {
    expect(() => {
      OwnedScopePermission.checkSortOnColumnsKeptToOwners(
        Runner,
        { name: SortOrder.Ascending, key: SortOrder.Descending },
        owned(),
      );
    }).toThrow(
      new NotAuthorizedException(
        "Your access lets you read the Agent Key only of the Runners you or your teams own, so you cannot sort or filter Runners by it.",
      ),
    );

    // By anything else, or with a grant over the whole project, they are.
    expect(() => {
      OwnedScopePermission.checkSortOnColumnsKeptToOwners(
        Runner,
        { name: SortOrder.Ascending },
        owned(),
      );
    }).not.toThrow();
    expect(() => {
      OwnedScopePermission.checkSortOnColumnsKeptToOwners(
        Runner,
        { key: SortOrder.Ascending },
        memberWith([row(Permission.RunbookAdmin, PermissionScope.All)]),
      );
    }).not.toThrow();
    expect(() => {
      OwnedScopePermission.checkSortOnColumnsKeptToOwners(
        Runner,
        undefined,
        owned(),
      );
    }).not.toThrow();
  });

  test("a Runner's owners are not ordered by the key of the Runner they own", () => {
    expect(() => {
      OwnedScopePermission.checkSortOnColumnsKeptToOwners(
        RunnerOwnerUser,
        { runner: { key: SortOrder.Ascending } },
        owned(),
      );
    }).toThrow(
      new NotAuthorizedException(
        "Your access lets you read the Agent Key only of the Runners you or your teams own, so you cannot sort or filter Runners by it.",
      ),
    );

    // By the Runner's name, they are; and by its key with a grant over the whole project.
    expect(() => {
      OwnedScopePermission.checkSortOnColumnsKeptToOwners(
        RunnerOwnerUser,
        { runner: { name: SortOrder.Ascending } },
        owned(),
      );
    }).not.toThrow();
    expect(() => {
      OwnedScopePermission.checkSortOnColumnsKeptToOwners(
        RunnerOwnerUser,
        { runner: { key: SortOrder.Ascending } },
        memberWith([row(Permission.RunbookAdmin, PermissionScope.All)]),
      );
    }).not.toThrow();
    // An order that names no relation is read no deeper.
    expect(() => {
      OwnedScopePermission.checkSortOnColumnsKeptToOwners(
        RunnerOwnerUser,
        { notAColumn: { key: SortOrder.Ascending } },
        owned(),
      );
    }).not.toThrow();
  });

  test("another record is not filtered by a Runner's key through its relation", () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      row(Permission.RunbookAdmin, PermissionScope.Owned),
    ]);

    // A Runner's owners, matched by the key of the Runner they own.
    expect(() => {
      QueryPermission.checkQueryPermission(
        RunnerOwnerUser,
        { runner: { key: QueryHelper.search("ab") } } as never,
        props,
      );
    }).toThrow(
      new NotAuthorizedException(
        "Your access lets you read the Agent Key only of the Runners you or your teams own, so you cannot sort or filter Runners by it.",
      ),
    );

    // By the Runner's name, they are; and by its key with a grant over the whole project.
    expect(() => {
      QueryPermission.checkQueryPermission(
        RunnerOwnerUser,
        { runner: { name: QueryHelper.search("ab") } } as never,
        props,
      );
    }).not.toThrow();
    expect(() => {
      QueryPermission.checkQueryPermission(
        RunnerOwnerUser,
        { runner: { key: QueryHelper.search("ab") } } as never,
        memberWith([row(Permission.RunbookAdmin, PermissionScope.All)]),
      );
    }).not.toThrow();
  });
});
