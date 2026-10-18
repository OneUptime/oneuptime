import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The On-Call simplicity audit, held in the source.
 *
 * - What happens after a policy's last level is one choice - Stop, or Start
 *   again and how many more times - on an on-call policy's Repeat Policy card
 *   and on an incoming call policy's Settings, both through one shared card
 *   (RepeatChoiceCard). The switches "Repeat if no one acknowledges" and
 *   "Repeat Policy If No One Answers", whose help explained both of their
 *   modes, and their numbers asked on their own, are gone from the forms.
 * - The call handler reads an incoming call policy's repeats, and the words
 *   it reads out for a policy without its own, from Common, where the
 *   Settings page reads them too.
 * - An incoming call policy's Settings: Answer Calls is one switch that
 *   saves on flip; no "Policy Settings" dialog of three unlike things.
 * - Forms of the area do not show their columns' "Any friendly name of this
 *   object" under Name, nor "Friendly description that will help you
 *   remember" under Description.
 * - A schedule's Overview says who is on call once, in its Final Schedule.
 *
 * App has no renderer, so the pages are read as text. Common's
 * RepeatPolicyChoiceCard, IncomingCallPolicySettingsPage,
 * IncomingCallPolicyFirstSteps, IncomingCallPolicyDocsMovedToDocs,
 * ScheduleOverviewFirstStep and LayerConfigFormPlainWords draw them.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const PACKAGES: string = path.join(APP_ROOT, "..");
const DASHBOARD_SRC: string = path.join(APP_ROOT, "FeatureSet/Dashboard/src");

function read(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

// Runs of whitespace, so a source reads the same however prettier wraps it.
const WHITESPACE: RegExp = /\s+/g;

function flat(text: string): string {
  return text.replace(WHITESPACE, " ");
}

/*
 * A source without its comments: the files say in their comments what they
 * replaced ("Repeat enabled", "on the roster"), which is not what they draw.
 * Block comments are cut out with indexOf, and lines that are only a line
 * comment are dropped.
 */
function codeOf(text: string): string {
  let code: string = "";
  let at: number = 0;

  for (;;) {
    const start: number = text.indexOf("/*", at);

    if (start === -1) {
      code += text.slice(at);
      break;
    }

    const end: number = text.indexOf("*/", start + 2);
    code += text.slice(at, start) + " ";

    if (end === -1) {
      break;
    }

    at = end + 2;
  }

  return code
    .split("\n")
    .filter((line: string): boolean => {
      return !line.trim().startsWith("//");
    })
    .join("\n");
}

function countOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

// Every .ts and .tsx file of the Dashboard's source, but its locales.
function dashboardSources(): Array<string> {
  const files: Array<string> = [];

  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "Locales" && entry.name !== "node_modules") {
          walk(full);
        }
        continue;
      }

      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }
  };

  walk(DASHBOARD_SRC);
  return files;
}

