import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { SUBSCRIBER_NOTIFICATION_SUMMARIES } from "../../../FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceForm";
import { DEFAULT_MAINTENANCE_DURATION_IN_MINUTES } from "Common/Types/ScheduledMaintenance/MaintenanceWindow";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Scheduling maintenance takes two short steps. The subscribers guide
 * (status-pages/subscribers.md) walks them, quotes the line the folded
 * Subscriber Notifications section shows, and names the switches inside
 * it. Markdown is not compiled, so this reads the create form's source and
 * checks the guide still tells the same story - and that no guide, in any
 * language, still sends readers to the old seven-step form's labels.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const CREATE_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Create.tsx";

const GUIDE: string = "status-pages/subscribers.md";

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readGuide(language: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, GUIDE), "utf8");
}

const CREATE_FORM: string = readRepoFile(CREATE_FORM_FILE);
const ENGLISH_GUIDE: string = readGuide("en");

// The step titles, in order, as the create form declares them.
function stepTitles(): Array<string> {
  const stepsBlock: string | undefined = CREATE_FORM.match(
    /steps=\{\[([\s\S]*?)\]\}/,
  )?.[1];

  expect(stepsBlock).toBeDefined();

  return Array.from(stepsBlock!.matchAll(/title: "([^"]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("the scheduled maintenance create form in the docs", () => {
  test("walks the form's two steps, in its order", () => {
    const steps: Array<string> = stepTitles();

    expect(steps).toEqual(["Event", "Resources Affected"]);

    let from: number = 0;

    for (const [index, step] of steps.entries()) {
      const item: string = `${index + 1}. **${step}**`;
      const at: number = ENGLISH_GUIDE.indexOf(item, from);

      expect(`${item}: ${at >= 0}`).toBe(`${item}: true`);
      from = at;
    }
  });

  test("names the switches folded under Subscriber Notifications as the form does", () => {
    for (const title of [
      "When the event is scheduled",
      "When the event starts",
      "When the event ends",
      "Reminders before the event",
    ]) {
      expect(CREATE_FORM).toContain(`title: "${title}"`);
      expect(ENGLISH_GUIDE).toContain(`**${title}**`);
    }

    expect(ENGLISH_GUIDE).toContain("**Subscriber Notifications**");
  });

  test("quotes the folded section's line word for word", () => {
    expect(ENGLISH_GUIDE).toContain(
      `"${SUBSCRIBER_NOTIFICATION_SUMMARIES["scheduled,started,ended"]}"`,
    );
  });

  test("says how long a new event lasts and when it starts", () => {
    expect(DEFAULT_MAINTENANCE_DURATION_IN_MINUTES).toBe(60);
    expect(ENGLISH_GUIDE).toContain(
      "A new event starts at the next full hour on your clock and lasts an hour",
    );
    expect(ENGLISH_GUIDE).toContain(
      "Moving **Starts At** moves **Ends At** with it",
    );
  });

  test("says the review step shows the same line", () => {
    expect(ENGLISH_GUIDE).toContain("the review step shows it too");
  });

  test("puts the options the form folds under More fields there", () => {
    expect(ENGLISH_GUIDE).toContain(
      "**Owners** and **Labels** wait under **More fields**",
    );
  });

  /*
   * Resources Affected asks for the monitors apart from everything else,
   * with Change Monitor Status to right under them once one is picked - it
   * is no longer folded under More fields.
   */
  test("walks Resources Affected as the form draws it: the monitors, their status, then the other resources", () => {
    for (const title of [
      "Monitors",
      "Change Monitor Status to",
      "Other Affected Resources",
    ]) {
      expect(CREATE_FORM).toContain(`title: "${title}"`);
    }

    const step: string | undefined = ENGLISH_GUIDE.split("\n").find(
      (line: string): boolean => {
        return line.startsWith("2. **Resources Affected**");
      },
    );

    expect(step).toBeDefined();

    const monitorsAt: number = step!.indexOf("**Monitors**");
    const statusAt: number = step!.indexOf("**Change Monitor Status to**");
    const othersAt: number = step!.indexOf("**Other Affected Resources**");
    const statusPagesAt: number = step!.indexOf(
      "**Show event on these status pages**",
    );

    expect(monitorsAt).toBeGreaterThan(-1);
    expect(statusAt).toBeGreaterThan(monitorsAt);
    expect(othersAt).toBeGreaterThan(statusAt);
    expect(statusPagesAt).toBeGreaterThan(othersAt);
    expect(step).toContain("right under them once a monitor is picked");
    expect(step).toContain("back to operational when it ends");
    expect(step).not.toContain("**More fields**");

    // A record's tab picks it among the other resources.
    expect(ENGLISH_GUIDE).toContain(
      "already picked under **Other Affected Resources**",
    );
    // A template always asks for the status.
    expect(ENGLISH_GUIDE).toContain(
      "A template asks for **Change Monitor Status to** whether or not it names monitors",
    );
  });

  test("no guide says the monitor status waits under More fields, or that sites have a picker of their own", () => {
    const retired: Array<string> = [
      "**Change Monitor Status to** waits under **More fields**",
      "the event's **Resources Affected** picker",
    ];
    const problems: Array<string> = [];

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      for (const guide of [GUIDE, "monitor/network-sites.md"]) {
        const file: string = path.join(CONTENT_DIR, language, guide);

        if (!fs.existsSync(file)) {
          continue;
        }

        const text: string = fs.readFileSync(file, "utf8");

        for (const sentence of retired) {
          if (text.includes(sentence)) {
            problems.push(`${language}/${guide}: ${sentence}`);
          }
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("no guide sends readers to the old form's steps or labels", () => {
    const retired: Array<string> = [
      "Event Created: Notify Status Page Subscribers",
      "Event Ongoing: Notify Status Page Subscribers",
      "Event Ended: Notify Status Page Subscribers",
      "Send reminders to subscribers before the event",
      "on the **Subscribers** step",
    ];
    const problems: Array<string> = [];

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const file: string = path.join(CONTENT_DIR, language, GUIDE);

      if (!fs.existsSync(file)) {
        continue;
      }

      const guide: string = readGuide(language);

      for (const text of retired) {
        if (guide.includes(text)) {
          problems.push(`${language}/${GUIDE}: ${text}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
