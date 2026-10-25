import { afterEach, describe, expect, jest, test } from "@jest/globals";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybook from "../../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../../../Server/Services/SecurityPlaybookRunService";
import SecurityPlaybookService from "../../../../Server/Services/SecurityPlaybookService";
import SecurityPlaybookLauncher from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookLauncher";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import { testPriorityId } from "../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import {
  SECURITY_PLAYBOOK_ACTIONS,
  SECURITY_PLAYBOOK_INSIDE_CATEGORIES,
  SecurityPlaybookActionCategory,
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  doStepsStayInsideOneUptime,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookTrigger from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b811-9dad-41d1-80b4-00c04fd43301",
);
const CASE_ID: ObjectID = new ObjectID("6ba7b812-9dad-41d1-80b4-00c04fd43301");

function steps(actions: Array<SecurityPlaybookActionType>): JSONArray {
  return actions.map((action: SecurityPlaybookActionType): JSONObject => {
    return { id: ObjectID.generate().toString(), action, config: {} };
  });
}

function playbook(
  idSuffix: string,
  actions: Array<SecurityPlaybookActionType> | null,
): SecurityPlaybook {
  const model: SecurityPlaybook = new SecurityPlaybook();
  model._id = `6ba7b813-9dad-41d1-80b4-00c04fd4${idSuffix}`;
  model.name = `Playbook ${idSuffix}`;
  model.isEnabled = true;
  model.trigger = SecurityPlaybookTrigger.CaseOpened;

  if (actions) {
    model.steps = steps(actions);
  }

  return model;
}

function install(playbooks: Array<SecurityPlaybook>): {
  started: Array<string>;
  selects: Array<JSONObject>;
} {
  const started: Array<string> = [];
  const selects: Array<JSONObject> = [];

  jest
    .spyOn(SecurityPlaybookService, "findBy")
    .mockImplementation(async (data: { select?: unknown }) => {
      selects.push(data.select as JSONObject);
      return playbooks as never;
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
    .spyOn(SecurityPlaybookRunService, "create")
    .mockImplementation(async (data: { data: SecurityPlaybookRun }) => {
      started.push(data.data.securityPlaybookId!.toString());
      return data.data as never;
    });

  return { started, selects };
}

const ENRICH: SecurityPlaybook = playbook("0001", [
  SecurityPlaybookActionType.CheckThreatIntel,
  SecurityPlaybookActionType.LookUpEntityActivity,
  SecurityPlaybookActionType.AddCaseNote,
]);
const NOTIFY: SecurityPlaybook = playbook("0002", [
  SecurityPlaybookActionType.CheckThreatIntel,
  SecurityPlaybookActionType.EmailPeople,
]);
const CONTAIN: SecurityPlaybook = playbook("0003", [
  SecurityPlaybookActionType.SuspendOktaUser,
]);
const NO_STEPS: SecurityPlaybook = playbook("0004", null);

/*
 * The setup test's case runs only the playbooks that stay inside OneUptime
 * (the Case and Investigate steps), so a test never tells anyone, pages
 * on-call, declares an incident or contains a real account or host. Every
 * other case runs every playbook its trigger and conditions call for, as
 * before.
 */
describe("SecurityPlaybookLauncher.launchForCase", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("for the setup test's case, only playbooks that stay inside OneUptime start", async () => {
    const { started, selects } = install([ENRICH, NOTIFY, CONTAIN, NO_STEPS]);

    const count: number = await SecurityPlaybookLauncher.launchForCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      trigger: SecurityPlaybookTrigger.CaseOpened,
      detection: { source: SecurityDetectionSource.DetectionRule },
      onlyPlaybooksThatStayInside: true,
    });

    expect(count).toBe(1);
    expect(started).toEqual([ENRICH.id!.toString()]);
    // The steps are read to decide.
    expect(selects[0]!["steps"]).toBe(true);
  });

  test("for any other case, every playbook its trigger calls for starts", async () => {
    const { started } = install([ENRICH, NOTIFY, CONTAIN]);

    await SecurityPlaybookLauncher.launchForCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      trigger: SecurityPlaybookTrigger.CaseOpened,
      detection: { source: SecurityDetectionSource.DetectionRule },
    });

    expect(started).toEqual([
      ENRICH.id!.toString(),
      NOTIFY.id!.toString(),
      CONTAIN.id!.toString(),
    ]);
  });
});

describe("doStepsStayInsideOneUptime", () => {
  test("the inside categories are the case and investigate ones", () => {
    expect([...SECURITY_PLAYBOOK_INSIDE_CATEGORIES]).toEqual([
      SecurityPlaybookActionCategory.Case,
      SecurityPlaybookActionCategory.Investigate,
    ]);
  });

  test.each(
    SECURITY_PLAYBOOK_ACTIONS.map(
      (action: SecurityPlaybookActionDefinition): [string, boolean] => {
        return [
          action.type,
          action.category === SecurityPlaybookActionCategory.Case ||
            action.category === SecurityPlaybookActionCategory.Investigate,
        ];
      },
    ),
  )(
    "a playbook of one %s step stays inside: %s",
    (type: string, inside: boolean) => {
      expect(doStepsStayInsideOneUptime([{ action: type, config: {} }])).toBe(
        inside,
      );
    },
  );

  test("nothing a step could hide behind counts as inside", () => {
    expect(doStepsStayInsideOneUptime(undefined)).toBe(false);
    expect(doStepsStayInsideOneUptime("not steps")).toBe(false);
    expect(doStepsStayInsideOneUptime([null])).toBe(false);
    expect(doStepsStayInsideOneUptime([["AddCaseNote"]])).toBe(false);
    expect(doStepsStayInsideOneUptime([{ action: "Launch Missiles" }])).toBe(
      false,
    );
  });

  test("one step outside makes the whole playbook outside", () => {
    expect(
      doStepsStayInsideOneUptime([
        { action: SecurityPlaybookActionType.AddCaseNote },
        { action: SecurityPlaybookActionType.PageOnCall },
      ]),
    ).toBe(false);
  });

  test("a playbook of no steps is inside", () => {
    expect(doStepsStayInsideOneUptime([])).toBe(true);
  });
});
