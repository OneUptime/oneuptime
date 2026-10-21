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

// An SMS message property (not a call's sayMessage) written the old way.
const OLD_SMS_OPENING: RegExp =
  /(?<![A-Za-z])(message|smsText):\s*`This is a message from OneUptime/g;

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
