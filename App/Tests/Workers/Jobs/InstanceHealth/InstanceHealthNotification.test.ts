import InstanceHealthLog, {
  InstanceHealthLogEventType,
  InstanceHealthLogStatus,
} from "Common/Models/DatabaseModels/InstanceHealthLog";
import User from "Common/Models/DatabaseModels/User";
import InstanceHealthLogService from "Common/Server/Services/InstanceHealthLogService";
import MailService from "Common/Server/Services/MailService";
import UserService from "Common/Server/Services/UserService";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

import {
  bytesToReadable,
  evaluateInstanceHealthNotification,
  InstanceHealthCheckResult,
  mergeMetadata,
  notApplicable,
  RETRY_COOLDOWN_IN_MINUTES,
} from "../../../../FeatureSet/Workers/Jobs/InstanceHealth/InstanceHealthNotification";

const now: Date = new Date("2026-08-03T12:00:00.000Z");
const later: Date = new Date("2026-08-03T13:00:00.000Z");

const EVENT_TYPE: InstanceHealthLogEventType =
  InstanceHealthLogEventType.RedisMemoryNotification;

function makeCheck(
  isBreaching: boolean,
  overrides: Partial<InstanceHealthCheckResult> = {},
): InstanceHealthCheckResult {
  return {
    isBreaching,
    isCritical: false,
    subject: "ACTION REQUIRED: Redis memory is 85.00% full",
    badgeText: "Memory Warning",
    details: [
      { title: "Memory Used: ", text: "85.00% of maxmemory" },
      { title: "Notification Threshold: ", text: "80%" },
    ],
    remediation: "Raise maxmemory.",
    breachMessage: "Redis memory reached 85.00%.",
    resolvedMessage: "Redis memory returned to 50.00%.",
    observedPercent: 85,
    thresholdPercent: 80,
    metadata: { snapshot: { usedMemoryInBytes: 85 } },
    ...overrides,
  };
}

function makeLog(data: {
  status: InstanceHealthLogStatus;
  nextCheckAt?: Date | undefined;
}): InstanceHealthLog {
  const log: InstanceHealthLog = new InstanceHealthLog();
  log.id = new ObjectID("health-log");
  log.eventType = EVENT_TYPE;
  log.status = data.status;
  if (data.nextCheckAt) {
    log.nextCheckAt = data.nextCheckAt;
  }
  return log;
}

function makeAdmin(id: string, email: string): User {
  const admin: User = new User();
  admin.id = new ObjectID(id);
  admin.email = new Email(email);
  return admin;
}

function evaluate(data: {
  isEnabled: boolean;
  latestLog: InstanceHealthLog | null;
  check: InstanceHealthCheckResult | null;
}): Promise<void> {
  return evaluateInstanceHealthNotification({
    eventType: EVENT_TYPE,
    templateType: EmailTemplateType.RedisHealthWarning,
    healthRoute: "/health/redis",
    healthPageButtonText: "View Redis Health",
    ...data,
  });
}

