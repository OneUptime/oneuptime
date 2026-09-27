import UserDiscordService from "../../../Server/Services/UserDiscordService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import UserDiscord from "../../../Models/DatabaseModels/UserDiscord";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import { EntityManager, getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * HOM-44, written before UserDiscordService existed. The Discord twin of
 * UserMicrosoftTeamsService.test.ts, plus the two Discord-only contracts:
 *
 *   - Discord bindings are tombstoned, not deleted (DiscordBindingService),
 *     so a row with deletedAt or an emptied authToken is NOT a live link.
 *   - DiscordBindingService writes with a raw manager, so no service hook
 *     fires on unlink/disconnect/relink. deleteMethodsForBinding is the
 *     cascade those transactions call, and onCreateSuccess re-checks the link
 *     under the same advisory lock to close the add-versus-disconnect race.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const METHOD_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_METHOD_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const DISCORD_USER_ID: string = "100000000000000003";

type HookFunction = (...args: Array<unknown>) => Promise<unknown>;

function hook(name: string): HookFunction {
  const service: Record<string, HookFunction> =
    UserDiscordService as unknown as Record<string, HookFunction>;
  return service[name]!.bind(UserDiscordService);
}

function createBy(
  data: Partial<UserDiscord> = {},
  props: { isRoot: boolean } = { isRoot: false },
): CreateBy<UserDiscord> {
  return {
    data: {
      projectId: PROJECT_ID,
      userId: USER_ID,
      ...data,
    } as UserDiscord,
    props: props,
  } as CreateBy<UserDiscord>;
}

function liveLink(
  overrides: Partial<WorkspaceUserAuthToken> = {},
): WorkspaceUserAuthToken {
  return {
    workspaceUserId: DISCORD_USER_ID,
    authToken: "discord-verified-identity",
    miscData: {
      userId: DISCORD_USER_ID,
      username: "discord-e2e-user",
      displayName: "Discord E2E",
    },
    ...overrides,
  } as unknown as WorkspaceUserAuthToken;
}

interface FakeManager {
  manager: EntityManager;
  queries: Array<[string, Array<unknown> | undefined]>;
  deletes: Array<{ entity: string; where: unknown }>;
  finds: Array<{ entity: string; options: unknown }>;
  updates: Array<{ entity: string; criteria: unknown; patch: unknown }>;
}

function fakeManager(data: {
  methods?: Array<Partial<UserDiscord>>;
  rules?: Array<Partial<UserNotificationRule>>;
  link?: WorkspaceUserAuthToken | null;
}): FakeManager {
  const queries: Array<[string, Array<unknown> | undefined]> = [];
  const deletes: Array<{ entity: string; where: unknown }> = [];
  const finds: Array<{ entity: string; options: unknown }> = [];
  const updates: Array<{ entity: string; criteria: unknown; patch: unknown }> =
    [];
  const repository: (entity: { name: string }) => unknown = (entity: {
    name: string;
  }): unknown => {
    return {
      find: async (options: unknown): Promise<unknown> => {
        finds.push({ entity: entity.name, options });
        if (entity === UserDiscord) {
          return data.methods || [];
        }
        if (entity === UserNotificationRule) {
          return data.rules || [];
        }
        return [];
      },
      findOne: async (options: unknown): Promise<unknown> => {
        finds.push({ entity: entity.name, options });
        return entity === WorkspaceUserAuthToken ? data.link ?? null : null;
      },
      delete: async (where: unknown): Promise<{ affected: number }> => {
        deletes.push({ entity: entity.name, where });
        return { affected: 1 };
      },
      update: async (
        criteria: unknown,
        patch: unknown,
      ): Promise<{ affected: number }> => {
        updates.push({ entity: entity.name, criteria, patch });
        return { affected: 1 };
      },
    };
  };
  const manager: EntityManager = {
    query: async (sql: string, params?: Array<unknown>): Promise<unknown> => {
      queries.push([sql, params]);
      return [];
    },
    getRepository: repository,
  } as unknown as EntityManager;
  return { manager, queries, deletes, finds, updates };
}

