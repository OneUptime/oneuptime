import {
  ResponseLinkKind,
  ResponseTracesLink,
} from "../../../../Types/SecurityCase/SecurityCaseResponseLink";
import {
  SecurityCaseMatchedDetectionJson,
  getOpeningMatchedDetection,
} from "../../../../Types/SecurityCase/SecurityCaseMatches";
import { readStepCheckDataTime } from "../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState, {
  isStepCheckHolding,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../Types/SecurityCase/SecurityEntity";
import { RESPONSE_STEP_KINDS } from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import {
  CHECK_CANNOT_NO_TRAFFIC_REQUESTS,
  CHECK_REQUESTS_ALL_TURNED_AWAY,
  CHECK_REQUESTS_GOT_THROUGH,
  CHECK_REQUESTS_SINCE,
  CHECK_REQUESTS_SOME_UNREAD,
} from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  SecurityAddressScope,
  getSecurityAddressScope,
} from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import {
  addressIsProxy,
  afterGrace,
  cannotSeeAddress,
  getAddressWindow,
  readFailed,
} from "./AddressStepChecks";
import {
  AddressCoverageReading,
  AddressRequestsReading,
  isProxyAddress,
} from "./Evidence/AddressRequests";
import {
  StepCheck,
  StepCheckCase,
  StepCheckContext,
  StepCheckResult,
  StepCheckTarget,
  evidenceOf,
  getDoneSince,
  isStillRegressed,
  sentence,
} from "./StepCheck";

/*
 * "CHECK THAT NOTHING ELSE FROM THIS ADDRESS GOT THROUGH" (#10340): every
 * request from the address since the case's first detection, as the app's
 * traces and logs show it, not only the ones its detections matched.
 *
 *   Verified    every one of them was turned away (4xx);
 *   Looks Done  none got through, but OneUptime could not read the app's
 *               answer to some of them;
 *   Not Done    some got past the app's checks: their traces are linked;
 *   Regressed   it held - none had got through - and one since did;
 *   Cannot Tell OneUptime cannot see the address's requests, or the address
 *               never reached the app.
 */

export interface RequestsInput {
  address: string;
  now: Date;
  target: StepCheckTarget;
  reading: AddressRequestsReading | null;
  coverage: AddressCoverageReading | null;
}

/*
 * The address the step is about: the one the opening detection was grouped
 * on, else the case's first public address. Empty when the case names none.
 */
export function getRequestsAddress(data: {
  securityCase: Pick<StepCheckCase, "matches" | "entities">;
  target: StepCheckTarget;
}): string {
  const opening: SecurityCaseMatchedDetectionJson | null = data.securityCase
    .matches
    ? getOpeningMatchedDetection(data.securityCase.matches)
    : null;

  for (const value of [
    data.target.value,
    opening?.groupValue || "",
    ...data.securityCase.entities
      .filter((entity: SecurityEntity): boolean => {
        return entity.type === SecurityEntityType.IpAddress;
      })
      .map((entity: SecurityEntity): string => {
        return entity.value;
      }),
  ]) {
    if (getSecurityAddressScope(value.trim()) === SecurityAddressScope.Public) {
      return value.trim();
    }
  }

  return "";
}

function tracesLink(
  reading: AddressRequestsReading,
): ResponseTracesLink | null {
  return reading.throughTraceIds.length > 0
    ? {
        kind: ResponseLinkKind.OpenTraces,
        traceIds: reading.throughTraceIds,
        startTime: reading.windowStart.toISOString(),
        endTime: reading.windowEnd.toISOString(),
      }
    : null;
}

