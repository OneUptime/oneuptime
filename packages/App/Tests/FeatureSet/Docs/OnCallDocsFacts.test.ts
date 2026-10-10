import { readPage } from "./DocsContentSupport";
import IncomingCallLog from "Common/Models/DatabaseModels/IncomingCallLog";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyEscalationRule from "Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import IncomingCallStatus from "Common/Types/IncomingCall/IncomingCallStatus";
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
      "Twilio sends every call to `https://<your host>/notification/incoming-call/voice`.",
    );
    expect(page).toContain(
      "OneUptime sets the number's voice webhook to `https://<your host>/notification/incoming-call/voice`, built from `HOST` and `HTTP_PROTOCOL`",
    );
    expect(page).toContain(
      "Twilio->>OneUptime: POST /notification/incoming-call/voice",
    );
    expect(page).toContain(
      "Twilio->>OneUptime: POST /notification/incoming-call/dial-status/...",
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
    for (const phrase of [
      "Connecting you to the next available engineer.",
      "Sorry, this service is currently disabled.",
    ]) {
      expect({ phrase, inCode: incomingCallRoute.includes(phrase) }).toEqual({
        phrase,
        inCode: true,
      });
      expect({ phrase, onPage: page.includes(`"${phrase}"`) }).toEqual({
        phrase,
        onPage: true,
      });
    }
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

    expect(valueOf("Enabled")).toBe(
      onOff(columnDefault(policySource, "isEnabled")),
    );
    expect(valueOf("Repeat Policy If No One Answers")).toBe(
      onOff(columnDefault(policySource, "repeatPolicyIfNoOneAnswers")),
    );
    expect(valueOf("Repeat Policy Times")).toBe(
      columnDefault(policySource, "repeatPolicyIfNoOneAnswersTimes"),
    );

    // The route falls back to the same greeting when a policy has none.
    expect(incomingCallRoute).toContain(
      `"${columnDefault(policySource, "greetingMessage")}"`,
    );
  });

  it("names the Settings page's cards, buttons and fields", () => {
    const settings: string = readDashboardFile(
      "Pages/OnCallDuty/IncomingCallPolicy/Settings.tsx",
    );

    expect(settings).toMatch(
      /editButtonText="Edit Messages"\s*cardProps=\{\{\s*title: "Voice Messages"/,
    );
    expect(settings).toMatch(
      /editButtonText="Edit Policy Settings"\s*cardProps=\{\{\s*title: "Policy Settings"/,
    );

    for (const field of [
      "Greeting Message",
      "No Answer Message",
      "No One Available Message",
      "Enabled",
      "Repeat Policy If No One Answers",
      "Repeat Policy Times",
    ]) {
      expect({ field, inCode: settings.includes(`title: "${field}"`) }).toEqual(
        { field, inCode: true },
      );
    }

    expect(page).toContain(
      "**Edit Messages** on the **Voice Messages** card changes what callers hear; **Edit Policy Settings** on the **Policy Settings** card changes the rest.",
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

    expect(rows.map((cells: Array<string>): string => {
      return cells[0] as string;
    })).toEqual(["SMS", "Phone call", "Push notification", "WhatsApp", "Telegram"]);
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
