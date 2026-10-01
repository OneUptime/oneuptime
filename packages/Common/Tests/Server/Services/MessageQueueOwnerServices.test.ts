/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import { IsBillingEnabled } from "../../../Server/EnvironmentConfig";
import MessageQueueLabelRuleService from "../../../Server/Services/MessageQueueLabelRuleService";
import MessageQueueOwnerRuleService from "../../../Server/Services/MessageQueueOwnerRuleService";
import MessageQueueOwnerTeamService from "../../../Server/Services/MessageQueueOwnerTeamService";
import MessageQueueOwnerUserService from "../../../Server/Services/MessageQueueOwnerUserService";
import MessageQueueService from "../../../Server/Services/MessageQueueService";
import logger from "../../../Server/Utils/Logger";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import MessageQueueOwnerTeam from "../../../Models/DatabaseModels/MessageQueueOwnerTeam";
import MessageQueueOwnerUser from "../../../Models/DatabaseModels/MessageQueueOwnerUser";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";

/*
 * The queue owner join services and the rule CRUD services.
 *
 * An owner row a CALLER adds must name a queue of the caller's own project
 * (by FK column and relation object alike), and the create permission is
 * checked before that lookup - so the refusal is no way to probe for queues
 * in other projects. An owner a PERSON adds counts as investment (the
 * auto-archive sweep leaves the queue alone); one an owner rule adds as root
 * stays automatic. There is no queue feed, so nothing is written besides.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const QUEUE_ID: ObjectID = ObjectID.generate();
const OTHER_QUEUE_ID: ObjectID = ObjectID.generate();
const TEAM_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const ACTING_USER_ID: ObjectID = ObjectID.generate();

function callerProps(
  permissions: Array<Permission> = [Permission.ProjectMember],
): DatabaseCommonInteractionProps {
  return {
    userId: ACTING_USER_ID,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              permission,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            };
          },
        ),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function newUserOwner(): MessageQueueOwnerUser {
  const owner: MessageQueueOwnerUser = new MessageQueueOwnerUser();
  owner.userId = USER_ID;
  return owner;
}

function newTeamOwner(): MessageQueueOwnerTeam {
  const owner: MessageQueueOwnerTeam = new MessageQueueOwnerTeam();
  owner.teamId = TEAM_ID;
  return owner;
}

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("queue owner rows created by a caller", () => {
  let findQueue: jest.SpyInstance;

  beforeEach(() => {
    // Only QUEUE_ID lives in PROJECT_ID.
    findQueue = getJestSpyOn(
      MessageQueueService,
      "findOneBy",
    ).mockImplementation(async (args: any) => {
      return args.query._id === QUEUE_ID.toString() &&
        args.query.projectId.toString() === PROJECT_ID.toString()
        ? ({ _id: QUEUE_ID.toString() } as never)
        : null;
    });
  });

  describe.each([
    [
      "MessageQueueOwnerUserService",
      MessageQueueOwnerUserService as any,
      Permission.ReadMessageQueueOwnerUser,
      newUserOwner as () => any,
    ],
    [
      "MessageQueueOwnerTeamService",
      MessageQueueOwnerTeamService as any,
      Permission.ReadMessageQueueOwnerTeam,
      newTeamOwner as () => any,
    ],
  ])(
    "%s.onBeforeCreate",
    (
      _name: string,
      ownerService: any,
      readPermission: Permission,
      newOwner: () => any,
    ) => {
      test("a queue of the caller's project is accepted, as the FK column only", async () => {
        const data: any = newOwner();
        data.messageQueue = new MessageQueue(QUEUE_ID);

        await ownerService.onBeforeCreate({
          data: data,
          props: callerProps(),
        });

        expect(data.messageQueueId.toString()).toBe(QUEUE_ID.toString());
        expect(data.messageQueue).toBeUndefined();
        const lookup: any = findQueue.mock.calls[0]![0];
        expect(lookup.query._id).toBe(QUEUE_ID.toString());
        expect(lookup.query.projectId.toString()).toBe(PROJECT_ID.toString());
        expect(lookup.props).toEqual({ isRoot: true });
      });

      test("the FK column alone is accepted too", async () => {
        const data: any = newOwner();
        data.messageQueueId = QUEUE_ID;

        await ownerService.onBeforeCreate({
          data: data,
          props: callerProps(),
        });

        expect(data.messageQueueId.toString()).toBe(QUEUE_ID.toString());
      });

      test("another project's queue is refused - by FK column or by relation object", async () => {
        const byColumn: any = newOwner();
        byColumn.messageQueueId = OTHER_QUEUE_ID;
        const byRelation: any = newOwner();
        byRelation.messageQueue = new MessageQueue(OTHER_QUEUE_ID);

        for (const data of [byColumn, byRelation]) {
          await expect(
            ownerService.onBeforeCreate({ data: data, props: callerProps() }),
          ).rejects.toThrow("Queue not found.");
        }
      });

      test("an FK column and a relation object that disagree are refused", async () => {
        const data: any = newOwner();
        data.messageQueueId = QUEUE_ID;
        data.messageQueue = new MessageQueue(OTHER_QUEUE_ID);

        await expect(
          ownerService.onBeforeCreate({ data: data, props: callerProps() }),
        ).rejects.toThrow("Conflicting queue references were provided.");
        expect(findQueue).not.toHaveBeenCalled();
      });

      test("an owner row naming no queue is refused", async () => {
        await expect(
          ownerService.onBeforeCreate({
            data: newOwner(),
            props: callerProps(),
          }),
        ).rejects.toThrow("Select a queue.");
        expect(findQueue).not.toHaveBeenCalled();
      });

      test("a caller without the create permission is refused before any lookup", async () => {
        const data: any = newOwner();
        data.messageQueueId = OTHER_QUEUE_ID;

        const error: unknown = await ownerService
          .onBeforeCreate({
            data: data,
            props: callerProps([Permission.ReadMessageQueue, readPermission]),
          })
          .catch((e: unknown) => {
            return e;
          });

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(findQueue).not.toHaveBeenCalled();
      });

      test("root writes (owner rules) pass through untouched", async () => {
        const data: any = newOwner();
        data.messageQueueId = OTHER_QUEUE_ID;

        await ownerService.onBeforeCreate({
          data: data,
          props: { isRoot: true },
        });

        expect(findQueue).not.toHaveBeenCalled();
        expect(data.messageQueueId).toBe(OTHER_QUEUE_ID);
      });
    },
  );

  describe.each([
    [
      "user",
      MessageQueueOwnerUserService as any,
      "ownerUserIds",
      newUserOwner as () => any,
      USER_ID,
    ],
    [
      "team",
      MessageQueueOwnerTeamService as any,
      "ownerTeamIds",
      newTeamOwner as () => any,
      TEAM_ID,
    ],
  ])(
    "a %s owner",
    (
      _kind: string,
      ownerService: any,
      assignmentKind: string,
      newOwner: () => any,
      ownerId: ObjectID,
    ) => {
      let forget: jest.SpyInstance;

      beforeEach(() => {
        forget = getJestSpyOn(
          MessageQueueService,
          "forgetAutomaticAssignments",
        ).mockResolvedValue(undefined);
      });

      test("added by a person counts as investment, whichever rule added it first", async () => {
        const owner: any = newOwner();
        owner.messageQueueId = QUEUE_ID;
        owner.projectId = PROJECT_ID;

        const result: any = await ownerService.onCreateSuccess(
          {
            createBy: { data: owner, props: callerProps() },
            carryForward: null,
          },
          owner,
        );

        expect(result).toBe(owner);
        expect(forget).toHaveBeenCalledWith({
          messageQueueId: QUEUE_ID,
          kind: assignmentKind,
          ids: [ownerId],
        });
      });

      test("added by an owner rule (root) stays automatic", async () => {
        const owner: any = newOwner();
        owner.messageQueueId = QUEUE_ID;
        owner.projectId = PROJECT_ID;

        await ownerService.onCreateSuccess(
          {
            createBy: { data: owner, props: { isRoot: true } },
            carryForward: null,
          },
          owner,
        );

        expect(forget).not.toHaveBeenCalled();
      });

      test("a row without its queue or owner is left alone", async () => {
        const owner: any = newOwner();
        owner.projectId = PROJECT_ID;

        await ownerService.onCreateSuccess(
          {
            createBy: { data: owner, props: callerProps() },
            carryForward: null,
          },
          owner,
        );

        expect(forget).not.toHaveBeenCalled();
      });
    },
  );
});

/*
 * Rules are configuration: kept forever self-hosted and for three years on
 * the billed cloud, like every rule service. The hard-delete cron
 * (HardDelete:HardDeleteOlderItemsInDatabase) is not billing-gated - the
 * retention each service's constructor sets is all that keeps a self-hosted
 * install's rules from being purged by age.
 */
