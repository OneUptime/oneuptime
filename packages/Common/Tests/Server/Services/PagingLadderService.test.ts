import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import PagingLadderService, {
  PAGING_LADDER_ADMIN_WRITE_PERMISSIONS,
  PAGING_LADDER_METHOD_NOT_USABLE_MESSAGE,
  PAGING_LADDER_NOT_ALLOWED_MESSAGE,
  PagingLadderSaveResult,
} from "../../../Server/Services/PagingLadderService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserMattermostService from "../../../Server/Services/UserMattermostService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserNotificationRuleAdminService from "../../../Server/Services/UserNotificationRuleAdminService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import {
  PagingLadderCell,
  PagingLadderRule,
  getPagingLadderCells,
  normalizePagingLadderSteps,
  readPagingId,
  readPagingLadder,
} from "../../../Types/NotificationRule/PagingLadder";
import PushNotificationLevel from "../../../Types/NotificationRule/PushNotificationLevel";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Saving a ladder (#6820): the server plans the rows from what the database
 * holds and writes them as OneUptime, after asking the questions the rule
 * service's hooks ask one write at a time. These tests stand a database up
 * in memory - severities, rules and methods - and check what is written,
 * who may write it, and that an admin's change tells the member once.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const ANA: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000b1");

const CRITICAL: string = "20000000-0000-4000-8000-000000000001";
const MINOR: string = "20000000-0000-4000-8000-000000000002";
const ARCHIVED: string = "20000000-0000-4000-8000-000000000003";
const ALERT_HIGH: string = "20000000-0000-4000-8000-000000000004";

const ANA_EMAIL: string = "30000000-0000-4000-8000-000000000001";
const ANA_SMS: string = "30000000-0000-4000-8000-000000000002";
const ANA_CALL: string = "30000000-0000-4000-8000-000000000003";
const ANA_PUSH: string = "30000000-0000-4000-8000-000000000004";
const ANA_UNVERIFIED_SMS: string = "30000000-0000-4000-8000-000000000005";
const BOB_SMS: string = "30000000-0000-4000-8000-0000000000b2";

interface MethodRow {
  _id: string;
  userId: string;
  projectId: string;
  isVerified: boolean;
}

// The methods table by table: what each findBy answers.
let methodRows: Record<string, Array<MethodRow>> = {};

let rules: Array<UserNotificationRule> = [];
let severities: {
  incident: Array<IncidentSeverity>;
  alert: Array<AlertSeverity>;
};

let createSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
let deleteSpy: jest.SpyInstance;
let auditSpy: jest.SpyInstance;
let memberSpy: jest.SpyInstance;
let ownershipSpy: jest.SpyInstance;

let createdCounter: number = 0;

const incidentSeverity: (
  id: string,
  name: string,
  isArchived?: boolean,
) => IncidentSeverity = (
  id: string,
  name: string,
  isArchived?: boolean,
): IncidentSeverity => {
  const severity: IncidentSeverity = new IncidentSeverity(new ObjectID(id));
  severity.name = name;
  severity.isArchived = Boolean(isArchived);
  return severity;
};

const alertSeverity: (id: string, name: string) => AlertSeverity = (
  id: string,
  name: string,
): AlertSeverity => {
  const severity: AlertSeverity = new AlertSeverity(new ObjectID(id));
  severity.name = name;
  severity.isArchived = false;
  return severity;
};

const cells: () => Array<PagingLadderCell> = (): Array<PagingLadderCell> => {
  return getPagingLadderCells({
    incidentSeverities: severities.incident,
    alertSeverities: severities.alert,
  });
};

let ruleCounter: number = 0;

const rule: (data: {
  cell: PagingLadderCell;
  userId?: ObjectID;
  column: string;
  methodId: string;
  wait?: number;
}) => UserNotificationRule = (data: {
  cell: PagingLadderCell;
  userId?: ObjectID;
  column: string;
  methodId: string;
  wait?: number;
}): UserNotificationRule => {
  ruleCounter++;
  const row: UserNotificationRule = new UserNotificationRule(
    new ObjectID(
      `40000000-0000-4000-8000-${String(ruleCounter).padStart(12, "0")}`,
    ),
  );
  row.projectId = PROJECT;
  row.userId = data.userId || ANA;
  row.ruleType = data.cell.ruleType;
  row.setColumnValue(
    data.cell.severityColumn,
    new ObjectID(data.cell.severityId),
  );
  row.setColumnValue(data.column, new ObjectID(data.methodId));
  row.notifyAfterMinutes = data.wait ?? 0;
  row.isOptOut = false;
  row.pushNotificationLevel = PushNotificationLevel.Critical;
  row.repeatEveryMinutes = 0;
  return row;
};

// Ana's defaults: email, SMS and call, at once, in every live card.
const anasDefaults: () => Array<UserNotificationRule> =
  (): Array<UserNotificationRule> => {
    const rows: Array<UserNotificationRule> = [];

    for (const cell of cells()) {
      if (cell.isArchived) {
        continue;
      }

      rows.push(
        rule({ cell: cell, column: "userEmailId", methodId: ANA_EMAIL }),
      );
      rows.push(rule({ cell: cell, column: "userSmsId", methodId: ANA_SMS }));
      rows.push(rule({ cell: cell, column: "userCallId", methodId: ANA_CALL }));
    }

    return rows;
  };

const queryMatches: (
  row: Record<string, unknown>,
  query: Record<string, unknown>,
) => boolean = (
  row: Record<string, unknown>,
  query: Record<string, unknown>,
): boolean => {
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "boolean") {
      if (row[key] !== value) {
        return false;
      }

      continue;
    }

    if (readPagingId(row[key]) !== readPagingId(value)) {
      return false;
    }
  }

  return true;
};

