/*
 * The evaluator's import chain pulls the native isolated-vm addon
 * (MonitorCriteriaEvaluator → VMAPI → VMRunner). Nothing under test here
 * touches the sandbox, and the prebuilt binary cannot always dlopen in the
 * test environment — so stub the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import API from "../../../../Utils/API";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../../Types/Exception/EgressGuardException";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import RequestFailedDetails, {
  RequestFailedPhase,
} from "../../../../Types/Probe/RequestFailedDetails";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ROOT CAUSE A CUSTOMER ACTUALLY READS WHEN A TARGET CANNOT BE RESOLVED.
 *
 * A website monitor for https://order.abbeysbakehouse.com/ raised an incident
 * whose entire root cause was:
 *
 *   Response Snapshot -> Response Time: 0.00 ms ; Timed Out: No
 *   Request Failed Details ->
 *     Failed Phase: Unknown
 *     Error Description: Request failed: Monitor target host
 *       order.abbeysbakehouse.com could not be reached.
 *     Raw Error Message: <the same sentence>
 *
 * One monitor out of ~75 on the same cluster. Nothing in that text told the
 * customer what to check, there was no Error Code line at all, and "Unknown"
 * actively suggested a product bug rather than a resolver hiccup.
 *
 * The cause was a classification gap, not a rendering one: the egress guard
 * deliberately sanitizes its message down to one sentence (a shared cloud probe
 * must not let a tenant tell "did not resolve" from "resolved but blocked", or
 * they can enumerate internal DNS names), and that sanitized sentence matched
 * none of API.getRequestFailedDetails' string patterns, so it fell through to
 * the Unknown default with errorCode undefined.
 *
 * This suite pins the surface the customer read: it drives the REAL classifier
 * with a REAL EgressGuardException and asserts what MonitorCriteriaEvaluator
 * renders from it, so the fix cannot be undone at either end. It also pins the
 * new "- Attempts:" line, which is the other half of reading such a failure —
 * "tried once" and "tried three times" mean very different things — and a
 * plain HTTP 500 control case so the new branch is not shadowing the old ones.
 */

type EvaluatorPrivate = {
  buildRootCauseContext: (input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
  }) => Promise<string | null>;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

const CUSTOMER_URL: string = "https://order.abbeysbakehouse.com/";

/*
 * Byte-for-byte the sentence the guard throws for this customer's host when
 * detail is suppressed — DNS failure and address-policy rejection produce the
 * SAME sentence on purpose. Tests build the exception from it rather than
 * hand-writing requestFailedDetails, so the classifier is exercised too.
 */
const SANITIZED_GUARD_MESSAGE: string =
  "Monitor target host order.abbeysbakehouse.com could not be reached.";

/*
 * The description is a constant in API.getRequestFailedDetails rather than an
 * exported symbol, so read it back through the classifier instead of copying
 * a paragraph that would silently drift out of date.
 */
const UNREACHABLE_DETAILS: RequestFailedDetails = API.getRequestFailedDetails(
  new EgressGuardException(
    SANITIZED_GUARD_MESSAGE,
    EgressFailureReason.Unreachable,
  ),
);

function makeMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = MonitorType.Website;
  return monitor;
}

function makeMonitorStep(): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.setMonitorDestination(URL.fromString(CUSTOMER_URL));
  return monitorStep;
}

function makeProbeResponse(
  overrides: Partial<ProbeMonitorResponse> = {},
): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: new Date("2026-09-10T09:15:00.000Z"),
    isOnline: false,
    responseTimeInMs: 0,
    isTimeout: false,
    ...overrides,
  };
}

async function renderRootCause(
  probeResponse: ProbeMonitorResponse,
): Promise<string> {
  const context: string | null = await Evaluator.buildRootCauseContext({
    dataToProcess: probeResponse,
    monitorStep: makeMonitorStep(),
    monitor: makeMonitor(),
  });

  expect(context).not.toBeNull();
  return context as string;
}

/*
 * The rendered block is a flat list of "**Section**" headings, so pull one
 * section's body out by slicing between its heading and the next one. Used to
 * prove WHERE a line lands, not just that it exists somewhere.
 */
function section(context: string, heading: string): string {
  const marker: string = `**${heading}**`;
  const start: number = context.indexOf(marker);

  expect(start).toBeGreaterThanOrEqual(0);

  const afterHeading: string = context.substring(start + marker.length);
  const nextHeading: number = afterHeading.indexOf("**");

  return nextHeading === -1
    ? afterHeading
    : afterHeading.substring(0, nextHeading);
}

/** The failing probe response exactly as the customer's incident recorded it. */
function customerFailureResponse(): ProbeMonitorResponse {
  return makeProbeResponse({
    totalAttempts: 1,
    requestFailedDetails: {
      failedPhase: RequestFailedPhase.TargetResolution,
      errorCode: "TARGET_UNREACHABLE",
      errorDescription: UNREACHABLE_DETAILS.errorDescription,
      rawErrorMessage: SANITIZED_GUARD_MESSAGE,
    },
  });
}

