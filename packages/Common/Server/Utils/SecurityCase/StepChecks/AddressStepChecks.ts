import { SecurityCaseStepCheckSentence } from "../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  CHECK_CANNOT_ADDRESS_IS_PROXY,
  CHECK_CANNOT_LOAD_BALANCER_ADDRESSES,
  CHECK_CANNOT_NO_CLIENT_ADDRESS,
  CHECK_CANNOT_NO_TELEMETRY,
  CHECK_CANNOT_PROXY_ADDRESSES,
  CHECK_CANNOT_READ_FAILED,
  CHECK_FACT_SEEN_ADDRESSES,
} from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  AddressCoverage,
  AddressCoverageReading,
} from "./Evidence/AddressRequests";
import {
  STEP_CHECK_DOCS_PATH,
  StepCheckCase,
  StepCheckResult,
  evidenceOf,
  sentence,
} from "./StepCheck";

/*
 * What the checks of an address's steps share - "Block this address" and
 * "Check nothing else from it got through" (#10340): the window their
 * requests are read over, the grace after a step is done, and what they say
 * when OneUptime cannot see the address's requests at all.
 */

// How long an address must be quiet, with nobody saying it is blocked, for its block to look done.
export const BLOCK_QUIET_MINUTES: number = 30;

/*
 * Requests in the first minutes after a step is said to be done are not a
 * block that fails: a firewall's rule takes a moment to reach every node,
 * and a person ticks the step as they save it.
 */
export const BLOCK_GRACE_MINUTES: number = 2;

// How far back an address's requests are read: the case's first detection, an hour before it, at most three days.
export const ADDRESS_WINDOW_LEAD_MINUTES: number = 60;
export const ADDRESS_WINDOW_MAX_DAYS: number = 3;

const MINUTE: number = 60 * 1000;

export function getAddressWindow(data: {
  securityCase: Pick<StepCheckCase, "firstDetectedAt" | "createdAt">;
  now: Date;
}): { start: Date; end: Date } {
  const first: Date =
    data.securityCase.firstDetectedAt || data.securityCase.createdAt;
  const earliest: number =
    data.now.getTime() - ADDRESS_WINDOW_MAX_DAYS * 24 * 60 * MINUTE;

  return {
    start: new Date(
      Math.max(
        earliest,
        first.getTime() - ADDRESS_WINDOW_LEAD_MINUTES * MINUTE,
      ),
    ),
    end: data.now,
  };
}

// A moment and the grace after it: what is after it counts.
export function afterGrace(moment: Date | null): Date | null {
  return moment
    ? new Date(moment.getTime() + BLOCK_GRACE_MINUTES * MINUTE)
    : null;
}

// What a check says when it could not read its data: it tries again soon.
export function readFailed(): StepCheckResult {
  return {
    state: SecurityCaseStepCheckState.CannotTell,
    evidence: evidenceOf({
      sentence: sentence(CHECK_CANNOT_READ_FAILED),
      data: { readFailed: true },
    }),
    recheckInMinutes: 2,
  };
}

// The address is Cloudflare's own: nobody's requests can be told apart by it.
export function addressIsProxy(address: string): StepCheckResult {
  return {
    state: SecurityCaseStepCheckState.CannotTell,
    evidence: evidenceOf({
      sentence: sentence(CHECK_CANNOT_ADDRESS_IS_PROXY, { address }),
      docsPath: STEP_CHECK_DOCS_PATH,
      data: { reason: "AddressIsProxy" },
    }),
  };
}

/*
 * Why OneUptime saw no request from the address: it sees none by address at
 * all (no traces or logs, no client address, a proxy's addresses), or it
 * does and the address never reached the app - said with `noTraffic`.
 */
export function cannotSeeAddress(data: {
  address: string;
  coverage: AddressCoverageReading;
  noTraffic: string;
}): StepCheckResult {
  const facts: Array<SecurityCaseStepCheckSentence> =
    data.coverage.topAddresses.length > 0
      ? [
          sentence(
            CHECK_FACT_SEEN_ADDRESSES,
            { address: data.coverage.topAddresses[0]! },
            { count: Math.max(1, data.coverage.addressCount) },
          ),
        ]
      : [];
  let line: SecurityCaseStepCheckSentence;

  switch (data.coverage.coverage) {
    case AddressCoverage.NoTelemetry:
      line = sentence(CHECK_CANNOT_NO_TELEMETRY, { address: data.address });
      break;
    case AddressCoverage.NoClientAddress:
      line = sentence(CHECK_CANNOT_NO_CLIENT_ADDRESS);
      break;
    case AddressCoverage.ProxyAddresses:
      line = sentence(CHECK_CANNOT_PROXY_ADDRESSES);
      break;
    case AddressCoverage.LoadBalancerAddresses:
      line = sentence(CHECK_CANNOT_LOAD_BALANCER_ADDRESSES);
      break;
    default:
      line = sentence(data.noTraffic, { address: data.address });
  }

  return {
    state: SecurityCaseStepCheckState.CannotTell,
    evidence: evidenceOf({
      sentence: line,
      facts: data.coverage.coverage === AddressCoverage.Sees ? [] : facts,
      docsPath:
        data.coverage.coverage === AddressCoverage.Sees
          ? undefined
          : STEP_CHECK_DOCS_PATH,
      data: { reason: data.coverage.coverage },
    }),
  };
}
