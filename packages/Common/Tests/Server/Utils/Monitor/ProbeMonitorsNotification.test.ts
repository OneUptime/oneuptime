import User from "../../../../Models/DatabaseModels/User";
import ProbeMonitorsNotification, {
  ProbeAffectedMonitor,
  ProbeMonitorsNotificationContent,
  ProbeMonitorsRecipient,
  ProbeMonitorsRecipientOwnership,
} from "../../../../Server/Utils/Monitor/ProbeMonitorsNotification";
import Dictionary from "../../../../Types/Dictionary";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../../Types/JSON";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import { WhatsAppTemplateIds } from "../../../../Types/WhatsApp/WhatsAppTemplates";
import { describe, expect, test } from "@jest/globals";

/*
 * ProbeMonitorsNotification is the pure half of issue #2486: when a probe
 * connects or disconnects, every person hears about it ONCE, in a message
 * that names the probe and lists the monitors of theirs it affected, instead
 * of once per monitor on every channel.
 *
 * These tests pin the two things that decide what a person receives:
 *
 *   - who hears about which monitors (groupMonitorsByRecipient): monitor
 *     owners only, the project owners as the fallback for a monitor with no
 *     owners, one entry per person however they were reached, and a stable
 *     order,
 *   - what each channel says (buildContent): the email subject and vars the
 *     MonitorsAffectedByProbeStatus template reads, the SMS and call text,
 *     the push, and the WhatsApp payload that has to fit the per-monitor
 *     template Meta already approved.
 *
 * The event type is pinned too: reusing the per-monitor event is what makes
 * the channels people already chose (or turned off) apply unchanged.
 *
 * So is the subject's lack of braces. MailService compiles the subject as a
 * Handlebars template, and the probe name is user-controlled, so the subject
 * loses every "{" and "}" from the name. Nothing else does: the vars, SMS,
 * call, push and WhatsApp keep the name exactly as typed.
 */

const PROJECT_ID: string = "5f0c1b2a-0000-4000-8000-000000000001";
const PROJECT_NAME: string = "Acme Production";
const PROBE_NAME: string = "eu-west-1";
const DASHBOARD: string = `https://oneuptime.test/dashboard/${PROJECT_ID}`;
const DISCONNECTED_LIST_LINK: string = `${DASHBOARD}/monitors/probe-disconnected`;
const MONITORS_LIST_LINK: string = `${DASHBOARD}/monitors`;
const UNSUBSCRIBE_LINE: string =
  "To unsubscribe from this notification go to User Settings in OneUptime Dashboard.";

const ANY_BRACE: RegExp = /[{}]/;

/*
 * Probe names built to get past a brace strip into MailService's Handlebars
 * compile, each with what should be left: the same text minus every brace.
 * Several defeat a strip that only removes "{{" and "}}": "a{b}c" and
 * "{{{x}}}" keep single braces, and "{}}{x" has no "{{" at all until its
 * "}}" is removed, which leaves the unterminated expression "{{x".
 */
const ADVERSARIAL_PROBE_NAMES: Array<[string, string]> = [
  ["{{{x}}}", "x"],
  ["{{#each}}", "#each"],
  ["a{b}c", "abc"],
  ["}}{{", ""],
  ["{}}{x", "x"],
  ["{}}{}}{", ""],
  ["a{}}{{b}}}", "ab"],
  ["{{{{raw}}}}", "raw"],
  ["{{> partial}}", "> partial"],
  ["{{!-- note --}}", "!-- note --"],
  ["\\{{x}}", "\\x"],
  ["{{lookup this 'constructor'}}", "lookup this 'constructor'"],
  ["{", ""],
  ["}", ""],
  ["Edge {EU}", "Edge EU"],
];

// Deterministic ids, so the name-then-id ordering can be asserted exactly.
function monitorIdFor(n: number): ObjectID {
  return new ObjectID(
    `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`,
  );
}

function monitor(n: number, name: string): ProbeAffectedMonitor {
  const monitorId: ObjectID = monitorIdFor(n);

  return {
    monitorId: monitorId,
    monitorName: name,
    monitorViewLink: `${DASHBOARD}/monitors/${monitorId.toString()}`,
  };
}

function numberedMonitors(count: number): Array<ProbeAffectedMonitor> {
  const result: Array<ProbeAffectedMonitor> = [];

  for (let i: number = 1; i <= count; i++) {
    result.push(monitor(i, `Monitor ${i.toString().padStart(2, "0")}`));
  }

  return result;
}

/*
 * A fresh User per call, as MonitorService.findOwners and
 * ProjectService.getOwners return: the same person reached for two monitors
 * arrives as two different objects with the same id.
 */
function user(id: string): User {
  const result: User = new User();
  result.id = new ObjectID(id);
  return result;
}

function ownersOf(
  entries: Array<[ProbeAffectedMonitor, Array<User>]>,
): Dictionary<Array<User>> {
  const result: Dictionary<Array<User>> = {};

  for (const [affected, owners] of entries) {
    result[affected.monitorId.toString()] = owners;
  }

  return result;
}

interface RecipientSummary {
  userId: string;
  monitorNames: Array<string>;
  ownership: ProbeMonitorsRecipientOwnership;
}

