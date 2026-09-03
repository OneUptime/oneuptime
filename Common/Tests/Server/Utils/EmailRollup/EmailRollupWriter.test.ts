import MailService from "../../../../Server/Services/MailService";
import UserNotificationEmailRollupItemService from "../../../../Server/Services/UserNotificationEmailRollupItemService";
import EmailRollupWriter, {
  RollupMailOptions,
  SendOrRollupData,
} from "../../../../Server/Utils/EmailRollup/EmailRollupWriter";
import {
  BURST_THRESHOLD,
  BURST_WINDOW_MINUTES,
  ROLLUP_SUBJECT_MAX_LENGTH,
} from "../../../../Server/Utils/EmailRollup/EmailRollupConstants";
import logger from "../../../../Server/Utils/Logger";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import UserNotificationEmailRollupItem from "../../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import Dictionary from "../../../../Types/Dictionary";
import Email from "../../../../Types/Email";
import { EmailEnvelope } from "../../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../../Types/JSON";
import * as NotificationEmailRollupCategory from "../../../../Types/NotificationSetting/NotificationEmailRollupCategory";
import { NEVER_ROLLED_UP_EVENT_TYPES } from "../../../../Types/NotificationSetting/NotificationEmailRollupPolicy";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * EmailRollupWriter is the single place an owner notification email can be
 * held back on its way to MailService. What breaks in production if any of
 * the behaviour below regresses:
 *
 *   1. FAIL OPEN. Every database line in the writer sits inside one try/catch
 *      whose catch resets `deferred`. If that ever stops being true, a missing
 *      table, a statement timeout or a degraded Postgres stops being "the
 *      product behaves exactly as it did last month" and starts being silently
 *      dropped incident mail. This is the property the whole feature's safety
 *      argument rests on, so four separate failure shapes are pinned here.
 *
 *   2. THE ON-CALL BYPASS. NEVER_ROLLED_UP event types must reach MailService
 *      with no database work at all - not "usually", not "unless the counter
 *      says otherwise". A regression here delays a page.
 *
 *   3. THE PER-CATEGORY COUNTER. The burst counter is scoped to one
 *      RollupCategory. If it ever becomes global, a monitor that flaps every
 *      thirty seconds eats the free immediate sends the first "production is
 *      down" incident email needs, and the feature makes the exact problem it
 *      exists to fix worse.
 *
 *   4. BYTE-IDENTICAL BELOW THRESHOLD. Under the threshold MailService must
 *      receive the same envelope and the same correlation-id bag it received
 *      before this feature existed. Those ids are what join an email to its
 *      incident in every downstream log; losing one breaks attribution with
 *      nothing failing loudly.
 *
 *   5. THE SUBJECT IS SANITISED BEFORE STORAGE. Subjects are Handlebars-
 *      compiled downstream, and the stored subject is replayed into the rollup
 *      email, so an incident title containing `{{` would be evaluated as a
 *      template. Over-length subjects must truncate rather than throw, because
 *      a throw inside the writer degrades every notification for that project
 *      to the fail-open path.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TO_EMAIL: Email = new Email("owner@example.com");

const INCIDENT_EVENT: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;
const MONITOR_EVENT: NotificationSettingEventType =
  NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION;

const INCIDENT_LINK: string = "https://oneuptime.com/dashboard/incidents/1";

/*
 * What the writer hands countBy. Declared here rather than reaching through
 * Query<Model>, because the two things worth asserting - the category scope
 * and the window bound - are exactly the two the generic type erases.
 */
interface CapturedCountBy {
  query: {
    projectId: ObjectID;
    userId: ObjectID;
    toEmail: Email;
    rollupCategory: NotificationEmailRollupCategory.RollupCategory;
    createdAt: FindOperator<Date>;
  };
  props: {
    isRoot: boolean;
  };
}

function buildEnvelope(overrides: Partial<EmailEnvelope> = {}): EmailEnvelope {
  return {
    subject: "Incident created: Checkout is down",
    templateType: EmailTemplateType.BlankTemplate,
    vars: {
      incidentViewLink: INCIDENT_LINK,
    },
    ...overrides,
  } as EmailEnvelope;
}

function buildMailOptions(): RollupMailOptions {
  return {
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    userId: USER_ID,
  };
}

function sendData(overrides: Partial<SendOrRollupData> = {}): SendOrRollupData {
  return {
    projectId: PROJECT_ID,
    userId: USER_ID,
    toEmail: TO_EMAIL,
    eventType: INCIDENT_EVENT,
    emailEnvelope: buildEnvelope(),
    mailOptions: buildMailOptions(),
    ...overrides,
  };
}

