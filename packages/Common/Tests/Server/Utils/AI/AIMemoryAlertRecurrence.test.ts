import "../../TestingUtils/Init";
import AIMemory, {
  PAST_RESOLVED_ALERTS_HEADING,
} from "../../../../Server/Utils/AI/SRE/AIMemory";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../../Server/Types/Database/FindOneBy";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Contract under test - what an alert's investigation remembers of the
 * project's past alerts (AIMemory.getPriorSimilarAlertsContext, #5519's
 * follow-up), as an incident's remembers its past incidents:
 *
 *  - the project's resolved alerts that share something with this one -
 *    its monitor, the same series of it above all, or a label - read in
 *    its project, newest first, the monitor's own read apart so a busy
 *    project's newest cannot push them out; never this alert, never a
 *    private one, never one that shares nothing;
 *  - a past alert counts when its root cause or its verified fix is known,
 *    and says how OneUptime AI fixed it when that fix was verified - the
 *    commands that ran, or the runbook it started - so a recurrence names
 *    the fix that worked last time;
 *  - its title and its words are data: embedded images left out, held to a
 *    length;
 *  - nothing here throws: what cannot be read is no context.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000001",
);
const CURRENT_ALERT: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000002",
);
const RESOLVED_STATE: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000003",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000004",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000005",
);
const CLUSTER_ID: string = "0193c0de-ffff-4aaa-8bbb-000000000006";
const SERIES: string = "host.name=web-1";

function alertId(index: number): string {
  return `0193c0de-ffff-4aaa-8bbb-0000000001${String(index).padStart(2, "0")}`;
}

function label(name: string): Label {
  const row: Label = new Label();
  row.name = name;
  return row;
}

function pastAlert(data: {
  index: number;
  title?: string | undefined;
  rootCause?: string | undefined;
  monitorId?: ObjectID | undefined;
  series?: string | undefined;
  labels?: Array<string> | undefined;
  isPrivate?: boolean | undefined;
}): Alert {
  const alert: Alert = new Alert(new ObjectID(alertId(data.index)));
  alert.projectId = PROJECT_ID;
  alert.alertNumber = 300 + data.index;
  alert.title = data.title || `High CPU on web-${data.index}`;
  if (data.rootCause) {
    alert.rootCause = data.rootCause;
  }
  alert.createdAt = new Date(
    Date.parse("2026-11-01T10:00:00.000Z") - data.index * 60 * 60 * 1000,
  );
  alert.isPrivate = data.isPrivate === true;
  if (data.monitorId) {
    alert.monitorId = data.monitorId;
    const monitor: Monitor = new Monitor(data.monitorId);
    monitor.name = "web CPU";
    alert.monitor = monitor;
  }
  if (data.series) {
    alert.seriesFingerprint = data.series;
  }
  alert.labels = (data.labels || []).map(label);
  return alert;
}

function verifiedFix(data: {
  alert: number;
  command?: string | undefined;
  runbook?: string | undefined;
}): AutoRemediationSuggestion {
  const suggestion: AutoRemediationSuggestion = new AutoRemediationSuggestion(
    ObjectID.generate(),
  );
  suggestion.alertId = new ObjectID(alertId(data.alert));

  if (data.runbook) {
    suggestion.suggestionType = AutoRemediationSuggestionType.Runbook;
    suggestion.runbookNameSnapshot = data.runbook;
    return suggestion;
  }

  suggestion.suggestionType = AutoRemediationSuggestionType.CommandPlan;
  suggestion.commandPlan = AiRemediationCommandPlanUtil.toJSON({
    commands: [
      {
        sequence: 1,
        stepType: RunbookStepType.Kubectl,
        runnerId: CLUSTER_ID,
        runnerNameSnapshot: "Kubernetes AI agent",
        kubernetesClusterId: CLUSTER_ID,
        command:
          data.command || "kubectl rollout restart deployment/web -n shop",
        timeoutInMs: 60000,
        rationale: "the pool ran dry",
        expectedEffect: "requests pass",
        policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
        execution: { status: AiRemediationCommandExecutionStatus.Succeeded },
      },
    ],
  });
  return suggestion;
}

