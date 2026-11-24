import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Alert from "../../../../Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AlertService from "../../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import RunbookService from "../../../../Server/Services/RunbookService";
import VerifiedFixRunbookSave, {
  VerifiedFixRunbookSaved,
} from "../../../../Server/Utils/AutoRemediation/VerifiedFixRunbookSave";
import ServerSetColumns from "../../../../Server/Utils/Database/ServerSetColumns";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlanUtil,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { AiRemediationCommandPolicyVerdict } from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Indigo500 } from "../../../../Types/BrandColors";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { RunbookStep } from "../../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import {
  VERIFIED_FIX_RUNBOOK_REFUSAL_MESSAGES,
  VerifiedFixRunbookRefusal,
} from "../../../../Utils/AiRemediation/VerifiedFixRunbook";

/*
 * Save as Runbook on a verified fix (#6801), on the server: the person must
 * read the fix; the fix must be verified, its own commands' and not saved
 * yet; the runbook is created as the person - so whoever may not create
 * runbooks is refused as on the Runbooks page - turned off, with a name no
 * runbook of the project has; the fix then names it, and the incident's or
 * alert's feed says it was saved, without pinging its chat channel.
 *
 * No database: the services are spied.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ALERT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const RUNBOOK_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const RUNNER_ID: string = "66666666-6666-4666-8666-666666666666";
const MAYA_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");

const MAYA: DatabaseCommonInteractionProps = {
  userId: MAYA_ID,
  tenantId: PROJECT_ID,
};

let suggestion: AutoRemediationSuggestion;
let mayReadSuggestion: boolean;
let mayCreateRunbook: boolean;
let takenNames: Array<string>;
let createdRunbooks: Array<{
  data: Runbook;
  props: DatabaseCommonInteractionProps;
}>;
let suggestionWrites: Array<{ id: string; data: JSONObject }>;
let incidentFeed: Array<JSONObject>;
let alertFeed: Array<JSONObject>;

function verifiedCommandPlanFix(): AutoRemediationSuggestion {
  const fix: AutoRemediationSuggestion = new AutoRemediationSuggestion();
  fix._id = SUGGESTION_ID.toString();
  fix.projectId = PROJECT_ID;
  fix.incidentId = INCIDENT_ID;
  fix.suggestionType = AutoRemediationSuggestionType.CommandPlan;
  fix.verificationStatus = AutoRemediationVerificationStatus.Verified;
  fix.commandPlan = AiRemediationCommandPlanUtil.toJSON({
    commands: [
      {
        sequence: 1,
        stepType: RunbookStepType.Bash,
        runnerId: RUNNER_ID,
        runnerNameSnapshot: "web-runner",
        command: "systemctl restart nginx",
        timeoutInMs: 30000,
        rationale: "nginx stopped answering",
        expectedEffect: "nginx answers again",
        policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
        execution: { status: AiRemediationCommandExecutionStatus.Succeeded },
      },
    ],
  });
  return fix;
}

beforeEach(() => {
  suggestion = verifiedCommandPlanFix();
  mayReadSuggestion = true;
  mayCreateRunbook = true;
  takenNames = [];
  createdRunbooks = [];
  suggestionWrites = [];
  incidentFeed = [];
  alertFeed = [];

  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockImplementation(async (args: unknown) => {
      const { props } = args as { props: DatabaseCommonInteractionProps };

      // The person's own read first (findAccessibleSuggestion), then OneUptime's.
      if (!props.isRoot && !mayReadSuggestion) {
        return null;
      }

      return suggestion;
    });

  jest.spyOn(IncidentService, "findOneById").mockImplementation(async () => {
    const incident: Incident = new Incident();
    incident.title = "Checkout returns 503s";
    incident.incidentNumber = 42;
    return incident;
  });

  jest.spyOn(AlertService, "findOneById").mockImplementation(async () => {
    const alert: Alert = new Alert();
    alert.title = "Disk full on db-1";
    alert.alertNumberWithPrefix = "ALR-7";
    return alert;
  });

  jest.spyOn(RunbookService, "findBy").mockImplementation(async () => {
    return takenNames.map((name: string): Runbook => {
      const runbook: Runbook = new Runbook();
      runbook.name = name;
      return runbook;
    });
  });

  jest
    .spyOn(RunbookService, "create")
    .mockImplementation(async (createBy: unknown) => {
      const { data, props } = createBy as {
        data: Runbook;
        props: DatabaseCommonInteractionProps;
      };

      if (!mayCreateRunbook) {
        throw new Error(
          "You do not have permission to create Runbook. You need one of these permissions: Create Runbook.",
        );
      }

      createdRunbooks.push({ data, props });
      data._id = RUNBOOK_ID.toString();
      return data;
    });

  jest
    .spyOn(
      AutoRemediationSuggestionService as unknown as {
        updateColumnsByIdWithoutHooks: () => void;
      },
      "updateColumnsByIdWithoutHooks",
    )
    .mockImplementation((async (args: unknown) => {
      const { id, data } = args as { id: ObjectID; data: JSONObject };
      suggestionWrites.push({ id: id.toString(), data });
    }) as never);

  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation(async (args: unknown) => {
      incidentFeed.push(args as JSONObject);
    });

  jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockImplementation(async (args: unknown) => {
      alertFeed.push(args as JSONObject);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function save(): Promise<VerifiedFixRunbookSaved> {
  return VerifiedFixRunbookSave.save({
    props: MAYA,
    suggestionId: SUGGESTION_ID.toString(),
  });
}

describe("saving a verified fix as a runbook", () => {
  test("creates a turned-off runbook of what ran, as the person", async () => {
    const saved: VerifiedFixRunbookSaved = await save();

    expect(saved).toEqual({
      runbookId: RUNBOOK_ID,
      runbookName: "Fix: Checkout returns 503s",
    });
    expect(createdRunbooks).toHaveLength(1);

    const { data, props } = createdRunbooks[0]!;

    expect(props).toBe(MAYA);
    expect(data.projectId).toEqual(PROJECT_ID);
    expect(data.isEnabled).toBe(false);
    expect(data.name).toBe("Fix: Checkout returns 503s");
    expect(data.description).toContain(
      "Written from the fix OneUptime AI ran for incident #42",
    );

    const steps: Array<RunbookStep> =
      data.steps as unknown as Array<RunbookStep>;

    expect(steps).toHaveLength(1);
    expect(steps[0]!.type).toBe(RunbookStepType.Bash);
    expect(steps[0]!.config).toEqual({
      script: "systemctl restart nginx",
      agentId: RUNNER_ID,
      timeoutInMs: 30000,
    });
  });

  /*
   * The steps are OneUptime's, not the person's (GHSA-rfrx-38rq-44w6):
   * marked so on the record the create writes, which RunbookService lets
   * through for a person who may create runbooks but not write steps that
   * run, while the runbook starts turned off
   * (RunbookStepsThatRunThroughTheWrite drives that create).
   */
  test("marks the steps as OneUptime's, on a runbook that starts turned off", async () => {
    await save();

    const { data } = createdRunbooks[0]!;

    expect(ServerSetColumns.getMarked(data)).toEqual(["steps"]);
    expect(data.isEnabled).toBe(false);
  });

  test("the fix then names its runbook, and the incident's feed says so, without pinging its channel", async () => {
    await save();

    expect(suggestionWrites).toEqual([
      {
        id: SUGGESTION_ID.toString(),
        data: { savedAsRunbookId: RUNBOOK_ID },
      },
    ]);
    expect(incidentFeed).toEqual([
      {
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        incidentFeedEventType: IncidentFeedEventType.AutoRemediation,
        displayColor: Indigo500,
        feedInfoInMarkdown:
          "📘 Saved OneUptime AI's verified fix as the runbook **Fix: Checkout returns 503s**. It stays off until someone reviews its steps and turns it on.",
        userId: MAYA_ID,
        workspaceNotification: {
          sendWorkspaceNotification: false,
          leadWithAuthor: true,
        },
      },
    ]);
  });

  test("a name the project has already is counted up", async () => {
    takenNames = ["Fix: Checkout returns 503s"];

    expect((await save()).runbookName).toBe("Fix: Checkout returns 503s (2)");
  });

  test("an alert's fix names the alert, and its feed says so", async () => {
    delete suggestion.incidentId;
    suggestion.alertId = ALERT_ID;

    const saved: VerifiedFixRunbookSaved = await save();

    expect(saved.runbookName).toBe("Fix: Disk full on db-1");
    expect(createdRunbooks[0]!.data.description).toContain("for alert ALR-7");
    expect(incidentFeed).toEqual([]);
    expect(alertFeed).toHaveLength(1);
    expect(alertFeed[0]!["alertId"]).toEqual(ALERT_ID);
    expect(alertFeed[0]!["alertFeedEventType"]).toBe(
      AlertFeedEventType.AutoRemediation,
    );
  });

  test("the runbook is saved whatever the feed says", async () => {
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockRejectedValue(new Error("The database went away.") as never);

    await expect(save()).resolves.toEqual({
      runbookId: RUNBOOK_ID,
      runbookName: "Fix: Checkout returns 503s",
    });
    expect(suggestionWrites).toHaveLength(1);
  });
});

