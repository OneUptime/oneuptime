import AutoRemediationRuleEngineService, {
  getRemediationRetryLockKey,
  IN_FLIGHT_SUGGESTION_STATUSES,
  REMEDIATION_RETRY_LOCK_NAMESPACE,
} from "../../../Server/Services/AutoRemediationRuleEngineService";
import AutoRemediationDecisionService from "../../../Server/Services/AutoRemediationDecisionService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import logger from "../../../Server/Utils/Logger";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import { AutoRemediationDecisionStage } from "../../../Types/AutoRemediation/AutoRemediationDecision";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  REMEDIATION_TRY_AGAIN_COOLDOWN_SECONDS,
  RemediationTryAgainResult,
} from "../../../Types/AutoRemediation/RemediationTryAgain";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
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
 * TRY AGAIN ON THE REMEDIATION STEP (block 43).
 *
 * OneUptime AI decides how to fix an incident once, with the settings of
 * that moment, and a project that turned fixing on afterwards saw its open
 * incidents still say "Fix new incidents automatically is off" - nothing
 * was ever tried again. Try again decides again, now. These hold:
 *
 *   - it decides with every gate of a new incident (applyRulesTo*ById);
 *   - only for an open record, whose remediation no longer waits for its
 *     investigation, decided more than the cooldown ago, with no fix being
 *     worked out or waiting for approval;
 *   - serialized per record under the linking retry's own lock, decided
 *     again inside it, and never at all without it;
 *   - the incident's and the alert's own reads, never the other's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const ALERT_ID: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

function decisionAt(secondsAgo: number): AutoRemediationDecision {
  const row: AutoRemediationDecision = new AutoRemediationDecision();
  row.stage = AutoRemediationDecisionStage.Evaluated;
  row.createdAt = OneUptimeDate.addRemoveSeconds(
    OneUptimeDate.getCurrentDate(),
    -secondsAgo,
  );
  return row;
}

interface Spies {
  decisions: SpyInstance<typeof AutoRemediationDecisionService.findOneBy>;
  inFlight: SpyInstance<typeof AutoRemediationSuggestionService.countBy>;
  isIncidentResolved: SpyInstance<typeof IncidentService.isIncidentResolved>;
  isAlertResolved: SpyInstance<typeof AlertService.isAlertResolved>;
  lock: SpyInstance<typeof Semaphore.lock>;
  release: SpyInstance<typeof Semaphore.release>;
  applyToIncident: SpyInstance<
    typeof AutoRemediationRuleEngineService.applyRulesToIncidentById
  >;
  applyToAlert: SpyInstance<
    typeof AutoRemediationRuleEngineService.applyRulesToAlertById
  >;
}

/*
 * The latest Evaluated decision (null: never evaluated), whether a
 * WaitingForInvestigation one exists, the open fixes, and resolved.
 */