describe("an alert's recurrence context", () => {
  let recent: Array<Alert>;
  let sameMonitor: Array<Alert>;
  let fixes: Array<AutoRemediationSuggestion>;
  let current: Alert | null;
  let alertFind: SpyInstance<typeof AlertService.findBy>;
  let fixFind: SpyInstance<typeof AutoRemediationSuggestionService.findBy>;

  beforeEach(() => {
    recent = [];
    sameMonitor = [];
    fixes = [];
    current = pastAlert({
      index: 0,
      monitorId: MONITOR_ID,
      series: SERIES,
      labels: ["checkout"],
    });
    current.id = CURRENT_ALERT;

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(AlertService, "findOneBy")
      .mockImplementation(
        async (_: FindOneBy<Alert>): Promise<Alert | null> => {
          return current;
        },
      );
    jest
      .spyOn(AlertStateService, "getResolvedAlertStateIds")
      .mockResolvedValue([RESOLVED_STATE]);
    alertFind = jest
      .spyOn(AlertService, "findBy")
      .mockImplementation(
        async (findBy: FindBy<Alert>): Promise<Array<Alert>> => {
          const query: JSONObject = findBy.query as unknown as JSONObject;

          return query["monitorId"] !== undefined ? sameMonitor : recent;
        },
      );
    fixFind = jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockImplementation(
        async (): Promise<Array<AutoRemediationSuggestion>> => {
          return fixes;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function context(): Promise<string> {
    return await AIMemory.getPriorSimilarAlertsContext({
      projectId: PROJECT_ID,
      currentAlertId: CURRENT_ALERT,
    });
  }

  test("reads the project's resolved alerts, and its monitor's apart, in its project", async () => {
    sameMonitor = [
      pastAlert({ index: 1, monitorId: MONITOR_ID, rootCause: "pool cut" }),
    ];

    await context();

    expect(alertFind).toHaveBeenCalledTimes(2);

    for (const call of alertFind.mock.calls) {
      const query: JSONObject = call[0].query as unknown as JSONObject;

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["currentAlertStateId"]).toBeDefined();
    }

    expect(
      alertFind.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          ((call[0] as FindBy<Alert>).query as JSONObject)["monitorId"] ===
          MONITOR_ID
        );
      }),
    ).toBe(true);
  });

  test("names the past alerts of its monitor, the same series first, with their causes", async () => {
    sameMonitor = [
      pastAlert({
        index: 1,
        monitorId: MONITOR_ID,
        series: "host.name=web-2",
        rootCause: "a noisy neighbour",
      }),
      pastAlert({
        index: 2,
        monitorId: MONITOR_ID,
        series: SERIES,
        rootCause: "the pool was cut to 10",
      }),
    ];

    const markdown: string = await context();

    expect(markdown.startsWith(`\n\n${PAST_RESOLVED_ALERTS_HEADING}\n`)).toBe(
      true,
    );
    expect(markdown).toContain(
      "reference that alert's number (alert #305) and how it was resolved",
    );
    // The same series of the same monitor first, though it is older.
    expect(markdown.indexOf("**Alert #302")).toBeLessThan(
      markdown.indexOf("**Alert #301"),
    );
    expect(markdown).toContain(
      "- **Alert #302 — High CPU on web-2**\n  Previously resolved. Root cause: the pool was cut to 10\n  Monitor: web CPU\n  The same monitor fired it for the same series as this alert.",
    );
    expect(markdown).not.toContain(
      "**Alert #301 — High CPU on web-1**\n  Previously resolved. Root cause: a noisy neighbour\n  Monitor: web CPU\n  The same monitor fired it",
    );
  });

  test("names the fix OneUptime AI made when it was verified, and reads fixes by the alerts listed", async () => {
    sameMonitor = [
      pastAlert({ index: 1, monitorId: MONITOR_ID, rootCause: "pool cut" }),
      pastAlert({ index: 2, monitorId: MONITOR_ID, rootCause: "disk full" }),
    ];
    fixes = [
      verifiedFix({ alert: 1 }),
      verifiedFix({ alert: 2, runbook: "Clear the log disk" }),
    ];

    const markdown: string = await context();

    expect(markdown).toContain(
      "Fixed by OneUptime AI (verified): ran `kubectl rollout restart deployment/web -n shop`",
    );
    expect(markdown).toContain(
      'Fixed by OneUptime AI (verified): ran the runbook "Clear the log disk"',
    );

    const query: JSONObject = fixFind.mock.calls[0]![0]
      .query as unknown as JSONObject;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["verificationStatus"]).toBe(
      AutoRemediationVerificationStatus.Verified,
    );
    expect(query["alertId"]).toBeDefined();
    expect(query["incidentId"]).toBeUndefined();
  });

  test("a past alert with a verified fix and no cause typed still counts; one with neither does not", async () => {
    sameMonitor = [
      pastAlert({ index: 1, monitorId: MONITOR_ID }),
      pastAlert({ index: 2, monitorId: MONITOR_ID }),
    ];
    fixes = [verifiedFix({ alert: 1 })];

    const markdown: string = await context();

    expect(markdown).toContain(
      "- **Alert #301 — High CPU on web-1**\n  Previously resolved. No root cause was recorded.",
    );
    expect(markdown).not.toContain("Alert #302");
  });

  test("an alert that shares a label counts; one that shares nothing never does", async () => {
    recent = [
      pastAlert({
        index: 3,
        monitorId: OTHER_MONITOR_ID,
        labels: ["Checkout"],
        rootCause: "a bad deploy",
      }),
      /*
       * Shares nothing: another monitor, another label, and words that say
       * something else happened (its default title, "High CPU on web-4",
       * would read like this alert's and match by meaning).
       */
      pastAlert({
        index: 4,
        monitorId: OTHER_MONITOR_ID,
        title: "Disk full on db-4",
        labels: ["payments"],
        rootCause: "an unrelated cause",
      }),
    ];

    const markdown: string = await context();

    expect(markdown).toContain("Alert #303");
    expect(markdown).not.toContain("Alert #304");

    recent = [recent[1]!];

    expect(await context()).toBe("");
  });

  test("a private alert, and this alert itself, are never listed", async () => {
    const itself: Alert = pastAlert({
      index: 5,
      monitorId: MONITOR_ID,
      rootCause: "itself",
    });
    itself.id = CURRENT_ALERT;
    sameMonitor = [
      itself,
      pastAlert({
        index: 6,
        monitorId: MONITOR_ID,
        rootCause: "a private cause",
        isPrivate: true,
      }),
    ];

    expect(await context()).toBe("");
    // The private alert's fixes were never read either.
    expect(fixFind).not.toHaveBeenCalled();
  });

  test("an alert listed twice, by its monitor and as recent, is listed once; at most four", async () => {
    sameMonitor = Array.from({ length: 6 }, (_: unknown, index: number) => {
      return pastAlert({
        index: index + 1,
        monitorId: MONITOR_ID,
        rootCause: `cause ${index + 1}`,
      });
    });
    recent = [...sameMonitor];

    const markdown: string = await context();

    expect(markdown.split("- **Alert #").length - 1).toBe(4);
    expect(markdown.split("**Alert #301 ").length - 1).toBe(1);
  });

  test("its words are data: an embedded image left out, a long title and cause cut", async () => {
    sameMonitor = [
      pastAlert({
        index: 1,
        monitorId: MONITOR_ID,
        title: `CPU ${"x".repeat(500)}`,
        rootCause: `See ![shot](data:image/png;base64,${"A".repeat(4000)}) ${"y".repeat(600)}`,
      }),
    ];

    const markdown: string = await context();

    expect(markdown).not.toContain("data:image/png;base64,AAAA");
    expect(markdown.length).toBeLessThan(1600);
  });

  test("nothing here throws: no current alert, no resolved state, or a failed read is no context", async () => {
    current = null;
    expect(await context()).toBe("");

    current = pastAlert({ index: 0, monitorId: MONITOR_ID });
    current.id = CURRENT_ALERT;
    (
      AlertStateService.getResolvedAlertStateIds as unknown as SpyInstance<
        typeof AlertStateService.getResolvedAlertStateIds
      >
    ).mockResolvedValue([]);
    expect(await context()).toBe("");

    (
      AlertStateService.getResolvedAlertStateIds as unknown as SpyInstance<
        typeof AlertStateService.getResolvedAlertStateIds
      >
    ).mockResolvedValue([RESOLVED_STATE]);
    alertFind.mockRejectedValue(new Error("Database not connected"));
    expect(await context()).toBe("");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("failed to load an alert's recurrence context"),
    );
  });
});

describe("the verified fixes of past alerts", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("are read by alert id, held to the project and a verified verdict; the newest speaks", async () => {
    const older: AutoRemediationSuggestion = verifiedFix({
      alert: 1,
      runbook: "Older runbook",
    });
    const newer: AutoRemediationSuggestion = verifiedFix({
      alert: 1,
      runbook: "Newer runbook",
    });
    const findBy: SpyInstance<typeof AutoRemediationSuggestionService.findBy> =
      jest
        .spyOn(AutoRemediationSuggestionService, "findBy")
        .mockResolvedValue([newer, older]);

    const read: Map<string, string> = await AIMemory.readVerifiedAlertFixes({
      projectId: PROJECT_ID,
      alertIds: [new ObjectID(alertId(1))],
    });

    expect(read.get(alertId(1))).toBe('ran the runbook "Newer runbook"');
    expect((findBy.mock.calls[0]![0].query as JSONObject)["projectId"]).toBe(
      PROJECT_ID,
    );
    expect(
      await AIMemory.readVerifiedAlertFixes({
        projectId: PROJECT_ID,
        alertIds: [],
      }),
    ).toEqual(new Map<string, string>());
  });
});