describe("what it refuses", () => {
  test("a fix the person cannot read, as one that does not exist", async () => {
    mayReadSuggestion = false;

    await expect(save()).rejects.toThrow(
      "Auto-remediation suggestion not found (or you do not have access to it).",
    );
    expect(createdRunbooks).toEqual([]);
  });

  test("no suggestion id", async () => {
    await expect(
      VerifiedFixRunbookSave.save({ props: MAYA, suggestionId: undefined }),
    ).rejects.toThrow("suggestionId is required.");
  });

  test.each([
    [
      "a fix not verified",
      (fix: AutoRemediationSuggestion): void => {
        fix.verificationStatus = AutoRemediationVerificationStatus.Failed;
      },
      VerifiedFixRunbookRefusal.NotVerified,
    ],
    [
      "a runbook's own run",
      (fix: AutoRemediationSuggestion): void => {
        fix.suggestionType = AutoRemediationSuggestionType.Runbook;
      },
      VerifiedFixRunbookRefusal.RanARunbook,
    ],
    [
      "a fix saved already",
      (fix: AutoRemediationSuggestion): void => {
        fix.savedAsRunbookId = RUNBOOK_ID;
      },
      VerifiedFixRunbookRefusal.AlreadySaved,
    ],
    [
      "a fix of which nothing ran",
      (fix: AutoRemediationSuggestion): void => {
        fix.commandPlan = AiRemediationCommandPlanUtil.toJSON({ commands: [] });
      },
      VerifiedFixRunbookRefusal.NothingRan,
    ],
  ])(
    "%s, with what to do instead, creating nothing",
    async (
      _what: string,
      change: (fix: AutoRemediationSuggestion) => void,
      refusal: VerifiedFixRunbookRefusal,
    ) => {
      change(suggestion);

      await expect(save()).rejects.toThrow(
        VERIFIED_FIX_RUNBOOK_REFUSAL_MESSAGES[refusal],
      );
      expect(createdRunbooks).toEqual([]);
      expect(suggestionWrites).toEqual([]);
    },
  );

  test("a person who may not create runbooks, as the Runbooks page refuses them, and the fix stays unsaved", async () => {
    mayCreateRunbook = false;

    await expect(save()).rejects.toThrow(
      "You do not have permission to create Runbook.",
    );
    expect(suggestionWrites).toEqual([]);
    expect(incidentFeed).toEqual([]);
  });
});
