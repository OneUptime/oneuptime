import CallLog from "../../../../../Models/DatabaseModels/CallLog";
import Entities from "../../../../../Models/DatabaseModels/Index";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import MonitorOwnerUser from "../../../../../Models/DatabaseModels/MonitorOwnerUser";
import SmsLog from "../../../../../Models/DatabaseModels/SmsLog";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../../Models/DatabaseModels/User";
import UserNotificationRule from "../../../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "../../../../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import WhatsAppLog from "../../../../../Models/DatabaseModels/WhatsAppLog";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import OwnerOnlyColumnPermission from "../../../../../Server/Types/Database/Permissions/OwnerOnlyColumnPermission";
import QueryPermission from "../../../../../Server/Types/Database/Permissions/QueryPermission";
import Query from "../../../../../Server/Types/Database/Query";
import PendingInviteeProfiles from "../../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Search from "../../../../../Types/BaseDatabase/Search";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../../Types/HeldPermissions";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { describe, expect, test } from "@jest/globals";

/*
 * A LIST OF PEOPLE IS FILTERED AND ORDERED ONLY BY WHAT ITS READER MAY SEE
 * OF THEM (found while fixing #9895).
 *
 * Permission.CurrentUser lets a person read their own account's columns -
 * their language, time zone, company, phone, whether their address is
 * verified - and every signed-in person holds it, because a read of the
 * User table itself is held to the reader's own row. A filter or an order
 * through a relation to someone's account was held to the same column
 * permissions, and so let every project member filter and order their
 * project's people by any of those columns of anybody's account:
 *
 *   - `{ user: { isEmailVerified: true } }` on the Users list said whether
 *     an address the project had invited had an account before (an
 *     account an invitation makes is not verified) - the very thing #9823
 *     and #9825 closed everywhere else;
 *   - a filter by `user.companyPhoneNumber` or `user.timezone` spelt them
 *     out one Search at a time, and an order put them in order, of members
 *     and invitees alike, none of which any select may return.
 *
 * Through a relation the account is whoever the relation names, so
 * CurrentUser lets in nobody there (QueryPermission
 * .canFilterOrOrderByRelatedColumn): a filter or an order through a
 * relation names of a person what any reader of the relation may read -
 * their name, address, picture and two-factor flag - and their id. A select
 * through the relation is unchanged, and so is OneUptime's own read and a
 * master admin's.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

function caller(
  permissions: Array<Permission>,
  extra: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
    ...extra,
  };
}

const ROLES: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  ["a project member", [Permission.ProjectMember]],
  ["a viewer", [Permission.Viewer]],
];

// The relations a list reads a person through, on lists people use most.
const RELATIONS: Array<[string, { new (): BaseModel }, string]> = [
  ["the Users list's person", TeamMember, "user"],
  ["an owner row's person", MonitorOwnerUser, "user"],
  ["the person who declared an incident", Incident, "createdByUser"],
];

const user: User = new User();

/*
 * The columns of a person's account only they read: CurrentUser among their
 * readers, not readable by any reader of a relation, and not an id or a
 * time every select may name.
 */
const OWN_COLUMNS: Array<string> = Object.keys(
  user
    .getTableColumns()
    .columns.reduce((found: Record<string, true>, column: string) => {
      const metadata: TableColumnMetadata | undefined =
        user.getTableColumnMetadata(column);
      const readers: Array<Permission> =
        user.getColumnAccessControlFor(column)?.read || [];

      if (
        metadata &&
        !metadata.canReadOnRelationQuery &&
        !ColumnPermissions.getExcludedColumnNames().includes(column) &&
        readers.includes(Permission.CurrentUser)
      ) {
        found[column] = true;
      }

      return found;
    }, {}),
);

// What any reader of a relation reads of a person.
const READ_THROUGH_A_RELATION: Array<string> = [
  "name",
  "email",
  "profilePictureId",
  "twoFactorAuthEnabled",
];

async function outcome(data: {
  modelType: { new (): BaseModel };
  query?: Record<string, unknown>;
  select?: Record<string, unknown>;
  sort?: unknown;
  props: DatabaseCommonInteractionProps;
}): Promise<Error | null> {
  try {
    await ModelPermission.checkReadQueryPermission<BaseModel>(
      data.modelType,
      (data.query || {}) as Query<BaseModel>,
      (data.select || { _id: true }) as never,
      data.props,
      data.sort,
    );
    return null;
  } catch (err) {
    return err as Error;
  }
}

