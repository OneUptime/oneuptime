import {
  ResponseLinkKind,
  ResponseTracesLink,
} from "../../../../Types/SecurityCase/SecurityCaseResponseLink";
import { readStepCheckDataTime } from "../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { RESPONSE_STEP_KINDS } from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import {
  CHECK_BLOCK_NOT_PROOF,
  CHECK_BLOCK_QUIET,
  CHECK_BLOCK_QUIET_SINCE,
  CHECK_BLOCK_REGRESSED,
  CHECK_BLOCK_SINCE_AGAIN,
  CHECK_BLOCK_STILL_REACHING,
  CHECK_CANNOT_NO_TRAFFIC,
} from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  BLOCK_QUIET_MINUTES,
  addressIsProxy,
  afterGrace,
  cannotSeeAddress,
  getAddressWindow,
  readFailed,
} from "./AddressStepChecks";
import { AddressBlockEvidence } from "./Evidence/AddressBlocks";
import {
  AddressCoverageReading,
  AddressRequestsReading,
  isProxyAddress,
} from "./Evidence/AddressRequests";
import {
  StepCheck,
  StepCheckContext,
  StepCheckResult,
  StepCheckTarget,
  evidenceOf,
  getDoneSince,
  isStillRegressed,
  laterOf,
  sentence,
} from "./StepCheck";

/*
 * "BLOCK THIS ADDRESS AT YOUR FIREWALL, WAF OR LOAD BALANCER" (#10340).
 *
 *   Verified    a block of the address is in force at a destination,
 *               applied and read back there (AddressBlocks: the blocklist's
 *               destinations, #10338), and no request from it has reached
 *               the app since;
 *   Looks Done  no request from the address has reached the app for half an
 *               hour, after it was sending them - or since a person ticked
 *               the step. That catches a block made by hand, anywhere; but
 *               an address may simply have stopped, so a person confirms;
 *   Regressed   it was done, and a request from the address reached the app
 *               afterwards: the block is not holding;
 *   Not Done    the address still reaches the app;
 *   Cannot Tell OneUptime cannot see the address's requests - no traces or
 *               logs, none that say a client's address, a proxy's addresses
 *               in them - or the address never reached the app, so nothing
 *               going quiet would mean anything.
 */

const MINUTE: number = 60 * 1000;

export interface BlockAddressInput {
  address: string;
  now: Date;
  target: StepCheckTarget;
  // The blocks in force at a destination.
  blocks: Array<AddressBlockEvidence>;
  // The app's requests from the address; null when they could not be read.
  reading: AddressRequestsReading | null;
  // What OneUptime can see by address, read when the address sent nothing.
  coverage: AddressCoverageReading | null;
  // Requests in the hour before the address went quiet; null when not read.
  hourBefore: number | null;
}

// The newest block in force.
export function getLatestBlock(
  blocks: Array<AddressBlockEvidence>,
): AddressBlockEvidence | null {
  let latest: AddressBlockEvidence | null = null;

  for (const block of blocks) {
    if (!latest || block.appliedAt.getTime() > latest.appliedAt.getTime()) {
      latest = block;
    }
  }

  return latest;
}

/*
 * The moment requests are counted from to tell a block that stopped
 * holding: since the step was done (a tick, or OneUptime seeing it hold) or
 * since the newest block in force was applied - the later - and a grace.
 * For a step still stopped holding, since it stopped. Null for a step
 * nobody said is done.
 */
