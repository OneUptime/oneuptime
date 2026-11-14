import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY SMS AND CALL THE SERVER SENDS SAYS WHICH TWILIO ACCOUNT IT GOES
 * THROUGH, AND THE ONES TO A PROJECT'S MEMBERS GO THROUGH ITS DEFAULT.
 *
 * Project Settings -> Notifications -> Notification Settings tells people that the SMS and
 * calls to everyone in their project - on-call alerts, notifications,
 * verification codes - go through the project's default Twilio config, and
 * a project's first config now becomes that default by itself. That is only
 * true while every sender asks for it: the code that verifies a number for
 * incoming call routing did not, so it went out through OneUptime's own
 * account, paid from the project's balance.
 *
 * So this reads every SmsService.sendSms and CallService.makeCall call in
 * the server and its workers and holds each to the rule of its kind:
 *
 *   - a message to a project's members passes the project's default config
 *     for its kind of message - its default for SMS, or for calls
 *     (ProjectCallSMSConfigService.getProjectDefaultTwilioConfig);
 *   - a message to a status page's subscribers passes that page's own config
 *     (ProjectCallSMSConfigService.toTwilioConfig of its callSmsConfig);
 *   - the Notification service's own routes pass on the config they were
 *     handed, or the one being tested;
 *   - a master admin's test of the server's own settings goes through the
 *     server's own account, and says so: it passes no config
 *     (customTwilioConfig: undefined) and names no project.
 *
 * A file that starts sending SMS or calls has to be put on one of the lists
 * below, so whoever adds it decides which rule it follows.
 */

// packages/Common/Tests/Server/Services -> packages/
const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");

const SCAN_ROOTS: Array<string> = [
  "Common/Server",
  "App/FeatureSet/Workers",
  "App/FeatureSet/Notification",
];

// SMS and calls to a project's members.
const MEMBER_SENDERS: Array<string> = [
  "Common/Server/Services/UserCallService.ts",
  "Common/Server/Services/UserIncomingCallNumberService.ts",
  "Common/Server/Services/UserNotificationRuleService.ts",
  "Common/Server/Services/UserNotificationSettingService.ts",
  "Common/Server/Services/UserSmsService.ts",
  // An on-call test page, sent the way every page to a person is.
  "Common/Server/Utils/OnCall/OnCallTestPageDelivery.ts",
];

// SMS to a status page's subscribers.
const STATUS_PAGE_SENDERS: Array<string> = [
  "App/FeatureSet/Workers/Jobs/Announcement/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/Incident/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentEpisode/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentEpisodePublicNote/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentEpisodeStateTimeline/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers.ts",
  "Common/Server/API/StatusPageAPI.ts",
  "Common/Server/Services/ScheduledMaintenanceService.ts",
  "Common/Server/Services/StatusPageSubscriberService.ts",
];

// The Notification service's routes: the send itself, and Send Test SMS/Call.
const NOTIFICATION_ROUTES: Array<string> = [
  "App/FeatureSet/Notification/API/Call.ts",
  "App/FeatureSet/Notification/API/SMS.ts",
];

// A master admin's test SMS and call, through the server's own settings.
const SERVER_SETTINGS_TESTS: Array<string> = [
  "App/FeatureSet/Notification/Services/ServerTestSendService.ts",
];

const SEND_CALL: RegExp = /\b(SmsService\.sendSms|CallService\.makeCall)\(/g;

// A status page's own config, as its senders pass it (whitespace removed).
const STATUS_PAGE_CONFIG: RegExp =
  /customTwilioConfig:ProjectCallSMSConfigService\.toTwilioConfig\(status[pP]age\.callSmsConfig/;

interface SendCall {
  file: string;
  line: number;
  callee: string;
  // The call's arguments, whitespace removed.
  text: string;
}

function listTypeScriptFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "build") {
      continue;
    }

    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...listTypeScriptFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      found.push(fullPath);
    }
  }

  return found;
}

// The text of a call from its opening parenthesis to the matching one.
function argumentsOf(source: string, openParen: number): string {
  let depth: number = 0;

  for (let index: number = openParen; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth--;

      if (depth === 0) {
        return source.slice(openParen, index + 1);
      }
    }
  }

  return source.slice(openParen);
}

function findSendCalls(): Array<SendCall> {
  const calls: Array<SendCall> = [];

  for (const root of SCAN_ROOTS) {
    for (const filePath of listTypeScriptFiles(path.join(PACKAGES_DIR, root))) {
      const source: string = fs.readFileSync(filePath, "utf8");
      const file: string = path
        .relative(PACKAGES_DIR, filePath)
        .split(path.sep)
        .join("/");

      for (const match of source.matchAll(SEND_CALL)) {
        const openParen: number = match.index! + match[0].length - 1;

        calls.push({
          file,
          line: source.slice(0, match.index).split("\n").length,
          callee: match[1]!,
          text: argumentsOf(source, openParen).replace(/\s+/g, ""),
        });
      }
    }
  }

  return calls;
}

function describeCall(call: SendCall): string {
  return `${call.file}:${call.line} ${call.callee}`;
}

const SEND_CALLS: Array<SendCall> = findSendCalls();

const filesSending: Set<string> = new Set<string>(
  SEND_CALLS.map((call: SendCall): string => {
    return call.file;
  }),
);

