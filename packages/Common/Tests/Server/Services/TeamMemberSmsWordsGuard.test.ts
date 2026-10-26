import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY SMS A TEAM MEMBER GETS IS WRITTEN THE SHORT WAY.
 *
 * OneUptime's texts to its users used to open with "This is a message from
 * OneUptime." and close with "To unsubscribe from this notification go to
 * User Settings in OneUptime Dashboard." - 116 of the 160 characters an SMS
 * part holds, so every page and every notification took two parts or more,
 * each one billed. Now:
 *
 *   - a page's text is built by OnCallPageSms (Utils/Sms), fitted to one
 *     part wherever it can be;
 *   - every other text to a team member is one sentence between
 *     buildNotificationSms's "OneUptime:" and its turn-off sentence, and goes
 *     out through UserNotificationSettingService, which fits its SMS copy.
 *
 * This reads the server, its workers and the enterprise server, and fails
 * on an SMS written the old way, so a new notification cannot bring it back.
 * A phone call still opens "This is a message from OneUptime" - it is read
 * out, not billed by the character - so `sayMessage` and the call text of a
 * shift reminder are not SMS and are not held to this.
 */

// packages/Common/Tests/Server/Services -> the repository.
const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..", "..");

const SCAN_ROOTS: Array<string> = [
  "packages/Common/Server",
  "packages/App/FeatureSet",
  "ee/Server",
];

/*
 * An SMS message property (not a call's sayMessage) written the old way, in
 * a template literal or a quoted string.
 */
const OLD_SMS_OPENING: RegExp =
  /(?<![A-Za-z])(message|smsText):\s*[`"']This is a message from OneUptime/g;

/*
 * Files that send a team member a notification with an SMS some other file
 * writes, and the file that writes it.
 */
const SMS_WRITTEN_ELSEWHERE: Record<string, string> = {
  "packages/Common/Server/Services/IncomingCallMissedCallNotificationService.ts":
    "packages/Common/Server/Utils/IncomingCall/MissedCallNotification.ts",
  "packages/App/FeatureSet/Workers/Jobs/IncidentSla/CheckSlaBreaches.ts":
    "packages/Common/Server/Utils/Incident/IncidentSlaBreachNotice.ts",
};

// The service that sends them, which defines sendUserNotification.
const NOTIFICATION_SETTING_SERVICE: string =
  "packages/Common/Server/Services/UserNotificationSettingService.ts";

const WHITESPACE_RUN: RegExp = /\s+/;
const NUMBER_WITH_PREFIX_SELECTED: RegExp =
  /(incident|alert|episode)NumberWithPrefix:true,/;

// The old closing sentence inside a notification's SMS.
const OLD_SMS_CLOSING: string =
  "To unsubscribe from this notification go to User Settings in OneUptime Dashboard.";

const listFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "build") {
        continue;
      }

      files.push(...listFiles(entryPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(entryPath);
    }
  }

  return files;
};

const sourceFiles: Array<string> = SCAN_ROOTS.flatMap(
  (root: string): Array<string> => {
    return listFiles(path.join(REPO_ROOT, root));
  },
);

const read: (relative: string) => string = (relative: string): string => {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
};

/*
 * The property whose template literal holds the text at `index`: the name
 * before the last ": `" ahead of it (sayMessage for a call's sentence).
 */
const getPropertyBefore: (source: string, index: number) => string = (
  source: string,
  index: number,
): string => {
  const opening: number = source.lastIndexOf(": `", index);

  if (opening === -1) {
    return "";
  }

  let start: number = opening;

  while (start > 0 && isLetter(source[start - 1]!)) {
    start--;
  }

  return source.slice(start, opening);
};

const isLetter: (character: string) => boolean = (
  character: string,
): boolean => {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z")
  );
};

const lineOf: (source: string, index: number) => number = (
  source: string,
  index: number,
): number => {
  return source.slice(0, index).split("\n").length;
};

