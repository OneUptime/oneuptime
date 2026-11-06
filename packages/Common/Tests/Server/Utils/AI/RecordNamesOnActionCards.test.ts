import { afterEach, describe, expect, test } from "@jest/globals";
import Incident from "../../../../Models/DatabaseModels/Incident";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybook from "../../../../Models/DatabaseModels/SecurityPlaybook";
import IncidentService from "../../../../Server/Services/IncidentService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import RunbookService from "../../../../Server/Services/RunbookService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityPlaybookService from "../../../../Server/Services/SecurityPlaybookService";
import {
  PageOnCallPolicyTool,
  RunRunbookTool,
} from "../../../../Server/Utils/AI/Toolbox/AIActionTools";
import { quoteRecordName } from "../../../../Server/Utils/AI/Toolbox/RecordNamesForPerson";
import { RunSecurityPlaybookTool } from "../../../../Server/Utils/AI/Toolbox/SecurityCaseTools";
import {
  ObservabilityTool,
  PreparedMutation,
  ToolContext,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  AI_ACTION_TITLES,
  describeAIActionSentence,
  isKnownAIActionSentence,
} from "../../../../Types/AI/AIActionWords";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { dashboardTranslator } from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";

/*
 * HOW AN APPROVAL CARD NAMES WHAT A PAGE, A RUN OR A PLAYBOOK IS FOR.
 *
 * The card's title names each record the way the person knows it, read
 * with their own permissions before the card is shown:
 *
 *   - a name is written in quotes, as the card's line writes a resource's
 *     ('host "test01"'): 'Run runbook "Restart checkout"' says where the
 *     name ends, where "Run runbook Restart checkout" ran on into the
 *     sentence. A number ("INC-42") is written bare;
 *   - paging an on-call policy and running a runbook name the incident they
 *     are for by its number, once the person may read it: the card's line
 *     of arguments showed the incident's ID instead (namedArguments leaves
 *     an argument the title names out of that line);
 *   - an incident the person may not read is not named, and stays on that
 *     line as the call names it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
);
const USER_ID: ObjectID = new ObjectID("b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2");
const POLICY_ID: string = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const RUNBOOK_ID: string = "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4";
const INCIDENT_ID: string = "e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5";
const CASE_ID: string = "f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6";
const PLAYBOOK_ID: string = "a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7";

const CONTEXT: ToolContext = {
  projectId: PROJECT_ID,
  props: { userId: USER_ID, tenantId: PROJECT_ID },
};

function incidentNamed(number: number, withPrefix?: string): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID;
  incident.incidentNumber = number;

  if (withPrefix) {
    incident.incidentNumberWithPrefix = withPrefix;
  }

  return incident;
}

function policyNamed(name: string): OnCallDutyPolicy {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy._id = POLICY_ID;
  policy.name = name;
  return policy;
}

function runbookNamed(name: string): Runbook {
  const runbook: Runbook = new Runbook();
  runbook._id = RUNBOOK_ID;
  runbook.name = name;
  return runbook;
}

// What the person may read: each record, or null for one they may not.
function stubReads(data: {
  incident?: Incident | null;
  policy?: OnCallDutyPolicy | null;
  runbook?: Runbook | null;
}): void {
  jest
    .spyOn(IncidentService, "findOneById")
    .mockResolvedValue(data.incident ?? null);
  jest
    .spyOn(OnCallDutyPolicyService, "findOneById")
    .mockResolvedValue(data.policy ?? null);
  jest
    .spyOn(RunbookService, "findOneById")
    .mockResolvedValue(data.runbook ?? null);
}

async function prepare(
  tool: ObservabilityTool,
  args: JSONObject,
): Promise<PreparedMutation> {
  return tool.prepareMutation!({ ...args }, CONTEXT);
}

function english(prepared: PreparedMutation): string {
  return describeAIActionSentence(prepared.title!);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a name on a card is quoted; a number is not", () => {
  test("quoteRecordName writes a name as a JSON string, and nothing for no name", () => {
    expect(quoteRecordName("Restart checkout")).toBe('"Restart checkout"');
    // A quote in the name can never read as its end.
    expect(quoteRecordName('Say "hi"')).toBe('"Say \\"hi\\""');
    expect(quoteRecordName(null)).toBeNull();
    expect(quoteRecordName("")).toBeNull();
  });

  test("a runbook's name, quoted; with no incident on the call, the title names none", async () => {
    stubReads({ runbook: runbookNamed("Restart checkout") });

    const prepared: PreparedMutation = await prepare(RunRunbookTool, {
      runbookId: RUNBOOK_ID,
    });

    expect(english(prepared)).toBe('Run runbook "Restart checkout"');
    expect(prepared.title!.template).toBe(AI_ACTION_TITLES.runRunbook);
    expect(prepared.namedArguments).toEqual(["runbookId"]);
    expect(isKnownAIActionSentence(prepared.title)).toBe(true);
  });

  test("a playbook's name is quoted, the case's number is not", async () => {
    const securityCase: SecurityCase = new SecurityCase();
    securityCase._id = CASE_ID;
    securityCase.caseNumber = 3;
    securityCase.caseNumberWithPrefix = "CASE-3";
    jest
      .spyOn(SecurityCaseService, "findOneById")
      .mockResolvedValue(securityCase);
    const playbook: SecurityPlaybook = new SecurityPlaybook();
    playbook._id = PLAYBOOK_ID;
    playbook.name = "Contain host";
    jest
      .spyOn(SecurityPlaybookService, "findOneById")
      .mockResolvedValue(playbook);

    const prepared: PreparedMutation = await prepare(RunSecurityPlaybookTool, {
      securityCaseId: CASE_ID,
      securityPlaybookId: PLAYBOOK_ID,
    });

    expect(english(prepared)).toBe(
      'Run playbook "Contain host" on security case CASE-3',
    );
  });

  test("a name with a quote in it keeps it inside its quotes", async () => {
    stubReads({ runbook: runbookNamed('Drain "blue" pool') });

    const prepared: PreparedMutation = await prepare(RunRunbookTool, {
      runbookId: RUNBOOK_ID,
    });

    expect(english(prepared)).toBe('Run runbook "Drain \\"blue\\" pool"');
  });
});

describe("a page names the incident it is for", () => {
  test("by its number, beside the policy's name, and leaves both IDs off the line of arguments", async () => {
    stubReads({
      incident: incidentNamed(42, "INC-42"),
      policy: policyNamed("Checkout on-call"),
    });

    const prepared: PreparedMutation = await prepare(PageOnCallPolicyTool, {
      onCallDutyPolicyId: POLICY_ID,
      incidentId: INCIDENT_ID,
    });

    expect(english(prepared)).toBe(
      'Page on-call policy "Checkout on-call" for incident INC-42',
    );
    expect(prepared.title!.template).toBe(
      AI_ACTION_TITLES.pageOnCallPolicyForIncident,
    );
    expect([...prepared.namedArguments!].sort()).toEqual([
      "incidentId",
      "onCallDutyPolicyId",
    ]);
    expect(isKnownAIActionSentence(prepared.title)).toBe(true);
    // The call is unchanged: the prepare only names what it acts on.
    expect(prepared.arguments).toEqual({
      onCallDutyPolicyId: POLICY_ID,
      incidentId: INCIDENT_ID,
    });
  });

  test("a project with no number prefix: the incident as #42", async () => {
    stubReads({
      incident: incidentNamed(42),
      policy: policyNamed("Checkout on-call"),
    });

    const prepared: PreparedMutation = await prepare(PageOnCallPolicyTool, {
      onCallDutyPolicyId: POLICY_ID,
      incidentId: INCIDENT_ID,
    });

    expect(english(prepared)).toBe(
      'Page on-call policy "Checkout on-call" for incident #42',
    );
  });

  test("an incident the person may not read is not named: it stays on the line of arguments", async () => {
    stubReads({ incident: null, policy: policyNamed("Checkout on-call") });

    const prepared: PreparedMutation = await prepare(PageOnCallPolicyTool, {
      onCallDutyPolicyId: POLICY_ID,
      incidentId: INCIDENT_ID,
    });

    expect(english(prepared)).toBe('Page on-call policy "Checkout on-call"');
    expect(prepared.namedArguments).toEqual(["onCallDutyPolicyId"]);
  });

  test("a policy the person may not read keeps its ID, the incident still by its number", async () => {
    stubReads({ incident: incidentNamed(42, "INC-42"), policy: null });

    const prepared: PreparedMutation = await prepare(PageOnCallPolicyTool, {
      onCallDutyPolicyId: POLICY_ID,
      incidentId: INCIDENT_ID,
    });

    expect(english(prepared)).toBe(
      `Page on-call policy ${POLICY_ID} for incident INC-42`,
    );
    expect(prepared.namedArguments).toEqual(["incidentId"]);
  });

  test("nothing the person may read: no title of the prepare's, the card keeps buildActionTitle's", async () => {
    stubReads({ incident: null, policy: null });

    const prepared: PreparedMutation = await prepare(PageOnCallPolicyTool, {
      onCallDutyPolicyId: POLICY_ID,
      incidentId: INCIDENT_ID,
    });

    expect(prepared.title).toBeUndefined();
    expect(prepared.namedArguments).toBeUndefined();
    expect(
      describeAIActionSentence(
        PageOnCallPolicyTool.buildActionTitle!({
          onCallDutyPolicyId: POLICY_ID,
          incidentId: INCIDENT_ID,
        }),
      ),
    ).toBe(`Page on-call policy ${POLICY_ID}`);
  });
});

describe("a run names the incident it is for", () => {
  test("by its number, beside the runbook's name", async () => {
    stubReads({
      incident: incidentNamed(42, "INC-42"),
      runbook: runbookNamed("Restart checkout"),
    });

    const prepared: PreparedMutation = await prepare(RunRunbookTool, {
      runbookId: RUNBOOK_ID,
      incidentId: INCIDENT_ID,
    });

    expect(english(prepared)).toBe(
      'Run runbook "Restart checkout" for incident INC-42',
    );
    expect(prepared.title!.template).toBe(
      AI_ACTION_TITLES.runRunbookForIncident,
    );
    expect([...prepared.namedArguments!].sort()).toEqual([
      "incidentId",
      "runbookId",
    ]);
  });

  test("an incident the person may not read is not named", async () => {
    stubReads({ incident: null, runbook: runbookNamed("Restart checkout") });

    const prepared: PreparedMutation = await prepare(RunRunbookTool, {
      runbookId: RUNBOOK_ID,
      incidentId: INCIDENT_ID,
    });

    expect(english(prepared)).toBe('Run runbook "Restart checkout"');
    expect(prepared.namedArguments).toEqual(["runbookId"]);
  });
});

describe("the reader's language says the same, the name and the number as written", () => {
  test.each([
    [
      "de",
      'Bereitschaftsrichtlinie "Checkout on-call" zu Vorfall INC-42 alarmieren',
      'Runbook "Restart checkout" für Vorfall INC-42 ausführen',
    ],
    [
      "fa",
      'فراخوانی با سیاست آنکال "Checkout on-call" برای حادثه INC-42',
      'اجرای رانبوک "Restart checkout" برای حادثه INC-42',
    ],
    [
      "ja",
      'インシデント INC-42 についてオンコールポリシー "Checkout on-call" で呼び出す',
      'インシデント INC-42 に対して Runbook "Restart checkout" を実行',
    ],
  ])("%s", async (language: string, page: string, run: string) => {
    stubReads({
      incident: incidentNamed(42, "INC-42"),
      policy: policyNamed("Checkout on-call"),
      runbook: runbookNamed("Restart checkout"),
    });

    const paged: PreparedMutation = await prepare(PageOnCallPolicyTool, {
      onCallDutyPolicyId: POLICY_ID,
      incidentId: INCIDENT_ID,
    });
    const ran: PreparedMutation = await prepare(RunRunbookTool, {
      runbookId: RUNBOOK_ID,
      incidentId: INCIDENT_ID,
    });

    // As the card draws it: values set apart, which a reader never sees.
    expect(
      withoutIsolateMarks(
        describeAIActionSentence(paged.title!, dashboardTranslator(language), {
          setsValuesApart: true,
        }),
      ),
    ).toBe(page);
    expect(
      withoutIsolateMarks(
        describeAIActionSentence(ran.title!, dashboardTranslator(language), {
          setsValuesApart: true,
        }),
      ),
    ).toBe(run);
  });
});
