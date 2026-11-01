import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY TEXT ONEUPTIME WRITES TO A STATUS PAGE'S SMS SUBSCRIBERS GOES OUT IN
 * GSM-7'S CHARACTERS (Utils/Sms/SubscriberSms).
 *
 * A curly apostrophe in an incident's title made every subscriber's text
 * UCS-2 - 70 characters a part instead of 160 - so it cost two or three
 * times as much. The default texts (an incident, its state, a note, an
 * episode, a scheduled maintenance event, an announcement, a postmortem)
 * and the texts about a subscription itself (its confirmation link, its
 * welcome, its manage link) are written with writeDefaultSubscriberSms. A
 * team's own SMS template is sent as written.
 *
 * The notifications' texts are written in each subscriber's language, by
 * SubscriberMessageText.sms and smsWithLinks, which both end in
 * writeDefaultSubscriberSms: the words are the translator's, the characters
 * GSM-7's either way.
 *
 * Read from the source, because these texts are written in a dozen jobs: a
 * new default text that writes its own words, without them, fails here.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const SCAN_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "App", "FeatureSet", "Workers"),
  path.join(PACKAGES_DIR, "Common", "Server"),
];

// How a notification's default text is written: in the subscriber's language.
const DEFAULT_TEXT_WRITERS: ReadonlyArray<string> = [
  "SubscriberMessageText.smsWithLinks(",
  "SubscriberMessageText.sms(",
];

/*
 * How a default text written by hand, in English only, ended: with the
 * unsubscribe link. None is left; one that comes back skips the
 * subscriber's language, and perhaps writeDefaultSubscriberSms too.
 */
const HAND_WRITTEN_TEXT_END: string = "Unsub: ${unsubscribeUrl}`";

const WRITER_CALL: string = "writeDefaultSubscriberSms(";

const MESSAGE_TEXT: string =
  "Common/Server/Utils/StatusPage/SubscriberMessageText.ts";

const listSourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (["node_modules", "build", "dist", "Tests"].includes(entry.name)) {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      files.push(fullPath);
    }
  }

  return files;
};

const relative: (file: string) => string = (file: string): string => {
  return path.relative(PACKAGES_DIR, file).split(path.sep).join("/");
};

interface DefaultText {
  file: string;
  // The statement that assigns it, from its "smsMessage =" to the writer.
  statement: string;
}

const DEFAULT_TEXTS: Array<DefaultText> = [];

// Files that still end a text with the English unsubscribe link by hand.
const HAND_WRITTEN_TEXTS: Array<string> = [];

for (const directory of SCAN_DIRS) {
  for (const file of listSourceFiles(directory)) {
    if (relative(file) === MESSAGE_TEXT) {
      continue;
    }

    const source: string = fs.readFileSync(file, "utf8");

    for (const writer of DEFAULT_TEXT_WRITERS) {
      let at: number = source.indexOf(writer);

      while (at !== -1) {
        const start: number = source.lastIndexOf("smsMessage =", at);

        DEFAULT_TEXTS.push({
          file: relative(file),
          statement: source.slice(
            start === -1 ? Math.max(0, at - 400) : start,
            at + writer.length,
          ),
        });

        at = source.indexOf(writer, at + writer.length);
      }
    }

    if (source.includes(HAND_WRITTEN_TEXT_END)) {
      HAND_WRITTEN_TEXTS.push(relative(file));
    }
  }
}

// A method of SubscriberMessageText, from its name to its end.
const methodOf: (source: string, name: string) => string = (
  source: string,
  name: string,
): string => {
  const start: number = source.indexOf(`public static ${name}(`);

  expect(start).toBeGreaterThan(-1);

  return source.slice(start, source.indexOf("\n  }\n", start));
};

const read: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
};

describe("the texts OneUptime writes to a status page's SMS subscribers", () => {
  test("are found: every kind of subscriber notification", () => {
    const files: Array<string> = DEFAULT_TEXTS.map(
      (text: DefaultText): string => {
        return text.file;
      },
    );

    for (const expected of [
      "App/FeatureSet/Workers/Jobs/Incident/SendNotificationToSubscribers.ts",
      "App/FeatureSet/Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers.ts",
      "App/FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers.ts",
      "App/FeatureSet/Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers.ts",
      "App/FeatureSet/Workers/Jobs/IncidentEpisode/SendNotificationToSubscribers.ts",
      "App/FeatureSet/Workers/Jobs/IncidentEpisodeStateTimeline/SendNotificationToSubscribers.ts",
      "App/FeatureSet/Workers/Jobs/IncidentEpisodePublicNote/SendNotificationToSubscribers.ts",
      "App/FeatureSet/Workers/Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers.ts",
      "App/FeatureSet/Workers/Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers.ts",
      "App/FeatureSet/Workers/Jobs/Announcement/SendNotificationToSubscribers.ts",
      "Common/Server/Services/ScheduledMaintenanceService.ts",
    ]) {
      expect(files).toContain(expected);
    }

    expect(DEFAULT_TEXTS.length).toBeGreaterThanOrEqual(11);
  });

  test("each default text is written with writeDefaultSubscriberSms, in the subscriber's language", () => {
    const messageText: string = read(MESSAGE_TEXT);

    for (const name of ["sms", "smsWithLinks"]) {
      expect(methodOf(messageText, name)).toContain(`return ${WRITER_CALL}`);
    }

    // Each is written in the subscriber's language.
    const outsideLanguage: Array<string> = DEFAULT_TEXTS.filter(
      (text: DefaultText): boolean => {
        return !text.statement.includes("writeInLanguage(");
      },
    ).map((text: DefaultText): string => {
      return text.file;
    });

    expect(outsideLanguage).toEqual([]);

    // And none is written by hand, in English, beside them.
    expect(HAND_WRITTEN_TEXTS).toEqual([]);
  });

  test("a team's own SMS template is sent as written", () => {
    for (const text of DEFAULT_TEXTS) {
      const source: string = read(text.file);

      expect({
        file: text.file,
        wrapsTemplate: source.includes(
          `${WRITER_CALL}StatusPageSubscriberNotificationTemplateServiceClass`,
        ),
      }).toEqual({ file: text.file, wrapsTemplate: false });
    }
  });

  test("the texts about a subscription itself - the confirmation link and the welcome - are written the same way", () => {
    const service: string = read(
      "Common/Server/Services/StatusPageSubscriberService.ts",
    );
    const sendText: string = service.slice(
      service.indexOf("private sendText("),
      service.indexOf("\n  }\n", service.indexOf("private sendText(")),
    );

    expect(sendText).toContain(
      "message: writeDefaultSubscriberSms(data.message),",
    );
  });

  test("the manage link a subscriber asks for is written the same way, a custom template as written", () => {
    const api: string = read("Common/Server/API/StatusPageAPI.ts");

    expect(api).toContain(
      "smsMessage = writeDefaultSubscriberSms(defaultChatMessage);",
    );
    expect(api).not.toContain(
      `${WRITER_CALL}\n                StatusPageSubscriberNotificationTemplateServiceClass`,
    );
  });
});