describe("the columns only a person reads of their own account", () => {
  test("are the account's private settings: never what a relation reads", () => {
    for (const column of [
      "isEmailVerified",
      "timezone",
      "language",
      "companyName",
      "companyPhoneNumber",
      "jobRole",
    ]) {
      expect(OWN_COLUMNS).toContain(column);
    }

    for (const column of READ_THROUGH_A_RELATION) {
      expect(OWN_COLUMNS).not.toContain(column);
    }
  });

  test("CurrentUser is the one permission a relation to a person's own records does not count, and only there", () => {
    expect(
      PendingInviteeProfiles.getPermissionsNotCountedThroughRelation(
        new User(),
      ),
    ).toEqual([Permission.CurrentUser]);
    // A person's memberships are theirs to read across projects too (#10176).
    expect(
      PendingInviteeProfiles.getPermissionsNotCountedThroughRelation(
        new TeamMember(),
      ),
    ).toEqual([Permission.CurrentUser]);
    expect(
      PendingInviteeProfiles.getPermissionsNotCountedThroughRelation(
        new Incident(),
      ),
    ).toEqual([]);
  });
});

describe.each(RELATIONS)(
  "%s",
  (
    _relationName: string,
    modelType: { new (): BaseModel },
    relation: string,
  ) => {
    describe.each(ROLES)(
      "for %s",
      (_role: string, permissions: Array<Permission>) => {
        test("no filter by a column only the person reads", async () => {
          for (const column of OWN_COLUMNS) {
            const refusal: Error | null = await outcome({
              modelType,
              query: { [relation]: { [column]: new Search("a") } },
              props: caller(permissions),
            });

            expect({ column, refused: refusal?.message || null }).toEqual({
              column,
              refused: expect.stringContaining(
                `You do not have permissions to query on - ${column} of User through ${relation}. No permission allows it`,
              ),
            });
          }
        });

        test("no order by a column only the person reads", async () => {
          for (const column of OWN_COLUMNS) {
            const refusal: Error | null = await outcome({
              modelType,
              sort: { [relation]: { [column]: "ASC" } },
              props: caller(permissions),
            });

            expect({ column, refused: refusal?.message || null }).toEqual({
              column,
              refused: expect.stringContaining(
                `You do not have permissions to sort on - ${column} of User through ${relation}. No permission allows it`,
              ),
            });
          }
        });

        test("a filter and an order by what the relation reads of them, and by their id, as before", async () => {
          for (const column of READ_THROUGH_A_RELATION) {
            expect(
              await outcome({
                modelType,
                query: { [relation]: { [column]: new Search("a") } },
                props: caller(permissions),
              }),
            ).toBeNull();
            expect(
              await outcome({
                modelType,
                sort: { [relation]: { [column]: "ASC" } },
                props: caller(permissions),
              }),
            ).toBeNull();
          }

          expect(
            await outcome({
              modelType,
              query: { [relation]: { _id: ObjectID.generate().toString() } },
              props: caller(permissions),
            }),
          ).toBeNull();
        });

        test("a select through the relation reads what it always read", async () => {
          expect(
            await outcome({
              modelType,
              select: {
                _id: true,
                [relation]: {
                  _id: true,
                  name: true,
                  email: true,
                  profilePictureId: true,
                },
              },
              props: caller(permissions),
            }),
          ).toBeNull();
        });
      },
    );

    test("OneUptime's own reads and a master admin's filter and order as before", async () => {
      for (const props of [
        { isRoot: true },
        caller([], { isMasterAdmin: true }),
      ] as Array<DatabaseCommonInteractionProps>) {
        for (const column of ["isEmailVerified", "timezone", "language"]) {
          expect(
            await outcome({
              modelType,
              query: { [relation]: { [column]: new Search("a") } },
              props,
            }),
          ).toBeNull();
          expect(
            await outcome({
              modelType,
              sort: { [relation]: { [column]: "ASC" } },
              props,
            }),
          ).toBeNull();
        }
      }
    });
  },
);

describe("whether an invited address had an account", () => {
  test("the Users list cannot be asked which invitees had a verified address", async () => {
    const refusal: Error | null = await outcome({
      modelType: TeamMember,
      query: {
        hasAcceptedInvitation: false,
        user: { isEmailVerified: true },
      },
      props: caller([Permission.ProjectMember]),
    });

    expect(refusal?.message).toContain("isEmailVerified of User through user");
  });

  test("nor ordered by it, for a project admin either", async () => {
    const refusal: Error | null = await outcome({
      modelType: TeamMember,
      sort: { user: { isEmailVerified: "DESC" } },
      props: caller([Permission.ProjectAdmin]),
    });

    expect(refusal?.message).toContain("isEmailVerified of User through user");
  });
});