describe("what happens after the last level", () => {
  test("an on-call policy's Repeat Policy card is the shared choice card", () => {
    const card: string = flat(read("Components/OnCallPolicy/RepeatPolicy.tsx"));

    expect(card).toContain("<RepeatChoiceCard<OnCallDutyPolicy>");
    expect(card).toContain("config={ON_CALL_POLICY_REPEAT}");
    expect(card).not.toContain("FormFieldSchemaType.Toggle");

    expect(
      flat(read("Pages/OnCallDuty/OnCallDutyPolicy/Escalation.tsx")),
    ).toContain("<RepeatPolicy onCallDutyPolicyId={modelId} />");
  });

  test("an incoming call policy's Settings page has the same card, with its own words and columns", () => {
    const settings: string = flat(
      read("Pages/OnCallDuty/IncomingCallPolicy/Settings.tsx"),
    );

    expect(settings).toContain("<RepeatChoiceCard<IncomingCallPolicy>");
    expect(settings).toContain("config={INCOMING_CALL_POLICY_REPEAT}");
  });

  test("the old switches and their lone numbers are asked nowhere", () => {
    const retiredTitles: Array<string> = [
      'title: "Repeat if no one acknowledges"',
      'title: "Number of times to repeat"',
      'title: "Repeat Policy If No One Answers"',
      'title: "Repeat Policy Times"',
      '"Repeat enabled"',
      '"Repeat disabled"',
    ];
    const found: Array<string> = [];

    for (const file of dashboardSources()) {
      const text: string = codeOf(fs.readFileSync(file, "utf8"));

      for (const title of retiredTitles) {
        if (text.includes(title)) {
          found.push(`${path.relative(DASHBOARD_SRC, file)}: ${title}`);
        }
      }
    }

    expect(found).toEqual([]);
  });

  test("the choice is written into the columns the worker and the call handler read", () => {
    const choice: string = flat(
      read("Components/OnCallPolicy/RepeatChoice/RepeatChoice.ts"),
    );

    expect(choice).toContain('repeat: "repeatPolicyIfNoOneAcknowledges"');
    expect(choice).toContain(
      'times: "repeatPolicyIfNoOneAcknowledgesNoOfTimes"',
    );
    expect(choice).toContain('repeat: "repeatPolicyIfNoOneAnswers"');
    expect(choice).toContain('times: "repeatPolicyIfNoOneAnswersTimes"');
    // Read as they run: by the same functions the worker and the handler use.
    expect(choice).toContain("getOnCallPolicyRepeatsAllowed(");
    expect(choice).toContain("getIncomingCallPolicyRepeatsAllowed(");
  });
});

describe("the call handler", () => {
  const handler: string = flat(
    fs.readFileSync(
      path.join(APP_ROOT, "FeatureSet/Notification/API/IncomingCall.ts"),
      "utf8",
    ),
  );

  test("reads a policy's repeats as its Settings page says them", () => {
    expect(handler).toContain(
      "(callLog.repeatCount || 0) < getIncomingCallPolicyRepeatsAllowed(policy)",
    );
    expect(handler).not.toContain("repeatPolicyIfNoOneAnswersTimes || 1");
  });

  test("reads out the default messages the Settings page shows", () => {
    for (const constant of [
      "DEFAULT_INCOMING_CALL_GREETING_MESSAGE",
      "DEFAULT_INCOMING_CALL_NO_ANSWER_MESSAGE",
      "DEFAULT_INCOMING_CALL_NO_ONE_AVAILABLE_MESSAGE",
      "INCOMING_CALL_POLICY_OFF_MESSAGE",
    ]) {
      // Imported once, and read where the message is spoken.
      expect({ constant, uses: countOf(handler, constant) }).toEqual({
        constant,
        uses: 2,
      });
    }

    const messages: string = fs.readFileSync(
      path.join(PACKAGES, "Common/Types/IncomingCall/IncomingCallMessages.ts"),
      "utf8",
    );

    for (const sentence of [
      "Please wait while we connect you to the on-call engineer.",
      "No one is available. Please try again later.",
      "We're sorry, but no on-call engineer is currently available.",
      "Sorry, this service is currently disabled.",
    ]) {
      expect(messages).toContain(`"${sentence}"`);
      expect(handler).not.toContain(`"${sentence}"`);
    }
  });
});

describe("an incoming call policy's Settings page", () => {
  const settings: string = flat(
    read("Pages/OnCallDuty/IncomingCallPolicy/Settings.tsx"),
  );

  test("answers calls with one switch that saves on flip, asking before it turns calls away", () => {
    expect(settings).toContain("<ModelSwitchCard<IncomingCallPolicy>");
    expect(settings).toContain("column={INCOMING_CALL_ANSWER_CALLS_COLUMN}");
    expect(settings).toContain(
      "getConfirmation={getStopAnsweringCallsConfirmation}",
    );

    expect(
      read("Components/IncomingCallPolicy/IncomingCallPolicySettingsCopy.ts"),
    ).toContain(
      'INCOMING_CALL_ANSWER_CALLS_COLUMN: IncomingCallAnswerCallsColumn =\n  "isEnabled"',
    );
  });

  test("has no Policy Settings dialog of three unlike things", () => {
    expect(settings).not.toContain("Policy Settings");
    expect(settings).not.toContain("Enable or disable this policy");
    expect(settings).not.toContain("isEnabled: true");
  });

  test("names Voice Messages' dialog for what it edits", () => {
    expect(settings).toContain(
      "editModalTitle={IncomingCallVoiceMessagesCopy.dialogTitle}",
    );
  });
});

