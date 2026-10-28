import {
  DocsFence,
  DocsHeading,
  DocsLink,
  NAV_PAGES,
  ScannedPage,
  TRANSLATED_LANGUAGES,
  anchorsOfScanned,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  PACKAGES_DIR,
  readCommonSource,
  readDashboardSource,
} from "./DocsDashboardMenus";
import EnterpriseEdition, {
  RUNTIME_ENTERPRISE_FEATURES,
} from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "Common/Server/Enterprise/EnterpriseFeature";
import CustomNotificationChannelDeliveryService, {
  CustomChannelDeliveryResult,
} from "Common/Server/Services/CustomNotificationChannelDeliveryService";
import CustomNotificationChannelService from "Common/Server/Services/CustomNotificationChannelService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import DatabaseRequestType from "Common/Server/Types/BaseDatabase/DatabaseRequestType";
import EditionPermissions from "Common/Server/Types/Database/Permissions/EditionPermission";
import CustomChannelEdition, {
  CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
} from "Common/Server/Utils/Notification/CustomChannelEdition";
import logger from "Common/Server/Utils/Logger";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import API from "Common/Utils/API";
import FakeEnterpriseModule, {
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  LICENSE_STATE_CASES,
  LicenseStateCase,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import fs from "fs";
import path from "path";
import {
  CUSTOM_CHANNEL_PAYLOAD_VERSION,
  CustomChannelAction,
  CustomChannelEvent,
  CustomChannelPerson,
  CustomChannelRecordType,
  CustomChannelReference,
  MAX_CUSTOM_CHANNEL_TEXT_LENGTH,
  buildCustomChannelNotificationPayload,
  buildCustomChannelPagePayload,
} from "Common/Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import { JSONObject } from "Common/Types/JSON";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { TRUNCATED_TEXT_NOTE } from "Common/Utils/MessageFit";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The Without a License section is held to the edition checks themselves,
 * so billing and the edition are pinned where it is (CI's config.env sets
 * BILLING_ENABLED=true). Nothing else in this file reads either.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * THE CUSTOM CHANNELS PAGE SAYS WHAT A NOTIFICATION SENDS.
 *
 * self-hosted/custom-notification-channels documents the body of a request
 * to a service OneUptime does not own, and its "Other Notifications"
 * section the body of a notification that is not a page
 * (buildCustomChannelNotificationPayload): its example, field for field,
 * the event that names it, and where people turn it on. Markdown is not
 * compiled, so these hold the page to Common's builder and to the source
 * that sends it: the example is what the builder makes of the example's
 * own values, and a field added to the payload fails here until the page
 * shows it.
 */

const PAGE: string = "self-hosted/custom-notification-channels";

const english: string = readPage("en", PAGE);
const scanned: ScannedPage = scanMarkdown(english);

// The text of a level-2 section, from its heading to the next one.
function section(title: string): string {
  const start: number = english.indexOf(`\n## ${title}\n`);

  if (start < 0) {
    throw new Error(`The page has no "## ${title}" section.`);
  }

  const end: number = english.indexOf("\n## ", start + 1);

  return english.slice(start, end < 0 ? english.length : end);
}

// The JSON example a fence titled `title` holds, parsed.
function jsonExample(title: string): JSONObject {
  const fence: DocsFence | undefined = scanned.fences.find(
    (candidate: DocsFence): boolean => {
      return (
        candidate.lang === "json" && candidate.info.includes(`title="${title}"`)
      );
    },
  );

  if (!fence) {
    throw new Error(`The page has no json example titled "${title}".`);
  }

  return JSON.parse(fence.code) as JSONObject;
}

const notificationExample: JSONObject = jsonExample("A notification");

describe("the custom channels page and other notifications", () => {
  it("is a page of the docs", () => {
    expect(NAV_PAGES).toContain(PAGE);
  });

  it("has an Other Notifications section, which its cards link to", () => {
    const heading: DocsHeading | undefined = scanned.headings.find(
      (candidate: DocsHeading): boolean => {
        return candidate.text === "Other Notifications";
      },
    );

    expect(heading?.level).toBe(2);
    expect(anchorsOfScanned(scanned).has("other-notifications")).toBe(true);
    expect(
      scanned.links
        .map((link: DocsLink): string => {
          return link.target;
        })
        .filter((target: string): boolean => {
          return target === "#other-notifications";
        }).length,
    ).toBeGreaterThanOrEqual(2);
    expect(english).toContain(
      "- [Other notifications](#other-notifications): Owner notifications, notes and shifts, for people who want them.",
    );
  });

  it("documents the example as the builder makes it, field for field and value for value", () => {
    const built: JSONObject = buildCustomChannelNotificationPayload({
      sentAt: new Date(notificationExample["sentAt"] as string),
      channel: notificationExample[
        "channel"
      ] as unknown as CustomChannelReference,
      notificationType: notificationExample["notificationType"] as string,
      title: notificationExample["title"] as string,
      message: notificationExample["message"] as string,
      url: notificationExample["url"] as string,
      project: notificationExample[
        "project"
      ] as unknown as CustomChannelReference,
      user: notificationExample["user"] as unknown as CustomChannelPerson,
    });

    expect(notificationExample).toEqual(built);
    // In the order a service reads them, too.
    expect(Object.keys(notificationExample)).toEqual(Object.keys(built));
  });

  it("names every field the builder sends, nested ones included, and no other", () => {
    const built: JSONObject = buildCustomChannelNotificationPayload({
      sentAt: new Date("2026-10-27T03:20:00.000Z"),
      channel: { id: "channel-id", name: "CorpoApp" },
      notificationType:
        NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
      title: "Title",
      message: "Message",
      url: "https://oneuptime.example.com/dashboard",
      project: { id: "project-id", name: "Agency A" },
      user: { id: "user-id", name: "Jane Tan", email: "jane@example.com" },
    });

    expect(Object.keys(notificationExample)).toEqual(Object.keys(built));

    for (const nested of ["channel", "project", "user"]) {
      expect({
        nested,
        keys: Object.keys(notificationExample[nested] as JSONObject),
      }).toEqual({
        nested,
        keys: Object.keys(built[nested] as JSONObject),
      });
    }
  });

  it("is a page's body with no record and nothing to act on, and two fields of its own", () => {
    const page: JSONObject = buildCustomChannelPagePayload({
      event: CustomChannelEvent.IncidentCreated,
      notificationId: "5f2c8a1e-6b1d-4c3a-9e7f-2a4b6c8d0e1f",
      sentAt: new Date("2026-10-27T03:14:15.000Z"),
      channel: { id: "channel-id", name: "CorpoApp" },
      title: "Title",
      message: "Message",
      project: { id: "project-id", name: "Agency A" },
      user: { id: "user-id", name: "Jane Tan", email: "jane@example.com" },
      recordType: CustomChannelRecordType.Incident,
      record: {
        id: "incident-id",
        number: "INC-42",
        title: "API latency high",
        description: "",
        severity: "Critical",
        state: "Created",
        url: "https://oneuptime.example.com/dashboard",
      },
      isPageAgain: false,
      actions: {
        [CustomChannelAction.Acknowledge]: "https://x/acknowledge",
        [CustomChannelAction.Escalate]: "https://x/escalate",
        [CustomChannelAction.Resolve]: "https://x/resolve",
      },
    });

    // The page's own example has the page's fields, in the page's order.
    expect(Object.keys(jsonExample("An incident page"))).toEqual(
      Object.keys(page),
    );
    expect(Object.keys(notificationExample)).toEqual([
      ...Object.keys(page),
      "notificationType",
      "url",
    ]);

    expect(notificationExample).toMatchObject({
      version: CUSTOM_CHANNEL_PAYLOAD_VERSION,
      event: CustomChannelEvent.Notification,
      notificationId: null,
      team: null,
      recordType: null,
      record: null,
      onCallPolicy: null,
      escalationRule: null,
      isPageAgain: false,
      actions: null,
    });
  });

  it("names a real notification setting in notificationType, and a time as the builder writes it", () => {
    expect(Object.values(NotificationSettingEventType)).toContain(
      notificationExample["notificationType"],
    );

    const sentAt: string = notificationExample["sentAt"] as string;

    expect(new Date(sentAt).toISOString()).toBe(sentAt);
  });

  it("says the link is null when there is none, as the builder sends it", () => {
    expect(section("Other Notifications")).toContain(
      "`url` links to what it is about, or is `null`.",
    );
    expect(
      buildCustomChannelNotificationPayload({
        sentAt: new Date("2026-10-27T03:20:00.000Z"),
        channel: { id: "channel-id", name: "CorpoApp" },
        notificationType:
          NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
        title: "Title",
        message: "Message",
        project: { id: "project-id", name: "Agency A" },
        user: { id: "user-id", name: "Jane Tan", email: "jane@example.com" },
      })["url"],
    ).toBeNull();
    expect(typeof notificationExample["url"]).toBe("string");
  });

  it("lists every event a request can name in the field table, notification with a link to its section", () => {
    const eventRow: string | undefined = english
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("| `event` |");
      });

    expect(eventRow).toBeDefined();

    for (const event of Object.values(CustomChannelEvent)) {
      expect({ event, listed: eventRow!.includes(`\`${event}\``) }).toEqual({
        event,
        listed: true,
      });
    }

    expect(eventRow).toContain(
      "`notification` for [other notifications](#other-notifications)",
    );
    expect(section("Other Notifications")).toContain(
      `with \`event\` set to \`${CustomChannelEvent.Notification}\``,
    );
  });

  it("sends one request per channel that is on, as the event the page names", () => {
    const service: string = readCommonSource(
      "Server/Services/UserNotificationSettingService.ts",
    );

    expect(section("Other Notifications")).toContain(
      "A notification goes to every channel that is on, as one request per channel",
    );
    expect(service).toContain(
      "await CustomNotificationChannelService.getChannelsThatAreOn();",
    );
    expect(service).toContain("eventType: CustomChannelEvent.Notification,");
    expect(service).toContain("notificationType: data.eventType,");
  });

  it("says title and message are the push notification's, as the source sends them", () => {
    const service: string = readCommonSource(
      "Server/Services/UserNotificationSettingService.ts",
    );

    expect(section("Other Notifications")).toContain(
      "`title` and `message` are what the person's push notification would say.",
    );
    expect(service).toContain('title: message.title || "",');
    expect(service).toContain('message: message.body || "",');
    expect(service).toContain(
      "url: message.url || message.clickAction || undefined,",
    );
  });

  it("names where people turn it on, by the column the Dashboard draws, while a channel is on", () => {
    const settingsPage: string = readDashboardSource(
      "Pages/UserSettings/NotificationSettings.tsx",
    );
    const column: string = settingsPage.slice(
      settingsPage.indexOf('key: "alertByCustomChannel"'),
      settingsPage.indexOf(
        "},",
        settingsPage.indexOf('key: "alertByCustomChannel"'),
      ),
    );

    expect(section("Other Notifications")).toContain(
      "Each person chooses where each of these goes in **User Settings > Notification Settings**, which has a **Custom Channels** column while a channel is on.",
    );
    expect(column).toContain('label: "Custom Channels",');
    expect(column).toContain("isCustomChannels: true,");
    expect(settingsPage).toContain(
      "if (channel.isCustomChannels) {\n      return hasCustomChannels;",
    );
  });

  it("says it is off for everyone until they turn it on, as the column's default is", () => {
    const metadata: TableColumnMetadata =
      new UserNotificationSetting().getTableColumnMetadata(
        "alertByCustomChannel",
      );

    expect(section("Other Notifications")).toContain(
      "It is off for everyone until they turn it on.",
    );
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(false);
  });

  it("holds the texts to the budget and the note the builder uses", () => {
    expect(english).toContain(
      `held to ${MAX_CUSTOM_CHANNEL_TEXT_LENGTH.toLocaleString("en-US")} characters`,
    );
    expect(english).toContain(`"${TRUNCATED_TEXT_NOTE}"`);
  });
});

