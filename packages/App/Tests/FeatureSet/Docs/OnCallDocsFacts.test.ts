import { readPage } from "./DocsContentSupport";
import IncomingCallLog from "Common/Models/DatabaseModels/IncomingCallLog";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyEscalationRule from "Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import IncomingCallStatus from "Common/Types/IncomingCall/IncomingCallStatus";
import {
  DEFAULT_INCOMING_CALL_GREETING_MESSAGE,
  DEFAULT_INCOMING_CALL_NO_ANSWER_MESSAGE,
  DEFAULT_INCOMING_CALL_NO_ONE_AVAILABLE_MESSAGE,
  INCOMING_CALL_POLICY_OFF_MESSAGE,
} from "Common/Types/IncomingCall/IncomingCallMessages";
import { getIncomingCallPolicyRepeatsAllowed } from "Common/Types/IncomingCall/IncomingCallPolicyRepeat";
import { MISSED_INCOMING_CALL_STATUSES } from "Common/Types/IncomingCall/MissedIncomingCall";
import {
  MAX_CALL_TWIML_LENGTH,
  MAX_PUSH_TEXT_BYTES,
  MAX_SMS_LENGTH,
  MAX_TELEGRAM_MESSAGE_LENGTH,
  MAX_WHATSAPP_TEMPLATE_TEXT_LENGTH,
  TRUNCATED_NAME_NOTE,
  TRUNCATED_TEXT_NOTE,
} from "Common/Utils/MessageFit";
import {
  buildOnCallPageSms,
  MIN_TITLE_CHARACTERS,
  ON_CALL_PAGE_SMS_ACTION,
  ON_CALL_PAGE_SMS_CUT_MARK,
  ON_CALL_PAGE_SMS_STILL_NOT_RESOLVED,
  OnCallPageSms,
  OnCallPageSmsKind,
} from "Common/Utils/Sms/OnCallPageSms";
import {
  buildNotificationSms,
  NOTIFICATION_SMS_SENDER,
  NOTIFICATION_SMS_TURN_OFF,
} from "Common/Utils/Sms/NotificationSms";
import { toGsm7Text } from "Common/Utils/Sms/Gsm7Text";
import { getOnCallPersonPageLead } from "Common/Types/OnCallDutyPolicy/OnCallPersonPage";
import {
  GSM_7_SINGLE_SEGMENT_LENGTH,
  SmsEncoding,
  UCS_2_SINGLE_SEGMENT_LENGTH,
} from "Common/Utils/Sms/SmsSegments";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English On Call pages say about the product, held to the code that
 * makes it true. Markdown is not compiled, so nothing else notices when a
 * button is renamed, a default message changes, a status is added or a limit
 * moves. Each test reads the source of truth - the dashboard page, the model,
 * the server route, the shared constant - and checks the page still says what
 * it does. The translations are held to these English pages by
 * OnCallDocsTranslations; the ring time, the roles and the calendar feeds have
 * their own suites (IncomingCallEscalationRulesDocs,
 * PhoneNumberAndChatFormRolesDocs, CalendarFeedsDocsPage).
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const DASHBOARD_DIR: string = "App/FeatureSet/Dashboard/src";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function readDashboardFile(relativePath: string): string {
  return readRepoFile(`${DASHBOARD_DIR}/${relativePath}`);
}

// The value a model's column gets in the database when nothing is set.
function columnDefault(modelSource: string, property: string): string {
  const declaration: number = modelSource.indexOf(`public ${property}?:`);

  expect({ property, declared: declaration > 0 }).toEqual({
    property,
    declared: true,
  });

  const column: string = modelSource.slice(
    modelSource.lastIndexOf("@Column(", declaration),
    declaration,
  );
  const value: RegExpMatchArray | null = column.match(
    /\bdefault:\s*("(?:[^"\\]|\\.)*"|true|false|\d+)/,
  );

  expect({ property, hasDefault: Boolean(value) }).toEqual({
    property,
    hasDefault: true,
  });

  const raw: string = value![1] as string;

  return raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
}

// The rows of the Markdown table that follows `header` on the page.
function tableAfter(page: string, header: string): Array<Array<string>> {
  const lines: Array<string> = page.split("\n");
  const start: number = lines.indexOf(header);

  expect({ header, found: start >= 0 }).toEqual({ header, found: true });

  const rows: Array<Array<string>> = [];

  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) {
      break;
    }

    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows;
}

