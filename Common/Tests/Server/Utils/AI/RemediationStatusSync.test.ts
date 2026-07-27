import RemediationStatusSync from "../../../../Server/Utils/AI/SRE/RemediationStatusSync";
import AIRemediationActionService from "../../../../Server/Services/AIRemediationActionService";
import RunbookExecutionService from "../../../../Server/Services/RunbookExecutionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import AIRemediationAction from "../../../../Models/DatabaseModels/AIRemediationAction";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import AIRemediationActionStatus from "../../../../Types/AI/AIRemediationActionStatus";
import RunbookExecutionStatus from "../../../../Types/Runbook/RunbookExecutionStatus";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import URL from "../../../../Types/API/URL";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The remediation status sweeper: Executing actions are finalized from
 * their linked RunbookExecution via CAS transitions (a lost CAS posts
 * nothing — the winner owns the side effects), every finalization posts an
 * outcome feed item WITH a workspace notification, in-flight executions
 * are left alone, and stale Proposed rows are quietly swept to Expired.
 */

const actionId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const runbookId: ObjectID = ObjectID.generate();
const executionId: ObjectID = ObjectID.generate();

type ActionOverrides = Partial<Record<keyof AIRemediationAction, unknown>>;

function executingAction(overrides: ActionOverrides = {}): AIRemediationAction {
  return {
    _id: actionId.toString(),
    projectId,
    incidentId,
    title: "Restart the API pods",
    runbookId,
    runbookExecutionId: executionId,
    executedAt: OneUptimeDate.getCurrentDate(),
    ...overrides,
  } as unknown as AIRemediationAction;
}

describe("RemediationStatusSync.syncExecutingActions", () => {
  let transitionSpy: jest.SpyInstance;
  let incidentFeedSpy: jest.SpyInstance;
  let alertFeedSpy: jest.SpyInstance;

  beforeEach(() => {
    transitionSpy = jest
      .spyOn(AIRemediationActionService, "attemptStatusTransition")
      .mockResolvedValue(1);
    incidentFeedSpy = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    alertFeedSpy = jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a Completed execution finalizes to Succeeded and posts a loud outcome with the execution link", async () => {
    jest
      .spyOn(AIRemediationActionService, "findBy")
      .mockResolvedValue([executingAction()]);
    jest.spyOn(RunbookExecutionService, "findOneById").mockResolvedValue({
      status: RunbookExecutionStatus.Completed,
    } as unknown as RunbookExecution);

    await RemediationStatusSync.syncExecutingActions();

    expect(transitionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: AIRemediationActionStatus.Executing,
        set: { status: AIRemediationActionStatus.Succeeded },
      }),
    );

    expect(incidentFeedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId,
        projectId,
        feedInfoInMarkdown: expect.stringContaining(
          `/runbooks/${runbookId.toString()}/executions/${executionId.toString()}`,
        ),
        // Execution on infrastructure is ALWAYS news — success included.
        workspaceNotification: { sendWorkspaceNotification: true },
      }),
    );
  });

  test("a Failed execution finalizes to Failed carrying failureReason, posting to the alert feed", async () => {
    jest
      .spyOn(AIRemediationActionService, "findBy")
      .mockResolvedValue([executingAction({ incidentId: undefined, alertId })]);
    jest.spyOn(RunbookExecutionService, "findOneById").mockResolvedValue({
      status: RunbookExecutionStatus.Failed,
      failureReason: "Step 1 exited with code 1",
    } as unknown as RunbookExecution);

    await RemediationStatusSync.syncExecutingActions();

    expect(transitionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: AIRemediationActionStatus.Executing,
        set: {
          status: AIRemediationActionStatus.Failed,
          errorMessage: "Step 1 exited with code 1",
        },
      }),
    );

    expect(alertFeedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        alertId,
        workspaceNotification: { sendWorkspaceNotification: true },
      }),
    );
    expect(incidentFeedSpy).not.toHaveBeenCalled();
  });

  test("a Cancelled execution also finalizes to Failed", async () => {
    jest
      .spyOn(AIRemediationActionService, "findBy")
      .mockResolvedValue([executingAction()]);
    jest.spyOn(RunbookExecutionService, "findOneById").mockResolvedValue({
      status: RunbookExecutionStatus.Cancelled,
    } as unknown as RunbookExecution);

    await RemediationStatusSync.syncExecutingActions();

    expect(transitionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          status: AIRemediationActionStatus.Failed,
          errorMessage: expect.stringMatching(/cancelled/i),
        }),
      }),
    );
  });

  test("in-flight executions (Running / WaitingForManualStep) are left alone", async () => {
    jest
      .spyOn(AIRemediationActionService, "findBy")
      .mockResolvedValue([executingAction()]);
    jest.spyOn(RunbookExecutionService, "findOneById").mockResolvedValue({
      status: RunbookExecutionStatus.WaitingForManualStep,
    } as unknown as RunbookExecution);

    await RemediationStatusSync.syncExecutingActions();

    expect(transitionSpy).not.toHaveBeenCalled();
    expect(incidentFeedSpy).not.toHaveBeenCalled();
  });

  test("a lost CAS posts NO outcome — the winner owns the side effects", async () => {
    jest
      .spyOn(AIRemediationActionService, "findBy")
      .mockResolvedValue([executingAction()]);
    jest.spyOn(RunbookExecutionService, "findOneById").mockResolvedValue({
      status: RunbookExecutionStatus.Completed,
    } as unknown as RunbookExecution);
    transitionSpy.mockResolvedValue(0);

    await RemediationStatusSync.syncExecutingActions();

    expect(incidentFeedSpy).not.toHaveBeenCalled();
    expect(alertFeedSpy).not.toHaveBeenCalled();
  });

  test("a vanished execution row fails the action", async () => {
    jest
      .spyOn(AIRemediationActionService, "findBy")
      .mockResolvedValue([executingAction()]);
    jest.spyOn(RunbookExecutionService, "findOneById").mockResolvedValue(null);

    await RemediationStatusSync.syncExecutingActions();

    expect(transitionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          status: AIRemediationActionStatus.Failed,
          errorMessage: expect.stringMatching(/no longer exists/i),
        }),
      }),
    );
  });

  test("an action with no linked execution is left alone inside the grace window", async () => {
    jest.spyOn(AIRemediationActionService, "findBy").mockResolvedValue([
      executingAction({
        runbookExecutionId: undefined,
        executedAt: OneUptimeDate.getCurrentDate(),
      }),
    ]);
    const findExecutionSpy: jest.SpyInstance = jest.spyOn(
      RunbookExecutionService,
      "findOneById",
    );

    await RemediationStatusSync.syncExecutingActions();

    expect(transitionSpy).not.toHaveBeenCalled();
    expect(findExecutionSpy).not.toHaveBeenCalled();
  });

  test("an action with no linked execution past the grace window is failed", async () => {
    jest.spyOn(AIRemediationActionService, "findBy").mockResolvedValue([
      executingAction({
        runbookExecutionId: undefined,
        executedAt: OneUptimeDate.getSomeHoursAgo(2),
      }),
    ]);

    await RemediationStatusSync.syncExecutingActions();

    expect(transitionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: AIRemediationActionStatus.Executing,
        set: expect.objectContaining({
          status: AIRemediationActionStatus.Failed,
          errorMessage: expect.stringMatching(/dispatch never completed/i),
        }),
      }),
    );
  });

  test("one bad row never stalls the sweep", async () => {
    const otherActionId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIRemediationActionService, "findBy")
      .mockResolvedValue([
        executingAction(),
        executingAction({ _id: otherActionId.toString() }),
      ]);
    jest
      .spyOn(RunbookExecutionService, "findOneById")
      .mockRejectedValueOnce(new Error("db hiccup"))
      .mockResolvedValueOnce({
        status: RunbookExecutionStatus.Completed,
      } as unknown as RunbookExecution);

    await RemediationStatusSync.syncExecutingActions();

    // The second action still finalized.
    expect(transitionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: otherActionId,
        set: { status: AIRemediationActionStatus.Succeeded },
      }),
    );
  });
});