const mockMethodTable: (service: { findBy: unknown }, table: string) => void = (
  service: { findBy: unknown },
  table: string,
): void => {
  jest
    .spyOn(service as { findBy: () => Promise<unknown> }, "findBy")
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }): Promise<Array<{ id: ObjectID }>> => {
      return (methodRows[table] || [])
        .filter((row: MethodRow): boolean => {
          return queryMatches(
            row as unknown as Record<string, unknown>,
            findBy.query,
          );
        })
        .map((row: MethodRow): { id: ObjectID } => {
          return { id: new ObjectID(row._id) };
        });
    }) as never);
};

const anaProps: DatabaseCommonInteractionProps = {
  userId: ANA,
  tenantId: PROJECT,
};

// Bob, holding a permission: a member's own rules are his to change only with one.
const bobProps: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: BOB,
    tenantId: PROJECT,
    userTenantAccessPermission: {
      [PROJECT.toString()]: {
        projectId: PROJECT,
        permissions: permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
        isBlockPermission: false,
      } as unknown as UserTenantAccessPermission,
    },
  };
};

const save: (data: {
  steps: unknown;
  target?: ObjectID;
  props?: DatabaseCommonInteractionProps;
}) => Promise<PagingLadderSaveResult> = (data: {
  steps: unknown;
  target?: ObjectID;
  props?: DatabaseCommonInteractionProps;
}): Promise<PagingLadderSaveResult> => {
  return PagingLadderService.applyLadder({
    projectId: PROJECT,
    targetUserId: data.target || ANA,
    steps: data.steps,
    props: data.props || anaProps,
  });
};

const createdRules: () => Array<UserNotificationRule> =
  (): Array<UserNotificationRule> => {
    return createSpy.mock.calls.map(
      (call: Array<unknown>): UserNotificationRule => {
        return (call[0] as CreateBy<UserNotificationRule>).data;
      },
    );
  };