describe("the SMS a team member gets", () => {
  test("the scan reads the server and its workers", () => {
    expect(sourceFiles.length).toBeGreaterThan(500);
    expect(
      sourceFiles.some((file: string): boolean => {
        return file.endsWith(
          path.join(
            "Workers",
            "Jobs",
            "IncidentOwners",
            "SendStateChangeNotification.ts",
          ),
        );
      }),
    ).toBe(true);
  });

  test("the old opening is found in a template literal and in a quoted string alike", () => {
    for (const written of [
      "message: `This is a message from OneUptime. Probe x is down.`",
      'message: "This is a message from OneUptime. Probe x is down."',
      "smsText:\n  'This is a message from OneUptime. Probe x is down.'",
    ]) {
      expect(written.match(OLD_SMS_OPENING)).not.toBeNull();
    }

    for (const call of [
      "sayMessage: `This is a message from OneUptime. Probe x is down.`",
      'message: "This message is from OneUptime. Your verification code is 1"',
    ]) {
      expect(call.match(OLD_SMS_OPENING)).toBeNull();
    }
  });

  test("never opens the old way", () => {
    const offenders: Array<string> = [];

    for (const file of sourceFiles) {
      const source: string = fs.readFileSync(file, "utf8");

      for (const match of source.matchAll(OLD_SMS_OPENING)) {
        offenders.push(
          `${path.relative(REPO_ROOT, file)}:${lineOf(source, match.index || 0)}`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  test("writes the old closing sentence only where a call says it", () => {
    const offenders: Array<string> = [];

    for (const file of sourceFiles) {
      const source: string = fs.readFileSync(file, "utf8");
      let index: number = source.indexOf(OLD_SMS_CLOSING);

      while (index !== -1) {
        if (getPropertyBefore(source, index) !== "sayMessage") {
          offenders.push(
            `${path.relative(REPO_ROOT, file)}:${lineOf(source, index)}`,
          );
        }

        index = source.indexOf(OLD_SMS_CLOSING, index + 1);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("the pages", () => {
  const source: string = read(
    "packages/Common/Server/Services/UserNotificationRuleService.ts",
  );

  test.each([
    "generateSmsTemplateForIncidentCreated",
    "generateSmsTemplateForAlertCreated",
    "generateSmsTemplateForIncidentEpisodeCreated",
    "generateSmsTemplateForAlertEpisodeCreated",
  ])("%s builds its text with OnCallPageSms", (generator: string) => {
    const start: number = source.indexOf(`public async ${generator}(`);

    expect(start).toBeGreaterThan(-1);

    const body: string = source.slice(
      start,
      source.indexOf("@CaptureSpan()", start + 1),
    );

    expect(body).toContain("message: this.buildOnCallPageSmsText({");
  });

  /*
   * The records a page is about are read with what its text names: a
   * select that lost the severity or the project would leave them out of
   * every page without a word.
   */
  test.each([
    ["incident = await IncidentService.findOneById({", "incidentSeverity"],
    ["alert = await AlertService.findOneById({", "alertSeverity"],
    ["alertEpisode = await AlertEpisodeService.findOneById({", "alertSeverity"],
    [
      "incidentEpisode = await IncidentEpisodeService.findOneById({",
      "incidentSeverity",
    ],
  ])(
    "%s reads the title, number, project and severity names",
    (assignment: string, severity: string) => {
      const start: number = source.indexOf(assignment);

      expect(start).toBeGreaterThan(-1);

      const select: string = source
        .slice(
          source.indexOf("select: {", start),
          source.indexOf("\n      });", start),
        )
        .split(WHITESPACE_RUN)
        .join("");

      expect(select).toContain("title:true,");
      expect(select).toContain("project:{name:true,},");
      expect(select).toContain(`${severity}:{name:true,`);
      expect(select).toMatch(NUMBER_WITH_PREFIX_SELECTED);
    },
  );

  test("buildOnCallPageSmsText fits the text as the Notification service sends it", () => {
    const start: number = source.indexOf("private buildOnCallPageSmsText(");
    const body: string = source.slice(
      start,
      source.indexOf("private getRecordNumberText(", start),
    );

    expect(body).toContain("return buildOnCallPageSms({");
    expect(body).toContain("productName: ONEUPTIME_PRODUCT_NAME,");
    expect(body).toContain("return ProductBrandingText.brandText(text);");
  });
});

describe("the notifications", () => {
  test("every sender of a team member's notification writes its SMS with buildNotificationSms", () => {
    const senders: Array<string> = sourceFiles
      .map((file: string): string => {
        return path.relative(REPO_ROOT, file).split(path.sep).join("/");
      })
      .filter((file: string): boolean => {
        return (
          file !== NOTIFICATION_SETTING_SERVICE &&
          read(file).includes("sendUserNotification(")
        );
      });

    // The owner notices, on-call notices, reminders, SLA and SLO notices...
    expect(senders.length).toBeGreaterThan(40);
    expect(senders).toContain(
      "packages/App/FeatureSet/Workers/Jobs/IncidentSla/CheckSlaBreaches.ts",
    );
    expect(senders).toContain(
      "packages/App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
    );

    const offenders: Array<string> = senders.filter((file: string): boolean => {
      const writer: string = SMS_WRITTEN_ELSEWHERE[file] || file;

      return !read(writer).includes("buildNotificationSms(");
    });

    expect(offenders).toEqual([]);
  });

  test("the SLA breach and SLO status notices say their news in those words", () => {
    const slaJob: string = read(
      "packages/App/FeatureSet/Workers/Jobs/IncidentSla/CheckSlaBreaches.ts",
    );
    const slaNotice: string = read(
      "packages/Common/Server/Utils/Incident/IncidentSlaBreachNotice.ts",
    );
    const sloJob: string = read(
      "packages/App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
    );

    /*
     * The SLA breach job sends what IncidentSlaBreachNotice words: one
     * sentence, which the call reads out too.
     */
    expect(slaJob).toContain("smsMessage: messages.smsMessage,");
    expect(slaNotice).toContain(
      "const missedSentence: string = `Incident ${identifier} missed its SLA ${breachWord} deadline.`;",
    );
    expect(slaNotice).toContain(
      "message: buildNotificationSms(missedSentence),",
    );
    expect(slaJob).not.toContain("View incident in OneUptime Dashboard.");
    expect(slaNotice).not.toContain("View incident in OneUptime Dashboard.");
    expect(sloJob).toContain("message: buildNotificationSms(news),");
    // WhatsApp still says the news alone.
    expect(sloJob).toContain("body: news,");
  });

  test("UserNotificationSettingService sends the SMS copy fitted, and the other copies as written", () => {
    const source: string = read(
      "packages/Common/Server/Services/UserNotificationSettingService.ts",
    );
    const smsBranch: string = source.slice(
      source.indexOf("if (notificationSettings.alertBySMS) {"),
      source.indexOf("if (notificationSettings.alertByCall) {"),
    );

    expect(smsBranch).toContain("message: fitNotificationSmsForSending(");
    expect(smsBranch).toContain("...smsMessage,");
    expect(smsBranch).not.toContain("...data.smsMessage,\n              to:");
    // Telegram and the workspace DMs still read the text as written.
    expect(source).toContain(
      'const smsBody: string = data.smsMessage.message || "";',
    );
  });

  test("shift reminders send their SMS text, and keep the spoken one for calls", () => {
    const source: string = read(
      "packages/Common/Server/Utils/OnCall/OnCallShiftReminderRunner.ts",
    );

    expect(
      source.split("smsText: buildNotificationSms(sentence),").length - 1,
    ).toBe(3);
    expect(source).toContain("message: message.smsText,");
    expect(source).toContain("sayMessage: `${message.text} Good bye.`,");
  });
});
