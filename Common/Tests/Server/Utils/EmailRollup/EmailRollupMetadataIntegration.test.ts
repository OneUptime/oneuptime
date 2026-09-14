import UserNotificationEmailRollupItem from "../../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import UserNotificationEmailRollupItemService from "../../../../Server/Services/UserNotificationEmailRollupItemService";
import UserNotificationEmailRollupSettingService from "../../../../Server/Services/UserNotificationEmailRollupSettingService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import { BURST_THRESHOLD } from "../../../../Server/Utils/EmailRollup/EmailRollupConstants";
import EmailRollupFlushRunner from "../../../../Server/Utils/EmailRollup/EmailRollupFlushRunner";
import EmailRollupWriter from "../../../../Server/Utils/EmailRollup/EmailRollupWriter";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  FakeItemRow,
  RollupHarness,
  emptyRollupHarness,
  installRollupHarness,
  pendingItems,
  seedItem,
  seedProject,
  seedVerifiedEmail,
} from "./EmailRollupTestHarness";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const TO_EMAIL: Email = new Email("owner@example.com");
const NOW: Date = new Date("2026-09-09T07:15:00.000Z");

interface NotificationFamily {
  name: string;
  eventType: NotificationSettingEventType;
  severityVar: string;
  linkVar: string;
}

const FAMILIES: Array<NotificationFamily> = [
  {
    name: "alert",
    eventType:
      NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION,
    severityVar: "alertSeverity",
    linkVar: "alertViewLink",
  },
  {
    name: "incident",
    eventType:
      NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
    severityVar: "incidentSeverity",
    linkVar: "incidentViewLink",
  },
  {
    name: "alert episode",
    eventType:
      NotificationSettingEventType.SEND_ALERT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION,
    severityVar: "episodeSeverity",
    linkVar: "episodeViewLink",
  },
  {
    name: "incident episode",
    eventType:
      NotificationSettingEventType.SEND_INCIDENT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION,
    severityVar: "episodeSeverity",
    linkVar: "episodeViewLink",
  },
];

/*
 * Real writer, flush runner and renderer with a projected in-memory database.
 * The persisted copy is the only bridge between enqueue and flush, so omitting
 * metadata from either the insert or the flush select loses these labels.
 */
describe("grouped email severity and state from enqueue through delivery", () => {
  let harness: RollupHarness;
  let queuedAt: Date;

  beforeEach(() => {
    harness = emptyRollupHarness();
    installRollupHarness(harness);
    seedProject(harness, { projectId: PROJECT_ID, name: "Acme" });
    seedVerifiedEmail(harness, {
      projectId: PROJECT_ID,
      userId: USER_ID,
      email: TO_EMAIL,
    });
    queuedAt = OneUptimeDate.addRemoveMinutes(NOW, -12);

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
      return queuedAt;
    });
    jest
      .spyOn(UserNotificationEmailRollupItemService, "countBy")
      .mockResolvedValue(new PositiveNumber(BURST_THRESHOLD));
    jest
      .spyOn(
        UserNotificationEmailRollupSettingService,
        "isRollupEnabledForUser",
      )
      .mockResolvedValue(true);
    jest
      .spyOn(UserNotificationEmailRollupItemService, "create")
      .mockImplementation(
        async (
          args: CreateBy<UserNotificationEmailRollupItem>,
        ): Promise<UserNotificationEmailRollupItem> => {
          const item: UserNotificationEmailRollupItem = args.data;
          seedItem(harness, {
            projectId: item.projectId!,
            userId: item.userId!,
            toEmail: item.toEmail!,
            eventType: item.eventType,
            rollupCategory: item.rollupCategory,
            subject: item.subject,
            viewLink: item.viewLink,
            severity: item.severity,
            currentState: item.currentState,
            sentAt: item.sentAt,
            createdAt: queuedAt,
          });
          return item;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function enqueue(data: {
    family: NotificationFamily;
    subject: string;
    severity: string;
    state: string;
  }): Promise<void> {
    const vars: Dictionary<string | JSONObject> = {
      [data.family.severityVar]: data.severity,
      currentState: data.state,
      [data.family.linkVar]: "https://oneuptime.com/dashboard/resource/1",
    };

    await EmailRollupWriter.sendOrRollup({
      projectId: PROJECT_ID,
      userId: USER_ID,
      toEmail: TO_EMAIL,
      eventType: data.family.eventType,
      emailEnvelope: { subject: data.subject, vars: vars },
      mailOptions: { projectId: PROJECT_ID, userId: USER_ID },
    });

    // Later changes to producer data must not alter the persisted snapshot.
    vars[data.family.severityVar] = "Changed after enqueue";
    vars["currentState"] = "Changed after enqueue";
  }

  test.each(FAMILIES)(
    "delivers the latest $name severity and state after folding queued updates",
    async (family: NotificationFamily) => {
      await enqueue({
        family: family,
        subject: "Acknowledged notification",
        severity: "Critical",
        state: "Acknowledged",
      });
      queuedAt = OneUptimeDate.addRemoveMinutes(NOW, -10);
      await enqueue({
        family: family,
        subject: "Resolved notification",
        severity: "High",
        state: "Resolved",
      });

      expect(harness.sent).toHaveLength(0);
      expect(pendingItems(harness)).toHaveLength(2);
      expect(
        harness.items.map((item: FakeItemRow): Array<string | null> => {
          return [item.severity, item.currentState];
        }),
      ).toEqual([
        ["Critical", "Acknowledged"],
        ["High", "Resolved"],
      ]);

      await EmailRollupFlushRunner.runSweep({ now: NOW });

      expect(harness.sent).toHaveLength(1);
      expect(pendingItems(harness)).toHaveLength(0);
      const rows: Array<JSONObject> = harness.sent[0]!.vars[
        "rows"
      ] as unknown as Array<JSONObject>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        title: "Resolved notification",
        severity: "High",
        currentState: "Resolved",
        hasSeverity: "true",
        hasCurrentState: "true",
        hasDetails: "true",
      });
      expect(rows[0]!["metaLabel"]).toContain("2 updates");
    },
  );

  test("delivers older pending items with null metadata alongside enriched notifications", async () => {
    seedItem(harness, {
      projectId: PROJECT_ID,
      userId: USER_ID,
      toEmail: TO_EMAIL,
      subject: "Previously queued incident",
      createdAt: OneUptimeDate.addRemoveMinutes(NOW, -15),
    });
    await enqueue({
      family: FAMILIES[0]!,
      subject: "New alert",
      severity: "Critical",
      state: "Investigating",
    });

    await EmailRollupFlushRunner.runSweep({ now: NOW });

    expect(harness.sent).toHaveLength(1);
    const rows: Array<JSONObject> = harness.sent[0]!.vars[
      "rows"
    ] as unknown as Array<JSONObject>;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Previously queued incident",
          severity: "",
          currentState: "",
          hasDetails: "false",
        }),
        expect.objectContaining({
          title: "New alert",
          severity: "Critical",
          currentState: "Investigating",
          hasDetails: "true",
        }),
      ]),
    );
    expect(harness.errors).toEqual([]);
  });
});