// Runs the service transaction against the fake manager; there is no database here.
function runInTransaction(fake: FakeManager): jest.SpyInstance {
  return jest
    .spyOn(
      UserDiscordService as unknown as {
        executeTransaction: (
          action: (manager: EntityManager) => Promise<unknown>,
        ) => Promise<unknown>;
      },
      "executeTransaction",
    )
    .mockImplementation(
      async (
        action: (manager: EntityManager) => Promise<unknown>,
      ): Promise<unknown> => {
        return await action(fake.manager);
      },
    );
}

function idsIn(where: unknown, key: string): Array<string> {
  const operator: { value?: Array<unknown> } = (
    where as Record<string, { value?: Array<unknown> }>
  )[key]!;
  return (operator.value || []).map((value: unknown): string => {
    return String(value);
  });
}

describe("UserDiscordService", () => {
  let countBy: jest.SpyInstance;
  let getProjectAuth: jest.SpyInstance;
  let getUserAuth: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    countBy = jest
      .spyOn(UserDiscordService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    getProjectAuth = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue({
        id: PROJECT_ID,
        authToken: "bot-token",
        workspaceProjectId: "100000000000000004",
      } as unknown as WorkspaceProjectAuthToken as never);

    getUserAuth = jest
      .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
      .mockResolvedValue(liveLink() as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("onBeforeCreate", () => {
    test("stamps the Discord user id from the caller's own link and marks it verified", async () => {
      const result: OnCreate<UserDiscord> = (await hook("onBeforeCreate")(
        createBy(),
      )) as OnCreate<UserDiscord>;

      expect(result.createBy.data.discordUserId).toBe(DISCORD_USER_ID);
      expect(result.createBy.data.isVerified).toBe(true);
      const authArg: { workspaceType: WorkspaceType; userId: ObjectID } =
        getUserAuth.mock.calls[0][0] as {
          workspaceType: WorkspaceType;
          userId: ObjectID;
        };
      expect(authArg.workspaceType).toBe(WorkspaceType.Discord);
      expect(authArg.userId.toString()).toBe(USER_ID.toString());
    });

    test("the label is the OAuth display name, falling back to the username", async () => {
      let result: OnCreate<UserDiscord> = (await hook("onBeforeCreate")(
        createBy(),
      )) as OnCreate<UserDiscord>;
      expect(result.createBy.data.discordUserName).toBe("Discord E2E");

      getUserAuth.mockResolvedValue(
        liveLink({
          miscData: { username: "discord-e2e-user" },
        } as unknown as Partial<WorkspaceUserAuthToken>) as never,
      );
      result = (await hook("onBeforeCreate")(
        createBy(),
      )) as OnCreate<UserDiscord>;
      expect(result.createBy.data.discordUserName).toBe("discord-e2e-user");
    });

    test.each([
      [{ isVerified: true }, "isVerified cannot be set to true"],
      [{ discordUserId: "199999999999999999" }, "discordUserId cannot be set"],
      [{ discordUserName: "someone else" }, "discordUserName cannot be set"],
    ])(
      "a non-root caller supplying %o is refused",
      async (forged: Partial<UserDiscord>, message: string) => {
        await expect(hook("onBeforeCreate")(createBy(forged))).rejects.toThrow(
          message,
        );
        expect(getUserAuth).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["missing", null],
      ["tombstoned", { authToken: "", deletedAt: new Date() }],
      ["credential-cleared", { authToken: "" }],
    ])(
      "a %s project installation is refused with the settings pointer",
      async (_label: string, row: unknown) => {
        getProjectAuth.mockResolvedValue(row as never);
        await expect(hook("onBeforeCreate")(createBy())).rejects.toThrow(
          "This project is not connected to Discord.",
        );
      },
    );

    test.each([
      ["missing", null],
      ["without an id", { workspaceUserId: "" }],
      ["tombstoned", { deletedAt: new Date() }],
      ["credential-cleared", { authToken: "" }],
    ])(
      "a %s account link is refused with the settings pointer",
      async (_label: string, overrides: unknown) => {
        getUserAuth.mockResolvedValue(
          (overrides === null
            ? null
            : liveLink(overrides as Partial<WorkspaceUserAuthToken>)) as never,
        );
        await expect(hook("onBeforeCreate")(createBy())).rejects.toThrow(
          "Your Discord account is not connected to OneUptime for this project.",
        );
      },
    );

    test("a second row for the same (user, project) is refused as a duplicate", async () => {
      countBy.mockResolvedValue(new PositiveNumber(1) as never);
      await expect(hook("onBeforeCreate")(createBy())).rejects.toThrow(
        "Discord is already added as a notification method for this project.",
      );
      expect(getUserAuth).not.toHaveBeenCalled();
    });

    test("a missing projectId or userId is refused before anything is queried", async () => {
      await expect(
        hook("onBeforeCreate")({
          data: { userId: USER_ID } as UserDiscord,
          props: { isRoot: false },
        }),
      ).rejects.toThrow("projectId and userId are required");
      expect(countBy).not.toHaveBeenCalled();
    });
  });

  describe("onCreateSuccess", () => {
    let seedRules: jest.SpyInstance;
    const created: UserDiscord = {
      id: METHOD_ID,
      _id: METHOD_ID.toString(),
      projectId: PROJECT_ID,
      userId: USER_ID,
      discordUserId: DISCORD_USER_ID,
    } as unknown as UserDiscord;

    beforeEach(() => {
      seedRules = jest
        .spyOn(
          UserNotificationRuleService,
          "addDefaultNotificationRulesForVerifiedMethod",
        )
        .mockResolvedValue(undefined as never);
    });

    test("re-checks the link under the Discord binding lock, then seeds default rules", async () => {
      const fake: FakeManager = fakeManager({ link: liveLink() });
      runInTransaction(fake);

      await hook("onCreateSuccess")(
        { createBy: createBy(), carryForward: null },
        created,
      );

      const lock: [string, Array<unknown> | undefined] | undefined =
        fake.queries.find(
          (query: [string, Array<unknown> | undefined]): boolean => {
            return query[0].includes("pg_advisory_xact_lock");
          },
        );
      expect(lock?.[1]).toEqual(["discord-binding:" + PROJECT_ID.toString()]);
      expect(fake.deletes).toHaveLength(0);
      const arg: { notificationMethod: { userDiscordId: ObjectID } } = seedRules
        .mock.calls[0][0] as {
        notificationMethod: { userDiscordId: ObjectID };
      };
      expect(arg.notificationMethod.userDiscordId.toString()).toBe(
        METHOD_ID.toString(),
      );
    });

    test.each([
      ["removed", null],
      ["relinked to another account", liveLink({ workspaceUserId: "199" })],
      ["tombstoned", liveLink({ authToken: "" })],
    ])(
      "a link %s while the row was inserted deletes the row and seeds nothing",
      async (_label: string, link: WorkspaceUserAuthToken | null) => {
        const fake: FakeManager = fakeManager({ link });
        runInTransaction(fake);

        await expect(
          hook("onCreateSuccess")(
            { createBy: createBy(), carryForward: null },
            created,
          ),
        ).rejects.toThrow(BadDataException);

        expect(fake.deletes).toEqual([
          { entity: "UserDiscord", where: { _id: METHOD_ID.toString() } },
        ]);
        expect(seedRules).not.toHaveBeenCalled();
      },
    );

    test("a seeding failure is swallowed and logged - the method row is already real", async () => {
      runInTransaction(fakeManager({ link: liveLink() }));
      seedRules.mockRejectedValue(new Error("severity read failed") as never);

      await expect(
        hook("onCreateSuccess")(
          { createBy: createBy(), carryForward: null },
          created,
        ),
      ).resolves.toBe(created);
      expect(loggerError).toHaveBeenCalled();
    });
  });

  /*
   * onBeforeCreate's duplicate check is a count before the insert, so two
   * concurrent adds both see zero and both insert: two verified methods and
   * two sets of seeded paging rules for one person. Only the database can
   * close that. Ways it goes wrong:
   *
   *   1. no unique index on (projectId, userId), so both inserts land;
   *   2. an index that also counts deleted rows, so a re-add after delete is
   *      refused;
   *   3. the losing insert still seeds default rules;
   *   4. the loser gets a bare 500 instead of a duplicate 400.
   *
   * The fake table below enforces exactly the unique indexes TypeORM has
   * registered for UserDiscord, so it fails the way Postgres would.
   */
  describe("concurrent add", () => {
    function liveUniqueIndexes(): Array<Array<string>> {
      return getMetadataArgsStorage()
        .indices.filter((index: IndexMetadataArgs): boolean => {
          return index.target === UserDiscord && Boolean(index.unique);
        })
        .map((index: IndexMetadataArgs): Array<string> => {
          return [...(index.columns as Array<string>)].sort();
        });
    }

    test("the model declares one live Discord method per (project, user)", () => {
      expect(liveUniqueIndexes()).toContainEqual(["projectId", "userId"]);

      const index: IndexMetadataArgs | undefined =
        getMetadataArgsStorage().indices.find(
          (candidate: IndexMetadataArgs): boolean => {
            return (
              candidate.target === UserDiscord &&
              Boolean(candidate.unique) &&
              [...(candidate.columns as Array<string>)].sort().join() ===
                "projectId,userId"
            );
          },
        );
      expect(index?.where).toBe('"deletedAt" IS NULL');
    });

    test("two simultaneous adds leave one method, one rule seeding and a duplicate 400", async () => {
      const rows: Array<UserDiscord> = [];
      jest.spyOn(UserDiscordService, "getRepository").mockReturnValue({
        save: async (data: UserDiscord): Promise<UserDiscord> => {
          // Both requests have passed the count check before either writes.
          await new Promise((resolve: (value: unknown) => void) => {
            setTimeout(resolve, 0);
          });
          for (const columns of liveUniqueIndexes()) {
            const clash: boolean = rows.some((row: UserDiscord): boolean => {
              return columns.every((column: string): boolean => {
                return (
                  String(
                    (row as unknown as Record<string, unknown>)[column],
                  ) ===
                  String((data as unknown as Record<string, unknown>)[column])
                );
              });
            });
            if (clash) {
              throw Object.assign(
                new Error("duplicate key value violates unique constraint"),
                {
                  code: "23505",
                  table: "UserDiscord",
                  detail:
                    'Key ("projectId", "userId")=(' +
                    PROJECT_ID.toString() +
                    ", " +
                    USER_ID.toString() +
                    ") already exists.",
                },
              );
            }
          }
          const saved: UserDiscord = Object.assign(data, {
            _id: ObjectID.generate().toString(),
          });
          (saved as unknown as { id: ObjectID }).id = new ObjectID(saved._id!);
          rows.push(saved);
          return saved;
        },
      } as never);

      jest
        .spyOn(
          UserDiscordService as unknown as {
            executeTransaction: (
              action: (manager: EntityManager) => Promise<unknown>,
            ) => Promise<unknown>;
          },
          "executeTransaction",
        )
        .mockImplementation(
          async (
            action: (manager: EntityManager) => Promise<unknown>,
          ): Promise<unknown> => {
            return await action(fakeManager({ link: liveLink() }).manager);
          },
        );
      const seedRules: jest.SpyInstance = jest
        .spyOn(
          UserNotificationRuleService,
          "addDefaultNotificationRulesForVerifiedMethod",
        )
        .mockResolvedValue(undefined as never);

      const add: () => Promise<UserDiscord> = (): Promise<UserDiscord> => {
        const data: UserDiscord = new UserDiscord();
        data.projectId = PROJECT_ID;
        data.userId = USER_ID;
        return UserDiscordService.create({
          data,
          props: { userId: USER_ID, tenantId: PROJECT_ID },
        });
      };

      const results: Array<PromiseSettledResult<UserDiscord>> =
        await Promise.allSettled([add(), add()]);

      const reasons: Array<unknown> = [];
      for (const result of results) {
        if (result.status === "rejected") {
          reasons.push(result.reason);
        }
      }
      expect(rows).toHaveLength(1);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toBeInstanceOf(BadDataException);
      expect(PostgresErrorTranslator.isUniqueViolation(reasons[0])).toBe(true);
      expect(seedRules).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * DatabaseService runs onBeforeDelete BEFORE checkDeleteQueryPermission,
   * and BaseAPI.deleteItem forwards the id from the URL untouched. A hook
   * that selects rows as root on the raw query therefore acts on rows the
   * caller could never delete. Ways this goes wrong, each pinned below
   * through the real permission layer and the real deleteOneById path:
   *
   *   1. another member's method id in the same project: their rules go,
   *      even though the method delete itself is later scoped to nothing;
   *   2. the caller's own method in a project other than the request's
   *      tenant: that project's rules go;
   *   3. a query that names another user outright must be refused before
   *      any rule is touched, not after;
   *   4. the requested limit/skip is ignored, so a limit-1 delete wipes
   *      rules for every matching method;
   *   5. the rows whose rules were removed differ from the rows the final
   *      delete removes (rules deleted for a method that survives).
   */
  describe("delete through the permission layer", () => {
    const OTHER_USER_ID: ObjectID = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );
    const OTHER_PROJECT_ID: ObjectID = new ObjectID(
      "66666666-6666-4666-8666-666666666666",
    );
    const OWN_OTHER_PROJECT_METHOD_ID: ObjectID = new ObjectID(
      "77777777-7777-4777-8777-777777777777",
    );
    const SECOND_OWN_METHOD_ID: ObjectID = new ObjectID(
      "88888888-8888-4888-8888-888888888888",
    );

    interface Row {
      _id: string;
      userId: string;
      projectId: string;
    }

    let methods: Array<Row>;
    let rules: Array<{ userDiscordId: string; projectId: string }>;

    const memberProps: {
      userId: ObjectID;
      tenantId: ObjectID;
    } = { userId: USER_ID, tenantId: PROJECT_ID };

    // Matches ObjectID equality and QueryHelper.any; anything else fails loudly.
    function matches(row: Row, query: Record<string, unknown>): boolean {
      return Object.entries(query).every(
        ([key, value]: [string, unknown]): boolean => {
          const actual: string = (row as unknown as Record<string, string>)[
            key
          ]!;
          if (value instanceof ObjectID || typeof value === "string") {
            return actual === value.toString();
          }
          const params: Record<string, unknown> | undefined = (
            value as { objectLiteralParameters?: Record<string, unknown> }
          )?.objectLiteralParameters;
          if (params) {
            return Object.values(params).flat().map(String).includes(actual);
          }
          throw new Error("Unhandled query operator on " + key);
        },
      );
    }

    beforeEach(() => {
      methods = [
        {
          _id: METHOD_ID.toString(),
          userId: USER_ID.toString(),
          projectId: PROJECT_ID.toString(),
        },
        {
          _id: OTHER_METHOD_ID.toString(),
          userId: OTHER_USER_ID.toString(),
          projectId: PROJECT_ID.toString(),
        },
        {
          _id: OWN_OTHER_PROJECT_METHOD_ID.toString(),
          userId: USER_ID.toString(),
          projectId: OTHER_PROJECT_ID.toString(),
        },
      ];
      rules = methods.map((row: Row) => {
        return { userDiscordId: row._id, projectId: row.projectId };
      });

      jest
        .spyOn(UserDiscordService as never, "_findBy" as never)
        .mockImplementation((async (findBy: {
          query: Record<string, unknown>;
          skip?: number | PositiveNumber;
          limit?: number | PositiveNumber;
        }): Promise<Array<UserDiscord>> => {
          const skip: number = Number(findBy.skip?.toString() || 0);
          const limit: number = Number(findBy.limit?.toString() || LIMIT_MAX);
          return methods
            .filter((row: Row) => {
              return matches(row, findBy.query);
            })
            .slice(skip, skip + limit)
            .map((row: Row) => {
              return {
                _id: row._id,
                id: new ObjectID(row._id),
                projectId: new ObjectID(row.projectId),
                userId: new ObjectID(row.userId),
              } as unknown as UserDiscord;
            });
        }) as never);

      // The history detach runs in a transaction; no rules point at these rows here.
      runInTransaction(fakeManager({}));

      jest.spyOn(UserDiscordService, "getRepository").mockReturnValue({
        delete: async (
          query: Record<string, unknown>,
        ): Promise<{ affected: number }> => {
          const before: number = methods.length;
          methods = methods.filter((row: Row) => {
            return !matches(row, query);
          });
          return { affected: before - methods.length };
        },
      } as never);

      jest
        .spyOn(UserNotificationRuleService, "deleteBy")
        .mockImplementation((async (deleteBy: {
          query: { userDiscordId: ObjectID; projectId: ObjectID };
        }): Promise<number> => {
          const before: number = rules.length;
          rules = rules.filter(
            (rule: { userDiscordId: string; projectId: string }) => {
              return !(
                rule.userDiscordId ===
                  deleteBy.query.userDiscordId.toString() &&
                rule.projectId === deleteBy.query.projectId.toString()
              );
            },
          );
          return before - rules.length;
        }) as never);
    });

    function survivingIds(
      list: Array<{ _id?: string; userDiscordId?: string }>,
    ): Array<string> {
      return list
        .map((entry: { _id?: string; userDiscordId?: string }): string => {
          return (entry._id || entry.userDiscordId)!;
        })
        .sort();
    }

    test("a member deleting their own method removes it and only its rules", async () => {
      await UserDiscordService.deleteOneById({
        id: METHOD_ID,
        props: memberProps,
      });

      const remaining: Array<string> = [
        OTHER_METHOD_ID.toString(),
        OWN_OTHER_PROJECT_METHOD_ID.toString(),
      ].sort();
      expect(survivingIds(methods)).toEqual(remaining);
      expect(survivingIds(rules)).toEqual(remaining);
    });

    test("another member's method id in the same project leaves their method and rules intact", async () => {
      await UserDiscordService.deleteOneById({
        id: OTHER_METHOD_ID,
        props: memberProps,
      });

      expect(methods).toHaveLength(3);
      expect(rules).toHaveLength(3);
    });

    test("the caller's own method in another project is untouched by a delete scoped to this tenant", async () => {
      await UserDiscordService.deleteOneById({
        id: OWN_OTHER_PROJECT_METHOD_ID,
        props: memberProps,
      });

      expect(methods).toHaveLength(3);
      expect(rules).toHaveLength(3);
    });

    test("a query naming another user is refused before any rule is touched", async () => {
      await expect(
        UserDiscordService.deleteBy({
          query: { userId: OTHER_USER_ID },
          limit: LIMIT_MAX,
          skip: 0,
          props: memberProps,
        }),
      ).rejects.toThrow();

      expect(methods).toHaveLength(3);
      expect(rules).toHaveLength(3);
    });

    test("the requested limit bounds which rules are removed, and the same rows are deleted", async () => {
      methods.push({
        _id: SECOND_OWN_METHOD_ID.toString(),
        userId: USER_ID.toString(),
        projectId: PROJECT_ID.toString(),
      });
      rules.push({
        userDiscordId: SECOND_OWN_METHOD_ID.toString(),
        projectId: PROJECT_ID.toString(),
      });

      const deleted: number = await UserDiscordService.deleteBy({
        query: {},
        limit: 1,
        skip: 0,
        props: memberProps,
      });

      expect(deleted).toBe(1);
      expect(methods).toHaveLength(3);
      expect(rules).toHaveLength(3);
      // Whichever method went, its rules went with it and no other's did.
      expect(survivingIds(rules)).toEqual(survivingIds(methods));
    });
  });

  describe("onBeforeDelete", () => {
    test("deletes every notification rule pointing at each row being deleted", async () => {
      jest
        .spyOn(UserDiscordService, "findBy")
        .mockResolvedValue([
          { id: METHOD_ID, projectId: PROJECT_ID } as unknown as UserDiscord,
        ] as never);
      const deleteRules: jest.SpyInstance = jest
        .spyOn(UserNotificationRuleService, "deleteBy")
        .mockResolvedValue([] as never);
      const RULE_ID: ObjectID = ObjectID.generate();
      const fake: FakeManager = fakeManager({
        rules: [{ _id: RULE_ID.toString() } as unknown as UserNotificationRule],
      });
      runInTransaction(fake);

      await hook("onBeforeDelete")({
        query: { _id: METHOD_ID },
        props: { isRoot: true },
      });

      /*
       * The timeline rows that recorded pages through the doomed rules are
       * detached first, so the ON DELETE CASCADE on the rule cannot take the
       * Sent and Error history with it.
       */
      expect(
        fake.finds.map((find: { entity: string }) => {
          return find.entity;
        }),
      ).toEqual(["UserNotificationRule"]);
      expect(
        idsIn(
          (fake.finds[0]!.options as { where: unknown }).where,
          "userDiscordId",
        ),
      ).toEqual([METHOD_ID.toString()]);
      expect(fake.updates).toHaveLength(1);
      expect(fake.updates[0]!.entity).toBe("UserOnCallLogTimeline");
      expect(
        idsIn(fake.updates[0]!.criteria, "userNotificationRuleId"),
      ).toEqual([RULE_ID.toString()]);
      expect(fake.updates[0]!.patch).toEqual({ userNotificationRuleId: null });

      const arg: {
        query: { userDiscordId: ObjectID; projectId: ObjectID };
        limit: number;
      } = deleteRules.mock.calls[0][0] as {
        query: { userDiscordId: ObjectID; projectId: ObjectID };
        limit: number;
      };
      expect(arg.query.userDiscordId.toString()).toBe(METHOD_ID.toString());
      expect(arg.query.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(arg.limit).toBe(LIMIT_MAX);
    });
  });

  describe("getDeletionImpact", () => {
    test("delegates to the shared preview with methodType Discord", async () => {
      const getImpact: jest.SpyInstance = jest
        .spyOn(
          UserNotificationRuleService,
          "getNotificationMethodDeletionImpact",
        )
        .mockResolvedValue({} as never);

      await UserDiscordService.getDeletionImpact({
        itemId: METHOD_ID,
        projectId: PROJECT_ID,
      });

      const arg: { methodType: string } = getImpact.mock.calls[0][0] as {
        methodType: string;
      };
      expect(arg.methodType).toBe("Discord");
    });
  });

  describe("deleteMethodsForBinding", () => {
    test("a user-scoped cleanup without a user id is refused before any query", async () => {
      const fake: FakeManager = fakeManager({
        methods: [{ _id: METHOD_ID.toString() }],
      });

      await expect(
        UserDiscordService.deleteMethodsForBinding(fake.manager, {
          scope: "user",
          projectId: PROJECT_ID,
          userId: undefined as unknown as ObjectID,
        }),
      ).rejects.toThrow(BadDataException);
      expect(fake.finds).toHaveLength(0);
      expect(fake.deletes).toHaveLength(0);
    });

    test("a user-scoped cleanup selects only that user's methods in that project", async () => {
      const fake: FakeManager = fakeManager({
        methods: [{ _id: METHOD_ID.toString() }],
      });

      await UserDiscordService.deleteMethodsForBinding(fake.manager, {
        scope: "user",
        projectId: PROJECT_ID,
        userId: USER_ID,
      });

      const where: Record<string, unknown> = (
        fake.finds[0]!.options as { where: Record<string, unknown> }
      ).where;
      expect(String(where["projectId"])).toBe(PROJECT_ID.toString());
      expect(String(where["userId"])).toBe(USER_ID.toString());
    });

    test("deletes only rules that reference the selected methods, then the methods", async () => {
      const fake: FakeManager = fakeManager({
        methods: [
          { _id: METHOD_ID.toString() },
          { _id: OTHER_METHOD_ID.toString() },
        ],
      });

      const count: number = await UserDiscordService.deleteMethodsForBinding(
        fake.manager,
        { scope: "project", projectId: PROJECT_ID },
      );

      expect(count).toBe(2);
      const where: Record<string, unknown> = (
        fake.finds[0]!.options as { where: Record<string, unknown> }
      ).where;
      expect(String(where["projectId"])).toBe(PROJECT_ID.toString());
      expect(where["userId"]).toBeUndefined();

      expect(
        fake.deletes.map((item: { entity: string }): string => {
          return item.entity;
        }),
      ).toEqual([UserNotificationRule.name, UserDiscord.name]);
      const ruleWhere: Record<string, unknown> = fake.deletes[0]!
        .where as Record<string, unknown>;
      // Only the method column: methodless opt-out rules can never match.
      expect(Object.keys(ruleWhere)).toEqual(["userDiscordId"]);
      expect(idsIn(ruleWhere, "userDiscordId")).toEqual([
        METHOD_ID.toString(),
        OTHER_METHOD_ID.toString(),
      ]);
      expect(idsIn(fake.deletes[1]!.where, "_id")).toEqual([
        METHOD_ID.toString(),
        OTHER_METHOD_ID.toString(),
      ]);
    });

    test("no methods means no deletes", async () => {
      const fake: FakeManager = fakeManager({ methods: [] });
      const count: number = await UserDiscordService.deleteMethodsForBinding(
        fake.manager,
        { scope: "project", projectId: PROJECT_ID },
      );
      expect(count).toBe(0);
      expect(fake.deletes).toHaveLength(0);
    });
  });
});