export function getBlockSince(data: {
  target: StepCheckTarget;
  blocks: Array<AddressBlockEvidence>;
}): Date | null {
  const doneOrBlocked: Date | null = laterOf(
    getDoneSince(data.target),
    getLatestBlock(data.blocks)?.appliedAt || null,
  );

  if (doneOrBlocked) {
    return afterGrace(doneOrBlocked);
  }

  if (isStillRegressed(data.target)) {
    const regressedAt: Date | null = readStepCheckDataTime(
      data.target.previous?.evidence.data,
      "regressedAt",
    );

    // Counted from the request that got through: it is one of them.
    return regressedAt ? new Date(regressedAt.getTime() - 1) : null;
  }

  return null;
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

// What the step says while the address keeps getting through after it was done.
function regressed(data: {
  input: BlockAddressInput;
  reading: AddressRequestsReading;
}): StepCheckResult {
  const { input, reading } = data;
  const keptAt: Date | null = isStillRegressed(input.target)
    ? readStepCheckDataTime(input.target.previous?.evidence.data, "regressedAt")
    : null;
  const regressedAt: Date =
    keptAt || reading.firstAfterSince || reading.lastSeenAt || input.now;

  return {
    state: SecurityCaseStepCheckState.Regressed,
    evidence: evidenceOf({
      sentence: sentence(
        CHECK_BLOCK_REGRESSED,
        { address: input.address },
        { times: { time: regressedAt } },
      ),
      facts: [
        sentence(
          CHECK_BLOCK_SINCE_AGAIN,
          { address: input.address },
          {
            count: Math.max(1, reading.afterSince || reading.recent),
            times: { time: regressedAt },
          },
        ),
      ],
      links: [tracesLink(reading)],
      data: {
        regressedAt,
        lastSeenAt: reading.lastSeenAt,
        requests: reading.total,
      },
    }),
  };
}

// What the step says of an address that went quiet.
function quiet(data: {
  input: BlockAddressInput;
  reading: AddressRequestsReading;
  doneSince: Date;
}): StepCheckResult {
  const { input, reading } = data;
  const since: Date = reading.lastSeenAt || data.doneSince;

  return {
    state: SecurityCaseStepCheckState.LooksDone,
    evidence: evidenceOf({
      sentence:
        input.hourBefore !== null && input.hourBefore > 0
          ? sentence(
              CHECK_BLOCK_QUIET,
              { address: input.address },
              { count: input.hourBefore, times: { since } },
            )
          : sentence(
              CHECK_BLOCK_QUIET_SINCE,
              { address: input.address },
              { times: { since } },
            ),
      facts: [sentence(CHECK_BLOCK_NOT_PROOF)],
      data: {
        doneSince: data.doneSince,
        lastSeenAt: reading.lastSeenAt,
        requests: reading.total,
      },
    }),
  };
}

export function decideBlockAddress(input: BlockAddressInput): StepCheckResult {
  if (isProxyAddress(input.address)) {
    return addressIsProxy(input.address);
  }

  const reading: AddressRequestsReading | null = input.reading;

  if (!reading) {
    return readFailed();
  }

  const block: AddressBlockEvidence | null = getLatestBlock(input.blocks);

  // A block in force: the app's own requests still have the last word.
  if (block) {
    if (reading.afterSince > 0) {
      return regressed({ input, reading });
    }

    return {
      state: SecurityCaseStepCheckState.Verified,
      evidence: evidenceOf({
        sentence: block.sentence,
        facts: reading.lastSeenAt
          ? [
              sentence(
                CHECK_BLOCK_QUIET_SINCE,
                { address: input.address },
                { times: { since: reading.lastSeenAt } },
              ),
            ]
          : [],
        links: [block.link || null],
        data: {
          doneSince: laterOf(getDoneSince(input.target), block.appliedAt),
          destination: block.destination,
          lastSeenAt: reading.lastSeenAt,
          requests: reading.total,
        },
      }),
    };
  }

  // The address never reached the app: its going quiet would mean nothing.
  if (reading.total === 0 || !reading.lastSeenAt) {
    if (!input.coverage) {
      return readFailed();
    }

    return cannotSeeAddress({
      address: input.address,
      coverage: input.coverage,
      noTraffic: CHECK_CANNOT_NO_TRAFFIC,
    });
  }

  const doneSince: Date | null = getDoneSince(input.target);
  const quietForInMinutes: number =
    (input.now.getTime() - reading.lastSeenAt.getTime()) / MINUTE;

  // Somebody said it is done: nothing since is what holds it.
  if (doneSince) {
    return reading.afterSince > 0
      ? regressed({ input, reading })
      : quiet({ input, reading, doneSince });
  }

  if (quietForInMinutes >= BLOCK_QUIET_MINUTES) {
    return quiet({ input, reading, doneSince: reading.lastSeenAt });
  }

  // Still stopped holding, until it is quiet again or somebody ticks it again.
  if (isStillRegressed(input.target)) {
    return regressed({ input, reading });
  }

  return {
    state: SecurityCaseStepCheckState.NotDone,
    evidence: evidenceOf({
      sentence: sentence(
        CHECK_BLOCK_STILL_REACHING,
        { address: input.address },
        {
          count: Math.max(1, reading.recent),
          times: { latest: reading.lastSeenAt },
        },
      ),
      links: [tracesLink(reading)],
      data: { lastSeenAt: reading.lastSeenAt, requests: reading.total },
    }),
  };
}

const BlockAddressStepCheck: StepCheck = {
  kind: RESPONSE_STEP_KINDS.blockIp,
  intervalInMinutes: 5,
  check: async (context: StepCheckContext): Promise<StepCheckResult | null> => {
    const address: string = context.target.value;

    if (!address) {
      return null;
    }

    const base: Omit<BlockAddressInput, "reading" | "coverage" | "hourBefore"> =
      {
        address,
        now: context.now,
        target: context.target,
        blocks: [],
      };

    if (isProxyAddress(address)) {
      return decideBlockAddress({
        ...base,
        reading: null,
        coverage: null,
        hourBefore: null,
      });
    }

    /*
     * A destination that cannot be read verifies nothing: the step is then
     * judged by the app's requests alone.
     */
    try {
      base.blocks = await context.evidence.readAddressBlocks(address);
    } catch {
      base.blocks = [];
    }

    const window: { start: Date; end: Date } = getAddressWindow({
      securityCase: context.securityCase,
      now: context.now,
    });
    let reading: AddressRequestsReading;

    try {
      reading = await context.evidence.readAddressRequests({
        address,
        start: window.start,
        end: window.end,
        since: getBlockSince({ target: context.target, blocks: base.blocks }),
      });
    } catch {
      return readFailed();
    }

    let coverage: AddressCoverageReading | null = null;
    let hourBefore: number | null = null;

    try {
      if (reading.total === 0) {
        coverage = await context.evidence.readAddressCoverage();
      } else if (
        reading.lastSeenAt &&
        reading.afterSince === 0 &&
        context.now.getTime() - reading.lastSeenAt.getTime() >=
          BLOCK_QUIET_MINUTES * MINUTE
      ) {
        hourBefore = await context.evidence.countAddressRequests({
          address,
          start: new Date(reading.lastSeenAt.getTime() - 60 * MINUTE),
          end: reading.lastSeenAt,
        });
      }
    } catch {
      if (reading.total === 0) {
        return readFailed();
      }
    }

    return decideBlockAddress({ ...base, reading, coverage, hourBefore });
  },
};

export default BlockAddressStepCheck;