// Who got which monitors, in the order the recipients came out.
function summarize(
  recipients: Array<ProbeMonitorsRecipient>,
): Array<RecipientSummary> {
  return recipients.map(
    (recipient: ProbeMonitorsRecipient): RecipientSummary => {
      return {
        userId: recipient.user.id!.toString(),
        monitorNames: recipient.monitors.map(
          (affected: ProbeAffectedMonitor): string => {
            return affected.monitorName;
          },
        ),
        ownership: recipient.ownership,
      };
    },
  );
}

function monitorIdsOf(monitors: Array<ProbeAffectedMonitor>): Array<string> {
  return monitors.map((affected: ProbeAffectedMonitor): string => {
    return affected.monitorId.toString();
  });
}

function recipientWith(
  monitors: Array<ProbeAffectedMonitor>,
  ownership: ProbeMonitorsRecipientOwnership = ProbeMonitorsRecipientOwnership.MonitorOwner,
): ProbeMonitorsRecipient {
  return {
    user: user("user-alice"),
    monitors: monitors,
    ownership: ownership,
  };
}

function build(data: {
  monitors: Array<ProbeAffectedMonitor>;
  isProbeDisconnected: boolean;
  ownership?: ProbeMonitorsRecipientOwnership;
  probeName?: string;
}): ProbeMonitorsNotificationContent {
  return ProbeMonitorsNotification.buildContent({
    probeName: data.probeName ?? PROBE_NAME,
    projectName: PROJECT_NAME,
    isProbeDisconnected: data.isProbeDisconnected,
    recipient: recipientWith(
      data.monitors,
      data.ownership ?? ProbeMonitorsRecipientOwnership.MonitorOwner,
    ),
    viewMonitorsLink: data.isProbeDisconnected
      ? DISCONNECTED_LIST_LINK
      : MONITORS_LIST_LINK,
  });
}

function listedMonitors(
  content: ProbeMonitorsNotificationContent,
): Array<JSONObject> {
  return content.emailEnvelope.vars["monitors"] as unknown as Array<JSONObject>;
}