describe("the check, alone", () => {
  test("a filter or an order through a relation does not count CurrentUser on a person's account; a select still does, for ids", () => {
    const held: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: ColumnPermissions.getColumnCheckRows(
        caller([Permission.ProjectOwner]),
      ),
    });

    expect(
      QueryPermission.canFilterOrOrderByRelatedColumn({
        relatedModel: new User(),
        column: "timezone",
        held: held,
      }),
    ).toBe(false);

    // A select of a related person's id is the relation's (QueryPermission's select check).
    expect(
      QueryPermission.canReadRelatedColumn({
        relatedModel: new User(),
        column: "_id",
        held: held,
      }),
    ).toBe(true);

    expect(
      QueryPermission.getRelatedFilterPermissions(new User(), "timezone"),
    ).toEqual([]);
  });
});

/*
 * A PERSON'S OWN RECORDS, THROUGH A RELATION (#10176).
 *
 * Not only a person's account: every table a person reads only their own
 * rows of (@CurrentUserCanAccessRecordBy) - their notification methods and
 * rules, their on-call logs and timelines - lets every signed-in person in
 * by CurrentUser, and a filter or an order through a relation to one of
 * them counted it. A project's SMS, call and WhatsApp logs relate to the
 * on-call timeline entry each was sent for, and through it to the person's
 * rule and method, so whoever reads the logs filtered them by a colleague's
 * own records - `{ userOnCallLogTimeline: { userWebhook: { webhookUrl } } }`
 * a guess at a time. CurrentUser now counts through no relation to any of
 * them; ids and times, and the columns any reader of the relation may read,
 * filter and order as before, and a select through the relation is
 * unchanged.
 */
const PERSON_TABLES: Array<BaseModel> = Entities.map(
  (entity: { new (): BaseModel }): BaseModel => {
    return new entity();
  },
).filter((model: BaseModel): boolean => {
  return Boolean(model.getUserColumn());
});

// The columns of `model` only its own person reads, and nobody else.
function onlyItsPersonReads(model: BaseModel): Array<string> {
  return model.getTableColumns().columns.filter((column: string): boolean => {
    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(column);
    const readers: Array<Permission> =
      model.getColumnAccessControlFor(column)?.read ||
      model.getReadPermissions() ||
      [];

    return (
      Boolean(metadata) &&
      !metadata!.canReadOnRelationQuery &&
      !ColumnPermissions.getExcludedColumnNames().includes(column) &&
      readers.length > 0 &&
      readers.every((permission: Permission): boolean => {
        return permission === Permission.CurrentUser;
      })
    );
  });
}

const TIMELINE_OWN_COLUMNS: Array<string> = onlyItsPersonReads(
  new UserOnCallLogTimeline(),
);

// The project's logs, each with the roles that read it.
const PROJECT_LOGS: Array<[string, { new (): BaseModel }]> = [
  ["an SMS log", SmsLog],
  ["a call log", CallLog],
  ["a WhatsApp log", WhatsAppLog],
];

