import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const handlebars: typeof Handlebars = Handlebars.create();

/*
 * Every navigation input has a different destination. A logo, preferences link,
 * copyable fallback, or another action therefore cannot satisfy the primary
 * button assertion by accident. These inputs and the contracts below are
 * explicit test data, not extracted from the templates being tested.
 */
const DESTINATION_KEYS: ReadonlyArray<string> = [
  "homeURL",
  "homeUrl",
  "statusPageUrl",
  "detailsUrl",
  "tokenVerifyUrl",
  "registrationLink",
  "registerLink",
  "signInLink",
  "confirmationUrl",
  "manageSubscriptionUrl",
  "unsubscribeUrl",
  "notificationPreferencesUrl",
  "preferencesLink",
  "projectHomeLink",
  "dashboardLink",
  "invoicePdfUrl",
  "incidentViewLink",
  "alertViewLink",
  "episodeViewLink",
  "monitorViewLink",
  "scheduledMaintenanceViewLink",
  "onCallPolicyViewLink",
  "scheduleViewLink",
  "statusPageViewLink",
  "viewAIAgentLink",
  "viewAIAgentsLink",
  "viewProbeLink",
  "viewProbesLink",
  "sloViewLink",
  "acknowledgeIncidentLink",
  "acknowledgeAlertLink",
  "acknowledgeIncidentEpisodeLink",
  "acknowledgeAlertEpisodeLink",
  "twoFactorAuthUrl",
  "capacityPageLink",
  "healthPageLink",
];
type DestinationKey = (typeof DESTINATION_KEYS)[number];

function destination(key: DestinationKey): string {
  return `https://actions.example.com/${key}?token=${key}-42&label="A & B"&next=%2Foverview%3Fa%3D1%26b%3D2#details`;
}

interface Anchor {
  href: string;
  text: string;
  classes: Array<string>;
}

interface ExpectedAnchor {
  href: string;
  text: string;
}

/*
 * Decode once, like an HTML attribute/text node. Numeric character references
 * are important: Handlebars escapes '=' and quotes as well as ampersands.
 * Strip actual tags before decoding, so literal angle brackets stay text.
 */
function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
    (entity: string, code: string): string => {
      if (code.startsWith("#")) {
        const hex: boolean = code[1]?.toLowerCase() === "x";
        return String.fromCodePoint(
          parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10),
        );
      }
      return named[code.toLowerCase()] ?? entity;
    },
  );
}