describe("ProbeMonitorsNotification", () => {
  describe("EVENT_TYPE - existing preferences keep working", () => {
    test("is the per-monitor probe status event, so the channels people already chose apply", () => {
      /*
       * A new event type would start from default channels and ignore every
       * user who had turned this notification off.
       */
      expect(ProbeMonitorsNotification.EVENT_TYPE).toBe(
        NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES,
      );
    });
  });

  describe("groupMonitorsByRecipient - who hears about which monitors", () => {
    test("a monitor with owners goes to its owners only, never to the project owners", () => {
      const checkout: ProbeAffectedMonitor = monitor(1, "Checkout API");

      const recipients: Array<ProbeMonitorsRecipient> =
        ProbeMonitorsNotification.groupMonitorsByRecipient({
          monitors: [checkout],
          ownersByMonitorId: ownersOf([[checkout, [user("user-alice")]]]),
          projectOwners: [user("user-pat")],
        });

      expect(summarize(recipients)).toEqual([
        {
          userId: "user-alice",
          monitorNames: ["Checkout API"],
          ownership: ProbeMonitorsRecipientOwnership.MonitorOwner,
        },
      ]);
    });

    test("a monitor with no owners goes to every project owner, whether its entry is missing or empty", () => {
      const missingEntry: ProbeAffectedMonitor = monitor(1, "Billing");
      const emptyEntry: ProbeAffectedMonitor = monitor(2, "Search");

      const recipients: Array<ProbeMonitorsRecipient> =
        ProbeMonitorsNotification.groupMonitorsByRecipient({
          monitors: [missingEntry, emptyEntry],
          // "Billing" has no key at all; "Search" has an empty owner list.
          ownersByMonitorId: ownersOf([[emptyEntry, []]]),
          projectOwners: [user("user-pat"), user("user-quinn")],
        });

      expect(summarize(recipients)).toEqual([
        {
          userId: "user-pat",
          monitorNames: ["Billing", "Search"],
          ownership: ProbeMonitorsRecipientOwnership.ProjectOwner,
        },
        {
          userId: "user-quinn",
          monitorNames: ["Billing", "Search"],
          ownership: ProbeMonitorsRecipientOwnership.ProjectOwner,
        },
      ]);
    });

    test("a person who owns one monitor and is the project-owner fallback for another gets ONE message listing both", () => {
      const checkout: ProbeAffectedMonitor = monitor(1, "Checkout API");
      const unowned: ProbeAffectedMonitor = monitor(2, "Search");

      const recipients: Array<ProbeMonitorsRecipient> =
        ProbeMonitorsNotification.groupMonitorsByRecipient({
          monitors: [checkout, unowned],
          ownersByMonitorId: ownersOf([[checkout, [user("user-alice")]]]),
          // Alice is also a project owner, as a separate User object.
          projectOwners: [user("user-alice"), user("user-pat")],
        });

      expect(summarize(recipients)).toEqual([
        {
          userId: "user-alice",
          monitorNames: ["Checkout API", "Search"],
          ownership: ProbeMonitorsRecipientOwnership.Mixed,
        },
        {
          userId: "user-pat",
          monitorNames: ["Search"],
          ownership: ProbeMonitorsRecipientOwnership.ProjectOwner,
        },
      ]);
    });

    test("different people get only their own monitors", () => {
      const checkout: ProbeAffectedMonitor = monitor(1, "Checkout API");
      const payments: ProbeAffectedMonitor = monitor(2, "Payments");
      const shared: ProbeAffectedMonitor = monitor(3, "Shared Gateway");

      const recipients: Array<ProbeMonitorsRecipient> =
        ProbeMonitorsNotification.groupMonitorsByRecipient({
          monitors: [checkout, payments, shared],
          ownersByMonitorId: ownersOf([
            [checkout, [user("user-alice")]],
            [payments, [user("user-bob")]],
            [shared, [user("user-alice"), user("user-bob")]],
          ]),
          projectOwners: [user("user-pat")],
        });

      expect(summarize(recipients)).toEqual([
        {
          userId: "user-alice",
          monitorNames: ["Checkout API", "Shared Gateway"],
          ownership: ProbeMonitorsRecipientOwnership.MonitorOwner,
        },
        {
          userId: "user-bob",
          monitorNames: ["Payments", "Shared Gateway"],
          ownership: ProbeMonitorsRecipientOwnership.MonitorOwner,
        },
      ]);
    });

    test("a person listed twice for the same monitor (user owner and team owner) gets it once", () => {
      const checkout: ProbeAffectedMonitor = monitor(1, "Checkout API");

      const recipients: Array<ProbeMonitorsRecipient> =
        ProbeMonitorsNotification.groupMonitorsByRecipient({
          monitors: [checkout],
          ownersByMonitorId: ownersOf([
            [
              checkout,
              [user("user-alice"), user("user-bob"), user("user-alice")],
            ],
          ]),
          projectOwners: [],
        });

      expect(summarize(recipients)).toEqual([
        {
          userId: "user-alice",
          monitorNames: ["Checkout API"],
          ownership: ProbeMonitorsRecipientOwnership.MonitorOwner,
        },
        {
          userId: "user-bob",
          monitorNames: ["Checkout API"],
          ownership: ProbeMonitorsRecipientOwnership.MonitorOwner,
        },
      ]);
    });

    test("a user without an id cannot be addressed and is skipped, owner or project owner", () => {
      const checkout: ProbeAffectedMonitor = monitor(1, "Checkout API");
      const unowned: ProbeAffectedMonitor = monitor(2, "Search");

      const recipients: Array<ProbeMonitorsRecipient> =
        ProbeMonitorsNotification.groupMonitorsByRecipient({
          monitors: [checkout, unowned],
          ownersByMonitorId: ownersOf([
            [checkout, [new User(), user("user-alice")]],
          ]),
          projectOwners: [new User(), user("user-pat")],
        });

      expect(summarize(recipients)).toEqual([
        {
          userId: "user-alice",
          monitorNames: ["Checkout API"],
          ownership: ProbeMonitorsRecipientOwnership.MonitorOwner,
        },
        {
          userId: "user-pat",
          monitorNames: ["Search"],
          ownership: ProbeMonitorsRecipientOwnership.ProjectOwner,
        },
      ]);
    });

    test("an unowned monitor in a project with no owners reaches nobody, and owned monitors are unaffected", () => {
      const checkout: ProbeAffectedMonitor = monitor(1, "Checkout API");
      const unowned: ProbeAffectedMonitor = monitor(2, "Search");

      expect(
        ProbeMonitorsNotification.groupMonitorsByRecipient({
          monitors: [unowned],
          ownersByMonitorId: {},
          projectOwners: [],
        }),
      ).toEqual([]);

      expect(
        summarize(
          ProbeMonitorsNotification.groupMonitorsByRecipient({
            monitors: [checkout, unowned],
            ownersByMonitorId: ownersOf([[checkout, [user("user-alice")]]]),
            projectOwners: [],
          }),
        ),
      ).toEqual([
        {
          userId: "user-alice",
          monitorNames: ["Checkout API"],
          ownership: ProbeMonitorsRecipientOwnership.MonitorOwner,
        },
      ]);
    });

    test("no affected monitors means no recipients, even with owners on hand", () => {
      expect(
        ProbeMonitorsNotification.groupMonitorsByRecipient({
          monitors: [],
          ownersByMonitorId: ownersOf([
            [monitor(1, "Checkout API"), [user("user-alice")]],
          ]),
          projectOwners: [user("user-pat")],
        }),
      ).toEqual([]);

      expect(
        ProbeMonitorsNotification.groupMonitorsByRecipient({
          monitors: [],
          ownersByMonitorId: {},
          projectOwners: [],
        }),
      ).toEqual([]);
    });

    test("each recipient's monitors are sorted by name, then by id for equal names", () => {
      const search: ProbeAffectedMonitor = monitor(3, "Search");
      const checkoutSecond: ProbeAffectedMonitor = monitor(2, "Checkout API");
      const payments: ProbeAffectedMonitor = monitor(5, "Payments");
      const checkoutFirst: ProbeAffectedMonitor = monitor(1, "Checkout API");
      const all: Array<ProbeAffectedMonitor> = [
        search,
        checkoutSecond,
        payments,
        checkoutFirst,
      ];

      const recipients: Array<ProbeMonitorsRecipient> =
        ProbeMonitorsNotification.groupMonitorsByRecipient({
          monitors: all,
          ownersByMonitorId: ownersOf(
            all.map(
              (
                affected: ProbeAffectedMonitor,
              ): [ProbeAffectedMonitor, Array<User>] => {
                return [affected, [user("user-alice")]];
              },
            ),
          ),
          projectOwners: [],
        });

      expect(recipients).toHaveLength(1);
      expect(monitorIdsOf(recipients[0]!.monitors)).toEqual(
        monitorIdsOf([checkoutFirst, checkoutSecond, payments, search]),
      );
    });

    test("recipients come out in the order they were first reached, not sorted by id", () => {
      const checkout: ProbeAffectedMonitor = monitor(1, "Checkout API");
      const payments: ProbeAffectedMonitor = monitor(2, "Payments");

      const recipients: Array<ProbeMonitorsRecipient> =
        ProbeMonitorsNotification.groupMonitorsByRecipient({
          monitors: [checkout, payments],
          ownersByMonitorId: ownersOf([
            [checkout, [user("user-carol")]],
            [payments, [user("user-bob"), user("user-alice")]],
          ]),
          projectOwners: [],
        });

      expect(
        recipients.map((recipient: ProbeMonitorsRecipient): string => {
          return recipient.user.id!.toString();
        }),
      ).toEqual(["user-carol", "user-bob", "user-alice"]);
    });
  });

  describe("sortMonitors", () => {
    test("orders by name, then by id, and leaves the caller's array untouched", () => {
      const input: Array<ProbeAffectedMonitor> = [
        monitor(4, "Search"),
        monitor(2, "Checkout API"),
        monitor(1, "Checkout API"),
        monitor(3, "Billing"),
      ];
      const inputOrder: Array<string> = monitorIdsOf(input);

      const sorted: Array<ProbeAffectedMonitor> =
        ProbeMonitorsNotification.sortMonitors(input);

      expect(monitorIdsOf(sorted)).toEqual([
        monitorIdFor(3).toString(),
        monitorIdFor(1).toString(),
        monitorIdFor(2).toString(),
        monitorIdFor(4).toString(),
      ]);
      expect(sorted).not.toBe(input);
      expect(monitorIdsOf(input)).toEqual(inputOrder);
    });

    test("is stable: entries that compare equal keep their input order", () => {
      const first: ProbeAffectedMonitor = {
        ...monitor(1, "Checkout API"),
        monitorViewLink: "https://oneuptime.test/first",
      };
      const second: ProbeAffectedMonitor = {
        ...monitor(1, "Checkout API"),
        monitorViewLink: "https://oneuptime.test/second",
      };

      expect(
        ProbeMonitorsNotification.sortMonitors([
          first,
          monitor(0, "Billing"),
          second,
        ]).map((affected: ProbeAffectedMonitor): string => {
          return affected.monitorViewLink;
        }),
      ).toEqual([
        monitor(0, "Billing").monitorViewLink,
        "https://oneuptime.test/first",
        "https://oneuptime.test/second",
      ]);
    });
  });

  describe("text helpers", () => {
    test("getMonitorCountLabel is singular only for exactly one", () => {
      expect(ProbeMonitorsNotification.getMonitorCountLabel(1)).toBe(
        "1 monitor",
      );
      expect(ProbeMonitorsNotification.getMonitorCountLabel(2)).toBe(
        "2 monitors",
      );
      expect(ProbeMonitorsNotification.getMonitorCountLabel(20)).toBe(
        "20 monitors",
      );
      expect(ProbeMonitorsNotification.getMonitorCountLabel(0)).toBe(
        "0 monitors",
      );
    });

    test("getSummary names the probe, the count and the project, with the verb agreeing", () => {
      expect(
        ProbeMonitorsNotification.getSummary({
          probeName: PROBE_NAME,
          projectName: PROJECT_NAME,
          isProbeDisconnected: true,
          monitorCount: 1,
        }),
      ).toBe(
        "Probe eu-west-1 is disconnected. 1 monitor in project Acme Production is not being monitored.",
      );

      expect(
        ProbeMonitorsNotification.getSummary({
          probeName: PROBE_NAME,
          projectName: PROJECT_NAME,
          isProbeDisconnected: true,
          monitorCount: 20,
        }),
      ).toBe(
        "Probe eu-west-1 is disconnected. 20 monitors in project Acme Production are not being monitored.",
      );

      expect(
        ProbeMonitorsNotification.getSummary({
          probeName: PROBE_NAME,
          projectName: PROJECT_NAME,
          isProbeDisconnected: false,
          monitorCount: 1,
        }),
      ).toBe(
        "Probe eu-west-1 is connected again. 1 monitor in project Acme Production is being monitored again.",
      );

      expect(
        ProbeMonitorsNotification.getSummary({
          probeName: PROBE_NAME,
          projectName: PROJECT_NAME,
          isProbeDisconnected: false,
          monitorCount: 3,
        }),
      ).toBe(
        "Probe eu-west-1 is connected again. 3 monitors in project Acme Production are being monitored again.",
      );
    });

    test("getEmailSubject reads differently for each direction", () => {
      expect(
        ProbeMonitorsNotification.getEmailSubject({
          probeName: PROBE_NAME,
          isProbeDisconnected: true,
          monitorCount: 20,
        }),
      ).toBe("[Probe Disconnected] eu-west-1: 20 monitors not being monitored");

      expect(
        ProbeMonitorsNotification.getEmailSubject({
          probeName: PROBE_NAME,
          isProbeDisconnected: false,
          monitorCount: 1,
        }),
      ).toBe("[Probe Connected] eu-west-1: 1 monitor being monitored again");
    });

    test("getEmailSubject strips Handlebars braces from the probe name, because MailService compiles the subject", () => {
      expect(
        ProbeMonitorsNotification.getEmailSubject({
          probeName: "{{projectName}} probe }}",
          isProbeDisconnected: true,
          monitorCount: 2,
        }),
      ).toBe(
        "[Probe Disconnected] projectName probe : 2 monitors not being monitored",
      );
    });

    test("getEmailSubject strips single braces from the probe name too", () => {
      expect(
        ProbeMonitorsNotification.getEmailSubject({
          probeName: "Edge {EU}",
          isProbeDisconnected: true,
          monitorCount: 2,
        }),
      ).toBe("[Probe Disconnected] Edge EU: 2 monitors not being monitored");

      expect(
        ProbeMonitorsNotification.getEmailSubject({
          probeName: "Edge {EU}",
          isProbeDisconnected: false,
          monitorCount: 1,
        }),
      ).toBe("[Probe Connected] Edge EU: 1 monitor being monitored again");
    });

    test("getEmailSubject has no brace at all for any adversarial probe name, in either direction", () => {
      /*
       * The subject's own text has no braces, so any brace left would come
       * from the probe name, and MailService would read it as template
       * syntax.
       */
      for (const [probeName, stripped] of ADVERSARIAL_PROBE_NAMES) {
        const disconnected: string = ProbeMonitorsNotification.getEmailSubject({
          probeName: probeName,
          isProbeDisconnected: true,
          monitorCount: 3,
        });
        const connected: string = ProbeMonitorsNotification.getEmailSubject({
          probeName: probeName,
          isProbeDisconnected: false,
          monitorCount: 3,
        });

        expect(disconnected).not.toMatch(ANY_BRACE);
        expect(connected).not.toMatch(ANY_BRACE);
        expect(disconnected).toBe(
          `[Probe Disconnected] ${stripped}: 3 monitors not being monitored`,
        );
        expect(connected).toBe(
          `[Probe Connected] ${stripped}: 3 monitors being monitored again`,
        );
      }
    });

    test("stripHandlebarsBraces removes every brace, paired or single, and leaves the rest alone", () => {
      expect(
        ProbeMonitorsNotification.stripHandlebarsBraces("{{a}} b {{c}}"),
      ).toBe("a b c");
      /*
       * A single brace goes too. Keeping it is what let two single braces
       * meet once a "}}" between them was removed (see the next test).
       */
      expect(
        ProbeMonitorsNotification.stripHandlebarsBraces("eu-west {primary}"),
      ).toBe("eu-west primary");
      expect(ProbeMonitorsNotification.stripHandlebarsBraces(PROBE_NAME)).toBe(
        PROBE_NAME,
      );
      // No braces: nothing else is touched, including a backslash.
      expect(
        ProbeMonitorsNotification.stripHandlebarsBraces(
          "edge <eu> & \\ [primary] (1)",
        ),
      ).toBe("edge <eu> & \\ [primary] (1)");
      expect(ProbeMonitorsNotification.stripHandlebarsBraces("")).toBe("");
    });

    test("stripHandlebarsBraces leaves no brace pair behind, even where removing one joins two single braces", () => {
      /*
       * "{}}{x" has no "{{" to strip, but removing its "}}" leaves "{{x",
       * which MailService's Handlebars compile reads as an unterminated
       * expression. The returned value must be safe on its own.
       */
      expect(ProbeMonitorsNotification.stripHandlebarsBraces("{}}{x")).toBe(
        "x",
      );
      expect(ProbeMonitorsNotification.stripHandlebarsBraces("{}}{}}{")).toBe(
        "",
      );
      expect(
        ProbeMonitorsNotification.stripHandlebarsBraces("a{}}{{b}}}"),
      ).toBe("ab");

      for (const probeName of ["{}}{x", "{}}{}}{", "a{}}{{b}}}"]) {
        const stripped: string =
          ProbeMonitorsNotification.stripHandlebarsBraces(probeName);

        expect(stripped).not.toContain("{{");
        expect(stripped).not.toContain("}}");
      }
    });

    test("stripHandlebarsBraces leaves no '{' or '}' at all in any output", () => {
      for (const [probeName] of ADVERSARIAL_PROBE_NAMES) {
        const stripped: string =
          ProbeMonitorsNotification.stripHandlebarsBraces(probeName);

        expect(stripped).not.toContain("{");
        expect(stripped).not.toContain("}");
      }
    });

    test("stripHandlebarsBraces removes only the braces from an adversarial name, and a second pass changes nothing", () => {
      for (const [probeName, expected] of ADVERSARIAL_PROBE_NAMES) {
        const stripped: string =
          ProbeMonitorsNotification.stripHandlebarsBraces(probeName);

        expect(stripped).toBe(expected);
        expect(ProbeMonitorsNotification.stripHandlebarsBraces(stripped)).toBe(
          stripped,
        );
      }
    });

    test("getWhatsAppMonitorName names the first monitor and counts the others", () => {
      const monitors: Array<ProbeAffectedMonitor> = [
        monitor(1, "Checkout API"),
        monitor(2, "Payments"),
        monitor(3, "Search"),
      ];

      expect(ProbeMonitorsNotification.getWhatsAppMonitorName([])).toBe("");
      expect(
        ProbeMonitorsNotification.getWhatsAppMonitorName(monitors.slice(0, 1)),
      ).toBe("Checkout API");
      expect(
        ProbeMonitorsNotification.getWhatsAppMonitorName(monitors.slice(0, 2)),
      ).toBe("Checkout API and 1 other monitor");
      expect(ProbeMonitorsNotification.getWhatsAppMonitorName(monitors)).toBe(
        "Checkout API and 2 other monitors",
      );
    });
  });

  describe("buildContent - the email", () => {
    test("a disconnect for a monitor owner fills every var the template reads", () => {
      const checkout: ProbeAffectedMonitor = monitor(1, "Checkout API");
      const search: ProbeAffectedMonitor = monitor(2, "Search");

      const content: ProbeMonitorsNotificationContent = build({
        monitors: [checkout, search],
        isProbeDisconnected: true,
      });

      expect(content.emailEnvelope.templateType).toBe(
        EmailTemplateType.MonitorsAffectedByProbeStatus,
      );
      expect(content.emailEnvelope.subject).toBe(
        "[Probe Disconnected] eu-west-1: 2 monitors not being monitored",
      );
      expect(content.emailEnvelope.vars).toEqual({
        title: "2 monitors not being monitored",
        probeName: PROBE_NAME,
        projectName: PROJECT_NAME,
        probeStatus: "Disconnected",
        isProbeDisconnected: "true",
        monitorCount: "2",
        monitors: [
          {
            monitorName: "Checkout API",
            monitorViewLink: checkout.monitorViewLink,
          },
          { monitorName: "Search", monitorViewLink: search.monitorViewLink },
        ],
        hasMore: "false",
        remainingCount: "0",
        viewMonitorsLink: DISCONNECTED_LIST_LINK,
        ownership: ProbeMonitorsRecipientOwnership.MonitorOwner,
        isOwner: "true",
      });
    });

    test("a reconnect reads as 'being monitored again' and links the monitors list", () => {
      const content: ProbeMonitorsNotificationContent = build({
        monitors: [monitor(1, "Checkout API")],
        isProbeDisconnected: false,
      });

      expect(content.emailEnvelope.subject).toBe(
        "[Probe Connected] eu-west-1: 1 monitor being monitored again",
      );
      expect(content.emailEnvelope.vars).toMatchObject({
        title: "1 monitor being monitored again",
        probeStatus: "Connected",
        isProbeDisconnected: "false",
        monitorCount: "1",
        viewMonitorsLink: MONITORS_LIST_LINK,
      });
    });

    test("isOwner is set only when every monitor is the recipient's own", () => {
      const monitors: Array<ProbeAffectedMonitor> = [
        monitor(1, "Checkout API"),
      ];

      const projectOwner: ProbeMonitorsNotificationContent = build({
        monitors: monitors,
        isProbeDisconnected: true,
        ownership: ProbeMonitorsRecipientOwnership.ProjectOwner,
      });
      const mixed: ProbeMonitorsNotificationContent = build({
        monitors: monitors,
        isProbeDisconnected: true,
        ownership: ProbeMonitorsRecipientOwnership.Mixed,
      });
      const owner: ProbeMonitorsNotificationContent = build({
        monitors: monitors,
        isProbeDisconnected: true,
        ownership: ProbeMonitorsRecipientOwnership.MonitorOwner,
      });

      expect(projectOwner.emailEnvelope.vars["ownership"]).toBe("ProjectOwner");
      expect(projectOwner.emailEnvelope.vars).not.toHaveProperty("isOwner");
      expect(mixed.emailEnvelope.vars["ownership"]).toBe("Mixed");
      expect(mixed.emailEnvelope.vars).not.toHaveProperty("isOwner");
      expect(owner.emailEnvelope.vars["ownership"]).toBe("MonitorOwner");
      expect(owner.emailEnvelope.vars["isOwner"]).toBe("true");
    });

    test("names reach the vars exactly as typed, since the template escapes them", () => {
      const content: ProbeMonitorsNotificationContent = build({
        monitors: [monitor(1, "<b>Checkout</b> & Co")],
        isProbeDisconnected: true,
        probeName: "edge <eu> & {{x}}",
      });

      // Pre-escaping here would show "&amp;lt;b&amp;gt;" in the email.
      expect(listedMonitors(content)[0]).toMatchObject({
        monitorName: "<b>Checkout</b> & Co",
      });
      expect(content.emailEnvelope.vars["probeName"]).toBe("edge <eu> & {{x}}");
      // Only the subject, which MailService compiles, loses the braces.
      expect(content.emailEnvelope.subject).toBe(
        "[Probe Disconnected] edge <eu> & x: 1 monitor not being monitored",
      );
    });

    test("a probe named 'Edge {EU}' loses its braces in the subject only; every other channel keeps the name as typed", () => {
      const api: ProbeAffectedMonitor = monitor(1, "API {v2}");

      const content: ProbeMonitorsNotificationContent = build({
        monitors: [api],
        isProbeDisconnected: true,
        probeName: "Edge {EU}",
      });

      expect(content.emailEnvelope.subject).toBe(
        "[Probe Disconnected] Edge EU: 1 monitor not being monitored",
      );

      // The template escapes vars, so they carry the name unchanged.
      expect(content.emailEnvelope.vars["probeName"]).toBe("Edge {EU}");
      expect(listedMonitors(content)).toEqual([
        { monitorName: "API {v2}", monitorViewLink: api.monitorViewLink },
      ]);

      const summary: string =
        "Probe Edge {EU} is disconnected. 1 monitor in project Acme Production is not being monitored.";

      expect(content.smsMessage.message).toBe(
        `This is a message from OneUptime. ${summary} ${UNSUBSCRIBE_LINE}`,
      );
      expect(content.callRequestMessage.data).toEqual([
        {
          sayMessage: `This is a message from OneUptime. ${summary} ${UNSUBSCRIBE_LINE} Good bye.`,
        },
      ]);
      expect(content.pushNotificationMessage).toMatchObject({
        title: "Probe Disconnected: Edge {EU}",
        body: summary,
      });
      expect(content.pushNotificationMessage.data).toMatchObject({
        probeName: "Edge {EU}",
      });
      expect(content.whatsAppMessage.templateVariables).toMatchObject({
        monitor_name: "API {v2}",
      });
      expect(content.whatsAppMessage.body).toContain(
        "Probes for monitor API {v2} are Disconnected.",
      );
    });

    test("exactly 25 monitors are all listed, with no '...and N more'", () => {
      const monitors: Array<ProbeAffectedMonitor> = numberedMonitors(25);

      const content: ProbeMonitorsNotificationContent = build({
        monitors: monitors,
        isProbeDisconnected: true,
      });

      expect(ProbeMonitorsNotification.MAX_MONITORS_IN_EMAIL).toBe(25);
      expect(listedMonitors(content)).toHaveLength(25);
      expect(listedMonitors(content)[24]).toEqual({
        monitorName: "Monitor 25",
        monitorViewLink: monitors[24]!.monitorViewLink,
      });
      expect(content.emailEnvelope.vars).toMatchObject({
        monitorCount: "25",
        hasMore: "false",
        remainingCount: "0",
      });
    });

    test("26 monitors list the first 25 and summarise the one left over", () => {
      const monitors: Array<ProbeAffectedMonitor> = numberedMonitors(26);

      const content: ProbeMonitorsNotificationContent = build({
        monitors: monitors,
        isProbeDisconnected: true,
      });

      const listedNames: Array<string> = listedMonitors(content).map(
        (listed: JSONObject): string => {
          return listed["monitorName"] as string;
        },
      );

      expect(listedNames).toHaveLength(25);
      expect(listedNames[0]).toBe("Monitor 01");
      expect(listedNames[24]).toBe("Monitor 25");
      expect(listedNames).not.toContain("Monitor 26");
      // The count everywhere else is the true total, not the listed 25.
      expect(content.emailEnvelope.vars).toMatchObject({
        title: "26 monitors not being monitored",
        monitorCount: "26",
        hasMore: "true",
        remainingCount: "1",
      });
      expect(content.emailEnvelope.subject).toBe(
        "[Probe Disconnected] eu-west-1: 26 monitors not being monitored",
      );
    });
  });

  describe("buildContent - SMS and voice call", () => {
    test("carry the one-sentence summary and the unsubscribe line, not the monitor names", () => {
      const content: ProbeMonitorsNotificationContent = build({
        monitors: [monitor(1, "Checkout API"), monitor(2, "Search")],
        isProbeDisconnected: true,
      });
      const summary: string =
        "Probe eu-west-1 is disconnected. 2 monitors in project Acme Production are not being monitored.";

      expect(content.smsMessage.message).toBe(
        `This is a message from OneUptime. ${summary} ${UNSUBSCRIBE_LINE}`,
      );
      expect(content.smsMessage.message).not.toContain("Checkout API");

      expect(content.callRequestMessage.data).toEqual([
        {
          sayMessage: `This is a message from OneUptime. ${summary} ${UNSUBSCRIBE_LINE} Good bye.`,
        },
      ]);
    });

    test("a reconnect says the monitors are being monitored again", () => {
      const content: ProbeMonitorsNotificationContent = build({
        monitors: [monitor(1, "Checkout API")],
        isProbeDisconnected: false,
      });
      const summary: string =
        "Probe eu-west-1 is connected again. 1 monitor in project Acme Production is being monitored again.";

      expect(content.smsMessage.message).toBe(
        `This is a message from OneUptime. ${summary} ${UNSUBSCRIBE_LINE}`,
      );
      expect(content.callRequestMessage.data).toEqual([
        {
          sayMessage: `This is a message from OneUptime. ${summary} ${UNSUBSCRIBE_LINE} Good bye.`,
        },
      ]);
    });
  });

  describe("buildContent - push", () => {
    test("one monitor: the push opens that monitor", () => {
      const checkout: ProbeAffectedMonitor = monitor(1, "Checkout API");

      const content: ProbeMonitorsNotificationContent = build({
        monitors: [checkout],
        isProbeDisconnected: true,
      });

      expect(content.pushNotificationMessage).toMatchObject({
        title: "Probe Disconnected: eu-west-1",
        body: "Probe eu-west-1 is disconnected. 1 monitor in project Acme Production is not being monitored.",
        tag: "probe-monitors-status",
        clickAction: checkout.monitorViewLink,
        url: checkout.monitorViewLink,
      });
      expect(content.pushNotificationMessage.data).toMatchObject({
        url: checkout.monitorViewLink,
      });
    });

    test("several monitors: the push opens the list, and a reconnect says Connected", () => {
      const content: ProbeMonitorsNotificationContent = build({
        monitors: numberedMonitors(3),
        isProbeDisconnected: false,
      });

      expect(content.pushNotificationMessage).toMatchObject({
        title: "Probe Connected: eu-west-1",
        body: "Probe eu-west-1 is connected again. 3 monitors in project Acme Production are being monitored again.",
        clickAction: MONITORS_LIST_LINK,
        url: MONITORS_LIST_LINK,
      });
    });
  });

  describe("buildContent - WhatsApp reuses the approved per-monitor template", () => {
    test("one monitor: its name and its own link fill the template", () => {
      const checkout: ProbeAffectedMonitor = monitor(1, "Checkout API");

      const content: ProbeMonitorsNotificationContent = build({
        monitors: [checkout],
        isProbeDisconnected: true,
      });

      expect(content.whatsAppMessage.templateKey).toBe(
        WhatsAppTemplateIds.MonitorProbeStatusChangedNotification,
      );
      expect(content.whatsAppMessage.templateLanguageCode).toBe("en");
      expect(content.whatsAppMessage.templateVariables).toEqual({
        monitor_name: "Checkout API",
        probe_status: "Disconnected",
        monitor_link: checkout.monitorViewLink,
      });
      expect(content.whatsAppMessage.body).toContain(
        "Probes for monitor Checkout API are Disconnected.",
      );
      expect(content.whatsAppMessage.body).toContain(checkout.monitorViewLink);
    });

    test("twenty monitors: the first name plus a count, and the list link", () => {
      const monitors: Array<ProbeAffectedMonitor> = numberedMonitors(20);

      const content: ProbeMonitorsNotificationContent = build({
        monitors: monitors,
        isProbeDisconnected: true,
      });

      expect(content.whatsAppMessage.templateKey).toBe(
        WhatsAppTemplateIds.MonitorProbeStatusChangedNotification,
      );
      expect(content.whatsAppMessage.templateVariables).toEqual({
        monitor_name: "Monitor 01 and 19 other monitors",
        probe_status: "Disconnected",
        monitor_link: DISCONNECTED_LIST_LINK,
      });
      expect(content.whatsAppMessage.body).toContain(
        "Probes for monitor Monitor 01 and 19 other monitors are Disconnected.",
      );
      expect(content.whatsAppMessage.body).toContain(DISCONNECTED_LIST_LINK);
      expect(content.whatsAppMessage.body).not.toContain(
        monitors[0]!.monitorViewLink,
      );
    });

    test("a reconnect fills probe_status with Connected", () => {
      const content: ProbeMonitorsNotificationContent = build({
        monitors: numberedMonitors(2),
        isProbeDisconnected: false,
      });

      expect(content.whatsAppMessage.templateVariables).toEqual({
        monitor_name: "Monitor 01 and 1 other monitor",
        probe_status: "Connected",
        monitor_link: MONITORS_LIST_LINK,
      });
      expect(content.whatsAppMessage.body).toContain(
        "Probes for monitor Monitor 01 and 1 other monitor are Connected.",
      );
    });
  });

  describe("grouping and content together - the issue #2486 scenario", () => {
    test("twenty monitors on one probe reach each person in one message about their own monitors", () => {
      const owned: Array<ProbeAffectedMonitor> = numberedMonitors(20);
      const unowned: ProbeAffectedMonitor = monitor(99, "Zz Unowned");

      const recipients: Array<ProbeMonitorsRecipient> =
        ProbeMonitorsNotification.groupMonitorsByRecipient({
          monitors: [...owned, unowned],
          ownersByMonitorId: ownersOf(
            owned.map(
              (
                affected: ProbeAffectedMonitor,
              ): [ProbeAffectedMonitor, Array<User>] => {
                return [affected, [user("user-alice")]];
              },
            ),
          ),
          projectOwners: [user("user-pat")],
        });

      expect(recipients).toHaveLength(2);

      const contents: Array<ProbeMonitorsNotificationContent> = recipients.map(
        (
          recipient: ProbeMonitorsRecipient,
        ): ProbeMonitorsNotificationContent => {
          return ProbeMonitorsNotification.buildContent({
            probeName: PROBE_NAME,
            projectName: PROJECT_NAME,
            isProbeDisconnected: true,
            recipient: recipient,
            viewMonitorsLink: DISCONNECTED_LIST_LINK,
          });
        },
      );

      expect(
        contents.map((content: ProbeMonitorsNotificationContent): string => {
          return content.emailEnvelope.subject;
        }),
      ).toEqual([
        "[Probe Disconnected] eu-west-1: 20 monitors not being monitored",
        "[Probe Disconnected] eu-west-1: 1 monitor not being monitored",
      ]);
      // The project owner's single fallback monitor is opened directly.
      expect(contents[1]!.pushNotificationMessage.clickAction).toBe(
        unowned.monitorViewLink,
      );
      expect(listedMonitors(contents[1]!)).toEqual([
        {
          monitorName: "Zz Unowned",
          monitorViewLink: unowned.monitorViewLink,
        },
      ]);
    });
  });
});