// Every bold span of a text.
function boldIn(text: string): Array<string> {
  return Array.from(text.matchAll(/\*\*([^*\n]+?)\*\*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

/*
 * The arguments of every call to one of `callees` in a source file: from the
 * opening parenthesis to the one that closes it.
 */
function callsTo(source: string, callees: Array<string>): Array<string> {
  const calls: Array<string> = [];

  for (const callee of callees) {
    let from: number = source.indexOf(callee);

    while (from >= 0) {
      const open: number = from + callee.length - 1;
      let depth: number = 0;
      let close: number = open;

      for (; close < source.length; close++) {
        if (source[close] === "(") {
          depth++;
        } else if (source[close] === ")") {
          depth--;

          if (depth === 0) {
            break;
          }
        }
      }

      calls.push(source.slice(open, close + 1));
      from = source.indexOf(callee, close);
    }
  }

  return calls;
}

// "NoAnswer" -> "No Answer", as the dashboard shows a status.
function statusLabel(status: IncomingCallStatus): string {
  return status.replace(/([a-z])([A-Z])/g, "$1 $2");
}

describe("the Incoming Call Policy page", () => {
  const page: string = readPage("en", "on-call/incoming-call-policy");
  const policySource: string = readRepoFile(
    "Common/Models/DatabaseModels/IncomingCallPolicy.ts",
  );
  const incomingCallRoute: string = readRepoFile(
    "App/FeatureSet/Notification/API/IncomingCall.ts",
  );

  it("creates a policy from On-Call Duty, as the menu and the table name it", () => {
    const menu: string = readDashboardFile("Pages/OnCallDuty/SideMenu.tsx");

    expect(menu).toContain('title: "Incoming Call Policies"');
    expect(new IncomingCallPolicy().singularName).toBe("Incoming Call Policy");
    expect(page).toContain(
      "Go to **On-Call Duty** > **Incoming Call Policies** and click **Create Incoming Call Policy**.",
    );
  });

  it("asks a new policy for its name, folds the rest under More fields, and opens it on its Overview", () => {
    const list: string = readDashboardFile(
      "Pages/OnCallDuty/IncomingCallPolicies.tsx",
    );
    const form: string = readDashboardFile(
      "Components/IncomingCallPolicy/IncomingCallPolicyCreateForm.ts",
    );
    const description: string = form.slice(
      form.indexOf("description: true"),
      form.indexOf("getLabelsFormField<IncomingCallPolicy>("),
    );

    expect(form).toContain('title: "Name"');
    expect(form).toContain('title: "Description"');
    expect(description).toContain("collapsibleSection: moreFields");
    expect(form).toContain(
      "getLabelsFormField<IncomingCallPolicy>({\n      collapsibleSection: moreFields,",
    );
    expect(form).toContain("getAdvancedFormSection<IncomingCallPolicy>()");
    expect(list).toContain("onCreateSuccess={");
    expect(list).toContain("PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW");

    expect(page).toContain(
      'Give it a **Name**, such as "Support Hotline"; a **Description** and **Labels** are optional, under **More fields**. The new policy opens on its **Overview**.',
    );
  });

  it("walks the policy's Setup card with the card's own words", () => {
    const overview: string = readDashboardFile(
      "Pages/OnCallDuty/IncomingCallPolicy/Index.tsx",
    );
    const purchase: string = readDashboardFile(
      "Components/CallSMS/PhoneNumberPurchase.tsx",
    );

    for (const fact of [
      'title="Setup"',
      'title={hasTwilioConfig ? "Change" : "Select"}',
      'title: "Twilio Configuration"',
      'submitButtonText="Save"',
      'title="Manage Rules"',
      'title="Phone Numbers & Twilio Configuration"',
      '"Remove all phone numbers to change"',
    ]) {
      expect({ fact, inCode: overview.includes(fact) }).toEqual({
        fact,
        inCode: true,
      });
    }

    expect(overview).toContain("<PhoneNumberPurchase");
    expect(purchase).toContain('title="Add Phone Number"');

    expect(page).toContain(
      "The policy's **Overview** shows a **Setup** card with three numbered steps. In the first one, click **Select**, pick the account under **Twilio Configuration** and click **Save**.",
    );
    expect(page).toContain("In the second step, click **Add Phone Number**.");
    expect(page).toContain("In the third step, click **Manage Rules**.");
    expect(page).toContain(
      "the card becomes **Phone Numbers & Twilio Configuration**",
    );
    expect(page).toContain('"Remove all phone numbers to change"');
  });

  it("names the policy's side menu as it is", () => {
    const menu: string = readDashboardFile(
      "Pages/OnCallDuty/IncomingCallPolicy/SideMenu.tsx",
    );

    expect(menu).toMatch(
      /<SideMenuSection title="Logs">\s*<SideMenuItem\s+link=\{\{\s*title: "Call Logs"/,
    );
    expect(menu).toMatch(
      /<SideMenuSection title="Advanced">\s*<SideMenuItem\s+link=\{\{\s*title: "Settings"/,
    );
    expect(menu).toContain('title: "Escalation Rules"');
    expect(menu).toContain('title: "Owners"');

    expect(page).toContain(
      "choose **Escalation Rules** in its side menu and click **Add Escalation Rule**",
    );
    expect(page).toContain(
      "Every call is listed on the policy's **Call Logs** page, under **Logs** in its side menu",
    );
    expect(page).toContain(
      "Open the policy and choose **Settings** under **Advanced** in its side menu.",
    );
  });

  it("adds numbers with the dialog's buttons and fields, and lists the 10 numbers a search asks Twilio for", () => {
    const purchase: string = readDashboardFile(
      "Components/CallSMS/PhoneNumberPurchase.tsx",
    );
    const phoneNumberRoute: string = readRepoFile(
      "App/FeatureSet/Notification/API/PhoneNumber.ts",
    );

    for (const fact of [
      '"Use Existing Phone Number"',
      '"Reserve New Phone Number"',
      'title="Search for Numbers"',
      'title: "Country"',
      'title: "Area Code (Optional)"',
      'title: "Contains (Optional)"',
      'submitButtonText="Search"',
      'title="Reserve"',
      'submitButtonText="Reserve"',
      'submitButtonText="Assign Number"',
      'title="Release"',
      'submitButtonText="Release Number"',
      '"Currently has a webhook configured"',
    ]) {
      expect({ fact, inCode: purchase.includes(fact) }).toEqual({
        fact,
        inCode: true,
      });
    }

    expect(phoneNumberRoute).toMatch(/countryCode,\s*limit: 10,/);

    expect(page).toContain(
      "Click **Add Phone Number**, then **Use Existing Phone Number**.",
    );
    expect(page).toContain(
      "Click **Add Phone Number**, then **Reserve New Phone Number** and **Search for Numbers**.",
    );
    expect(page).toContain(
      "Pick a **Country**. Optionally fill in **Area Code (Optional)**, such as 415, or **Contains (Optional)**",
    );
    expect(page).toContain(
      "Click **Search**: up to 10 local numbers are listed.",
    );
    expect(page).toContain(
      "Click **Reserve** next to a number, and confirm with **Reserve**.",
    );
    expect(page).toContain(
      "Click **Select** next to the number, then **Assign Number**.",
    );
    expect(page).toContain('says "Currently has a webhook configured"');
    expect(page).toContain(
      "click **Release** next to it and confirm with **Release Number**",
    );
  });

  it("gives the webhook Twilio calls, and the callback it reports each ring to", () => {
    const phoneNumberRoute: string = readRepoFile(
      "App/FeatureSet/Notification/API/PhoneNumber.ts",
    );

    // The number's voice webhook, as both ways of adding one set it.
    expect(
      phoneNumberRoute.split(
        "`${HttpProtocol}${Host}/notification/incoming-call/voice`",
      ).length - 1,
    ).toBeGreaterThanOrEqual(2);
    expect(incomingCallRoute).toMatch(/router\.post\(\s*"\/voice",/);
    expect(incomingCallRoute).toMatch(
      /router\.post\(\s*"\/dial-status\/:callLogId\/:callLogItemId",/,
    );
    expect(incomingCallRoute).toContain(
      "/notification/incoming-call/dial-status/",
    );

    expect(page).toContain(
      "Twilio sends every call to `https://<your host>/notification/incoming-call/voice`,",
    );
    expect(page).toContain(
      "OneUptime sets the number's voice webhook to `https://<your host>/notification/incoming-call/voice`, built from `HOST` and `HTTP_PROTOCOL`",
    );
    /*
     * The diagram names the two requests by their routes' last parts, so it
     * fits the docs column between four participants; the text above gives
     * both paths in full.
     */
    expect(page).toContain("Twilio->>OneUptime: POST …/voice");
    expect(page).toContain("Twilio->>OneUptime: POST …/dial-status");
    expect(page).toContain(
      "Twilio sends every call to `https://<your host>/notification/incoming-call/voice`, and how each ring ended to `https://<your host>/notification/incoming-call/dial-status/...`.",
    );
  });

  it("refuses a request it cannot verify, as the route does", () => {
    // Both routes answer a request whose signature does not check out with 403.
    expect(
      incomingCallRoute.split('res.status(403).send("Forbidden")').length - 1,
    ).toBe(2);
    expect(page).toContain(
      "OneUptime checks Twilio's signature on every request with the Twilio config's Auth Token, and refuses a request it cannot verify.",
    );
    expect(page).toContain(
      "An answer of `403` means the request's signature did not check out.",
    );
  });

  it("quotes what a caller hears, word for word", () => {
    // Between two rules: the route's own words.
    const nextEngineer: string =
      "Connecting you to the next available engineer.";

    expect(incomingCallRoute).toContain(nextEngineer);
    expect(page).toContain(`"${nextEngineer}"`);

    // While the policy does not answer calls: the shared words it hangs up with.
    const offBranch: string = incomingCallRoute.slice(
      incomingCallRoute.indexOf("if (!policy.isEnabled) {"),
    );

    expect(incomingCallRoute).toContain("if (!policy.isEnabled) {");
    expect(
      offBranch.slice(0, offBranch.indexOf("return res.send(twiml);")),
    ).toContain("INCOMING_CALL_POLICY_OFF_MESSAGE");
    expect(page).toContain(`"${INCOMING_CALL_POLICY_OFF_MESSAGE}"`);
    expect(page).toContain(
      `A policy with **Answer Calls** off answers every call with "${INCOMING_CALL_POLICY_OFF_MESSAGE}" and hangs up.`,
    );
  });

  it("rings the rules again only as the Repeat Policy says, then reads the No Answer Message", () => {
    // The call handler asks the shared rule how many more times to ring them.
    expect(incomingCallRoute).toContain(
      "< getIncomingCallPolicyRepeatsAllowed(policy)",
    );
    expect(
      getIncomingCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAnswers: false,
        repeatPolicyIfNoOneAnswersTimes: 3,
      }),
    ).toBe(0);
    expect(
      getIncomingCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAnswers: true,
        repeatPolicyIfNoOneAnswersTimes: 2,
      }),
    ).toBe(2);
    expect(incomingCallRoute).toContain(
      "policy.noAnswerMessage || DEFAULT_INCOMING_CALL_NO_ANSWER_MESSAGE",
    );

    expect(page).toContain(
      "5. After the last rule, the policy's **Repeat Policy** decides: **Ring again from the first rule** rings every rule again, as many more times as it says, and **End the call** does not. Then the caller hears the **No Answer Message**, and the call ends.",
    );
  });

  it("gives a new policy's messages and switches as the model sets them", () => {
    const rows: Array<Array<string>> = tableAfter(
      page,
      "| Setting | What it does | For a new policy |",
    );
    const valueOf: (setting: string) => string = (setting: string): string => {
      const row: Array<string> | undefined = rows.find(
        (cells: Array<string>): boolean => {
          return cells[0] === `**${setting}**`;
        },
      );

      expect({ setting, row: Boolean(row) }).toEqual({ setting, row: true });

      return row![2] as string;
    };

    for (const [setting, property] of [
      ["Greeting Message", "greetingMessage"],
      ["No Answer Message", "noAnswerMessage"],
      ["No One Available Message", "noOneAvailableMessage"],
    ] as Array<[string, string]>) {
      expect({ setting, value: valueOf(setting) }).toEqual({
        setting,
        value: `"${columnDefault(policySource, property)}"`,
      });
    }

    const onOff: (value: string) => string = (value: string): string => {
      return value === "true" ? "On" : "Off";
    };

    // The Answer Calls switch is the policy's isEnabled column.
    expect(
      readDashboardFile(
        "Components/IncomingCallPolicy/IncomingCallPolicySettingsCopy.ts",
      ),
    ).toContain(
      'INCOMING_CALL_ANSWER_CALLS_COLUMN: IncomingCallAnswerCallsColumn =\n  "isEnabled";',
    );
    expect(valueOf("Answer calls to this policy's numbers")).toBe(
      onOff(columnDefault(policySource, "isEnabled")),
    );

    // A new policy's pair rings no rule again, so it reads as End the call.
    expect(
      getIncomingCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAnswers:
          columnDefault(policySource, "repeatPolicyIfNoOneAnswers") === "true",
        repeatPolicyIfNoOneAnswersTimes: Number(
          columnDefault(policySource, "repeatPolicyIfNoOneAnswersTimes"),
        ),
      }),
    ).toBe(0);
    expect(valueOf("If nobody answers after the last rule")).toBe(
      "**End the call**",
    );

    // The route falls back to the same greeting when a policy has none.
    expect(DEFAULT_INCOMING_CALL_GREETING_MESSAGE).toBe(
      columnDefault(policySource, "greetingMessage"),
    );
    expect(incomingCallRoute).toContain(
      "policy.greetingMessage || DEFAULT_INCOMING_CALL_GREETING_MESSAGE",
    );
  });

  it("says an emptied message is read out in OneUptime's words, which the card shows", () => {
    const copy: string = readDashboardFile(
      "Components/IncomingCallPolicy/IncomingCallPolicySettingsCopy.ts",
    );

    // Each message's card row is given the words the route reads instead.
    for (const constant of [
      "DEFAULT_INCOMING_CALL_GREETING_MESSAGE",
      "DEFAULT_INCOMING_CALL_NO_ANSWER_MESSAGE",
      "DEFAULT_INCOMING_CALL_NO_ONE_AVAILABLE_MESSAGE",
    ]) {
      expect({
        constant,
        inCopy: copy.includes(`defaultMessage: ${constant}`),
      }).toEqual({
        constant,
        inCopy: true,
      });
      expect({
        constant,
        inRoute: incomingCallRoute.includes(constant),
      }).toEqual({ constant, inRoute: true });
    }

    // Shown first, with a quiet Default pill beside them.
    expect(copy).toContain('defaultPill: translationKey("Default")');
    expect(DEFAULT_INCOMING_CALL_NO_ANSWER_MESSAGE).toBe(
      columnDefault(policySource, "noAnswerMessage"),
    );
    expect(
      DEFAULT_INCOMING_CALL_NO_ONE_AVAILABLE_MESSAGE.length,
    ).toBeGreaterThan(0);
    expect(page).toContain(
      "A message left empty is read out in OneUptime's own words, which the card shows in its place.",
    );
  });

  it("names the Settings page's cards, buttons and fields", () => {
    const settings: string = readDashboardFile(
      "Pages/OnCallDuty/IncomingCallPolicy/Settings.tsx",
    );

    const copy: string = readDashboardFile(
      "Components/IncomingCallPolicy/IncomingCallPolicySettingsCopy.ts",
    );
    const choices: string = readDashboardFile(
      "Components/OnCallPolicy/RepeatChoice/RepeatChoice.ts",
    );
    const incomingRepeat: string = choices.slice(
      choices.indexOf("export const INCOMING_CALL_POLICY_REPEAT"),
    );
    const repeatCard: string = readDashboardFile(
      "Components/OnCallPolicy/RepeatChoice/RepeatChoiceCard.tsx",
    );

    // Three cards, in this order: Answer Calls, Repeat Policy, Voice Messages.
    const places: Array<number> = [
      "<ModelSwitchCard<IncomingCallPolicy>",
      "config={INCOMING_CALL_POLICY_REPEAT}",
      "editButtonText={IncomingCallVoiceMessagesCopy.editButtonText}",
    ].map((part: string): number => {
      return settings.indexOf(part);
    });

    expect(Math.min(...places)).toBeGreaterThan(0);
    expect(
      [...places].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(places);

    for (const fact of [
      'cardTitle: translationKey("Answer Calls")',
      'switchTitle: translationKey("Answer calls to this policy\'s numbers")',
      'turnOffConfirmButton: translationKey("Stop answering calls")',
      'cardTitle: translationKey("Voice Messages")',
      'editButtonText: translationKey("Edit Messages")',
      'title: translationKey("Greeting Message")',
      'title: translationKey("No Answer Message")',
      'title: translationKey("No One Available Message")',
    ]) {
      expect({ fact, inCode: copy.includes(fact) }).toEqual({
        fact,
        inCode: true,
      });
    }

    for (const fact of [
      'cardTitle: translationKey("Repeat Policy")',
      'fieldTitle: translationKey("If nobody answers after the last rule")',
      'title: translationKey("End the call")',
      'title: translationKey("Ring again from the first rule")',
      'timesTitle: translationKey("How many more times?")',
    ]) {
      expect({ fact, inCode: incomingRepeat.includes(fact) }).toEqual({
        fact,
        inCode: true,
      });
    }

    expect(repeatCard).toContain('editButtonText="Edit"');
    // Turning calls away asks first; turning them back on saves at once.
    expect(settings).toContain(
      "getConfirmation={getStopAnsweringCallsConfirmation}",
    );

    for (const sentence of [
      "Open the policy and choose **Settings** under **Advanced** in its side menu. It has three cards:",
      "- **Answer Calls**: **Answer calls to this policy's numbers** saves as soon as you flip it.",
      "Turning it off asks first, with **Stop answering calls**.",
      "- **Repeat Policy**: what happens when nobody answers after the last rule. **Edit** asks **If nobody answers after the last rule**: **End the call**, or **Ring again from the first rule** and **How many more times?**.",
      "- **Voice Messages**: what callers hear. **Edit Messages** changes them.",
    ]) {
      expect({ sentence, onPage: page.includes(sentence) }).toEqual({
        sentence,
        onPage: true,
      });
    }
  });

  it("says the Overview of a policy that does not answer calls says so, with the button that turns calls on", () => {
    const copy: string = readDashboardFile(
      "Components/IncomingCallPolicy/IncomingCallPolicySettingsCopy.ts",
    );
    const overview: string = readDashboardFile(
      "Pages/OnCallDuty/IncomingCallPolicy/Index.tsx",
    );

    expect(copy).toContain(
      'startAnsweringButton: translationKey("Start answering calls")',
    );
    expect(overview).toContain("<IncomingCallAnswerCallsOffBanner");

    expect(page).toContain(
      "Turning it off asks first, with **Stop answering calls**. While it is off, the policy's **Overview** says so, with **Start answering calls** to turn it back on.",
    );
  });

  it("lists the call log's columns and its timeline", () => {
    const logs: string = readDashboardFile(
      "Pages/OnCallDuty/IncomingCallPolicy/Logs.tsx",
    );
    const logView: string = readDashboardFile(
      "Pages/OnCallDuty/IncomingCallPolicy/LogView.tsx",
    );

    for (const column of [
      "Caller",
      "Number Called",
      "Status",
      "Answered By",
      "Duration",
      "Started At",
    ]) {
      expect({ column, inCode: logs.includes(`title: "${column}"`) }).toEqual({
        column,
        inCode: true,
      });
    }

    expect(logs).toContain('viewButtonText="View Timeline"');
    expect(logView).toContain('title: "Call Timeline"');

    expect(page).toContain(
      "the **Caller**, the **Number Called**, its **Status**, who answered it (**Answered By**), the **Duration**, and when it **Started At**. Click **View Timeline** on a call to see its **Call Timeline**",
    );
  });

  it("lists exactly the statuses the server gives a call log", () => {
    /*
     * A call log is created Initiated and then moved on by the route; its
     * attempts (the Call Timeline's rows) have their own statuses, Ringing
     * and Connected among them, which the Status column never shows.
     */
    const given: Set<string> = new Set<string>();

    for (const match of incomingCallRoute.matchAll(
      /callLog\.status = IncomingCallStatus\.(\w+)/g,
    )) {
      given.add(match[1] as string);
    }

    for (const call of callsTo(incomingCallRoute, [
      "IncomingCallLogService.updateOneById(",
      "endMissedCall(",
    ])) {
      for (const match of call.matchAll(/status: IncomingCallStatus\.(\w+)/g)) {
        given.add(match[1] as string);
      }
    }

    expect([...given].sort()).toEqual(
      [
        IncomingCallStatus.Initiated,
        IncomingCallStatus.Escalated,
        IncomingCallStatus.Completed,
        IncomingCallStatus.NoAnswer,
        IncomingCallStatus.CallerHungUp,
        IncomingCallStatus.Failed,
      ].sort(),
    );

    const documented: Array<string> = tableAfter(
      page,
      "| Status | What happened |",
    ).flatMap((cells: Array<string>): Array<string> => {
      return boldIn(cells[0] as string);
    });

    expect(documented.sort()).toEqual(
      [...given]
        .map((status: string): string => {
          return statusLabel(status as IncomingCallStatus);
        })
        .sort(),
    );
  });

  it("calls missed exactly the calls the server treats as missed", () => {
    const missed: Array<string> = MISSED_INCOMING_CALL_STATUSES.map(
      (status: IncomingCallStatus): string => {
        return `**${statusLabel(status)}**`;
      },
    );

    expect(missed).toHaveLength(3);
    expect(page).toContain(
      `A call is missed when it ends without reaching anyone: its status is ${missed[0]}, ${missed[1]} or ${missed[2]}.`,
    );
  });

  it("names the missed call setting where User Settings shows it", () => {
    const settings: string = readDashboardFile(
      "Pages/UserSettings/NotificationSettings.tsx",
    );

    expect(settings).toMatch(
      /SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION\]: \{\s*label: "Missed call",/,
    );
    expect(settings).toContain('"Incoming Call Policies"');
    expect(page).toContain(
      "**User Settings** > **Notification Settings**, under **On-Call** > **Incoming Call Policies** > **Missed call**",
    );
  });

  it("sends engineers to the Incoming Call Policy section of User Settings, which starts folded, for one number per project", () => {
    const userSettingsMenu: string = readDashboardFile(
      "Pages/UserSettings/SideMenu.tsx",
    );
    const numbers: string = readDashboardFile(
      "Components/NotificationMethods/IncomingCallNumber.tsx",
    );

    expect(userSettingsMenu).toMatch(
      /title: "Incoming Call Policy",\s*defaultCollapsed: true,\s*items: \[\s*\{\s*link: \{\s*title: "Incoming Phone Numbers"/,
    );
    expect(numbers).toContain(
      'title: "Phone Numbers for Incoming Call Routing"',
    );
    expect(numbers).toContain(
      "Only one verified phone number is allowed per project.",
    );

    expect(page).toContain(
      "Open **User Settings** > **Incoming Call Policy** > **Incoming Phone Numbers**. **Incoming Call Policy** is a section of the side menu that starts folded.",
    );
    expect(page).toContain(
      "In the **Phone Numbers for Incoming Call Routing** card, click **Add Phone Number for Incoming Call Routing**",
    );
    expect(page).toContain(
      "Each person can have one verified number per project.",
    );
  });

  it("says releasing a number gives it back to Twilio, as the provider does", () => {
    const provider: string = readRepoFile(
      "App/FeatureSet/Notification/Providers/TwilioCallProvider.ts",
    );

    expect(provider).toMatch(
      /public async releaseNumber\(phoneNumberId: string\): Promise<void> \{\s*try \{\s*await this\.client\.incomingPhoneNumbers\(phoneNumberId\)\.remove\(\);/,
    );
    expect(page).toContain(
      "Releasing a number gives it back to Twilio, even a number you brought with **Use Existing Phone Number**",
    );
  });

  it("puts a project's own Twilio config on the Growth plan", () => {
    const config: string = readRepoFile(
      "Common/Models/DatabaseModels/ProjectCallSMSConfig.ts",
    );

    expect(config).toContain("create: PlanType.Growth,");
    expect(page).toContain(
      "| The **Growth** plan, on OneUptime Cloud | A project needs it for its own Twilio configuration. |",
    );
  });

  it("gives the API routes the models serve, and keeps numbers and call logs read only", () => {
    const routes: Array<Array<string>> = tableAfter(
      page,
      "| Resource | API route |",
    );
    const documented: Array<string> = routes.map(
      (cells: Array<string>): string => {
        return (cells[1] as string).replace(/`/g, "");
      },
    );

    expect(documented).toEqual(
      [
        new IncomingCallPolicy(),
        new IncomingCallPolicyEscalationRule(),
        new IncomingCallPolicyPhoneNumber(),
        new IncomingCallLog(),
      ].map((model: { crudApiPath: { toString(): string } | null }): string => {
        return `/api${model.crudApiPath!.toString()}`;
      }),
    );

    // Nobody creates a number or a call log through the API.
    expect(new IncomingCallPolicyPhoneNumber().createRecordPermissions).toEqual(
      [],
    );
    expect(new IncomingCallLog().createRecordPermissions).toEqual([]);
    expect(routes[2]![0]).toBe("Their phone numbers, read only");
    expect(routes[3]![0]).toBe("Call logs, read only");
  });

  it("offers call log triggers and Find steps only, as the workflow builder does", () => {
    const log: IncomingCallLog = new IncomingCallLog();

    expect(log.singularName).toBe("Incoming Call Log");
    expect(log.enableWorkflowOn.create).toBe(true);
    expect(log.enableWorkflowOn.update).toBe(true);
    expect(log.enableWorkflowOn.read).toBe(true);
    expect(log.enableWorkflowOn.writeSteps).toBe(false);

    expect(page).toContain(
      `**On Create ${log.singularName}** runs when a call comes in.`,
    );
    expect(page).toContain(
      `**On Update ${log.singularName}** runs as the call progresses.`,
    );
    expect(page).toContain(
      "A workflow can read call logs with **Find One** and **Find Many**, but it cannot create or change them.",
    );
  });
});

describe("the Escalation Rules page's text message section", () => {
  const page: string = readPage("en", "on-call/escalation-rules");
  const start: number = page.indexOf("### What a page's text message says");
  const section: string = page.slice(
    start,
    page.indexOf("### When a page is not sent"),
  );

  // The page's example, built by the code that writes every page's text.
  const example: OnCallPageSms = buildOnCallPageSms({
    kind: OnCallPageSmsKind.Incident,
    productName: NOTIFICATION_SMS_SENDER,
    severityName: "Critical Incident",
    number: "INC-42",
    projectName: "Acme Prod",
    title: "Checkout API is down",
    link: "https://oneuptime.com/l/XJlaZRsd",
  });

  it("sits under How the levels page people, before When a page is not sent", () => {
    expect(start).toBeGreaterThan(
      page.indexOf("### How each person is reached"),
    );
    expect(section.length).toBeGreaterThan(0);
  });

  it("quotes a page's text exactly as OneUptime writes it, and it is one part", () => {
    /*
     * Shown as a phone wraps it, at the sentence before the link, so the
     * docs column shows it all without scrolling: the same text, one line
     * when sent.
     */
    const block: string = section.slice(
      section.indexOf("```text\n") + "```text\n".length,
      section.indexOf("\n```", section.indexOf("```text\n") + 1),
    );
    const lines: Array<string> = block.split("\n");

    expect(section).toContain("On a phone it reads:\n\n```text\n");
    expect(lines).toEqual([
      example.text.slice(
        0,
        example.text.indexOf(` ${ON_CALL_PAGE_SMS_ACTION}`),
      ),
      example.text.slice(example.text.indexOf(ON_CALL_PAGE_SMS_ACTION)),
    ]);
    expect(lines.join(" ")).toBe(example.text);
    // Each line fits the docs column (556px of 13px JetBrains Mono: 71 characters).
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(71);
    }
    expect(example.sent.encoding).toBe(SmsEncoding.Gsm7);
    expect(example.sent.segments).toBe(1);
    expect(example.text).toContain(ON_CALL_PAGE_SMS_ACTION);
  });

  /*
   * A page again (a policy paging again because an acknowledged record is
   * still not resolved) says so, where its first page read as a new one.
   */
  it("quotes a page again's text exactly as OneUptime writes it, and it is one part", () => {
    const pageAgain: OnCallPageSms = buildOnCallPageSms({
      kind: OnCallPageSmsKind.Incident,
      productName: NOTIFICATION_SMS_SENDER,
      severityName: "Critical Incident",
      number: "INC-42",
      projectName: "Acme Prod",
      title: "Checkout API is down",
      link: "https://oneuptime.com/l/XJlaZRsd",
      isPageAgain: true,
    });
    const intro: string =
      "When a policy pages again because an acknowledged incident or alert is still not resolved, the text says so after the number and the project, and those words are never cut either:\n\n```text\n";
    const at: number = section.indexOf(intro);
    const block: string = section.slice(
      at + intro.length,
      section.indexOf("\n```", at + intro.length),
    );
    const lines: Array<string> = block.split("\n");
    const why: string = `${ON_CALL_PAGE_SMS_STILL_NOT_RESOLVED}:`;

    expect(at).toBeGreaterThan(section.indexOf("are never cut."));
    // Shown as a phone wraps it, after the words that say why: one line when sent.
    expect(lines).toEqual([
      pageAgain.text.slice(0, pageAgain.text.indexOf(why) + why.length),
      pageAgain.text.slice(pageAgain.text.indexOf(why) + why.length + 1),
    ]);
    expect(lines.join(" ")).toBe(pageAgain.text);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(71);
    }
    expect(pageAgain.sent.encoding).toBe(SmsEncoding.Gsm7);
    expect(pageAgain.sent.segments).toBe(1);

    // The same page's first text, without those words.
    expect(
      pageAgain.text.replace(` ${ON_CALL_PAGE_SMS_STILL_NOT_RESOLVED}`, ""),
    ).toBe(example.text);
  });

  /*
   * A page a person asked for (OnCallPersonPage) - from Slack or Microsoft
   * Teams - says who paged whom, where a page OneUptime starts reads as news
   * of its record, from nobody.
   */
  it("quotes a person's page's text exactly as OneUptime writes it, and it is one part", () => {
    const lead: string = getOnCallPersonPageLead({
      pagedByName: "Alice Kim",
      teamName: "Platform",
    });
    const personPage: OnCallPageSms = buildOnCallPageSms({
      kind: OnCallPageSmsKind.Incident,
      productName: NOTIFICATION_SMS_SENDER,
      severityName: "Critical Incident",
      number: "INC-42",
      projectName: "Acme Prod",
      title: "Checkout API is down",
      link: "https://oneuptime.com/l/XJlaZRsd",
      lead: lead,
    });
    const intro: string =
      "When somebody pages you from Slack or Microsoft Teams, the text says who paged whom after `OneUptime:`, and those words are never cut either:\n\n```text\n";
    const at: number = section.indexOf(intro);
    const block: string = section.slice(
      at + intro.length,
      section.indexOf("\n```", at + intro.length),
    );
    const lines: Array<string> = block.split("\n");

    expect(lead).toBe("Alice Kim paged Platform");
    // After the page again's example.
    expect(at).toBeGreaterThan(section.indexOf("is still not resolved:\n"));
    // Shown as a phone wraps it: one line when sent.
    expect(lines.join(" ")).toBe(personPage.text);
    expect(lines[lines.length - 1]).toBe(
      personPage.text.slice(personPage.text.indexOf(ON_CALL_PAGE_SMS_ACTION)),
    );
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(71);
    }
    expect(personPage.sent.encoding).toBe(SmsEncoding.Gsm7);
    expect(personPage.sent.segments).toBe(1);

    // The same page's first text, with who paged before what happened.
    expect(personPage.text.replace(`${lead} about `, "")).toBe(example.text);
  });

  it("gives the part sizes the counter bills by", () => {
    expect(section).toContain(
      `in parts of ${GSM_7_SINGLE_SEGMENT_LENGTH} characters`,
    );
    expect(section).toContain(
      `the whole text go out in parts of ${UCS_2_SINGLE_SEGMENT_LENGTH} characters`,
    );
  });

  it("gives the fitting rule in its order, with the cut mark and the shortest title", () => {
    expect(section).toContain(
      "1. The project is left out first.\n" +
        `2. Then the title is cut, and ends with \`${ON_CALL_PAGE_SMS_CUT_MARK}\`.`,
    );
    expect(section).toContain(
      `A title keeps at least ${MIN_TITLE_CHARACTERS} characters`,
    );
    expect(section).toContain(
      "The severity, the number and the link are never cut.",
    );

    // What the code does when the project goes and when the title is cut.
    const longTitle: OnCallPageSms = buildOnCallPageSms({
      kind: OnCallPageSmsKind.Incident,
      productName: NOTIFICATION_SMS_SENDER,
      severityName: "Critical Incident",
      number: "INC-42",
      projectName: "Acme Prod",
      title:
        "Checkout API is down for every customer in every region since the deploy of 10:42",
      link: "https://oneuptime.com/l/XJlaZRsd",
    });

    expect(longTitle.isProjectLeftOut).toBe(true);
    expect(longTitle.isTitleCut).toBe(true);
    expect(longTitle.text).toContain(
      `${ON_CALL_PAGE_SMS_CUT_MARK} ${ON_CALL_PAGE_SMS_ACTION}`,
    );
    expect(longTitle.text).toContain(" INC-42: ");
    expect(longTitle.text).toContain("Critical Incident");
  });

  it("names the characters it writes plainly as the code writes them", () => {
    expect(section).toContain(
      "So curly quotes and dashes are written as `\"`, `'` and `-`, `\u{2026}` as `...`, and letters such as `\u{00E7}` and `\u{0142}` lose their accents; emoji are left out.",
    );
    expect(toGsm7Text("\u{201C}\u{201D}")).toBe('""');
    expect(toGsm7Text("\u{2018}\u{2019}")).toBe("''");
    expect(toGsm7Text("\u{2013}\u{2014}")).toBe("--");
    expect(toGsm7Text("\u{2026}")).toBe("...");
    expect(toGsm7Text("\u{00E7}\u{0142}")).toBe("cl");
    expect(toGsm7Text("\u{1F525}")).toBe("");
    // A title in another script is kept as written.
    expect(toGsm7Text("\u{6C7A}\u{6E08}")).toBe("\u{6C7A}\u{6E08}");
  });

  it("quotes the words every other text to a team member starts and ends with", () => {
    expect(section).toContain(
      `start with \`${NOTIFICATION_SMS_SENDER}:\` too and end with \`${NOTIFICATION_SMS_TURN_OFF}\``,
    );
    expect(buildNotificationSms("X.")).toBe(
      `${NOTIFICATION_SMS_SENDER}: X. ${NOTIFICATION_SMS_TURN_OFF}`,
    );
  });
});

describe("the Escalation Rules page's message limits", () => {
  const page: string = readPage("en", "on-call/escalation-rules");
  const rows: Array<Array<string>> = tableAfter(
    page,
    "| Channel | The longest message it carries |",
  );
  const limitOf: (channel: string) => string = (channel: string): string => {
    const row: Array<string> | undefined = rows.find(
      (cells: Array<string>): boolean => {
        return cells[0] === channel;
      },
    );

    expect({ channel, row: Boolean(row) }).toEqual({ channel, row: true });

    return row![1] as string;
  };

  it("gives each channel the limit its message is cut to", () => {
    const thousands: (value: number) => string = (value: number): string => {
      return value.toLocaleString("en-US");
    };

    expect(
      rows.map((cells: Array<string>): string => {
        return cells[0] as string;
      }),
    ).toEqual([
      "SMS",
      "Phone call",
      "Push notification",
      "WhatsApp",
      "Telegram",
    ]);
    expect(limitOf("SMS")).toBe(`${thousands(MAX_SMS_LENGTH)} characters`);
    expect(limitOf("Phone call")).toBe(
      `What fits in Twilio's ${thousands(MAX_CALL_TWIML_LENGTH)}-character call script`,
    );
    expect(limitOf("Push notification")).toBe(
      `4 KB, of which its title, text and data take up to ${MAX_PUSH_TEXT_BYTES / 1024} KB`,
    );
    expect(limitOf("WhatsApp")).toBe(
      `${thousands(MAX_WHATSAPP_TEMPLATE_TEXT_LENGTH)} characters`,
    );
    expect(limitOf("Telegram")).toBe(
      `${thousands(MAX_TELEGRAM_MESSAGE_LENGTH)} characters`,
    );
  });

  it("quotes the note a cut message ends with, and the mark a cut value ends with", () => {
    expect(page).toContain(
      `ends with a note that the full text is in OneUptime: "${TRUNCATED_TEXT_NOTE}".`,
    );
    expect(page).toContain(
      `each ending with "${TRUNCATED_NAME_NOTE}". The links in a message are never cut.`,
    );
  });
});