describe("a person's own records are no filter or order through a relation (#10176)", () => {
  test("CurrentUser counts through no relation to any table a person reads only their own rows of", () => {
    // Their methods, rules, on-call logs and timelines, sessions, factors...
    expect(PERSON_TABLES.length).toBeGreaterThan(20);

    for (const model of PERSON_TABLES) {
      expect({
        table: model.tableName,
        notCounted:
          PendingInviteeProfiles.getPermissionsNotCountedThroughRelation(model),
      }).toEqual({
        table: model.tableName,
        notCounted: [Permission.CurrentUser],
      });
    }

    for (const model of [new SmsLog(), new Incident(), new UserOnCallLog()]) {
      if (!model.getUserColumn()) {
        expect(
          PendingInviteeProfiles.getPermissionsNotCountedThroughRelation(model),
        ).toEqual([]);
      }
    }
  });

  test("the timeline's own columns are the person's: what was sent them, and how it went", () => {
    for (const column of [
      "status",
      "statusMessage",
      "userNotificationRule",
      "userSms",
      "userWebhook",
      "userEmail",
    ]) {
      expect(TIMELINE_OWN_COLUMNS).toContain(column);
    }
  });

  describe.each(PROJECT_LOGS)(
    "%s",
    (_log: string, modelType: { new (): BaseModel }) => {
      describe.each(ROLES)(
        "for %s",
        (_role: string, permissions: Array<Permission>) => {
          test("no filter by a column of the timeline entry only its person reads", async () => {
            for (const column of TIMELINE_OWN_COLUMNS) {
              const refusal: Error | null = await outcome({
                modelType,
                query: { userOnCallLogTimeline: { [column]: new Search("a") } },
                props: caller(permissions),
              });

              expect({ column, refused: refusal?.message || null }).toEqual({
                column,
                refused: expect.stringContaining(
                  `of User On-Call Log Timeline through userOnCallLogTimeline`,
                ),
              });
            }
          });

          test("no order by one either", async () => {
            for (const column of TIMELINE_OWN_COLUMNS) {
              const refusal: Error | null = await outcome({
                modelType,
                sort: { userOnCallLogTimeline: { [column]: "ASC" } },
                props: caller(permissions),
              });

              expect({ column, refused: refusal?.message || null }).toEqual({
                column,
                refused: expect.stringContaining(
                  `You do not have permissions to sort on - ${column} of `,
                ),
              });
            }
          });

          test.each([
            [
              "a colleague's webhook address",
              {
                userOnCallLogTimeline: {
                  userWebhook: {
                    webhookUrl: "https://hooks.slack.com/services/T0/B0/x",
                  },
                },
              },
            ],
            [
              "a colleague's phone",
              {
                userOnCallLogTimeline: { userSms: { phone: new Search("+1") } },
              },
            ],
            [
              "a colleague's email method",
              {
                userOnCallLogTimeline: {
                  userEmail: { email: new Search("@acme") },
                },
              },
            ],
            [
              "a colleague's notification rule",
              {
                userOnCallLogTimeline: {
                  userNotificationRule: { notifyAfterMinutes: 0 },
                },
              },
            ],
            [
              "whether a colleague's SMS method is verified",
              { userOnCallLogTimeline: { userSms: { isVerified: true } } },
            ],
          ])(
            "no filter a level deeper, into %s",
            async (_case: string, query: Record<string, unknown>) => {
              expect(
                await outcome({
                  modelType,
                  query: query,
                  props: caller(permissions),
                }),
              ).toBeInstanceOf(NotAuthorizedException);
            },
          );

          test("a filter by the entry's id, and a select of it, as before", async () => {
            expect(
              await outcome({
                modelType,
                query: {
                  userOnCallLogTimeline: {
                    _id: ObjectID.generate().toString(),
                  },
                },
                props: caller(permissions),
              }),
            ).toBeNull();
            expect(
              await outcome({
                modelType,
                select: { _id: true, userOnCallLogTimeline: { _id: true } },
                props: caller(permissions),
              }),
            ).toBeNull();
          });
        },
      );
    },
  );

  test("a project admin reads a colleague's rules, but filters them by no column of the colleague's methods", async () => {
    for (const query of [
      { userSms: { isVerified: true } },
      { userEmail: { isVerified: false } },
      { userSms: { phone: new Search("+1") } },
      { userWebhook: { webhookUrl: new Search("hooks") } },
    ] as Array<Record<string, unknown>>) {
      expect(
        await outcome({
          modelType: UserNotificationRule,
          query: query,
          props: caller([Permission.ProjectAdmin]),
        }),
      ).toBeInstanceOf(NotAuthorizedException);
    }

    // By the method's id, as before.
    expect(
      await outcome({
        modelType: UserNotificationRule,
        query: { userSms: { _id: ObjectID.generate().toString() } },
        props: caller([Permission.ProjectAdmin]),
      }),
    ).toBeNull();
  });

  test("OneUptime's own reads and a master admin's filter as before", async () => {
    for (const props of [
      { isRoot: true },
      caller([], { isMasterAdmin: true }),
    ] as Array<DatabaseCommonInteractionProps>) {
      expect(
        await outcome({
          modelType: SmsLog,
          query: {
            userOnCallLogTimeline: { userSms: { isVerified: true } },
          },
          props,
        }),
      ).toBeNull();
    }
  });

  /*
   * A person reading their own records - their own rules, their own
   * on-call timeline, read as theirs - reaches their own methods and rules
   * through them, and filters and orders by those as before. Never by
   * another person's account, which even their own records name (whoever
   * made a rule for them).
   */
  describe("a person's own records, read as theirs", () => {
    const ME: ObjectID = ObjectID.generate();

    function me(): DatabaseCommonInteractionProps {
      return { userId: ME, tenantId: PROJECT_ID, ...ON_HIGHEST_PLAN };
    }

    test("CurrentUser counts through a relation from a read pinned to its caller, but never into an account", () => {
      for (const model of PERSON_TABLES) {
        expect({
          table: model.tableName,
          notCounted:
            PendingInviteeProfiles.getPermissionsNotCountedThroughRelation(
              model,
              { isReadPinnedToCaller: true },
            ),
        }).toEqual({
          table: model.tableName,
          notCounted:
            model.tableName === "User" ? [Permission.CurrentUser] : [],
        });
      }
    });

    test.each([
      ["their SMS method's verification", { userSms: { isVerified: true } }],
      [
        "their webhook's address",
        { userWebhook: { webhookUrl: "https://hooks.example.com/x" } },
      ],
      ["their email method", { userEmail: { email: new Search("@acme") } }],
    ])(
      "their own rules filter by %s, as before",
      async (_case: string, query: Record<string, unknown>) => {
        expect(
          await outcome({
            modelType: UserNotificationRule,
            query: { userId: ME.toString(), ...query },
            props: me(),
          }),
        ).toBeNull();
      },
    );

    test("their own rules sort by their methods, and their timeline filters a level deeper, as before", async () => {
      expect(
        await outcome({
          modelType: UserNotificationRule,
          query: { userId: ME.toString() },
          sort: { userSms: { isVerified: "ASC" } },
          props: me(),
        }),
      ).toBeNull();
      expect(
        await outcome({
          modelType: UserOnCallLogTimeline,
          query: {
            userId: ME.toString(),
            userNotificationRule: { userSms: { isVerified: true } },
          },
          props: me(),
        }),
      ).toBeNull();
    });

    test("never by another person's account, even from their own rule", async () => {
      const refusal: Error | null = await outcome({
        modelType: UserNotificationRule,
        query: {
          userId: ME.toString(),
          createdByUser: { timezone: new Search("Europe") },
        },
        props: me(),
      });

      expect(refusal?.message).toContain(
        "timezone of User through createdByUser",
      );
    });

    test("a project admin's read pinned to a colleague is no read of their own", async () => {
      expect(
        await outcome({
          modelType: UserNotificationRule,
          query: {
            userId: ObjectID.generate().toString(),
            userSms: { isVerified: true },
          },
          props: caller([Permission.ProjectAdmin], { userId: ME }),
        }),
      ).toBeInstanceOf(NotAuthorizedException);
    });
  });
});