describe("the SMS and calls the server sends", () => {
  test("are really read", () => {
    // 30 calls in 20 files on 2026-10-04.
    expect(SEND_CALLS.length).toBeGreaterThanOrEqual(25);
    expect(filesSending.size).toBeGreaterThanOrEqual(18);

    expect(
      SEND_CALLS.filter((call: SendCall): boolean => {
        return call.callee === "CallService.makeCall";
      }).length,
    ).toBeGreaterThanOrEqual(5);
  });

  test("each say which Twilio account they go through", () => {
    expect(
      SEND_CALLS.filter((call: SendCall): boolean => {
        return !call.text.includes("customTwilioConfig:");
      }).map(describeCall),
    ).toEqual([]);
  });

  test("come from files that are each on exactly one list", () => {
    const lists: Array<Array<string>> = [
      MEMBER_SENDERS,
      STATUS_PAGE_SENDERS,
      NOTIFICATION_ROUTES,
      SERVER_SETTINGS_TESTS,
    ];

    const unlisted: Array<string> = Array.from(filesSending).filter(
      (file: string): boolean => {
        return (
          lists.filter((list: Array<string>): boolean => {
            return list.includes(file);
          }).length !== 1
        );
      },
    );

    expect(unlisted).toEqual([]);

    // And no list keeps a file that no longer sends anything.
    const stale: Array<string> = lists.flat().filter((file: string) => {
      return !filesSending.has(file);
    });

    expect(stale).toEqual([]);
  });

  test("to a project's members go through the project's default Twilio config", () => {
    for (const file of MEMBER_SENDERS) {
      const source: string = fs.readFileSync(
        path.join(PACKAGES_DIR, file),
        "utf8",
      );

      expect({
        file,
        readsTheDefault: source.includes(
          "ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(",
        ),
      }).toEqual({ file, readsTheDefault: true });
    }

    expect(
      SEND_CALLS.filter((call: SendCall): boolean => {
        return (
          MEMBER_SENDERS.includes(call.file) &&
          !call.text.includes("customTwilioConfig:projectTwilioConfig")
        );
      }).map(describeCall),
    ).toEqual([]);
  });

  /*
   * A project has a default for SMS and a default for calls - a config used
   * for SMS only and one used for calls only can both be the default
   * (issue #6574) - so the default is read for the kind of message: an SMS
   * passes the config read as the default for SMS, a call the one read as
   * the default for calls. One read for both would send the calls through
   * the SMS config, which makes none, and they would go through OneUptime's
   * own account.
   */
  test("to a project's members pass the default read for their kind of message", () => {
    const READ: RegExp =
      /const(\w+):TwilioConfig\|undefined=awaitProjectCallSMSConfigService\.getProjectDefaultTwilioConfig\(/g;
    // The kind a read names, its last argument (the source has no spaces here).
    const READ_FOR_KIND: RegExp = /,TwilioMessageKind\.(SMS|Call),?\)$/;
    // The variable a send passes as its Twilio config.
    const SENT_THROUGH: RegExp = /customTwilioConfig:(\w+)[,}]/;
    const KIND_OF_CALLEE: Record<string, string> = {
      "SmsService.sendSms": "SMS",
      "CallService.makeCall": "Call",
    };

    const problems: Array<string> = [];
    let reads: number = 0;

    for (const file of MEMBER_SENDERS) {
      const source: string = fs
        .readFileSync(path.join(PACKAGES_DIR, file), "utf8")
        .replace(/\s+/g, "");

      // Each variable a default is read into, and the kind it is read for.
      const kindOfVariable: Map<string, string> = new Map();

      for (const match of source.matchAll(READ)) {
        reads++;

        const args: string = argumentsOf(
          source,
          match.index! + match[0].length - 1,
        );
        const kind: string | undefined = READ_FOR_KIND.exec(args)?.[1];

        if (!kind) {
          problems.push(`${file}: ${match[1]} is read for no kind of message`);
          continue;
        }

        if (
          kindOfVariable.has(match[1]!) &&
          kindOfVariable.get(match[1]!) !== kind
        ) {
          problems.push(`${file}: ${match[1]} is read for SMS and for calls`);
        }

        kindOfVariable.set(match[1]!, kind);
      }

      for (const call of SEND_CALLS) {
        if (call.file !== file) {
          continue;
        }

        const variable: string | undefined = SENT_THROUGH.exec(call.text)?.[1];

        if (
          !variable ||
          kindOfVariable.get(variable) !== KIND_OF_CALLEE[call.callee]
        ) {
          problems.push(
            `${describeCall(call)} passes ${variable}, read for ${kindOfVariable.get(variable || "") || "nothing"}`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
    // Every member sender reads a default, the rule service one of each kind.
    expect(reads).toBeGreaterThanOrEqual(MEMBER_SENDERS.length + 1);
  });

  test("to a status page's subscribers go through that page's own config", () => {
    expect(
      SEND_CALLS.filter((call: SendCall): boolean => {
        return (
          STATUS_PAGE_SENDERS.includes(call.file) &&
          !STATUS_PAGE_CONFIG.test(call.text)
        );
      }).map(describeCall),
    ).toEqual([]);
  });

  /*
   * The server setup's test send checks what the server itself sends with,
   * so it passes no project's config and names no project: a config or a
   * project in it would test something else, and be paid for by a project.
   */
  test("that test the server's own settings go through the server's own account", () => {
    const calls: Array<SendCall> = SEND_CALLS.filter(
      (call: SendCall): boolean => {
        return SERVER_SETTINGS_TESTS.includes(call.file);
      },
    );

    // The test SMS and the test call.
    expect(calls.length).toBeGreaterThanOrEqual(2);

    expect(
      calls
        .filter((call: SendCall): boolean => {
          return (
            !call.text.includes("customTwilioConfig:undefined,") ||
            call.text.includes("projectId")
          );
        })
        .map(describeCall),
    ).toEqual([]);
  });
});