function installSpies(data?: {
  latestEvaluated?: AutoRemediationDecision | null;
  isWaiting?: boolean;
  inFlight?: number;
  isResolved?: boolean;
  /*
   * What the reads say the second time round, inside the lock: another try
   * decided meanwhile.
   */
  latestEvaluatedInLock?: AutoRemediationDecision | null;
}): Spies {
  const latestEvaluated: AutoRemediationDecision | null =
    data && Object.prototype.hasOwnProperty.call(data, "latestEvaluated")
      ? data.latestEvaluated!
      : decisionAt(10 * 60);
  let evaluatedReads: number = 0;

  return {
    decisions: jest
      .spyOn(AutoRemediationDecisionService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        query: JSONObject;
      }): Promise<AutoRemediationDecision | null> => {
        if (
          findOneBy.query["stage"] === AutoRemediationDecisionStage.Evaluated
        ) {
          evaluatedReads += 1;

          if (
            evaluatedReads > 1 &&
            data &&
            Object.prototype.hasOwnProperty.call(data, "latestEvaluatedInLock")
          ) {
            return data.latestEvaluatedInLock!;
          }

          return latestEvaluated;
        }

        return data?.isWaiting ? new AutoRemediationDecision() : null;
      }) as never),
    inFlight: jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(data?.inFlight ?? 0) as never),
    isIncidentResolved: jest
      .spyOn(IncidentService, "isIncidentResolved")
      .mockResolvedValue((data?.isResolved ?? false) as never),
    isAlertResolved: jest
      .spyOn(AlertService, "isAlertResolved")
      .mockResolvedValue((data?.isResolved ?? false) as never),
    lock: jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ identifier: "lock" } as never),
    release: jest.spyOn(Semaphore, "release").mockResolvedValue(undefined),
    applyToIncident: jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToIncidentById")
      .mockResolvedValue(undefined),
    applyToAlert: jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToAlertById")
      .mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Try again decides again, now", () => {
  test("an open incident decided long ago is decided again with every gate of a new one", async () => {
    const spies: Spies = installSpies();

    expect(
      await AutoRemediationRuleEngineService.tryAgain({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(RemediationTryAgainResult.Evaluated);

    expect(spies.applyToIncident).toHaveBeenCalledTimes(1);
    expect(spies.applyToIncident).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
    });
    expect(spies.applyToAlert).not.toHaveBeenCalled();
    expect(spies.release).toHaveBeenCalledTimes(1);
  });

  test("an alert is decided as an alert, with its own reads", async () => {
    const spies: Spies = installSpies();

    expect(
      await AutoRemediationRuleEngineService.tryAgain({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
      }),
    ).toBe(RemediationTryAgainResult.Evaluated);

    expect(spies.applyToAlert).toHaveBeenCalledWith({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
    });
    expect(spies.applyToIncident).not.toHaveBeenCalled();
    expect(spies.isAlertResolved).toHaveBeenCalledWith({ alertId: ALERT_ID });
    expect(spies.isIncidentResolved).not.toHaveBeenCalled();

    for (const call of spies.decisions.mock.calls) {
      const query: JSONObject = (call[0] as { query: JSONObject }).query;
      expect(query["alertId"]).toBe(ALERT_ID);
      expect(query["incidentId"]).toBeUndefined();
      expect(query["projectId"]).toBe(PROJECT_ID);
    }

    const countQuery: JSONObject = (
      spies.inFlight.mock.calls[0]![0] as { query: JSONObject }
    ).query;
    expect(countQuery["alertId"]).toBe(ALERT_ID);
    expect(countQuery["incidentId"]).toBeUndefined();
  });

  test("a record never decided at all (from before decisions) may be decided now", async () => {
    const spies: Spies = installSpies({ latestEvaluated: null });

    expect(
      await AutoRemediationRuleEngineService.tryAgain({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(RemediationTryAgainResult.Evaluated);
    expect(spies.applyToIncident).toHaveBeenCalledTimes(1);
  });

  test("exactly one incident or alert", async () => {
    installSpies();

    await expect(
      AutoRemediationRuleEngineService.tryAgain({ projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      AutoRemediationRuleEngineService.tryAgain({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertId: ALERT_ID,
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("what Try again refuses", () => {
  test("a resolved record: nothing is fixed on it", async () => {
    const spies: Spies = installSpies({ isResolved: true });

    expect(
      await AutoRemediationRuleEngineService.tryAgain({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(RemediationTryAgainResult.Resolved);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
    expect(spies.lock).not.toHaveBeenCalled();
  });

  test("a record whose remediation still waits for its investigation", async () => {
    const spies: Spies = installSpies({
      latestEvaluated: null,
      isWaiting: true,
    });

    expect(
      await AutoRemediationRuleEngineService.tryAgain({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(RemediationTryAgainResult.WaitingForInvestigation);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("an evaluation always wins over an older wait", async () => {
    const spies: Spies = installSpies({ isWaiting: true });

    expect(
      await AutoRemediationRuleEngineService.tryAgain({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(RemediationTryAgainResult.Evaluated);
    expect(spies.applyToIncident).toHaveBeenCalledTimes(1);
  });

  test("a record decided less than the cooldown ago", async () => {
    const spies: Spies = installSpies({
      latestEvaluated: decisionAt(REMEDIATION_TRY_AGAIN_COOLDOWN_SECONDS - 5),
    });

    expect(
      await AutoRemediationRuleEngineService.tryAgain({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(RemediationTryAgainResult.TooSoon);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
  });

  test("decided just past the cooldown: decided again", async () => {
    const spies: Spies = installSpies({
      latestEvaluated: decisionAt(REMEDIATION_TRY_AGAIN_COOLDOWN_SECONDS + 5),
    });

    expect(
      await AutoRemediationRuleEngineService.tryAgain({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(RemediationTryAgainResult.Evaluated);
    expect(spies.applyToIncident).toHaveBeenCalledTimes(1);
  });

  test("a fix being worked out or waiting for approval", async () => {
    const spies: Spies = installSpies({ inFlight: 1 });

    expect(
      await AutoRemediationRuleEngineService.tryAgain({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(RemediationTryAgainResult.FixInProgress);
    expect(spies.applyToIncident).not.toHaveBeenCalled();

    // Counted among the fixes still being worked out or waiting, only.
    const query: JSONObject = (
      spies.inFlight.mock.calls[0]![0] as { query: JSONObject }
    ).query;
    expect(JSON.stringify(query["status"])).toContain(
      AutoRemediationSuggestionStatus.Planning,
    );
    expect(JSON.stringify(query["status"])).toContain(
      AutoRemediationSuggestionStatus.Suggested,
    );
    expect([...IN_FLIGHT_SUGGESTION_STATUSES].sort()).toEqual(
      [
        AutoRemediationSuggestionStatus.Planning,
        AutoRemediationSuggestionStatus.Suggested,
      ].sort(),
    );
  });
});

describe("one decision at a time, per record", () => {
  test("under the linking retry's own lock, so a link and a Try again decide once", async () => {
    const spies: Spies = installSpies();

    await AutoRemediationRuleEngineService.tryAgain({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(spies.lock).toHaveBeenCalledTimes(1);
    const lock: { key: string; namespace: string } = spies.lock.mock
      .calls[0]![0] as unknown as { key: string; namespace: string };
    expect(lock.key).toBe(getRemediationRetryLockKey(INCIDENT_ID));
    expect(lock.key).toBe(
      "auto-remediation-relinked-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(lock.namespace).toBe(REMEDIATION_RETRY_LOCK_NAMESPACE);
  });

  test("decided again inside the lock: another try that decided meanwhile wins", async () => {
    const spies: Spies = installSpies({
      latestEvaluatedInLock: decisionAt(1),
    });

    expect(
      await AutoRemediationRuleEngineService.tryAgain({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(RemediationTryAgainResult.TooSoon);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
    // The lock is released whatever was decided inside it.
    expect(spies.release).toHaveBeenCalledTimes(1);
  });

  test("without the lock it does not try, rather than decide twice", async () => {
    const spies: Spies = installSpies();
    spies.lock.mockRejectedValue(new Error("Valkey is unreachable"));

    expect(
      await AutoRemediationRuleEngineService.tryAgain({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(RemediationTryAgainResult.Busy);
    expect(spies.applyToIncident).not.toHaveBeenCalled();
    expect(spies.release).not.toHaveBeenCalled();
  });

  test("the lock is released when the evaluation throws, and the error reaches the caller", async () => {
    const spies: Spies = installSpies();
    spies.applyToIncident.mockRejectedValue(new Error("database is down"));

    await expect(
      AutoRemediationRuleEngineService.tryAgain({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).rejects.toThrow("database is down");
    expect(spies.release).toHaveBeenCalledTimes(1);
  });
});