/*
 * THE PAGE SAYS WHAT HAPPENS WITHOUT A LICENSE, AS THE EDITION CHECKS DO IT.
 *
 * Custom channels are an Enterprise feature
 * (EnterpriseFeature.CustomNotificationChannels): the page's note and its
 * "Without a License" section say what runs when, what stops, what is read-
 * only and what is kept. Each sentence below is checked against the code
 * that makes it true: the license periods, CustomChannelEdition, the
 * delivery service, the channel lists and EditionPermissions - on the
 * Community Edition (no Enterprise module in this process, as in every
 * core test) and on an Enterprise Edition faked in each license state.
 */
describe("the custom channels page without a license", () => {
  const withoutALicense: string = section("Without a License").replace(
    /\s+/g,
    " ",
  );
  const channelId: ObjectID = new ObjectID(
    "c4a70000-0000-4000-8000-000000000001",
  );
  const timelineId: ObjectID = new ObjectID(
    "c4a70000-0000-4000-8000-000000000002",
  );

  const licenseState: (label: string) => LicenseStateCase = (
    label: string,
  ): LicenseStateCase => {
    const state: LicenseStateCase | undefined = LICENSE_STATE_CASES.find(
      (candidate: LicenseStateCase): boolean => {
        return candidate.label === label;
      },
    );

    if (!state) {
      throw new Error(`The test kit has no license state "${label}".`);
    }

    return state;
  };

  // How the edition's write check answered: allowed, or whose words.
  const writeOutcome: (
    modelType: DatabaseBaseModelType,
    operation: DatabaseRequestType,
    data: unknown,
  ) => string = (
    modelType: DatabaseBaseModelType,
    operation: DatabaseRequestType,
    data: unknown,
  ): string => {
    try {
      EditionPermissions.checkEditionPermissions(
        modelType,
        { userId: ObjectID.generate(), isMasterAdmin: true },
        operation,
        data,
      );
      EditionPermissions.checkEnterpriseColumnPermissions(
        modelType,
        { userId: ObjectID.generate() },
        operation,
        data,
      );
      return "allowed";
    } catch (err) {
      if (err instanceof PaymentRequiredException) {
        return err.message === EnterpriseEdition.COMMUNITY_EDITION_MESSAGE
          ? "refused: Community Edition"
          : "refused: license";
      }

      throw err;
    }
  };

  beforeEach(() => {
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  it("is a section of its own, which the note at the top and the cards link to", () => {
    expect(anchorsOfScanned(scanned).has("without-a-license")).toBe(true);
    expect(english).toContain(
      "> Custom channels are part of the [OneUptime Enterprise Edition](/docs/self-hosted/enterprise) and need an Enterprise license that includes them.",
    );
    expect(english).toContain("See [Without a license](#without-a-license).");
    expect(english).toContain(
      "- [Without a license](#without-a-license): What stops, and what is kept.",
    );
  });

  it("names a feature a license can include, whose running stops with the license", () => {
    expect(ALL_ENTERPRISE_FEATURES).toContain(
      EnterpriseFeature.CustomNotificationChannels,
    );
    expect(RUNTIME_ENTERPRISE_FEATURES).toContain(
      EnterpriseFeature.CustomNotificationChannels,
    );
  });

  it("says the Community Edition sends nothing to a channel, and has no Custom Channels page", () => {
    expect(english).toContain(
      "The Community Edition has no **Custom Channels** page and sends nothing to a channel.",
    );

    for (const billing of [false, true]) {
      setTestBillingEnabled(billing);
      expect(CustomChannelEdition.isActive()).toBe(false);
    }

    const adminDashboardSource: string = path.join(
      PACKAGES_DIR,
      "App",
      "FeatureSet",
      "AdminDashboard",
      "src",
    );

    expect(
      fs.existsSync(
        path.join(adminDashboardSource, "Pages", "Settings", "CustomChannels"),
      ),
    ).toBe(false);
    expect(
      fs.readFileSync(
        path.join(adminDashboardSource, "Utils", "PageMap.ts"),
        "utf8",
      ),
    ).not.toMatch(/CUSTOM_CHANNELS/);
  });

  it("names the trial and the grace period by the license's own lengths, and custom channels run in both", () => {
    expect(withoutALicense).toContain(
      `Custom channels work during the Enterprise Edition's ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial and the ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period after a license expires.`,
    );

    licenseState("no license, inside the 14-day trial").install();
    expect(CustomChannelEdition.isActive()).toBe(true);

    licenseState("license expired less than 30 days ago (grace)").install();
    expect(CustomChannelEdition.isActive()).toBe(true);
  });

  it("stops after them, and with a license that does not include them", () => {
    expect(withoutALicense).toContain(
      "After that, or with a license that does not include them:",
    );

    for (const label of [
      "license expired more than 30 days ago",
      "no license after the trial",
      "invalid license",
    ]) {
      licenseState(label).install();
      expect({ label, isActive: CustomChannelEdition.isActive() }).toEqual({
        label,
        isActive: false,
      });
    }

    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: ALL_ENTERPRISE_FEATURES.filter(
          (feature: EnterpriseFeature): boolean => {
            return feature !== EnterpriseFeature.CustomNotificationChannels;
          },
        ),
      }),
    });
    expect(CustomChannelEdition.isActive()).toBe(false);
  });

  it("says nothing is sent, and a page is recorded in the on-call log as not sent", async () => {
    expect(withoutALicense).toContain(
      "**Nothing is sent to a custom channel.** A page that would have gone to one is recorded in the person's on-call log as not sent, and so is a test.",
    );
    expect(CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE).toMatch(/^Not sent: /);

    const post: jest.SpyInstance = jest.spyOn(API, "post");
    const writeLogRow: jest.SpyInstance = jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: CustomChannelDeliveryResult =
      await CustomNotificationChannelDeliveryService.send({
        customNotificationChannelId: channelId,
        eventType: "on-call.incident.created",
        payload: {},
        userOnCallLogTimelineId: timelineId,
      });

    expect(result).toEqual({
      ok: false,
      message: CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
    });
    expect(post).not.toHaveBeenCalled();
    expect(writeLogRow).toHaveBeenCalledWith({
      id: timelineId,
      data: {
        status: UserNotificationStatus.Error,
        statusMessage: CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
      },
      props: { isRoot: true },
    });
  });

  it("and so is a test: both test routes ask the edition, and the sender refuses a test the same way", async () => {
    const routes: string = readCommonSource(
      "Server/API/CustomNotificationChannelAPI.ts",
    );

    expect(
      routes.split("await CustomChannelEdition.assertAvailable();").length - 1,
    ).toBe(2);

    const post: jest.SpyInstance = jest.spyOn(API, "post");

    expect(
      (
        await CustomNotificationChannelDeliveryService.send({
          customNotificationChannelId: channelId,
          eventType: "test",
          payload: {},
          isTest: true,
        })
      ).message,
    ).toBe(CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE);
    expect(post).not.toHaveBeenCalled();
  });

  it("says channels are no longer offered: every list a screen, readiness and the fallback read is empty", async () => {
    expect(withoutALicense).toContain(
      "**Channels are no longer offered.** They leave people's notification methods, on-call rules and notification settings, and readiness and the fallback stop counting them.",
    );

    // Where each reads them: the list a screen offers, readiness, notifications, the fallback.
    expect(
      readCommonSource("Server/API/CustomNotificationChannelAPI.ts"),
    ).toContain("await this.service.getChannelsThatAreOn();");
    expect(
      readCommonSource("Server/Services/OnCallReadinessService.ts"),
    ).toContain(
      "await CustomNotificationChannelService.getChannelsThatAreOn();",
    );
    expect(
      readCommonSource("Server/Services/UserNotificationSettingService.ts"),
    ).toContain(
      "await CustomNotificationChannelService.getChannelsThatAreOn();",
    );
    expect(
      readCommonSource("Server/Services/UserNotificationRuleService.ts"),
    ).toContain(
      "await CustomNotificationChannelService.getChannelsPagingEveryone();",
    );

    const read: jest.SpyInstance = jest
      .spyOn(CustomNotificationChannelService, "findBy")
      .mockResolvedValue([new CustomNotificationChannel()]);

    expect(
      await CustomNotificationChannelService.getChannelsThatAreOn(),
    ).toEqual([]);
    expect(
      await CustomNotificationChannelService.getChannelsPagingEveryone(),
    ).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it("says the page is read-only: channels can be seen and deleted, not added or changed, and nothing can point at one", () => {
    expect(withoutALicense).toContain(
      "**The page is read-only.** You can see and delete channels, but not add or change them, and no one can point a rule or a notification setting at one.",
    );

    for (const operation of [
      DatabaseRequestType.Create,
      DatabaseRequestType.Update,
    ]) {
      expect(writeOutcome(CustomNotificationChannel, operation, {})).toBe(
        "refused: Community Edition",
      );
    }

    for (const operation of [
      DatabaseRequestType.Read,
      DatabaseRequestType.Delete,
    ]) {
      expect(writeOutcome(CustomNotificationChannel, operation, {})).toBe(
        "allowed",
      );
    }

    expect(
      writeOutcome(UserNotificationRule, DatabaseRequestType.Create, {
        customNotificationChannelId: channelId,
      }),
    ).toBe("refused: Community Edition");
    expect(
      writeOutcome(UserNotificationSetting, DatabaseRequestType.Update, {
        alertByCustomChannel: true,
      }),
    ).toBe("refused: Community Edition");

    // The same after a lapse, in the license's words.
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    expect(
      writeOutcome(CustomNotificationChannel, DatabaseRequestType.Create, {}),
    ).toBe("refused: license");
  });

  it("says nothing is deleted: taking a channel off a rule or a setting is never refused", () => {
    expect(withoutALicense).toContain(
      "**Nothing is deleted.** The channels, and the on-call rules and settings that use them, are kept.",
    );

    expect(
      writeOutcome(UserNotificationRule, DatabaseRequestType.Update, {
        customNotificationChannelId: null,
      }),
    ).toBe("allowed");
    expect(
      writeOutcome(UserNotificationSetting, DatabaseRequestType.Update, {
        alertByCustomChannel: false,
      }),
    ).toBe("allowed");
  });

  it("says everything resumes once a license is activated, without a restart", () => {
    expect(withoutALicense).toContain(
      "Everything resumes as soon as a license is activated, without a restart.",
    );

    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("missing"),
    });

    expect(CustomChannelEdition.isActive()).toBe(false);

    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));

    expect(CustomChannelEdition.isActive()).toBe(true);
    expect(
      writeOutcome(UserNotificationRule, DatabaseRequestType.Create, {
        customNotificationChannelId: channelId,
      }),
    ).toBe("allowed");
  });

  it("says people who joined while they were stopped do not get a channel that pages everyone, and can add it themselves", async () => {
    expect(withoutALicense).toContain(
      "People who joined a project while custom channels were stopped do not get a channel that pages everyone in their rules: they can add it themselves.",
    );

    const channel: CustomNotificationChannel = new CustomNotificationChannel();
    channel._id = channelId.toString();
    jest
      .spyOn(CustomNotificationChannelService, "findBy")
      .mockResolvedValue([channel]);
    const addRules: jest.SpyInstance = jest
      .spyOn(
        UserNotificationRuleService,
        "addDefaultNotificationRulesForVerifiedMethod",
      )
      .mockResolvedValue(undefined);

    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    await UserNotificationRuleService.addCustomChannelsPagingEveryoneForUser({
      projectId: ObjectID.generate(),
      userId: ObjectID.generate(),
    });

    expect(addRules).not.toHaveBeenCalled();

    // Once it runs again, a rule of their own through the channel may be written.
    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));

    expect(
      writeOutcome(UserNotificationRule, DatabaseRequestType.Create, {
        customNotificationChannelId: channelId,
      }),
    ).toBe("allowed");
  });
});

