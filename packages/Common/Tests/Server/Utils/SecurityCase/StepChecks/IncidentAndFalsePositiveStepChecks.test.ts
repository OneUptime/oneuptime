import FalsePositiveStepCheck, {
  decideFalsePositive,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/FalsePositiveStepCheck";
import IncidentStepCheck, {
  decideIncident,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/IncidentStepCheck";
import { StepCheckResult } from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheck";
import {
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchesJson,
} from "../../../../../Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import SecurityEventRequestOutcome from "../../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  CHECK_CANNOT_READ_FAILED,
  CHECK_FACT_NOT_OWN_ADDRESS,
  CHECK_FACT_NO_SIGNED_IN_USERS,
  CHECK_FACT_NO_THREAT_INTEL,
  CHECK_FACT_OWN_ADDRESS,
  CHECK_FACT_SIGNED_IN_USERS,
  CHECK_FACT_THREAT_INTEL,
  CHECK_FALSE_POSITIVE_JUDGEMENT,
  CHECK_INCIDENT_MONITOR_DOWN,
  CHECK_INCIDENT_NOT_FOLLOWED,
  CHECK_INCIDENT_NOT_NEEDED,
  CHECK_INCIDENT_NOT_NEEDED_NO_MONITORS,
  CHECK_INCIDENT_REQUESTS_THROUGH,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  ADDRESS,
  context,
  fakeEvidence,
  planStep,
  stepTarget,
} from "../../../../Helpers/SecurityCaseStepChecks";
import { describe, expect, test } from "@jest/globals";

/*
 * "Declare an incident if customers or production are affected" and "Rule
 * out a false positive" (#10340). The first is not needed so far while no
 * request of the case got past the app's checks and the monitors of the
 * services it went to stayed up; the second is a judgement, so OneUptime
 * never verifies it - it lays out what it knows of the address instead.
 */

function matches(
  outcomes: Record<string, number>,
  failedSources: Array<string> = [],
): SecurityCaseMatchesJson {
  return {
    detections: [{ outcomes } as unknown as SecurityCaseMatchedDetectionJson],
    detectionCount: 1,
    unreadableSources: [],
    failedSources,
  } as unknown as SecurityCaseMatchesJson;
}

const MONITOR: { id: string; name: string } = {
  id: "m1",
  name: "Checkout API",
};

describe("Declare an incident", () => {
  test("is not needed so far while every request was turned away and the monitors stayed up", () => {
    const result: StepCheckResult = decideIncident({
      matches: matches({ [SecurityEventRequestOutcome.Rejected]: 12 }),
      monitors: { monitors: [MONITOR], down: [] },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotNeeded);
    expect(result.evidence.sentence.template).toBe(CHECK_INCIDENT_NOT_NEEDED);
  });

  test("says so without the monitors when the services the requests went to have none", () => {
    expect(
      decideIncident({
        matches: matches({ [SecurityEventRequestOutcome.Rejected]: 12 }),
        monitors: { monitors: [], down: [] },
      }).evidence.sentence.template,
    ).toBe(CHECK_INCIDENT_NOT_NEEDED_NO_MONITORS);
  });

  test("may be needed once a request got past the app's checks: a person decides", () => {
    const result: StepCheckResult = decideIncident({
      matches: matches({
        [SecurityEventRequestOutcome.Rejected]: 10,
        [SecurityEventRequestOutcome.ReachedApp]: 2,
      }),
      monitors: { monitors: [MONITOR], down: [] },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_INCIDENT_REQUESTS_THROUGH,
      values: {},
      count: 2,
    });
  });

  test("may be needed once a monitor went down while the case was open", () => {
    const result: StepCheckResult = decideIncident({
      matches: matches({ [SecurityEventRequestOutcome.Rejected]: 12 }),
      monitors: {
        monitors: [MONITOR],
        down: [{ ...MONITOR, since: null }],
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_INCIDENT_MONITOR_DOWN,
      values: { monitor: "Checkout API" },
    });
  });

  test("cannot tell when none of the requests could be followed into a trace", () => {
    const result: StepCheckResult = decideIncident({
      matches: matches({}),
      monitors: { monitors: [MONITOR], down: [] },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence.template).toBe(CHECK_INCIDENT_NOT_FOLLOWED);
  });

  test("a source of the case's events that failed, or monitors that could not be read, is no answer", () => {
    expect(
      decideIncident({
        matches: matches({ [SecurityEventRequestOutcome.Rejected]: 12 }, [
          "Logs",
        ]),
        monitors: { monitors: [], down: [] },
      }).evidence.sentence.template,
    ).toBe(CHECK_CANNOT_READ_FAILED);
    expect(
      decideIncident({
        matches: matches({ [SecurityEventRequestOutcome.Rejected]: 12 }),
        monitors: null,
      }).evidence.data["readFailed"],
    ).toBe(true);
  });

  test("a case with an incident declared has the step done: it is not checked", async () => {
    expect(
      await IncidentStepCheck.check(
        context({
          target: stepTarget({ step: planStep("contain:incident") }),
          evidence: fakeEvidence({}).evidence,
          minute: 20,
          securityCase: { hasIncident: true },
        }),
      ),
    ).toBeNull();
  });
});

describe("Rule out a false positive", () => {
  test("is never verified by OneUptime: it says only a person can, with what it knows of the address", () => {
    const result: StepCheckResult = decideFalsePositive({
      facts: {
        recordName: "",
        threatIntelFeeds: 2,
        signedInUsers: 3,
        signedInUser: "alice@acme.com",
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence.template).toBe(
      CHECK_FALSE_POSITIVE_JUDGEMENT,
    );
    expect(result.evidence.facts).toEqual([
      { template: CHECK_FACT_NOT_OWN_ADDRESS, values: {} },
      { template: CHECK_FACT_THREAT_INTEL, values: {}, count: 2 },
      {
        template: CHECK_FACT_SIGNED_IN_USERS,
        values: { user: "alice@acme.com" },
        count: 3,
      },
    ]);
  });

  test("names the record that holds one of the project's own addresses", () => {
    const result: StepCheckResult = decideFalsePositive({
      facts: {
        recordName: "vpn-gw-01",
        threatIntelFeeds: 0,
        signedInUsers: 0,
        signedInUser: "",
      },
    });

    expect(result.evidence.facts).toEqual([
      { template: CHECK_FACT_OWN_ADDRESS, values: { name: "vpn-gw-01" } },
      { template: CHECK_FACT_NO_THREAT_INTEL, values: {} },
      { template: CHECK_FACT_NO_SIGNED_IN_USERS, values: {} },
    ]);
  });

  test("facts that cannot be read are no answer", () => {
    expect(
      decideFalsePositive({ facts: null }).evidence.data["readFailed"],
    ).toBe(true);
  });

  test("reads the facts of the step's address, and checks no step about anything else", async () => {
    const recording: ReturnType<typeof fakeEvidence> = fakeEvidence({});

    await FalsePositiveStepCheck.check(
      context({
        target: stepTarget({
          step: planStep("confirm:false-positive:rule", ADDRESS),
        }),
        evidence: recording.evidence,
        minute: 20,
      }),
    );

    expect(recording.reads).toEqual([
      { reader: "readAddressFacts", asked: ADDRESS },
    ]);
    expect(
      await FalsePositiveStepCheck.check(
        context({
          target: stepTarget({ step: planStep("confirm:false-positive:rule") }),
          evidence: fakeEvidence({}).evidence,
          minute: 20,
        }),
      ),
    ).toBeNull();
  });
});