describe("Root cause for a target the probe could not resolve", () => {
  test("classifier turns the sanitized guard sentence into a Target Resolution failure", () => {
    /*
     * Guards the input to every assertion below. Against the old code this
     * failed on the very first expect: the sentence matched no pattern, so the
     * phase was Unknown and errorCode was undefined.
     */
    expect(UNREACHABLE_DETAILS.failedPhase).toBe(
      RequestFailedPhase.TargetResolution,
    );
    expect(UNREACHABLE_DETAILS.errorCode).toBe("TARGET_UNREACHABLE");
    expect(UNREACHABLE_DETAILS.errorDescription).not.toBe(
      SANITIZED_GUARD_MESSAGE,
    );
    expect(UNREACHABLE_DETAILS.rawErrorMessage).toBe(SANITIZED_GUARD_MESSAGE);
  });

  test("renders the failed phase as Target Resolution, never Unknown", async () => {
    const context: string = await renderRootCause(customerFailureResponse());

    expect(context).toContain("- Failed Phase: Target Resolution");
    expect(context).not.toContain("- Failed Phase: Unknown");
  });

  test("renders an Error Code line, which the customer's incident lacked entirely", async () => {
    const context: string = await renderRootCause(customerFailureResponse());

    /*
     * The renderer only emits this line when errorCode is truthy. The old
     * classifier left it undefined, so the incident had no Error Code line at
     * all — the assertion below is precisely the regression.
     */
    expect(context).toContain("- Error Code: TARGET_UNREACHABLE");
  });

  test("renders an actionable error description instead of echoing the raw sentence", async () => {
    const context: string = await renderRootCause(customerFailureResponse());

    expect(context).toContain(
      `- Error Description: ${UNREACHABLE_DETAILS.errorDescription}`,
    );

    // The old text was literally "Request failed: " + the raw sentence.
    expect(context).not.toContain(
      `- Error Description: Request failed: ${SANITIZED_GUARD_MESSAGE}`,
    );

    /*
     * Pin the actionable content, not just its identity with the constant:
     * the description has to name what to check and how an internal host is
     * meant to be monitored, or the incident is no more useful than before.
     */
    const description: string = UNREACHABLE_DETAILS.errorDescription;
    expect(description).toContain("DNS");
    expect(description).toContain("nameservers");
    expect(description).toContain("PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true");
  });

  test("still shows the raw guard message for debugging", async () => {
    const context: string = await renderRootCause(customerFailureResponse());

    expect(context).toContain(
      "- Raw Error Message: Monitor target host order.abbeysbakehouse.com could not be reached.",
    );
  });

  test("keeps the rest of the customer's snapshot intact", async () => {
    const context: string = await renderRootCause(customerFailureResponse());

    expect(context).toContain(`- Destination: ${CUSTOMER_URL}`);
    expect(context).toContain("- Response Time: 0.00 ms");
    expect(context).toContain("- Timed Out: No");
  });

  test("does not disclose which failure the guard actually hit", async () => {
    /*
     * The sanitization is a security property, not an accident: a tenant on a
     * shared cloud probe who can tell "did not resolve" from "resolved to an
     * address I am not allowed to dial" can enumerate internal DNS names. The
     * richer classification must not leak that distinction back out.
     */
    const context: string = await renderRootCause(customerFailureResponse());

    expect(context).not.toContain("ResolutionFailed");
    expect(context).not.toContain("AddressBlocked");
  });

  test("every unreachable reason renders the same code and description", async () => {
    /*
     * A self-hosted probe is allowed detail, so the guard hands the classifier
     * the specific ResolutionFailed / AddressBlocked reasons there. The
     * TENANT-facing text must still collapse them: differing codes or wording
     * would reopen the oracle one layer below the guard's sanitized message.
     */
    const rendered: Array<string> = [];

    for (const reason of [
      EgressFailureReason.Unreachable,
      EgressFailureReason.ResolutionFailed,
      EgressFailureReason.AddressBlocked,
    ]) {
      const details: RequestFailedDetails = API.getRequestFailedDetails(
        new EgressGuardException(SANITIZED_GUARD_MESSAGE, reason),
      );

      expect(details.errorCode).toBe("TARGET_UNREACHABLE");
      expect(details.errorDescription).toBe(
        UNREACHABLE_DETAILS.errorDescription,
      );

      rendered.push(
        await renderRootCause(
          makeProbeResponse({
            totalAttempts: 1,
            requestFailedDetails: details,
          }),
        ),
      );
    }

    expect(rendered[1]).toBe(rendered[0]);
    expect(rendered[2]).toBe(rendered[0]);
  });

  test("an invalid target is NOT collapsed into the unreachable text", async () => {
    /*
     * InvalidTarget is the tenant's own configuration echoed back — it reveals
     * nothing about the probe's network — so it has to surface as its own
     * code, or a typo'd monitor URL reads as a DNS outage.
     */
    const details: RequestFailedDetails = API.getRequestFailedDetails(
      new EgressGuardException(
        "Monitor destination must be a valid HTTP or HTTPS URL.",
        EgressFailureReason.InvalidTarget,
      ),
    );

    expect(details.failedPhase).toBe(RequestFailedPhase.TargetResolution);
    expect(details.errorCode).toBe("INVALID_TARGET");
    expect(details.errorDescription).not.toBe(
      UNREACHABLE_DETAILS.errorDescription,
    );

    const context: string = await renderRootCause(
      makeProbeResponse({ requestFailedDetails: details }),
    );

    expect(context).toContain("- Error Code: INVALID_TARGET");
    expect(context).not.toContain("TARGET_UNREACHABLE");
  });
});