// The rules as they stand after the writes the service made.
const rulesAfterSave: () => Array<PagingLadderRule> =
  (): Array<PagingLadderRule> => {
    const deleted: Set<string> = new Set<string>(
      deleteSpy.mock.calls.map((call: Array<unknown>): string => {
        return readPagingId((call[0] as { id: ObjectID }).id);
      }),
    );

    const after: Array<PagingLadderRule> = rules
      .filter((row: UserNotificationRule): boolean => {
        return !deleted.has(readPagingId(row.id));
      })
      .map((row: UserNotificationRule): PagingLadderRule => {
        const update: { data: Record<string, unknown> } | undefined =
          updateSpy.mock.calls
            .map((call: Array<unknown>) => {
              return call[0] as { id: ObjectID; data: Record<string, unknown> };
            })
            .find((call: { id: ObjectID }) => {
              return readPagingId(call.id) === readPagingId(row.id);
            });

        return {
          ...(row as unknown as PagingLadderRule),
          _id: readPagingId(row.id),
          ruleType: row.ruleType,
          incidentSeverityId: row.incidentSeverityId,
          alertSeverityId: row.alertSeverityId,
          userEmailId: row.userEmailId,
          userSmsId: row.userSmsId,
          userCallId: row.userCallId,
          userPushId: row.userPushId,
          notifyAfterMinutes: row.notifyAfterMinutes,
          isOptOut: row.isOptOut,
          pushNotificationLevel: row.pushNotificationLevel,
          repeatEveryMinutes: row.repeatEveryMinutes,
          ...(update ? update.data : {}),
        } as PagingLadderRule;
      });

    for (const created of createdRules()) {
      after.push({
        _id: `created-${after.length}`,
        ruleType: created.ruleType,
        incidentSeverityId: created.incidentSeverityId,
        alertSeverityId: created.alertSeverityId,
        userEmailId: created.userEmailId,
        userSmsId: created.userSmsId,
        userCallId: created.userCallId,
        userPushId: created.userPushId,
        notifyAfterMinutes: created.notifyAfterMinutes,
        pushNotificationLevel: created.pushNotificationLevel || "Critical",
        repeatEveryMinutes: created.repeatEveryMinutes,
      } as PagingLadderRule);
    }

    return after;
  };

const PUSH_SMS_CALL: Array<Record<string, unknown>> = [
  { methodColumn: "userPushId", methodId: ANA_PUSH, notifyAfterMinutes: 0 },
  { methodColumn: "userSmsId", methodId: ANA_SMS, notifyAfterMinutes: 0 },
  { methodColumn: "userCallId", methodId: ANA_CALL, notifyAfterMinutes: 5 },
];