export function decideRequests(input: RequestsInput): StepCheckResult {
  if (isProxyAddress(input.address)) {
    return addressIsProxy(input.address);
  }

  const reading: AddressRequestsReading | null = input.reading;

  if (!reading) {
    return readFailed();
  }

  if (reading.total === 0) {
    if (!input.coverage) {
      return readFailed();
    }

    return cannotSeeAddress({
      address: input.address,
      coverage: input.coverage,
      noTraffic: CHECK_CANNOT_NO_TRAFFIC_REQUESTS,
    });
  }

  const since: Array<ReturnType<typeof sentence>> = [
    sentence(
      CHECK_REQUESTS_SINCE,
      {},
      { times: { time: reading.windowStart } },
    ),
  ];
  const previousDoneSince: Date | null =
    input.target.previous && isStepCheckHolding(input.target.previous.state)
      ? readStepCheckDataTime(input.target.previous.evidence.data, "doneSince")
      : null;

  if (reading.through === 0) {
    const isEveryOneRead: boolean = reading.unknown === 0;

    return {
      state: isEveryOneRead
        ? SecurityCaseStepCheckState.Verified
        : SecurityCaseStepCheckState.LooksDone,
      evidence: evidenceOf({
        sentence: isEveryOneRead
          ? sentence(
              CHECK_REQUESTS_ALL_TURNED_AWAY,
              { address: input.address },
              { count: reading.total },
            )
          : sentence(
              CHECK_REQUESTS_SOME_UNREAD,
              { address: input.address },
              {
                numbers: { rejected: reading.rejected },
                count: reading.total,
              },
            ),
        facts: since,
        data: {
          doneSince: previousDoneSince || input.now,
          requests: reading.total,
          rejected: reading.rejected,
          unknown: reading.unknown,
        },
      }),
    };
  }

  const gotThrough: ReturnType<typeof sentence> = sentence(
    CHECK_REQUESTS_GOT_THROUGH,
    { address: input.address },
    { numbers: { through: reading.through }, count: reading.total },
  );
  const doneSince: Date | null = getDoneSince(input.target);
  const isNew: boolean = Boolean(doneSince) && reading.throughAfterSince > 0;

  if (isNew || isStillRegressed(input.target)) {
    const regressedAt: Date =
      (!isNew
        ? readStepCheckDataTime(
            input.target.previous?.evidence.data,
            "regressedAt",
          )
        : null) ||
      reading.firstThroughAfterSince ||
      reading.lastSeenAt ||
      input.now;

    return {
      state: SecurityCaseStepCheckState.Regressed,
      evidence: evidenceOf({
        sentence: gotThrough,
        facts: since,
        links: [tracesLink(reading)],
        data: {
          regressedAt,
          requests: reading.total,
          through: reading.through,
        },
      }),
    };
  }

  return {
    state: SecurityCaseStepCheckState.NotDone,
    evidence: evidenceOf({
      sentence: gotThrough,
      facts: since,
      links: [tracesLink(reading)],
      data: { requests: reading.total, through: reading.through },
    }),
  };
}

const RequestsStepCheck: StepCheck = {
  kind: RESPONSE_STEP_KINDS.requests,
  intervalInMinutes: 5,
  check: async (context: StepCheckContext): Promise<StepCheckResult | null> => {
    const address: string = getRequestsAddress({
      securityCase: context.securityCase,
      target: context.target,
    });

    // A case about no public address has no address's requests to read.
    if (!address) {
      return null;
    }

    if (isProxyAddress(address)) {
      return decideRequests({
        address,
        now: context.now,
        target: context.target,
        reading: null,
        coverage: null,
      });
    }

    const window: { start: Date; end: Date } = getAddressWindow({
      securityCase: context.securityCase,
      now: context.now,
    });
    let reading: AddressRequestsReading;
    let coverage: AddressCoverageReading | null = null;

    try {
      reading = await context.evidence.readAddressRequests({
        address,
        start: window.start,
        end: window.end,
        since: afterGrace(getDoneSince(context.target)),
      });

      if (reading.total === 0) {
        coverage = await context.evidence.readAddressCoverage();
      }
    } catch {
      return readFailed();
    }

    return decideRequests({
      address,
      now: context.now,
      target: context.target,
      reading,
      coverage,
    });
  },
};

export default RequestsStepCheck;