function anchors(html: string): Array<Anchor> {
  return Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)).map(
    (match: RegExpMatchArray): Anchor => {
      const attributes: Record<string, string> = {};
      for (const attribute of match[1]!.matchAll(
        /\b([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
      )) {
        attributes[attribute[1]!.toLowerCase()] = decodeHtml(
          attribute[2] ?? attribute[3] ?? "",
        );
      }
      return {
        href: attributes["href"] ?? "",
        text: decodeHtml(match[2]!.replace(/<[^>]*>/g, "")).trim(),
        classes: (attributes["class"] ?? "").split(/\s+/),
      };
    },
  );
}

function action(key: DestinationKey, text: string): ExpectedAnchor {
  return { href: destination(key), text };
}

function copyable(key: DestinationKey): ExpectedAnchor {
  return { href: destination(key), text: destination(key) };
}

function render(
  template: string,
  overrides: Record<string, unknown> = {},
): string {
  const vars: Record<string, unknown> = {
    year: "2026",
    logoUrl: "",
    statusPageName: "Acme Status",
    title: "Service update",
    subject: "Service update",
    projectName: "Acme Production",
    healthPageButtonText: "Inspect database health & capacity",
    hasResources: "false",
    hasMore: "false",
    rows: [],
    alerts: [],
    incidents: [],
  };
  for (const key of DESTINATION_KEYS) {
    vars[key] = destination(key);
  }
  return handlebars.compile(
    fs.readFileSync(Path.join(TEMPLATES_DIR, `${template}.hbs`), "utf8"),
  )({ ...vars, ...overrides });
}

function expectNavigation(
  html: string,
  expectedActions: Array<ExpectedAnchor>,
  expectedFallbacks: Array<ExpectedAnchor>,
): void {
  const parsed: Array<Anchor> = anchors(html);
  const primary: Array<Anchor> = parsed.filter((anchor: Anchor): boolean => {
    return anchor.classes.includes("st-Button-link");
  });
  const fallbacks: Array<Anchor> = parsed.filter((anchor: Anchor): boolean => {
    return (
      !anchor.classes.includes("st-Button-link") &&
      anchor.href !== "" &&
      anchor.text === anchor.href
    );
  });
  const navigation: (anchor: Anchor) => ExpectedAnchor = (
    anchor: Anchor,
  ): ExpectedAnchor => {
    return { href: anchor.href, text: anchor.text };
  };

  /*
   * Compare actual controls, including their labels and order. Merely finding a
   * URL somewhere in the document would pass when only a fallback survived.
   */
  expect(primary.map(navigation)).toEqual(expectedActions);
  expect(fallbacks.map(navigation)).toEqual(expectedFallbacks);
}

beforeAll(() => {
  for (const filename of fs.readdirSync(Path.join(TEMPLATES_DIR, "Partials"))) {
    if (filename.endsWith(".hbs")) {
      handlebars.registerPartial(
        filename.slice(0, -4),
        fs.readFileSync(Path.join(TEMPLATES_DIR, "Partials", filename), "utf8"),
      );
    }
  }
  handlebars.registerHelper("concat", (...args: Array<unknown>): string => {
    return args
      .slice(0, -1)
      .map((value: unknown): string => {
        return value === null || value === undefined ? "" : String(value);
      })
      .join("");
  });
  handlebars.registerHelper(
    "ifCond",
    function (
      this: unknown,
      left: unknown,
      right: unknown,
      options: Handlebars.HelperOptions,
    ): string {
      return left === right ? options.fn(this) : options.inverse(this);
    },
  );
  handlebars.registerHelper(
    "ifNotCond",
    function (
      this: unknown,
      left: unknown,
      right: unknown,
      options: Handlebars.HelperOptions,
    ): string {
      return left !== right ? options.fn(this) : options.inverse(this);
    },
  );
});

/*
 * [template, primary destination input, primary label, copyable destination]
 * A null copyable destination means the email deliberately has no URL fallback.
 */
const SINGLE_ACTION_CONTRACTS: Array<
  [string, DestinationKey, string, DestinationKey | null]
> = [
  [
    "AIAgentConnectionStatusChange",
    "viewAIAgentsLink",
    "View AI Agents",
    "viewAIAgentsLink",
  ],
  [
    "AIAgentOwnerAdded",
    "viewAIAgentLink",
    "View on Dashboard",
    "viewAIAgentLink",
  ],
  [
    "AcknowledgeAlert",
    "acknowledgeAlertLink",
    "Acknowledge Alert",
    "acknowledgeAlertLink",
  ],
  [
    "AcknowledgeAlertEpisode",
    "acknowledgeAlertEpisodeLink",
    "Acknowledge Alert Episode",
    "acknowledgeAlertEpisodeLink",
  ],
  [
    "AcknowledgeIncident",
    "acknowledgeIncidentLink",
    "Acknowledge Incident",
    "acknowledgeIncidentLink",
  ],
  [
    "AcknowledgeIncidentEpisode",
    "acknowledgeIncidentEpisodeLink",
    "Acknowledge Incident Episode",
    "acknowledgeIncidentEpisodeLink",
  ],
  [
    "AlertEpisodeOwnerAdded",
    "episodeViewLink",
    "View on Dashboard",
    "episodeViewLink",
  ],
  [
    "AlertEpisodeOwnerAlertAdded",
    "episodeViewLink",
    "View Alert Episode",
    "episodeViewLink",
  ],
  [
    "AlertEpisodeOwnerNotePosted",
    "episodeViewLink",
    "View on Dashboard",
    "episodeViewLink",
  ],
  [
    "AlertEpisodeOwnerResourceCreated",
    "episodeViewLink",
    "View on Dashboard",
    "episodeViewLink",
  ],
  [
    "AlertEpisodeOwnerStateChanged",
    "episodeViewLink",
    "View on Dashboard",
    "episodeViewLink",
  ],
  ["AlertOwnerAdded", "alertViewLink", "View on Dashboard", "alertViewLink"],
  [
    "AlertOwnerNotePosted",
    "alertViewLink",
    "View on Dashboard",
    "alertViewLink",
  ],
  [
    "AlertOwnerResourceCreated",
    "alertViewLink",
    "View on Dashboard",
    "alertViewLink",
  ],
  [
    "AlertOwnerStateChanged",
    "alertViewLink",
    "View on Dashboard",
    "alertViewLink",
  ],
  [
    "AlertOwnerUnresolvedReminder",
    "alertViewLink",
    "View on Dashboard",
    "alertViewLink",
  ],
  [
    "ClickhouseCapacityWarning",
    "capacityPageLink",
    "View ClickHouse Capacity",
    null,
  ],
  [
    "CompleteRegistration",
    "registrationLink",
    "Complete Registration",
    "registrationLink",
  ],
  [
    "ConfirmStatusPageSubscription",
    "confirmationUrl",
    "Confirm Subscription",
    "statusPageUrl",
  ],
  ["EmailChanged", "tokenVerifyUrl", "Verify Email", "tokenVerifyUrl"],
  ["ForgotPassword", "tokenVerifyUrl", "Reset Password", "tokenVerifyUrl"],
  [
    "IncidentEpisodeOwnerAdded",
    "episodeViewLink",
    "View on Dashboard",
    "episodeViewLink",
  ],
  [
    "IncidentEpisodeOwnerIncidentAdded",
    "episodeViewLink",
    "View Incident Episode",
    "episodeViewLink",
  ],
  [
    "IncidentEpisodeOwnerNotePosted",
    "episodeViewLink",
    "View on Dashboard",
    "episodeViewLink",
  ],
  [
    "IncidentEpisodeOwnerResourceCreated",
    "episodeViewLink",
    "View on Dashboard",
    "episodeViewLink",
  ],
  [
    "IncidentEpisodeOwnerStateChanged",
    "episodeViewLink",
    "View on Dashboard",
    "episodeViewLink",
  ],
  [
    "IncidentMemberAdded",
    "incidentViewLink",
    "View on Dashboard",
    "incidentViewLink",
  ],
  [
    "IncidentOwnerAdded",
    "incidentViewLink",
    "View on Dashboard",
    "incidentViewLink",
  ],
  [
    "IncidentOwnerNotePosted",
    "incidentViewLink",
    "View on Dashboard",
    "incidentViewLink",
  ],
  [
    "IncidentOwnerResourceCreated",
    "incidentViewLink",
    "View on Dashboard",
    "incidentViewLink",
  ],
  [
    "IncidentOwnerStateChanged",
    "incidentViewLink",
    "View on Dashboard",
    "incidentViewLink",
  ],
  [
    "IncidentOwnerUnresolvedReminder",
    "incidentViewLink",
    "View on Dashboard",
    "incidentViewLink",
  ],
  [
    "ManageExistingStatusPageSubscriberSubscription",
    "manageSubscriptionUrl",
    "Manage Subscription",
    "statusPageUrl",
  ],
  [
    "MonitorOwnerAdded",
    "monitorViewLink",
    "View on Dashboard",
    "monitorViewLink",
  ],
  [
    "MonitorOwnerResourceCreated",
    "monitorViewLink",
    "View on Dashboard",
    "monitorViewLink",
  ],
  [
    "MonitorOwnerStatusChanged",
    "monitorViewLink",
    "View on Dashboard",
    "monitorViewLink",
  ],
  [
    "MonitorProbesStatus",
    "monitorViewLink",
    "View on Dashboard",
    "monitorViewLink",
  ],
  ["NotificationRollup", "projectHomeLink", "View Your Project", null],
  [
    "PostgresHealthWarning",
    "healthPageLink",
    "Inspect database health & capacity",
    null,
  ],
  [
    "ProbeConnectionStatusChange",
    "viewProbesLink",
    "View Probes",
    "viewProbesLink",
  ],
  ["ProbeOwnerAdded", "viewProbeLink", "View on Dashboard", "viewProbeLink"],
  [
    "ProjectSubscriptionOverdue",
    "dashboardLink",
    "View on Dashboard",
    "dashboardLink",
  ],
  [
    "RedisHealthWarning",
    "healthPageLink",
    "Inspect database health & capacity",
    null,
  ],
  [
    "ScheduledMaintenanceOwnerAdded",
    "scheduledMaintenanceViewLink",
    "View on Dashboard",
    "scheduledMaintenanceViewLink",
  ],
  [
    "ScheduledMaintenanceOwnerNotePosted",
    "scheduledMaintenanceViewLink",
    "View on Dashboard",
    "scheduledMaintenanceViewLink",
  ],
  [
    "ScheduledMaintenanceOwnerResourceCreated",
    "scheduledMaintenanceViewLink",
    "View on Dashboard",
    "scheduledMaintenanceViewLink",
  ],
  [
    "ScheduledMaintenanceOwnerStateChanged",
    "scheduledMaintenanceViewLink",
    "View on Dashboard",
    "scheduledMaintenanceViewLink",
  ],
  [
    "ScheduledMaintenanceOwnerUnresolvedReminder",
    "scheduledMaintenanceViewLink",
    "View on Dashboard",
    "scheduledMaintenanceViewLink",
  ],
  [
    "SignupWelcomeEmail",
    "tokenVerifyUrl",
    "Verify Email Address",
    "tokenVerifyUrl",
  ],
  ["SloOwnerStatusChanged", "sloViewLink", "View on Dashboard", "sloViewLink"],
  [
    "StatusPageForgotPassword",
    "tokenVerifyUrl",
    "Reset your password",
    "tokenVerifyUrl",
  ],
  [
    "StatusPageOwnerAdded",
    "statusPageViewLink",
    "View on Dashboard",
    "statusPageViewLink",
  ],
  [
    "StatusPageOwnerResourceCreated",
    "statusPageViewLink",
    "View on Dashboard",
    "statusPageViewLink",
  ],
  ["StatusPagePasswordChanged", "homeURL", "Login to your account", "homeURL"],
  [
    "StatusPageWelcomeEmail",
    "tokenVerifyUrl",
    "Set up my account",
    "tokenVerifyUrl",
  ],
  [
    "SubscribedToStatusPage",
    "statusPageUrl",
    "Go to Status Page",
    "statusPageUrl",
  ],
  [
    "TwoFactorBackupCodeUsed",
    "twoFactorAuthUrl",
    "Manage two factor authentication",
    null,
  ],
  [
    "TwoFactorBackupCodesCreated",
    "twoFactorAuthUrl",
    "Manage two factor authentication",
    null,
  ],
  [
    "TwoFactorBackupCodesRegenerated",
    "twoFactorAuthUrl",
    "Manage two factor authentication",
    null,
  ],
  [
    "UserAddedToOnCallPolicy",
    "onCallPolicyViewLink",
    "View on Dashboard",
    "onCallPolicyViewLink",
  ],
  [
    "UserCurrentlyOnOnCallRoster",
    "onCallPolicyViewLink",
    "View on Dashboard",
    "onCallPolicyViewLink",
  ],
  [
    "UserNextOnOnCallRoster",
    "onCallPolicyViewLink",
    "View on Dashboard",
    "onCallPolicyViewLink",
  ],
  [
    "UserNoLongerActiveOnOnCallRoster",
    "onCallPolicyViewLink",
    "View on Dashboard",
    "onCallPolicyViewLink",
  ],
  [
    "UserOnCallShiftReassigned",
    "scheduleViewLink",
    "View on Dashboard",
    "scheduleViewLink",
  ],
  [
    "UserOnCallShiftReminder",
    "scheduleViewLink",
    "View on Dashboard",
    "scheduleViewLink",
  ],
  [
    "UserRemovedFromOnCallPolicy",
    "onCallPolicyViewLink",
    "View on Dashboard",
    "onCallPolicyViewLink",
  ],
];

describe("the primary and copyable actions have independent destinations", () => {
  test.each(SINGLE_ACTION_CONTRACTS)(
    "%s keeps its named primary action and copyable fallback",
    (
      template: string,
      key: DestinationKey,
      label: string,
      fallback: DestinationKey | null,
    ) => {
      expectNavigation(
        render(template),
        [action(key, label)],
        fallback ? [copyable(fallback)] : [],
      );
    },
  );
});

/*
 * The note/state-only notices offer a copyable link rather than a button.
 * Declaring both variants explicitly also protects their absence of a CTA.
 */
const SUBSCRIBER_CONTRACTS: Array<[string, string | null, string | null]> = [
  ["SubscriberIncidentCreated", "View Incident Details", "View Status Page"],
  [
    "SubscriberIncidentStateChanged",
    "View Incident Details",
    "View Status Page",
  ],
  [
    "SubscriberIncidentPostmortemCreated",
    "Read Full Postmortem",
    "View Status Page",
  ],
  ["SubscriberEpisodeCreated", "View Incident Details", "View Status Page"],
  [
    "SubscriberEpisodeStateChanged",
    "View Incident Details",
    "View Status Page",
  ],
  [
    "SubscriberScheduledMaintenanceEventCreated",
    "View Maintenance Details",
    "View Status Page",
  ],
  ["SubscriberAnnouncementCreated", "View Announcement", "View Status Page"],
  [
    "StatusPageSubscriberReport",
    "View Full Status Page",
    "View Full Status Page",
  ],
  ["SubscriberIncidentNoteCreated", null, null],
  ["SubscriberEpisodeNoteCreated", null, null],
  ["SubscriberScheduledMaintenanceEventNoteCreated", null, null],
  ["SubscriberScheduledMaintenanceEventStateChanged", null, null],
];

describe.each(SUBSCRIBER_CONTRACTS)(
  "%s subscriber navigation",
  (
    template: string,
    detailsLabel: string | null,
    statusLabel: string | null,
  ) => {
    test("uses the event destination when both event and status destinations are present", () => {
      expectNavigation(
        render(template),
        detailsLabel ? [action("detailsUrl", detailsLabel)] : [],
        detailsLabel ? [] : [copyable("detailsUrl")],
      );
    });

    test.each([undefined, "", null])(
      "falls back to the status page for detailsUrl=%s",
      (detailsUrl: unknown) => {
        expectNavigation(
          render(template, { detailsUrl }),
          statusLabel ? [action("statusPageUrl", statusLabel)] : [],
          statusLabel ? [] : [copyable("statusPageUrl")],
        );
      },
    );

    test("keeps the event action when the general status destination is absent", () => {
      expectNavigation(
        render(template, { statusPageUrl: undefined }),
        detailsLabel ? [action("detailsUrl", detailsLabel)] : [],
        detailsLabel ? [] : [copyable("detailsUrl")],
      );
    });

    test("omits event navigation when neither destination is supplied", () => {
      expectNavigation(
        render(template, { detailsUrl: undefined, statusPageUrl: undefined }),
        [],
        [],
      );
    });
  },
);

describe("invitation actions respect membership and account state", () => {
  test.each([
    ["true", "true", "registerLink", "Create Your Account"],
    ["true", "false", "signInLink", "Sign In to OneUptime"],
    ["false", "true", "registerLink", "Create Your Account"],
    ["false", "false", "signInLink", "Sign In to OneUptime"],
    [undefined, undefined, "signInLink", "Sign In to OneUptime"],
  ] as Array<[string | undefined, string | undefined, DestinationKey, string]>)(
    "accepted=%s newUser=%s chooses the intended account action",
    (
      isInvitationAccepted: string | undefined,
      isNewUser: string | undefined,
      key: DestinationKey,
      label: string,
    ) => {
      expectNavigation(
        render("InviteMember", { isInvitationAccepted, isNewUser }),
        [action(key, label)],
        [copyable(key)],
      );
    },
  );
});

describe("invoice actions are independently available", () => {
  test("keeps PDF, its fallback, and billing navigation distinct when both are present", () => {
    expectNavigation(
      render("Invoice"),
      [
        action("invoicePdfUrl", "View Invoice PDF"),
        action("dashboardLink", "View Billing Dashboard"),
      ],
      [copyable("invoicePdfUrl")],
    );
  });

  test.each([undefined, "", null])(
    "keeps PDF navigation when the billing destination is %s",
    (dashboardLink: unknown) => {
      expectNavigation(
        render("Invoice", { dashboardLink }),
        [action("invoicePdfUrl", "View Invoice PDF")],
        [copyable("invoicePdfUrl")],
      );
    },
  );

  test.each([undefined, "", null])(
    "keeps billing navigation when the PDF destination is %s",
    (invoicePdfUrl: unknown) => {
      expectNavigation(
        render("Invoice", { invoicePdfUrl }),
        [action("dashboardLink", "View Billing Dashboard")],
        [],
      );
    },
  );

  test("omits both controls when neither destination is supplied", () => {
    expectNavigation(
      render("Invoice", { invoicePdfUrl: undefined, dashboardLink: undefined }),
      [],
      [],
    );
  });
});

describe("optional administrator actions do not become dead controls", () => {
  test.each([
    ["ClickhouseCapacityWarning", "capacityPageLink"],
    ["PostgresHealthWarning", "healthPageLink"],
    ["RedisHealthWarning", "healthPageLink"],
  ] as Array<[string, DestinationKey]>)(
    "%s omits its action when the destination is absent",
    (template: string, key: DestinationKey) => {
      expectNavigation(render(template, { [key]: undefined }), [], []);
    },
  );
});
