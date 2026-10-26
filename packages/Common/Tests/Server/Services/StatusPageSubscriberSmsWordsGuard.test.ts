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
 * Read from the source, because these texts are written in a dozen jobs: a
 * new default text that forgets it fails here.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const SCAN_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "App", "FeatureSet", "Workers"),
  path.join(PACKAGES_DIR, "Common", "Server"),
];

// How a default subscriber text ends: with the unsubscribe link.
const DEFAULT_TEXT_END: string = "Unsub: ${unsubscribeUrl}`";

const WRITER_CALL: string = "writeDefaultSubscriberSms(";

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
  // The statement that assigns it, from its "smsMessage =" to its end.
  statement: string;
}

const DEFAULT_TEXTS: Array<DefaultText> = [];

for (const directory of SCAN_DIRS) {
  for (const file of listSourceFiles(directory)) {
    const source: string = fs.readFileSync(file, "utf8");
    let at: number = source.indexOf(DEFAULT_TEXT_END);

    while (at !== -1) {
      const start: number = source.lastIndexOf("smsMessage =", at);

      DEFAULT_TEXTS.push({
        file: relative(file),
        statement: source.slice(
          start === -1 ? Math.max(0, at - 400) : start,
          at + DEFAULT_TEXT_END.length,
        ),
      });

      at = source.indexOf(DEFAULT_TEXT_END, at + DEFAULT_TEXT_END.length);
    }
  }
}

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

  test("each default text is written with writeDefaultSubscriberSms", () => {
    const unwritten: Array<string> = DEFAULT_TEXTS.filter(
      (text: DefaultText): boolean => {
        return !text.statement.includes(WRITER_CALL);
      },
    ).map((text: DefaultText): string => {
      return text.file;
    });

    expect(unwritten).toEqual([]);
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
