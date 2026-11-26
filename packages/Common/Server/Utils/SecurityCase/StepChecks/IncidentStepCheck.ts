import {
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchesJson,
} from "../../../../Types/SecurityCase/SecurityCaseMatches";
import { SecurityCaseStepCheckSentence } from "../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  RequestOutcomeSummary,
  getRequestOutcomeSummary,
} from "../../../../Utils/SecurityCase/RequestOutcomeSummary";
import { RESPONSE_STEP_KINDS } from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import {
  CHECK_INCIDENT_MONITOR_DOWN,
  CHECK_INCIDENT_NOT_FOLLOWED,
  CHECK_INCIDENT_NOT_NEEDED,
  CHECK_INCIDENT_NOT_NEEDED_NO_MONITORS,
  CHECK_INCIDENT_REQUESTS_THROUGH,
} from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import { readFailed } from "./AddressStepChecks";
import { MonitorsDownReading } from "./Evidence/MonitorsDown";
import {
  StepCheck,
  StepCheckContext,
  StepCheckResult,
  evidenceOf,
  sentence,
} from "./StepCheck";

/*
 * "DECLARE AN INCIDENT IF CUSTOMERS OR PRODUCTION ARE AFFECTED" (#10340).
 *
 *   Not Needed  so far: no request of the case got past the app's checks -
 *               none reached a handler, errored or reached the database -
 *               and no monitor of the services the requests went to went
 *               down while the case was open. Anyone can still declare one;
 *   Not Done    a request got through, or a monitor went down: one may be
 *               needed, a person decides;
 *   Cannot Tell none of the case's requests could be followed into a trace,
 *               or what they did could not be read.
 *
 * A case with an incident already declared has the step done: it is not
 * checked.
 */

// How far every request the case's detections matched got, together.
export function getCaseRequestOutcomes(
  matches: SecurityCaseMatchesJson,
): RequestOutcomeSummary {
  const outcomes: Record<string, number> = {};

  for (const detection of matches.detections as Array<SecurityCaseMatchedDetectionJson>) {
    for (const [outcome, count] of Object.entries(detection.outcomes || {})) {
      outcomes[outcome] = (outcomes[outcome] || 0) + (Number(count) || 0);
    }
  }

  return getRequestOutcomeSummary(outcomes);
}

export function decideIncident(data: {
  matches: SecurityCaseMatchesJson | null;
  monitors: MonitorsDownReading | null;
}): StepCheckResult {
  // A source of the case's events that failed leaves what they did unknown.
  if (!data.matches || data.matches.failedSources.length > 0) {
    return readFailed();
  }

  const outcomes: RequestOutcomeSummary = getCaseRequestOutcomes(data.matches);

  if (outcomes.followed === 0) {
    return {
      state: SecurityCaseStepCheckState.CannotTell,
      evidence: evidenceOf({
        sentence: sentence(CHECK_INCIDENT_NOT_FOLLOWED),
        data: { reason: "NotFollowed" },
      }),
    };
  }

  if (outcomes.through > 0) {
    return {
      state: SecurityCaseStepCheckState.NotDone,
      evidence: evidenceOf({
        sentence: sentence(
          CHECK_INCIDENT_REQUESTS_THROUGH,
          {},
          { count: outcomes.through },
        ),
        data: { through: outcomes.through, followed: outcomes.followed },
      }),
    };
  }

  if (!data.monitors) {
    return readFailed();
  }

  if (data.monitors.down.length > 0) {
    const [first, ...others] = data.monitors.down;

    return {
      state: SecurityCaseStepCheckState.NotDone,
      evidence: evidenceOf({
        sentence: sentence(CHECK_INCIDENT_MONITOR_DOWN, {
          monitor: first!.name,
        }),
        facts: others.map(
          (monitor: { name: string }): SecurityCaseStepCheckSentence => {
            return sentence(CHECK_INCIDENT_MONITOR_DOWN, {
              monitor: monitor.name,
            });
          },
        ),
        data: { monitorsDown: data.monitors.down.length },
      }),
    };
  }

  return {
    state: SecurityCaseStepCheckState.NotNeeded,
    evidence: evidenceOf({
      sentence: sentence(
        data.monitors.monitors.length > 0
          ? CHECK_INCIDENT_NOT_NEEDED
          : CHECK_INCIDENT_NOT_NEEDED_NO_MONITORS,
      ),
      data: {
        followed: outcomes.followed,
        monitors: data.monitors.monitors.length,
      },
    }),
  };
}

const IncidentStepCheck: StepCheck = {
  kind: RESPONSE_STEP_KINDS.incident,
  intervalInMinutes: 10,
  check: async (context: StepCheckContext): Promise<StepCheckResult | null> => {
    // Declared already: the case says the step is done.
    if (context.securityCase.hasIncident) {
      return null;
    }

    let monitors: MonitorsDownReading | null = null;

    try {
      monitors = await context.evidence.readMonitorsDown();
    } catch {
      monitors = null;
    }

    return decideIncident({ matches: context.securityCase.matches, monitors });
  },
};

export default IncidentStepCheck;