describe("a value only its own person reads, at any depth of a filter (#10176)", () => {
  const ME: ObjectID = ObjectID.generate();

  function asMe(): DatabaseCommonInteractionProps {
    return caller([], { userId: ME });
  }

  function refusalOf(run: () => void): Error | null {
    try {
      run();
      return null;
    } catch (err) {
      return err as Error;
    }
  }

  test("two levels down, from a project's log: refused", () => {
    const refusal: Error | null = refusalOf(() => {
      OwnerOnlyColumnPermission.checkQueryPermission(
        SmsLog,
        {
          userOnCallLogTimeline: {
            userWebhook: { webhookUrl: "https://hooks.example.com/x" },
          },
        } as Query<BaseModel>,
        caller([Permission.ProjectOwner]),
      );
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal?.message).toContain(
      "query on webhookUrl of Webhook through userWebhook on User On-Call Log Timeline",
    );
  });

  test("in a list of filters: each is walked", () => {
    expect(
      refusalOf(() => {
        OwnerOnlyColumnPermission.checkQueryPermission(
          SmsLog,
          {
            userOnCallLogTimeline: [
              { status: "Sent" },
              { userSms: { phone: "+15550100" } },
            ],
          } as unknown as Query<BaseModel>,
          caller([Permission.ProjectOwner]),
        );
      }),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("a read pinned to the caller's own records passes, at any depth", () => {
    expect(
      refusalOf(() => {
        OwnerOnlyColumnPermission.checkQueryPermission(
          UserOnCallLogTimeline,
          {
            userId: ME.toString(),
            userNotificationRule: {
              userWebhook: { webhookUrl: "https://hooks.example.com/x" },
            },
          } as Query<BaseModel>,
          asMe(),
        );
      }),
    ).toBeNull();

    // Pinned to somebody else: refused.
    expect(
      refusalOf(() => {
        OwnerOnlyColumnPermission.checkQueryPermission(
          UserOnCallLogTimeline,
          {
            userId: ObjectID.generate().toString(),
            userNotificationRule: {
              userWebhook: { webhookUrl: "https://hooks.example.com/x" },
            },
          } as Query<BaseModel>,
          asMe(),
        );
      }),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("OneUptime's own read passes", () => {
    expect(
      refusalOf(() => {
        OwnerOnlyColumnPermission.checkQueryPermission(
          SmsLog,
          {
            userOnCallLogTimeline: { userSms: { phone: "+15550100" } },
          } as Query<BaseModel>,
          { isRoot: true },
        );
      }),
    ).toBeNull();
  });
});