describe("Root cause Attempts line", () => {
  test("renders '- Attempts: 1' for a single attempt", async () => {
    const context: string = await renderRootCause(
      makeProbeResponse({ totalAttempts: 1 }),
    );

    expect(context).toContain("- Attempts: 1");
  });

  test("renders '- Attempts: 3' when the probe retried", async () => {
    const context: string = await renderRootCause(
      makeProbeResponse({ totalAttempts: 3 }),
    );

    expect(context).toContain("- Attempts: 3");
    expect(context).not.toContain("- Attempts: 1");
  });

  test("renders no Attempts line at all when the count is unknown", async () => {
    const context: string = await renderRootCause(
      makeProbeResponse({ totalAttempts: undefined }),
    );

    /*
     * Absent, not "- Attempts: undefined" and not "- Attempts: 0" — an
     * unreported count must not be rendered as a real one.
     */
    expect(context).not.toContain("- Attempts:");
    expect(new RegExp("^- Attempts:", "m").test(context)).toBe(false);
  });
});

describe("Root cause section placement", () => {
  test("Attempts belongs to the Response Snapshot, after Timed Out", async () => {
    const context: string = await renderRootCause(customerFailureResponse());

    const snapshot: string = section(context, "Response Snapshot");
    const failure: string = section(context, "Request Failed Details");

    expect(snapshot).toContain("- Attempts: 1");
    expect(failure).not.toContain("- Attempts:");

    /*
     * How long the check took and whether it timed out describe one attempt;
     * the count of attempts summarizes them, so it reads last in the section.
     */
    expect(snapshot.indexOf("- Attempts:")).toBeGreaterThan(
      snapshot.indexOf("- Timed Out:"),
    );
  });

  test("failure classification stays out of the Response Snapshot", async () => {
    const context: string = await renderRootCause(customerFailureResponse());

    const snapshot: string = section(context, "Response Snapshot");
    const failure: string = section(context, "Request Failed Details");

    expect(snapshot).not.toContain("- Failed Phase:");
    expect(snapshot).not.toContain("- Error Code:");
    expect(failure).toContain("- Failed Phase: Target Resolution");
    expect(failure).toContain("- Error Code: TARGET_UNREACHABLE");
  });
});

describe("Root cause for an ordinary HTTP failure (control)", () => {
  /*
   * The Target Resolution branch runs BEFORE all the string matching in the
   * classifier and adds a section-level line to the renderer, so prove the
   * everyday case a customer sees far more often is untouched.
   */
  test("an HTTP 500 still renders its own phase, code, description and snapshot", async () => {
    const context: string = await renderRootCause(
      makeProbeResponse({
        responseCode: 500,
        responseTimeInMs: 1234,
        totalAttempts: 2,
        requestFailedDetails: {
          failedPhase: RequestFailedPhase.ServerResponse,
          errorCode: "HTTP_500",
          errorDescription:
            "The server responded with HTTP 500 Internal Server Error. This indicates a server-side error.",
          rawErrorMessage: "Request failed with status code 500",
        },
      }),
    );

    expect(context).toContain("- Response Status Code: 500");
    expect(context).toContain("- Response Time: 1234 ms");
    expect(context).toContain("- Timed Out: No");
    expect(context).toContain("- Attempts: 2");
    expect(context).toContain("- Failed Phase: Server Response");
    expect(context).toContain("- Error Code: HTTP_500");
    expect(context).toContain(
      "- Error Description: The server responded with HTTP 500 Internal Server Error. This indicates a server-side error.",
    );
    expect(context).toContain(
      "- Raw Error Message: Request failed with status code 500",
    );

    // The new branch must not have swallowed the old classification.
    expect(context).not.toContain("- Failed Phase: Target Resolution");
    expect(context).not.toContain("TARGET_UNREACHABLE");
  });
});