beforeEach(() => {
  jest.restoreAllMocks();
  createdCounter = 0;
  ruleCounter = 0;

  severities = {
    incident: [
      incidentSeverity(CRITICAL, "Critical Incident"),
      incidentSeverity(MINOR, "Minor Incident"),
      incidentSeverity(ARCHIVED, "[DONOTUSE] Sev 4", true),
    ],
    alert: [alertSeverity(ALERT_HIGH, "High")],
  };

  methodRows = {
    email: [
      {
        _id: ANA_EMAIL,
        userId: ANA.toString(),
        projectId: PROJECT.toString(),
        isVerified: true,
      },
    ],
    sms: [
      {
        _id: ANA_SMS,
        userId: ANA.toString(),
        projectId: PROJECT.toString(),
        isVerified: true,
      },
      {
        _id: ANA_UNVERIFIED_SMS,
        userId: ANA.toString(),
        projectId: PROJECT.toString(),
        isVerified: false,
      },
      {
        _id: BOB_SMS,
        userId: BOB.toString(),
        projectId: PROJECT.toString(),
        isVerified: true,
      },
    ],
    call: [
      {
        _id: ANA_CALL,
        userId: ANA.toString(),
        projectId: PROJECT.toString(),
        isVerified: true,
      },
    ],
    push: [
      {
        _id: ANA_PUSH,
        userId: ANA.toString(),
        projectId: PROJECT.toString(),
        isVerified: true,
      },
    ],
  };

  rules = anasDefaults();

  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockImplementation((async () => {
      return severities.incident;
    }) as never);
  jest.spyOn(AlertSeverityService, "findBy").mockImplementation((async () => {
    return severities.alert;
  }) as never);

  jest
    .spyOn(UserNotificationRuleService, "findBy")
    .mockImplementation((async (findBy: { query: Record<string, unknown> }) => {
      return rules.filter((row: UserNotificationRule): boolean => {
        return (
          readPagingId(row.userId) === readPagingId(findBy.query["userId"]) &&
          readPagingId(row.projectId) ===
            readPagingId(findBy.query["projectId"]) &&
          row.ruleType === findBy.query["ruleType"]
        );
      });
    }) as never);

  mockMethodTable(UserEmailService, "email");
  mockMethodTable(UserSmsService, "sms");
  mockMethodTable(UserCallService, "call");
  mockMethodTable(UserPushService, "push");
  mockMethodTable(UserWhatsAppService, "whatsapp");
  mockMethodTable(UserTelegramService, "telegram");
  mockMethodTable(UserSlackService, "slack");
  mockMethodTable(UserMicrosoftTeamsService, "teams");
  mockMethodTable(UserMattermostService, "mattermost");
  mockMethodTable(UserWebhookService, "webhook");

  createSpy = jest
    .spyOn(UserNotificationRuleService, "create")
    .mockImplementation((async (createBy: CreateBy<UserNotificationRule>) => {
      createdCounter++;
      const created: UserNotificationRule = createBy.data;
      created.id = new ObjectID(
        `50000000-0000-4000-8000-${String(createdCounter).padStart(12, "0")}`,
      );
      return created;
    }) as never);
  updateSpy = jest
    .spyOn(UserNotificationRuleService, "updateOneById")
    .mockResolvedValue(undefined as never);
  deleteSpy = jest
    .spyOn(UserNotificationRuleService, "deleteOneById")
    .mockResolvedValue(1 as never);

  auditSpy = jest
    .spyOn(UserNotificationRuleAdminService, "recordAdminRuleChange")
    .mockResolvedValue(undefined as never);
  memberSpy = jest
    .spyOn(UserNotificationRuleAdminService, "assertTargetUserIsProjectMember")
    .mockResolvedValue(undefined as never);
  ownershipSpy = jest
    .spyOn(
      UserNotificationRuleAdminService,
      "assertNotificationMethodsBelongToUser",
    )
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("saving your own ladder", () => {
  test("push, then SMS, then a call after five minutes: the rows are the grid edited by hand", async () => {
    const result: PagingLadderSaveResult = await save({ steps: PUSH_SMS_CALL });

    // Three live incident cards and one alert card, twice (incidents and episodes): six.
    expect(result).toEqual({
      createdCount: 6,
      updatedCount: 6,
      deletedCount: 6,
      unchangedCount: 6,
    });

    const reading: ReturnType<typeof readPagingLadder> = readPagingLadder({
      cells: cells(),
      rules: rulesAfterSave(),
    });

    expect(reading.isOneLadder).toBe(true);
    expect(reading.steps).toEqual(
      normalizePagingLadderSteps(
        PUSH_SMS_CALL.map((value: Record<string, unknown>) => {
          return value as never;
        }),
      ),
    );
  });

  test("new rows are written before old ones go, and every write is OneUptime's", async () => {
    const order: Array<string> = [];

    createSpy.mockImplementation((async (
      createBy: CreateBy<UserNotificationRule>,
    ) => {
      order.push("create");
      return createBy.data;
    }) as never);
    updateSpy.mockImplementation((async () => {
      order.push("update");
    }) as never);
    deleteSpy.mockImplementation((async () => {
      order.push("delete");
      return 1;
    }) as never);

    await save({ steps: PUSH_SMS_CALL });

    expect(order.indexOf("delete")).toBeGreaterThan(
      order.lastIndexOf("create"),
    );
    expect(order.indexOf("delete")).toBeGreaterThan(
      order.lastIndexOf("update"),
    );

    for (const spy of [createSpy, updateSpy, deleteSpy]) {
      for (const call of spy.mock.calls) {
        expect(
          (call[0] as { props: DatabaseCommonInteractionProps }).props,
        ).toEqual({
          isRoot: true,
        });
      }
    }
  });

  test("each created rule is Ana's, in this project, of its card, by its step, made by her", async () => {
    await save({ steps: PUSH_SMS_CALL });

    const created: Array<UserNotificationRule> = createdRules();

    expect(created).toHaveLength(6);

    for (const row of created) {
      expect(row.projectId?.toString()).toBe(PROJECT.toString());
      expect(row.userId?.toString()).toBe(ANA.toString());
      expect(row.createdByUserId?.toString()).toBe(ANA.toString());
      expect(row.userPushId?.toString()).toBe(ANA_PUSH);
      expect(row.notifyAfterMinutes).toBe(0);
      expect(row.pushNotificationLevel).toBe(PushNotificationLevel.Critical);
      expect(row.repeatEveryMinutes).toBe(0);
    }

    expect(
      created.map((row: UserNotificationRule): string => {
        return `${row.ruleType}:${readPagingId(row.incidentSeverityId || row.alertSeverityId)}`;
      }),
    ).toEqual([
      `${NotificationRuleType.ON_CALL_EXECUTED_INCIDENT}:${CRITICAL}`,
      `${NotificationRuleType.ON_CALL_EXECUTED_INCIDENT}:${MINOR}`,
      `${NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE}:${CRITICAL}`,
      `${NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE}:${MINOR}`,
      `${NotificationRuleType.ON_CALL_EXECUTED_ALERT}:${ALERT_HIGH}`,
      `${NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE}:${ALERT_HIGH}`,
    ]);
  });

  test("the call rows are changed in place to wait five minutes; only the wait is sent", async () => {
    await save({ steps: PUSH_SMS_CALL });

    const callRowIds: Array<string> = rules
      .filter((row: UserNotificationRule): boolean => {
        return Boolean(row.userCallId);
      })
      .map((row: UserNotificationRule): string => {
        return readPagingId(row.id);
      });

    expect(
      updateSpy.mock.calls.map((call: Array<unknown>) => {
        const update: { id: ObjectID; data: unknown } = call[0] as {
          id: ObjectID;
          data: unknown;
        };
        return [readPagingId(update.id), update.data];
      }),
    ).toEqual(
      callRowIds.map((id: string) => {
        return [id, { notifyAfterMinutes: 5 }];
      }),
    );
  });

  test("the archived severity is never written", async () => {
    await save({ steps: PUSH_SMS_CALL });

    for (const row of createdRules()) {
      expect(readPagingId(row.incidentSeverityId)).not.toBe(ARCHIVED);
    }
  });

  test("saving the same ladder twice writes nothing the second time", async () => {
    rules = anasDefaults();

    const result: PagingLadderSaveResult = await save({
      steps: [
        {
          methodColumn: "userEmailId",
          methodId: ANA_EMAIL,
          notifyAfterMinutes: 0,
        },
        { methodColumn: "userSmsId", methodId: ANA_SMS, notifyAfterMinutes: 0 },
        {
          methodColumn: "userCallId",
          methodId: ANA_CALL,
          notifyAfterMinutes: 0,
        },
      ],
    });

    expect(result).toEqual({
      createdCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      unchangedCount: 18,
    });
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  test("your own change is not an administrative one: no audit entry, no email", async () => {
    await save({ steps: PUSH_SMS_CALL });

    expect(auditSpy).not.toHaveBeenCalled();
    expect(memberSpy).not.toHaveBeenCalled();
  });

  test("every method is checked as the rule service checks it (R3)", async () => {
    await save({ steps: PUSH_SMS_CALL });

    expect(ownershipSpy).toHaveBeenCalledTimes(1);
    const call: {
      ownerUserId: ObjectID;
      references: Array<{ idColumn: string; methodId: ObjectID }>;
    } = ownershipSpy.mock.calls[0]![0] as never;

    expect(call.ownerUserId.toString()).toBe(ANA.toString());
    expect(
      call.references.map(
        (reference: { idColumn: string; methodId: ObjectID }) => {
          return `${reference.idColumn}:${reference.methodId.toString()}`;
        },
      ),
    ).toEqual([
      `userPushId:${ANA_PUSH}`,
      `userSmsId:${ANA_SMS}`,
      `userCallId:${ANA_CALL}`,
    ]);
  });
});

describe("what a ladder may name", () => {
  test("an unverified method is refused, and nothing is written", async () => {
    await expect(
      save({
        steps: [
          {
            methodColumn: "userSmsId",
            methodId: ANA_UNVERIFIED_SMS,
            notifyAfterMinutes: 0,
          },
        ],
      }),
    ).rejects.toThrow(
      new BadDataException(PAGING_LADDER_METHOD_NOT_USABLE_MESSAGE),
    );

    expect(createSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  test("somebody else's method is refused: a ladder cannot copy Ana's pages to Bob's phone", async () => {
    await expect(
      save({
        steps: [
          {
            methodColumn: "userSmsId",
            methodId: BOB_SMS,
            notifyAfterMinutes: 0,
          },
        ],
      }),
    ).rejects.toThrow(PAGING_LADDER_METHOD_NOT_USABLE_MESSAGE);

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a method of another project is refused", async () => {
    methodRows["sms"]!.push({
      _id: "30000000-0000-4000-8000-0000000000f1",
      userId: ANA.toString(),
      projectId: "10000000-0000-4000-8000-0000000000ff",
      isVerified: true,
    });

    await expect(
      save({
        steps: [
          {
            methodColumn: "userSmsId",
            methodId: "30000000-0000-4000-8000-0000000000f1",
            notifyAfterMinutes: 0,
          },
        ],
      }),
    ).rejects.toThrow(PAGING_LADDER_METHOD_NOT_USABLE_MESSAGE);
  });

  test("a webhook needs no verification", async () => {
    methodRows["webhook"] = [
      {
        _id: "30000000-0000-4000-8000-0000000000c1",
        userId: ANA.toString(),
        projectId: PROJECT.toString(),
        isVerified: false,
      },
    ];

    await expect(
      save({
        steps: [
          {
            methodColumn: "userWebhookId",
            methodId: "30000000-0000-4000-8000-0000000000c1",
            notifyAfterMinutes: 0,
          },
        ],
      }),
    ).resolves.toBeDefined();
  });

  test("a custom channel is the rule service's to allow (it is nobody's)", async () => {
    ownershipSpy.mockRejectedValue(
      new BadDataException("This custom channel is turned off."),
    );

    await expect(
      save({
        steps: [
          {
            methodColumn: "customNotificationChannelId",
            methodId: "30000000-0000-4000-8000-0000000000d1",
            notifyAfterMinutes: 0,
          },
        ],
      }),
    ).rejects.toThrow("This custom channel is turned off.");

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("an empty ladder is refused before anything is read", async () => {
    await expect(save({ steps: [] })).rejects.toThrow(
      "A ladder needs at least one step.",
    );
    await expect(save({ steps: undefined })).rejects.toThrow(
      "A ladder needs at least one step.",
    );
    await expect(save({ steps: "push" })).rejects.toThrow(
      "A ladder needs at least one step.",
    );

    expect(UserNotificationRuleService.findBy).not.toHaveBeenCalled();
  });

  test("a step with a bad wait is refused", async () => {
    await expect(
      save({
        steps: [
          {
            methodColumn: "userSmsId",
            methodId: ANA_SMS,
            notifyAfterMinutes: -5,
          },
        ],
      }),
    ).rejects.toThrow("from 0 to 1440");
  });
});

describe("who may change whose ladder", () => {
  test("a member may not change another member's ladder", async () => {
    await expect(
      save({ steps: PUSH_SMS_CALL, target: ANA, props: bobProps([]) }),
    ).rejects.toThrow(
      new NotAuthorizedException(PAGING_LADDER_NOT_ALLOWED_MESSAGE),
    );

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a member holding only Read may not either", async () => {
    await expect(
      save({
        steps: PUSH_SMS_CALL,
        target: ANA,
        props: bobProps([Permission.ReadProjectUserNotificationRule]),
      }),
    ).rejects.toThrow(PAGING_LADDER_NOT_ALLOWED_MESSAGE);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditProjectUserNotificationRule,
  ])(
    "someone holding %s may, for a member of the project",
    async (permission: Permission) => {
      await save({
        steps: PUSH_SMS_CALL,
        target: ANA,
        props: bobProps([permission]),
      });

      expect(memberSpy).toHaveBeenCalledTimes(1);
      expect(
        (
          memberSpy.mock.calls[0]![0] as { targetUserId: ObjectID }
        ).targetUserId.toString(),
      ).toBe(ANA.toString());
      expect(createSpy).toHaveBeenCalled();
    },
  );

  test("not for somebody who is not a member of the project (R1)", async () => {
    memberSpy.mockRejectedValue(new BadDataException("not a member"));

    await expect(
      save({
        steps: PUSH_SMS_CALL,
        target: ANA,
        props: bobProps([Permission.ProjectAdmin]),
      }),
    ).rejects.toThrow("not a member");

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("the methods checked are the member's, never the admin's", async () => {
    await expect(
      save({
        steps: [
          {
            methodColumn: "userSmsId",
            methodId: BOB_SMS,
            notifyAfterMinutes: 0,
          },
        ],
        target: ANA,
        props: bobProps([Permission.ProjectAdmin]),
      }),
    ).rejects.toThrow(PAGING_LADDER_METHOD_NOT_USABLE_MESSAGE);
  });

  test("the admin's change is audited per row, and Ana is told once", async () => {
    await save({
      steps: PUSH_SMS_CALL,
      target: ANA,
      props: bobProps([Permission.ProjectAdmin]),
    });

    // Six created, six changed, six deleted.
    expect(auditSpy).toHaveBeenCalledTimes(18);

    const calls: Array<{
      action: AuditLogAction;
      actorUserId: ObjectID;
      ownerUserId: ObjectID;
      notifyOwner: boolean;
    }> = auditSpy.mock.calls.map((call: Array<unknown>) => {
      return call[0] as never;
    });

    expect(
      calls.filter((call: { notifyOwner: boolean }): boolean => {
        return call.notifyOwner;
      }),
    ).toHaveLength(1);

    for (const call of calls) {
      expect(call.actorUserId.toString()).toBe(BOB.toString());
      expect(call.ownerUserId.toString()).toBe(ANA.toString());
    }

    expect(
      calls.map((call: { action: AuditLogAction }): AuditLogAction => {
        return call.action;
      }),
    ).toEqual([
      ...Array(6).fill(AuditLogAction.Create),
      ...Array(6).fill(AuditLogAction.Update),
      ...Array(6).fill(AuditLogAction.Delete),
    ]);
  });

  test("a master admin may", async () => {
    await save({
      steps: PUSH_SMS_CALL,
      target: ANA,
      props: { userId: BOB, tenantId: PROJECT, isMasterAdmin: true },
    });

    expect(createSpy).toHaveBeenCalled();
  });

  test("the permissions match the rule model's own write list", () => {
    const model: UserNotificationRule = new UserNotificationRule();

    for (const list of [
      model.getCreatePermissions(),
      model.getUpdatePermissions(),
      model.getDeletePermissions(),
    ]) {
      expect(
        list.filter((permission: Permission): boolean => {
          return permission !== Permission.CurrentUser;
        }),
      ).toEqual([...PAGING_LADDER_ADMIN_WRITE_PERMISSIONS]);
    }
  });
});

describe("the refusals say what to do next", () => {
  test.each([
    PAGING_LADDER_NOT_ALLOWED_MESSAGE,
    PAGING_LADDER_METHOD_NOT_USABLE_MESSAGE,
  ])("%s", (message: string) => {
    expect(message).toMatch(/^[A-Z].*\.$/);
  });
});