describe("EmailRollupWriter.sendOrRollup", () => {
  let sendMail: jest.SpyInstance;
  let countRecent: jest.SpyInstance;
  let createItem: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    sendMail = jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(undefined as never);

    countRecent = jest
      .spyOn(UserNotificationEmailRollupItemService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    createItem = jest
      .spyOn(UserNotificationEmailRollupItemService, "create")
      .mockResolvedValue(new UserNotificationEmailRollupItem() as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function recentCount(count: number): void {
    countRecent.mockResolvedValue(new PositiveNumber(count) as never);
  }

  function writtenItem(index: number = 0): UserNotificationEmailRollupItem {
    const arg: CreateBy<UserNotificationEmailRollupItem> = createItem.mock
      .calls[index]?.[0] as CreateBy<UserNotificationEmailRollupItem>;
    return arg.data;
  }

  function capturedCountBy(index: number = 0): CapturedCountBy {
    return countRecent.mock.calls[index]?.[0] as CapturedCountBy;
  }

  /*
   * ----------------------------------------------------------------------- *
   * (A) The decision table.
   * -----------------------------------------------------------------------
   */

  describe("the burst decision", () => {
    test("below the threshold it sends immediately with the envelope and options unchanged", async () => {
      recentCount(BURST_THRESHOLD - 1);
      const data: SendOrRollupData = sendData();

      await EmailRollupWriter.sendOrRollup(data);

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail.mock.calls[0]?.[0]).toEqual({
        subject: "Incident created: Checkout is down",
        templateType: EmailTemplateType.BlankTemplate,
        vars: {
          incidentViewLink: INCIDENT_LINK,
        },
        toEmail: TO_EMAIL,
      });
      /*
       * Reference identity, not deep equality: the correlation-id bag is
       * passed through verbatim, and a writer that rebuilt it would be free to
       * quietly drop a field.
       */
      expect(sendMail.mock.calls[0]?.[1]).toBe(data.mailOptions);
    });

    test("below the threshold exactly one row is written, with sentAt set", async () => {
      recentCount(BURST_THRESHOLD - 1);

      await EmailRollupWriter.sendOrRollup(sendData());

      expect(createItem).toHaveBeenCalledTimes(1);

      const item: UserNotificationEmailRollupItem = writtenItem();
      expect(item.sentAt).toBeInstanceOf(Date);
      expect(item.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(item.userId?.toString()).toBe(USER_ID.toString());
      expect(item.toEmail?.toString()).toBe(TO_EMAIL.toString());
      expect(item.eventType).toBe(INCIDENT_EVENT);
      expect(item.rollupCategory).toBe(
        NotificationEmailRollupCategory.RollupCategory.Incidents,
      );
      expect(item.subject).toBe("Incident created: Checkout is down");
      expect(item.viewLink).toBe(INCIDENT_LINK);
      expect(item.rollupBatchId).toBeUndefined();
    });

    test("at the threshold it defers: no mail, one pending row with sentAt undefined", async () => {
      recentCount(BURST_THRESHOLD);

      await EmailRollupWriter.sendOrRollup(sendData());

      expect(sendMail).not.toHaveBeenCalled();
      expect(createItem).toHaveBeenCalledTimes(1);
      expect(writtenItem().sentAt).toBeUndefined();
    });

    test("above the threshold it defers too", async () => {
      recentCount(BURST_THRESHOLD + 40);

      await EmailRollupWriter.sendOrRollup(sendData());

      expect(sendMail).not.toHaveBeenCalled();
      expect(createItem).toHaveBeenCalledTimes(1);
      expect(writtenItem().sentAt).toBeUndefined();
    });

    test("the ledger row is always written as root, since the service denies everything else", async () => {
      recentCount(0);

      await EmailRollupWriter.sendOrRollup(sendData());

      const arg: CreateBy<UserNotificationEmailRollupItem> = createItem.mock
        .calls[0]?.[0] as CreateBy<UserNotificationEmailRollupItem>;
      expect(arg.props.isRoot).toBe(true);
      expect(capturedCountBy().props.isRoot).toBe(true);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) The counter is scoped per category.
   * -----------------------------------------------------------------------
   */

  describe("the per-category counter scope", () => {
    test("ten recent Monitors rows do not defer an incident-created notification", async () => {
      /*
       * The regression guard for the whole feature: the noisiest resource must
       * never be able to delay the most important one. A flapping monitor
       * produces a Monitors-category flood; the first incident email that
       * follows it must still go out immediately.
       */
      countRecent.mockImplementation(
        (params: CapturedCountBy): Promise<PositiveNumber> => {
          return Promise.resolve(
            new PositiveNumber(
              params.query.rollupCategory ===
              NotificationEmailRollupCategory.RollupCategory.Monitors
                ? 10
                : 0,
            ),
          );
        },
      );

      await EmailRollupWriter.sendOrRollup(sendData());

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(writtenItem().sentAt).toBeInstanceOf(Date);

      /*
       * And the same flood does defer the next monitor notification, which is
       * what proves the mock above was actually reached rather than the
       * incident having been immediate for some unrelated reason.
       */
      sendMail.mockClear();
      createItem.mockClear();

      await EmailRollupWriter.sendOrRollup(
        sendData({ eventType: MONITOR_EVENT }),
      );

      expect(sendMail).not.toHaveBeenCalled();
      expect(writtenItem().sentAt).toBeUndefined();
    });

    test("the count is keyed on project, user, address and category", async () => {
      await EmailRollupWriter.sendOrRollup(sendData());

      const captured: CapturedCountBy = capturedCountBy();
      expect(captured.query.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(captured.query.userId.toString()).toBe(USER_ID.toString());
      expect(captured.query.toEmail.toString()).toBe(TO_EMAIL.toString());
      expect(captured.query.rollupCategory).toBe(
        NotificationEmailRollupCategory.RollupCategory.Incidents,
      );
    });

    test("the counter counts rows NEWER than now minus BURST_WINDOW_MINUTES, not older", async () => {
      /*
       * Both halves of this matter, and only one of them is a number.
       *
       * The BOUND is now minus ten minutes. The DIRECTION is what makes the
       * bound mean anything: QueryHelper.greaterThan and QueryHelper.lessThan
       * are the same call shape, take the same Date and produce the same
       * objectLiteralParameters, so a test that reads only the bound stays
       * green through the one-token swap that inverts the entire feature -
       * `lessThan` would count everything OLDER than the window, so a genuine
       * burst would never be detected and a recipient who had been quiet for
       * an hour would be deferred forever.
       *
       * The only part of the returned FindOperator that distinguishes them is
       * the SQL fragment its generator builds, so that is what is asserted.
       */
      const before: number = Date.now();

      await EmailRollupWriter.sendOrRollup(sendData());

      const after: number = Date.now();

      const createdAt: FindOperator<Date> = capturedCountBy().query.createdAt;

      const rawParameters: Record<string, unknown> =
        (createdAt.objectLiteralParameters ?? {}) as Record<string, unknown>;
      const parameterNames: Array<string> = Object.keys(rawParameters);
      expect(parameterNames).toHaveLength(1);

      const parameterName: string = parameterNames[0] ?? "";
      const windowStart: Date = rawParameters[parameterName] as Date;
      expect(windowStart).toBeInstanceOf(Date);

      const offsetMs: number = BURST_WINDOW_MINUTES * 60 * 1000;
      expect(windowStart.getTime()).toBeGreaterThanOrEqual(before - offsetMs);
      expect(windowStart.getTime()).toBeLessThanOrEqual(after - offsetMs);

      const buildSql: ((alias: string) => string) | undefined =
        createdAt.getSql;
      expect(typeof buildSql).toBe("function");

      const sql: string = (buildSql as (alias: string) => string)(
        "createdAtColumn",
      );

      /*
       * Anchored, and the parameter name is the one the bound above was read
       * from, so this cannot pass on a fragment that compares some other
       * column or some other value. `>=` is allowed because a half-open window
       * is the same window; `<` in either position is not, and neither is the
       * `or IS NULL` variant, which would make every never-created row count.
       */
      expect(sql).toMatch(
        new RegExp(`^\\(createdAtColumn >=? :${parameterName}\\)$`),
      );
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) The structural bypasses.
   * -----------------------------------------------------------------------
   */

  describe("the structural bypasses", () => {
    test("every never-rolled-up event type sends immediately, writes no row and never counts", async () => {
      /*
       * Armed with a flood that would defer anything eligible, precisely so a
       * regression that moved the eligibility check below the counter would
       * fail here rather than pass by luck.
       */
      recentCount(100);

      for (const eventType of Array.from(NEVER_ROLLED_UP_EVENT_TYPES)) {
        sendMail.mockClear();
        countRecent.mockClear();
        createItem.mockClear();

        await EmailRollupWriter.sendOrRollup(sendData({ eventType }));

        expect(sendMail).toHaveBeenCalledTimes(1);
        expect(countRecent).not.toHaveBeenCalled();
        expect(createItem).not.toHaveBeenCalled();
      }
    });

    test("forceImmediate sends immediately, writes no row and counts nothing", async () => {
      recentCount(100);

      await EmailRollupWriter.sendOrRollup(sendData({ forceImmediate: true }));

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(countRecent).not.toHaveBeenCalled();
      expect(createItem).not.toHaveBeenCalled();
    });

    test("forceImmediate false is not a bypass and still goes through the counter", async () => {
      recentCount(BURST_THRESHOLD);

      await EmailRollupWriter.sendOrRollup(sendData({ forceImmediate: false }));

      expect(countRecent).toHaveBeenCalledTimes(1);
      expect(sendMail).not.toHaveBeenCalled();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (D) Fail open.
   * -----------------------------------------------------------------------
   */

  describe("fail open", () => {
    test("a countBy that throws still sends the email, logging once", async () => {
      countRecent.mockRejectedValue(
        new Error('relation "UserNotificationEmailRollupItem" does not exist'),
      );

      await expect(
        EmailRollupWriter.sendOrRollup(sendData()),
      ).resolves.toBeUndefined();

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(createItem).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledTimes(1);
    });

    test("a create that throws still sends the email, logging once", async () => {
      recentCount(0);
      createItem.mockRejectedValue(new Error("insert timed out"));

      await expect(
        EmailRollupWriter.sendOrRollup(sendData()),
      ).resolves.toBeUndefined();

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalledTimes(1);
    });

    test("both throwing still sends the email, logging once", async () => {
      countRecent.mockRejectedValue(new Error("postgres is unreachable"));
      createItem.mockRejectedValue(new Error("postgres is unreachable"));

      await expect(
        EmailRollupWriter.sendOrRollup(sendData()),
      ).resolves.toBeUndefined();

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalledTimes(1);
    });

    test("a category lookup that throws still sends the email, logging once", async () => {
      /*
       * Stands in for every way the classification layer can go wrong at
       * runtime - a value the Record has no entry for, an import cycle that
       * leaves the map undefined at first call. The answer has to be the same
       * as for a dead database: send it the old way.
       */
      jest
        .spyOn(NotificationEmailRollupCategory, "getRollupCategory")
        .mockImplementation((): never => {
          throw new Error("unclassifiable event type");
        });

      await expect(
        EmailRollupWriter.sendOrRollup(sendData()),
      ).resolves.toBeUndefined();

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(countRecent).not.toHaveBeenCalled();
      expect(createItem).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledTimes(1);
    });

    test("a deferred notification is NOT sent twice when the write succeeds", async () => {
      /*
       * The mirror image of fail-open, and the reason the catch resets a flag
       * rather than returning early: if the catch were ever widened to cover
       * the send decision itself, a successful deferral could still fall
       * through to sendNow and the recipient would get both the immediate mail
       * and the rollup line.
       */
      recentCount(BURST_THRESHOLD);

      await EmailRollupWriter.sendOrRollup(sendData());

      expect(sendMail).not.toHaveBeenCalled();
      expect(loggerError).not.toHaveBeenCalled();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (E) The stored subject.
   * -----------------------------------------------------------------------
   */

  describe("the stored subject", () => {
    test("a 5,000 character subject is truncated to the column length rather than throwing", async () => {
      const longSubject: string = "x".repeat(5000);

      await expect(
        EmailRollupWriter.sendOrRollup(
          sendData({ emailEnvelope: buildEnvelope({ subject: longSubject }) }),
        ),
      ).resolves.toBeUndefined();

      expect(loggerError).not.toHaveBeenCalled();
      expect(writtenItem().subject).toHaveLength(ROLLUP_SUBJECT_MAX_LENGTH);
    });

    test("Handlebars braces are stripped before storage", async () => {
      await EmailRollupWriter.sendOrRollup(
        sendData({
          emailEnvelope: buildEnvelope({
            subject: "{{projectName}} is down }}",
          }),
        }),
      );

      expect(writtenItem().subject).toBe("projectName is down ");
      expect(writtenItem().subject).not.toContain("{{");
      expect(writtenItem().subject).not.toContain("}}");
    });

    test("the outgoing email keeps the producer's original subject", async () => {
      /*
       * Stripping and truncation are storage concerns only. The immediate send
       * below the threshold must be byte-identical to what shipped before.
       */
      const subject: string = "{{projectName}} is down";

      await EmailRollupWriter.sendOrRollup(
        sendData({ emailEnvelope: buildEnvelope({ subject }) }),
      );

      expect((sendMail.mock.calls[0]?.[0] as EmailEnvelope).subject).toBe(
        subject,
      );
    });

    test("an empty subject is stored as an empty string rather than failing the insert", async () => {
      await EmailRollupWriter.sendOrRollup(
        sendData({ emailEnvelope: buildEnvelope({ subject: "" }) }),
      );

      expect(loggerError).not.toHaveBeenCalled();
      expect(writtenItem().subject).toBe("");
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (F) extractViewLink - pure, no mocks needed.
   * -----------------------------------------------------------------------
   */

  describe("extractViewLink", () => {
    function vars(
      value: Dictionary<string | JSONObject>,
    ): Dictionary<string | JSONObject> {
      return value;
    }

    test("the first known variable in list order wins", () => {
      /*
       * Insertion order here is deliberately the opposite of preference order,
       * so a fallback that merely walked Object.keys would pick the monitor
       * link and fail.
       */
      expect(
        EmailRollupWriter.extractViewLink(
          vars({
            monitorViewLink: "https://oneuptime.com/dashboard/monitors/1",
            incidentViewLink: INCIDENT_LINK,
          }),
        ),
      ).toBe(INCIDENT_LINK);
    });

    test("the plural probe and AI agent variables resolve, as well as their singular twins", () => {
      expect(
        EmailRollupWriter.extractViewLink(
          vars({ viewProbesLink: "https://oneuptime.com/dashboard/probes" }),
        ),
      ).toBe("https://oneuptime.com/dashboard/probes");

      expect(
        EmailRollupWriter.extractViewLink(
          vars({ viewProbeLink: "https://oneuptime.com/dashboard/probes/1" }),
        ),
      ).toBe("https://oneuptime.com/dashboard/probes/1");

      expect(
        EmailRollupWriter.extractViewLink(
          vars({
            viewAIAgentsLink: "https://oneuptime.com/dashboard/ai-agents",
          }),
        ),
      ).toBe("https://oneuptime.com/dashboard/ai-agents");

      expect(
        EmailRollupWriter.extractViewLink(
          vars({
            viewAIAgentLink: "https://oneuptime.com/dashboard/ai-agents/1",
          }),
        ),
      ).toBe("https://oneuptime.com/dashboard/ai-agents/1");
    });

    test("deviceViewLink resolves", () => {
      expect(
        EmailRollupWriter.extractViewLink(
          vars({ deviceViewLink: "https://oneuptime.com/dashboard/devices/1" }),
        ),
      ).toBe("https://oneuptime.com/dashboard/devices/1");
    });

    test("an unknown *Link variable with an http value resolves through the fallback", () => {
      /*
       * This is what buys the feature a clickable line for a producer nobody
       * has written yet, with no list here to keep in sync.
       */
      expect(
        EmailRollupWriter.extractViewLink(
          vars({
            somethingBrandNewViewLink: "https://oneuptime.com/dashboard/new/1",
          }),
        ),
      ).toBe("https://oneuptime.com/dashboard/new/1");
    });

    test("a non-string or relative value is ignored", () => {
      expect(
        EmailRollupWriter.extractViewLink(
          vars({
            incidentViewLink: 42 as unknown as string,
            alertViewLink: { url: "https://oneuptime.com" } as JSONObject,
            monitorViewLink: "/dashboard/monitors/1",
          }),
        ),
      ).toBeUndefined();
    });

    test("no link variables at all returns undefined", () => {
      expect(
        EmailRollupWriter.extractViewLink(vars({ projectName: "Acme" })),
      ).toBeUndefined();
      expect(EmailRollupWriter.extractViewLink(undefined)).toBeUndefined();
    });

    test("an envelope with no usable link still writes the row", async () => {
      await EmailRollupWriter.sendOrRollup(
        sendData({
          emailEnvelope: buildEnvelope({ vars: { projectName: "Acme" } }),
        }),
      );

      expect(createItem).toHaveBeenCalledTimes(1);
      expect(writtenItem().viewLink).toBeUndefined();
      expect(sendMail).toHaveBeenCalledTimes(1);
    });
  });
});