describe("InstanceHealthNotification", () => {
  let createSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;
  let userSpy: jest.SpyInstance;
  let mailSpy: jest.SpyInstance;
  let getSomeMinutesAfterSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);
    getSomeMinutesAfterSpy = jest
      .spyOn(OneUptimeDate, "getSomeMinutesAfter")
      .mockReturnValue(later);

    createSpy = jest
      .spyOn(InstanceHealthLogService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<InstanceHealthLog>,
        ): Promise<InstanceHealthLog> => {
          createBy.data.id = new ObjectID("created-log");
          return createBy.data;
        },
      );
    updateSpy = jest
      .spyOn(InstanceHealthLogService, "updateOneById")
      .mockResolvedValue(undefined as never);
    userSpy = jest
      .spyOn(UserService, "findBy")
      .mockResolvedValue([makeAdmin("admin-1", "admin@example.com")] as never);
    mailSpy = jest.spyOn(MailService, "sendMail").mockResolvedValue({
      isSuccess: (): boolean => {
        return true;
      },
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("breach detection", () => {
    test("persists a pending log before emailing, then marks it active", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: null,
        check: makeCheck(true),
      });

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy.mock.calls[0]?.[0].data.status).toBe(
        InstanceHealthLogStatus.Running,
      );
      expect(createSpy.mock.calls[0]?.[0].data.eventType).toBe(EVENT_TYPE);
      expect(createSpy.mock.calls[0]?.[0].data.capacityBeforePercent).toBe(85);
      expect(createSpy.mock.calls[0]?.[0].data.thresholdPercent).toBe(80);

      // The durable row must exist before any mail leaves the process.
      expect(createSpy.mock.invocationCallOrder[0]).toBeLessThan(
        mailSpy.mock.invocationCallOrder[0]!,
      );

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy.mock.calls[0]?.[0].data.status).toBe(
        InstanceHealthLogStatus.NotificationActive,
      );
      expect(updateSpy.mock.calls[0]?.[0].data.completedAt).toBeNull();
      expect(updateSpy.mock.calls[0]?.[0].data.nextCheckAt).toBeNull();
      expect(updateSpy.mock.calls[0]?.[0].data.message).toContain(
        "1 succeeded, 0 failed",
      );
    });

    test("emails every eligible master admin with the check's detail rows", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: null,
        check: makeCheck(true),
      });

      expect(userSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            isMasterAdmin: true,
            isDisabled: false,
            isBlocked: false,
          },
          select: {
            _id: true,
            email: true,
          },
        }),
      );
      expect(mailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          templateType: EmailTemplateType.RedisHealthWarning,
          subject: "ACTION REQUIRED: Redis memory is 85.00% full",
          vars: expect.objectContaining({
            badgeType: "warning",
            badgeText: "Memory Warning",
            detail1Title: "Memory Used: ",
            detail1Text: "85.00% of maxmemory",
            detail2Title: "Notification Threshold: ",
            detail2Text: "80%",
            healthPageButtonText: "View Redis Health",
            remediation: "Raise maxmemory.",
          }),
        }),
        expect.objectContaining({
          userId: new ObjectID("admin-1"),
        }),
      );
    });

    test("marks a critical check with the critical badge type", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: null,
        check: makeCheck(true, { isCritical: true }),
      });

      expect(mailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          vars: expect.objectContaining({ badgeType: "critical" }),
        }),
        expect.anything(),
      );
    });

    test("caps email detail rows at six but keeps the rest in metadata", async () => {
      const details: Array<{ title: string; text: string }> = Array.from(
        { length: 9 },
        (_value: unknown, index: number) => {
          return { title: `t${index}`, text: `v${index}` };
        },
      );

      await evaluate({
        isEnabled: true,
        latestLog: null,
        check: makeCheck(true, { details }),
      });

      const vars: Record<string, string> = mailSpy.mock.calls[0]?.[0].vars;
      expect(vars["detail6Title"]).toBe("t5");
      expect(vars["detail7Title"]).toBeUndefined();
    });

    test("skips master admins that have no email address", async () => {
      const withoutEmail: User = new User();
      withoutEmail.id = new ObjectID("admin-2");

      userSpy.mockResolvedValue([
        makeAdmin("admin-1", "admin@example.com"),
        withoutEmail,
      ] as never);

      await evaluate({
        isEnabled: true,
        latestLog: null,
        check: makeCheck(true),
      });

      expect(mailSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy.mock.calls[0]?.[0].data.message).toContain(
        "1 succeeded, 0 failed",
      );
    });

    test("keeps paginating master admins while a full page is returned", async () => {
      const fullPage: Array<User> = Array.from(
        { length: LIMIT_MAX },
        (_value: unknown, index: number) => {
          return makeAdmin(`admin-${index}`, `admin${index}@example.com`);
        },
      );

      userSpy
        .mockResolvedValueOnce(fullPage as never)
        .mockResolvedValueOnce([
          makeAdmin("admin-last", "last@example.com"),
        ] as never);

      await evaluate({
        isEnabled: true,
        latestLog: null,
        check: makeCheck(true),
      });

      expect(userSpy).toHaveBeenCalledTimes(2);
      expect(userSpy.mock.calls[1]?.[0].skip).toBe(LIMIT_MAX);
      expect(mailSpy).toHaveBeenCalledTimes(LIMIT_MAX + 1);
    });
  });

  describe("delivery failure", () => {
    test("marks the log failed with a retry cooldown when no email lands", async () => {
      mailSpy.mockResolvedValue({
        isSuccess: (): boolean => {
          return false;
        },
      } as never);

      await evaluate({
        isEnabled: true,
        latestLog: null,
        check: makeCheck(true),
      });

      expect(updateSpy.mock.calls[0]?.[0].data.status).toBe(
        InstanceHealthLogStatus.Failed,
      );
      expect(updateSpy.mock.calls[0]?.[0].data.nextCheckAt).toEqual(later);
      expect(updateSpy.mock.calls[0]?.[0].data.message).toContain(
        "No notification email was delivered",
      );
      expect(getSomeMinutesAfterSpy).toHaveBeenLastCalledWith(
        RETRY_COOLDOWN_IN_MINUTES,
      );
    });

    test("stays active when at least one of several emails succeeds", async () => {
      userSpy.mockResolvedValue([
        makeAdmin("admin-1", "one@example.com"),
        makeAdmin("admin-2", "two@example.com"),
      ] as never);
      mailSpy
        .mockResolvedValueOnce({
          isSuccess: (): boolean => {
            return false;
          },
        } as never)
        .mockResolvedValueOnce({
          isSuccess: (): boolean => {
            return true;
          },
        } as never);

      await evaluate({
        isEnabled: true,
        latestLog: null,
        check: makeCheck(true),
      });

      expect(updateSpy.mock.calls[0]?.[0].data.status).toBe(
        InstanceHealthLogStatus.NotificationActive,
      );
      expect(updateSpy.mock.calls[0]?.[0].data.message).toContain(
        "1 succeeded, 1 failed",
      );
    });

    test("counts a throwing send as failed rather than aborting the batch", async () => {
      userSpy.mockResolvedValue([
        makeAdmin("admin-1", "one@example.com"),
        makeAdmin("admin-2", "two@example.com"),
      ] as never);
      mailSpy
        .mockRejectedValueOnce(new Error("smtp refused"))
        .mockResolvedValueOnce({
          isSuccess: (): boolean => {
            return true;
          },
        } as never);

      await evaluate({
        isEnabled: true,
        latestLog: null,
        check: makeCheck(true),
      });

      expect(mailSpy).toHaveBeenCalledTimes(2);
      expect(updateSpy.mock.calls[0]?.[0].data.status).toBe(
        InstanceHealthLogStatus.NotificationActive,
      );
    });

    /*
     * The send already happened; only the record of it failed. Marking that as a
     * delivery failure would schedule a retry and mail every master admin a
     * second time an hour later over a database hiccup.
     */
    test("keeps a confirmed send active when only the bookkeeping fails", async () => {
      updateSpy
        .mockRejectedValueOnce(new Error("statement timeout"))
        .mockResolvedValue(undefined as never);

      await expect(
        evaluate({ isEnabled: true, latestLog: null, check: makeCheck(true) }),
      ).rejects.toThrow("statement timeout");

      expect(mailSpy).toHaveBeenCalledTimes(1);

      const recovery: { data: InstanceHealthLog } =
        updateSpy.mock.calls[1]?.[0];
      expect(recovery.data.status).toBe(
        InstanceHealthLogStatus.NotificationActive,
      );
      // No cooldown, so the next tick does not re-send.
      expect(recovery.data.nextCheckAt).toBeNull();
      expect(recovery.data.message).toContain("1 succeeded, 0 failed");
      expect(recovery.data.message).toContain("statement timeout");
    });

    test("records the error and rethrows when looking up admins fails", async () => {
      userSpy.mockRejectedValue(new Error("postgres is down"));

      await expect(
        evaluate({ isEnabled: true, latestLog: null, check: makeCheck(true) }),
      ).rejects.toThrow("postgres is down");

      expect(updateSpy.mock.calls[0]?.[0].data.status).toBe(
        InstanceHealthLogStatus.Failed,
      );
      expect(updateSpy.mock.calls[0]?.[0].data.message).toContain(
        "postgres is down",
      );
      expect(
        updateSpy.mock.calls[0]?.[0].data.metadata?.[
          "notificationDeliveryError"
        ],
      ).toBe("postgres is down");
    });
  });

  describe("suppression and cooldown", () => {
    test("sends nothing while a notification is already active", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: makeLog({
          status: InstanceHealthLogStatus.NotificationActive,
        }),
        check: makeCheck(true),
      });

      expect(createSpy).not.toHaveBeenCalled();
      expect(mailSpy).not.toHaveBeenCalled();
    });

    test("holds off retrying a failed delivery until the cooldown expires", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: makeLog({
          status: InstanceHealthLogStatus.Failed,
          nextCheckAt: new Date("2026-08-03T12:30:00.000Z"),
        }),
        check: makeCheck(true),
      });

      expect(createSpy).not.toHaveBeenCalled();
      expect(mailSpy).not.toHaveBeenCalled();
    });

    test("retries delivery once the cooldown has passed", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: makeLog({
          status: InstanceHealthLogStatus.Failed,
          nextCheckAt: new Date("2026-08-03T11:30:00.000Z"),
        }),
        check: makeCheck(true),
      });

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(mailSpy).toHaveBeenCalledTimes(1);
    });

    test("retries a worker that died mid-delivery once its cooldown passes", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: makeLog({
          status: InstanceHealthLogStatus.Running,
          nextCheckAt: new Date("2026-08-03T11:30:00.000Z"),
        }),
        check: makeCheck(true),
      });

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(mailSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("recovery", () => {
    test("resolves an active notification once the condition clears", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: makeLog({
          status: InstanceHealthLogStatus.NotificationActive,
        }),
        check: makeCheck(false),
      });

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy.mock.calls[0]?.[0].data.status).toBe(
        InstanceHealthLogStatus.Resolved,
      );
      expect(createSpy.mock.calls[0]?.[0].data.message).toBe(
        "Redis memory returned to 50.00%.",
      );
      expect(createSpy.mock.calls[0]?.[0].data.capacityAfterPercent).toBe(85);
      expect(
        createSpy.mock.calls[0]?.[0].data.metadata?.["resolutionReason"],
      ).toBe("ConditionCleared");
      expect(mailSpy).not.toHaveBeenCalled();
    });

    test("resolves a failed delivery once the condition clears, ignoring the cooldown", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: makeLog({
          status: InstanceHealthLogStatus.Failed,
          nextCheckAt: new Date("2026-08-03T12:30:00.000Z"),
        }),
        check: makeCheck(false),
      });

      expect(createSpy.mock.calls[0]?.[0].data.status).toBe(
        InstanceHealthLogStatus.Resolved,
      );
    });

    test("writes nothing when the condition is clear and no notification is open", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: makeLog({ status: InstanceHealthLogStatus.Resolved }),
        check: makeCheck(false),
      });

      expect(createSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe("disabled checks", () => {
    test("closes an open notification when the check is turned off", async () => {
      await evaluate({
        isEnabled: false,
        latestLog: makeLog({
          status: InstanceHealthLogStatus.NotificationActive,
        }),
        check: null,
      });

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy.mock.calls[0]?.[0].data.status).toBe(
        InstanceHealthLogStatus.Resolved,
      );
      expect(
        createSpy.mock.calls[0]?.[0].data.metadata?.["resolutionReason"],
      ).toBe("NotificationsDisabled");
    });

    test("writes nothing when the check is off and nothing is open", async () => {
      await evaluate({
        isEnabled: false,
        latestLog: makeLog({ status: InstanceHealthLogStatus.Resolved }),
        check: null,
      });

      expect(createSpy).not.toHaveBeenCalled();
    });

    test("ignores a still-breaching check when the notification is disabled", async () => {
      await evaluate({
        isEnabled: false,
        latestLog: null,
        check: makeCheck(true),
      });

      expect(createSpy).not.toHaveBeenCalled();
      expect(mailSpy).not.toHaveBeenCalled();
    });
  });

  describe("unevaluatable checks", () => {
    /*
     * A null check means the datastore could not be probed. Treating that as
     * "not breaching" would resolve a live notification and then re-fire it, so
     * the state must be held instead.
     */
    test("holds an active notification when the check cannot be evaluated", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: makeLog({
          status: InstanceHealthLogStatus.NotificationActive,
        }),
        check: null,
      });

      expect(createSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(mailSpy).not.toHaveBeenCalled();
    });

    test("writes nothing when there is no prior state and no evaluation", async () => {
      await evaluate({ isEnabled: true, latestLog: null, check: null });

      expect(createSpy).not.toHaveBeenCalled();
      expect(mailSpy).not.toHaveBeenCalled();
    });
  });

  describe("checks that stop applying", () => {
    /*
     * NotificationActive has only two exits: the check being disabled, or a
     * non-null non-breaching check. A check whose precondition disappears
     * permanently — the admin clears a limit, the operator drops the resource
     * the alert named — must therefore take the second exit, not report itself
     * unevaluatable. If it held instead, nothing could ever move the stream
     * again and every future breach of that event type would be suppressed for
     * the life of the instance.
     */
    test("a no-longer-applicable check resolves an open notification", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: makeLog({
          status: InstanceHealthLogStatus.NotificationActive,
        }),
        check: notApplicable({
          subject: "PostgreSQL has no replication slots",
          resolvedMessage:
            "Resolved because this instance no longer has any replication slots.",
        }),
      });

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy.mock.calls[0]?.[0].data.status).toBe(
        InstanceHealthLogStatus.Resolved,
      );
      expect(
        createSpy.mock.calls[0]?.[0].data.metadata?.["resolutionDetail"],
      ).toBe("CheckNoLongerApplicable");
      expect(mailSpy).not.toHaveBeenCalled();
    });

    // Once resolved, a later real breach of the same event type must fire again.
    test("a later breach still notifies after the check became applicable again", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: makeLog({ status: InstanceHealthLogStatus.Resolved }),
        check: makeCheck(true),
      });

      expect(mailSpy).toHaveBeenCalledTimes(1);
      expect(createSpy.mock.calls[0]?.[0].data.status).toBe(
        InstanceHealthLogStatus.Running,
      );
    });

    test("writes nothing when nothing is open", async () => {
      await evaluate({
        isEnabled: true,
        latestLog: null,
        check: notApplicable({
          subject: "does not apply",
          resolvedMessage: "does not apply",
        }),
      });

      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe("helpers", () => {
    test("bytesToReadable scales and rounds by magnitude", () => {
      expect(bytesToReadable(0)).toBe("0 B");
      expect(bytesToReadable(-5)).toBe("0 B");
      expect(bytesToReadable(NaN)).toBe("0 B");
      expect(bytesToReadable(512)).toBe("512 B");
      expect(bytesToReadable(1024)).toBe("1.0 KB");
      expect(bytesToReadable(1024 * 1024 * 15)).toBe("15 MB");
      expect(bytesToReadable(1024 ** 4)).toBe("1.0 TB");
    });

    test("mergeMetadata keeps existing keys and lets additions win", () => {
      expect(mergeMetadata({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({
        a: 1,
        b: 3,
        c: 4,
      });
      expect(mergeMetadata(undefined, { a: 1 })).toEqual({ a: 1 });
    });
  });
});