describe("names and descriptions in the area's forms", () => {
  const FORMS: Array<{ file: string; nameAndDescription: number }> = [
    {
      file: "Components/OnCallPolicy/OnCallPolicyCreateForm.ts",
      nameAndDescription: 2,
    },
    {
      file: "Components/OnCallPolicy/OnCallScheduleCreateForm.ts",
      nameAndDescription: 2,
    },
    {
      file: "Components/IncomingCallPolicy/IncomingCallPolicyCreateForm.ts",
      nameAndDescription: 2,
    },
    {
      file: "Pages/OnCallDuty/OnCallDutyPolicy/Index.tsx",
      nameAndDescription: 2,
    },
    {
      file: "Pages/OnCallDuty/OnCallDutySchedule/Index.tsx",
      nameAndDescription: 2,
    },
    {
      file: "Pages/OnCallDuty/IncomingCallPolicy/Index.tsx",
      nameAndDescription: 2,
    },
    {
      file: "Components/OnCallPolicy/OnCallScheduleLayer/LayerConfigForm.tsx",
      nameAndDescription: 2,
    },
  ];

  test.each(FORMS)(
    "$file leaves out the columns' 'Any friendly name' and 'Friendly description'",
    (form: { file: string; nameAndDescription: number }) => {
      expect(
        countOf(read(form.file), "hideColumnDescription: true"),
      ).toBeGreaterThanOrEqual(form.nameAndDescription);
    },
  );

  test("the person's on-call rule form says how long after the page a method is used", () => {
    const table: string = flat(
      read("Components/NotificationRule/OnCallRulesTable.tsx"),
    );

    expect(table).toContain(
      "title: notifyAfterFieldTitle, /* * Its own line: the column's",
    );
    expect(table).toContain(
      'description: "How long after the page to use this method."',
    );
  });
});

describe("a schedule's Overview", () => {
  const overview: string = flat(
    codeOf(read("Pages/OnCallDuty/OnCallDutySchedule/Index.tsx")),
  );

  test("says who is on call once - in its Final Schedule - with no roster banner", () => {
    expect(overview).not.toContain("on the roster");
    expect(overview).not.toContain("currentUserOnRoster");
    expect(overview).not.toContain("<Alert");
    expect(overview).toContain("<FinalPreview");
  });

  test("waits for layers before it offers calendar links and chat groups", () => {
    expect(overview).toContain("onLayersLoaded={(count: number): void => {");
    expect(overview.indexOf("{hasLayers ? (")).toBeLessThan(
      overview.indexOf("<ScheduleUserGroupsCard"),
    );
  });

  test("is edited as an On-Call Schedule", () => {
    expect(overview).toContain("editButtonText={SCHEDULE_EDIT_BUTTON_TEXT}");
    expect(
      read(
        "Components/OnCallPolicy/OnCallScheduleLayer/ScheduleOverviewCopy.ts",
      ),
    ).toContain('translationKey(\n  "Edit On-Call Schedule",\n)');
  });
});

describe("the escalation summary", () => {
  test("speaks plainly", () => {
    const summary: string = read(
      "Components/OnCallPolicy/EscalationRule/EscalationSummary.tsx",
    );

    expect(summary).not.toContain("Repeats if unacked");
    expect(summary).not.toContain("A plain-english walkthrough");
    expect(summary).toContain('label="Repeats"');
  });
});
