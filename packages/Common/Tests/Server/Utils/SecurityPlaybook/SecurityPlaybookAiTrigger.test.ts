import { afterEach, describe, expect, jest, test } from "@jest/globals";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybook from "../../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../../../Server/Services/SecurityPlaybookRunService";
import SecurityPlaybookService from "../../../../Server/Services/SecurityPlaybookService";
import { describeRunTrigger } from "../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import { doesPlaybookMatch } from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookConditions";
import SecurityPlaybookLauncher from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookLauncher";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import {
  buildDefaultTestPriorities,
  testPriorityId,
} from "../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookTrigger, {
  AI_SECURITY_PLAYBOOK_TRIGGERS,
  SECURITY_PLAYBOOK_TRIGGERS,
  isAiSecurityPlaybookTrigger,
  isSecurityPlaybookTrigger,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { playbookStartedMarkdown } from "../../../../Utils/SecurityCase/SecurityCaseMarkdown";

/*
 * Triaged as Likely Malicious: a playbook that runs when OneUptime AI's
 * triage reads a case as Likely Malicious. About the whole case, so its
 * detection conditions are met by any of the case's detections; once per
 * case, so a case triaged again never runs it twice; and its steps wait
 * for approval as every playbook's do.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b811-9dad-41d1-80b4-00c04fd43301",
);
const CASE_ID: ObjectID = new ObjectID("6ba7b812-9dad-41d1-80b4-00c04fd43301");
const RULE_A: ObjectID = new ObjectID("6ba7b814-9dad-41d1-80b4-00c04fd43301");
const RULE_B: ObjectID = new ObjectID("6ba7b815-9dad-41d1-80b4-00c04fd43301");

function steps(actions: Array<SecurityPlaybookActionType>): JSONArray {
  return actions.map((action: SecurityPlaybookActionType): JSONObject => {
    return { id: ObjectID.generate().toString(), action, config: {} };
  });
}

function playbook(
  idSuffix: string,
  overrides: Partial<SecurityPlaybook> = {},
): SecurityPlaybook {
  const model: SecurityPlaybook = new SecurityPlaybook();
  model._id = `6ba7b813-9dad-41d1-80b4-00c04fd4${idSuffix}`;
  model.name = `Playbook ${idSuffix}`;
  model.isEnabled = true;
  model.trigger = SecurityPlaybookTrigger.TriagedAsLikelyMalicious;
  model.steps = steps([SecurityPlaybookActionType.AddCaseNote]);
  Object.assign(model, overrides);
  return model;
}

function install(data: {
  playbooks: Array<SecurityPlaybook>;
  alreadyRan?: Array<string>;
}): { started: Array<SecurityPlaybookRun>; triggers: Array<unknown> } {
  const started: Array<SecurityPlaybookRun> = [];
  const triggers: Array<unknown> = [];

  jest
    .spyOn(SecurityPlaybookService, "findBy")
    .mockImplementation(async (args: { query?: unknown }) => {
      triggers.push((args.query as JSONObject | undefined)?.["trigger"]);
      return data.playbooks as never;
    });

  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.High,
  );
  stubSecurityCaseValues();

  jest
    .spyOn(SecurityCaseService, "findOneBy")
    .mockResolvedValue(securityCase as never);

  jest
    .spyOn(SecurityPlaybookRunService, "countBy")
    .mockImplementation(async (args: { query?: unknown }) => {
      const id: string = String(
        (args.query as JSONObject | undefined)?.["securityPlaybookId"] || "",
      );
      return new PositiveNumber(
        (data.alreadyRan || []).includes(id) ? 1 : 0,
      ) as never;
    });

  jest
    .spyOn(SecurityPlaybookRunService, "create")
    .mockImplementation(async (args: { data: SecurityPlaybookRun }) => {
      started.push(args.data);
      return args.data as never;
    });

  return { started, triggers };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the trigger", () => {
  test("is listed between the detection triggers and Manual, and set off by AI", () => {
    expect(SECURITY_PLAYBOOK_TRIGGERS).toEqual([
      SecurityPlaybookTrigger.CaseOpened,
      SecurityPlaybookTrigger.DetectionAdded,
      SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
      SecurityPlaybookTrigger.Manual,
    ]);
    expect(SecurityPlaybookTrigger.TriagedAsLikelyMalicious).toBe(
      "Triaged as Likely Malicious",
    );
    expect(isSecurityPlaybookTrigger("Triaged as Likely Malicious")).toBe(true);
    expect(AI_SECURITY_PLAYBOOK_TRIGGERS).toEqual([
      SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
    ]);
    expect(
      isAiSecurityPlaybookTrigger(
        SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
      ),
    ).toBe(true);
    expect(
      isAiSecurityPlaybookTrigger(SecurityPlaybookTrigger.CaseOpened),
    ).toBe(false);
    expect(isAiSecurityPlaybookTrigger(42)).toBe(false);
  });

  test("the timeline and the approval email say how the run started", () => {
    expect(
      playbookStartedMarkdown({
        playbookName: "Contain Host",
        trigger: SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
      }).toString(),
    ).toBe(
      "▶️ Started playbook **Contain Host** when AI triage read the case as Likely Malicious.",
    );
    expect(
      describeRunTrigger(SecurityPlaybookTrigger.TriagedAsLikelyMalicious),
    ).toBe("Automatically, when AI triage read the case as Likely Malicious");
  });

  test("a playbook on it runs for that event only", () => {
    const conditions: {
      isEnabled: boolean;
      trigger: SecurityPlaybookTrigger;
    } = {
      isEnabled: true,
      trigger: SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
    };

    expect(
      doesPlaybookMatch(conditions, {
        trigger: SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
        priorities: buildDefaultTestPriorities(),
        casePriorityId: testPriorityId(SecurityCasePriorityLevel.High),
      }),
    ).toBe(true);
    expect(
      doesPlaybookMatch(conditions, {
        trigger: SecurityPlaybookTrigger.CaseOpened,
        priorities: buildDefaultTestPriorities(),
        casePriorityId: testPriorityId(SecurityCasePriorityLevel.High),
      }),
    ).toBe(false);
  });
});

describe("SecurityPlaybookLauncher, Triaged as Likely Malicious", () => {
  test("starts the playbooks on the trigger, recording the trigger on the run", async () => {
    const { started, triggers } = install({ playbooks: [playbook("0001")] });

    const count: number = await SecurityPlaybookLauncher.launchForCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      trigger: SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
      detections: [],
    });

    expect(count).toBe(1);
    expect(triggers).toEqual([
      SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
    ]);
    expect(started[0]!.trigger).toBe(
      SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
    );
    expect(started[0]!.securityCaseId?.toString()).toBe(CASE_ID.toString());
  });

  test("once per case: a playbook that already ran for it is not started again", async () => {
    const first: SecurityPlaybook = playbook("0001");
    const second: SecurityPlaybook = playbook("0002");
    const { started } = install({
      playbooks: [first, second],
      alreadyRan: [first._id!.toString()],
    });

    await SecurityPlaybookLauncher.launchForCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      trigger: SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
      detections: [],
    });

    expect(
      started.map((run: SecurityPlaybookRun): string => {
        return run.securityPlaybookId!.toString();
      }),
    ).toEqual([second._id!.toString()]);
  });

  test("a playbook limited to a source or to rules runs when any of the case's detections meets it", async () => {
    const bySource: SecurityPlaybook = playbook("0001", {
      detectionSource: SecurityDetectionSource.ThreatIntel,
    });
    const byRule: SecurityPlaybook = playbook("0002", {
      detectionRuleIds: [RULE_B.toString()],
    });
    const neither: SecurityPlaybook = playbook("0003", {
      detectionSource: SecurityDetectionSource.ConnectedProduct,
    });
    const { started } = install({ playbooks: [bySource, byRule, neither] });

    await SecurityPlaybookLauncher.launchForCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      trigger: SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
      detections: [
        {
          source: SecurityDetectionSource.DetectionRule,
          detectionRuleId: RULE_A,
        },
        {
          source: SecurityDetectionSource.DetectionRule,
          detectionRuleId: RULE_B,
        },
        { source: SecurityDetectionSource.ThreatIntel },
      ],
    });

    expect(
      started.map((run: SecurityPlaybookRun): string => {
        return run.securityPlaybookId!.toString();
      }),
    ).toEqual([bySource._id!.toString(), byRule._id!.toString()]);
  });

  test("a case with no detection meets no detection condition", async () => {
    const limited: SecurityPlaybook = playbook("0001", {
      detectionSource: SecurityDetectionSource.DetectionRule,
    });
    const open: SecurityPlaybook = playbook("0002");
    const { started } = install({ playbooks: [limited, open] });

    await SecurityPlaybookLauncher.launchForCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      trigger: SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
      detections: [],
    });

    expect(
      started.map((run: SecurityPlaybookRun): string => {
        return run.securityPlaybookId!.toString();
      }),
    ).toEqual([open._id!.toString()]);
  });

  test("the setup test's case: only playbooks that stay inside OneUptime", async () => {
    const inside: SecurityPlaybook = playbook("0001");
    const outside: SecurityPlaybook = playbook("0002", {
      steps: steps([SecurityPlaybookActionType.EmailPeople]),
    });
    const { started } = install({ playbooks: [inside, outside] });

    await SecurityPlaybookLauncher.launchForCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      trigger: SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
      detections: [],
      onlyPlaybooksThatStayInside: true,
    });

    expect(
      started.map((run: SecurityPlaybookRun): string => {
        return run.securityPlaybookId!.toString();
      }),
    ).toEqual([inside._id!.toString()]);
  });

  test("the detection triggers are never limited to once per case", async () => {
    const count: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityPlaybookRunService,
      "countBy",
    );
    install({
      playbooks: [
        playbook("0001", { trigger: SecurityPlaybookTrigger.DetectionAdded }),
      ],
    });

    await SecurityPlaybookLauncher.launchForCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      trigger: SecurityPlaybookTrigger.DetectionAdded,
      detection: { source: SecurityDetectionSource.DetectionRule },
    });

    expect(count).not.toHaveBeenCalled();
  });
});