describe("RemediationStatusSync.sweepExpiredProposals", () => {
  let transitionSpy: jest.SpyInstance;
  let incidentFeedSpy: jest.SpyInstance;

  beforeEach(() => {
    transitionSpy = jest
      .spyOn(AIRemediationActionService, "attemptStatusTransition")
      .mockResolvedValue(1);
    incidentFeedSpy = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("stale proposals are CAS'd to Expired with no notification", async () => {
    const secondId: ObjectID = ObjectID.generate();
    const findBySpy: jest.SpyInstance = jest
      .spyOn(AIRemediationActionService, "findBy")
      .mockResolvedValue([
        { _id: actionId.toString() } as unknown as AIRemediationAction,
        { _id: secondId.toString() } as unknown as AIRemediationAction,
      ]);

    await RemediationStatusSync.sweepExpiredProposals();

    // The sweep queries Proposed rows past their expiry.
    expect(findBySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          status: AIRemediationActionStatus.Proposed,
          expiresAt: expect.anything(),
        }),
      }),
    );

    expect(transitionSpy).toHaveBeenCalledTimes(2);
    expect(transitionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId,
        fromStatus: AIRemediationActionStatus.Proposed,
        set: { status: AIRemediationActionStatus.Expired },
      }),
    );

    // Quiet by design: nobody acted, nothing to announce.
    expect(incidentFeedSpy).not.toHaveBeenCalled();
  });

  test("no stale proposals means no transitions", async () => {
    jest.spyOn(AIRemediationActionService, "findBy").mockResolvedValue([]);

    await RemediationStatusSync.sweepExpiredProposals();

    expect(transitionSpy).not.toHaveBeenCalled();
  });
});