/*
 * THE PAGE SAYS WHERE CUSTOM CHANNELS IS IN THE ADMIN DASHBOARD.
 *
 * Custom Channels is in Settings' Notifications section, with Emails, Call
 * and SMS, WhatsApp, Telegram and Push Notifications (#5373), and that
 * section starts folded - so "open Settings, then Custom Channels" sent a
 * reader looking for an entry the menu does not show. The step names the
 * section, and says it starts folded, in the Admin Dashboard's own words, as
 * the SMTP page names Emails.
 *
 * Core draws the entries the Enterprise plugin adds to Notifications
 * (SettingsNotificationSideMenuItems) at the end of that folded section;
 * that Custom Channels is the one it draws is held where ee/ is checked out,
 * by ee/Tests/UI/CustomChannels/CustomChannelsPlugins.test.tsx.
 */
describe("the custom channels page says where the page is", () => {
  // The plugin's notification entries, drawn last in the section's body.
  const DRAWN_LAST_IN_SECTION: RegExp =
    /<EnterpriseNotificationSettingsItems \/>\s*\) : \(\s*<><\/>\s*\)\}$/;

  const adminSource: string = path.join(
    PACKAGES_DIR,
    "App",
    "FeatureSet",
    "AdminDashboard",
    "src",
  );

  // A dotted key of the Admin Dashboard's locale in one language, as its t() reads it.
  const adminText: (language: string, key: string) => string = (
    language: string,
    key: string,
  ): string => {
    let node: unknown = JSON.parse(
      fs.readFileSync(
        path.join(adminSource, "Locales", `${language}.json`),
        "utf8",
      ),
    );

    for (const part of key.split(".")) {
      node = (node as Record<string, unknown>)[part];
    }

    expect({ language, key, found: typeof node === "string" }).toEqual({
      language,
      key,
      found: true,
    });

    return node as string;
  };

  const ENGLISH_STEP: string = `1. In the Admin Dashboard, open **${adminText("en", "navbar.settings")}**, then **${adminText("en", "sideMenu.settingsNotifications")} > Custom Channels** in the side menu (**${adminText("en", "sideMenu.settingsNotifications")}** starts folded), and select **Add**.`;

  // The same line of a translation: each one is kept line for line with the English.
  const stepIn: (language: string) => string = (language: string): string => {
    const at: number = english.split("\n").indexOf(ENGLISH_STEP);

    expect(at).toBeGreaterThan(-1);

    return readPage(language, PAGE).split("\n")[at] || "";
  };

  it("walks the admin to Settings, then Notifications > Custom Channels, which starts folded", () => {
    expect(adminText("en", "navbar.settings")).toBe("Settings");
    expect(adminText("en", "sideMenu.settingsNotifications")).toBe(
      "Notifications",
    );
    expect(section("Add a Channel")).toContain(ENGLISH_STEP);
    expect(english).not.toContain(
      "open **Settings**, then **Custom Channels**",
    );
  });

  it("is where the Admin Dashboard draws the Enterprise notification entries: at the end of the folded Notifications section", () => {
    const menu: string = fs.readFileSync(
      path.join(adminSource, "Pages", "Settings", "SideMenu.tsx"),
      "utf8",
    );
    const contract: string = fs.readFileSync(
      path.join(adminSource, "Enterprise", "EnterprisePlugins.ts"),
      "utf8",
    );
    const start: number = menu.indexOf(
      'title={t("sideMenu.settingsNotifications")}',
    );
    const end: number = menu.indexOf("</SideMenuSection>", start);
    const notifications: string = menu.slice(start, end);
    const basic: string = menu.slice(
      menu.indexOf('title={t("sideMenu.basic")}'),
      start,
    );

    expect(start).toBeGreaterThan(-1);
    expect(notifications).toContain("defaultCollapsed={true}");
    expect(notifications.trim()).toMatch(DRAWN_LAST_IN_SECTION);
    expect(basic).not.toContain("EnterpriseNotificationSettingsItems");
    expect(menu).toContain(
      "getAdminDashboardPlugins().SettingsNotificationSideMenuItems",
    );
    expect(contract).toContain(
      "SettingsNotificationSideMenuItems?: EnterprisePluginComponent | undefined;",
    );
  });

  it.each(TRANSLATED_LANGUAGES)(
    "says the same in %s, in that language's Admin Dashboard words",
    (language: string) => {
      const step: string = stepIn(language);
      const settings: string = adminText(language, "navbar.settings");
      const notifications: string = adminText(
        language,
        "sideMenu.settingsNotifications",
      );
      // A right-to-left page bolds each step of a path on its own.
      const menuPath: string =
        language === "fa"
          ? `**${notifications}** > **Custom Channels**`
          : `**${notifications} > Custom Channels**`;

      expect({
        language,
        step: step.startsWith("1. "),
        settings: step.includes(`**${settings}**`),
        path: step.includes(menuPath),
        folded: step.split(`**${notifications}`).length - 1,
        add: step.includes("**Add**"),
        settingsFirst: step.indexOf(`**${settings}**`) < step.indexOf(menuPath),
      }).toEqual({
        language,
        step: true,
        settings: true,
        path: true,
        folded: 2,
        add: true,
        settingsFirst: true,
      });
    },
  );
});