describe("queue rule CRUD services", () => {
  interface RuleRetention {
    hardDeleteItemByColumnName: string;
    hardDeleteItemsOlderThanDays: number;
  }

  interface ExpectedRetention {
    column: string;
    days: number;
  }

  const KEPT_FOREVER: ExpectedRetention = { column: "", days: 0 };
  const KEPT_THREE_YEARS: ExpectedRetention = {
    column: "createdAt",
    days: 3 * 365,
  };

  const RULE_SERVICE_MODULES: Array<string> = [
    "../../../Server/Services/MessageQueueLabelRuleService",
    "../../../Server/Services/MessageQueueOwnerRuleService",
  ];

  function retentionOf(service: RuleRetention): ExpectedRetention {
    return {
      column: service.hardDeleteItemByColumnName,
      days: service.hardDeleteItemsOlderThanDays,
    };
  }

  /*
   * The service a module exports when the process started with
   * BILLING_ENABLED as given (undefined: not set), loaded into a fresh
   * registry: the constructor reads the setting once, at import.
   */
  function loadWithBilling(
    modulePath: string,
    billingEnabled: string | undefined,
  ): RuleRetention {
    const previous: string | undefined = process.env["BILLING_ENABLED"];
    let service: RuleRetention | undefined = undefined;

    if (billingEnabled === undefined) {
      delete process.env["BILLING_ENABLED"];
    } else {
      process.env["BILLING_ENABLED"] = billingEnabled;
    }

    try {
      jest.isolateModules((): void => {
        service = jest.requireActual<{ default: RuleRetention }>(
          modulePath,
        ).default;
      });
    } finally {
      if (previous === undefined) {
        delete process.env["BILLING_ENABLED"];
      } else {
        process.env["BILLING_ENABLED"] = previous;
      }
    }

    if (!service) {
      throw new Error(`${modulePath} exported no service`);
    }

    return service;
  }

  test.each([
    ["MessageQueueLabelRuleService", MessageQueueLabelRuleService],
    ["MessageQueueOwnerRuleService", MessageQueueOwnerRuleService],
  ] as Array<[string, RuleRetention]>)(
    "the registered %s keeps rules as this run's billing mode says",
    (_name: string, service: RuleRetention) => {
      expect(retentionOf(service)).toEqual(
        IsBillingEnabled ? KEPT_THREE_YEARS : KEPT_FOREVER,
      );
    },
  );

  /*
   * The singletons above show only the mode this run started in, and CI
   * starts one. Loading each module afresh checks both branches in any run.
   */
  test.each([
    ["on", "true", KEPT_THREE_YEARS],
    ["off", "false", KEPT_FOREVER],
    ["not set", undefined, KEPT_FOREVER],
  ] as Array<[string, string | undefined, ExpectedRetention]>)(
    "with billing %s, both rule services keep rules accordingly",
    (
      _label: string,
      billingEnabled: string | undefined,
      expected: ExpectedRetention,
    ) => {
      for (const modulePath of RULE_SERVICE_MODULES) {
        expect({
          modulePath,
          ...retentionOf(loadWithBilling(modulePath, billingEnabled)),
        }).toEqual({ modulePath, ...expected });
      }
    },
  );
});
