import {
  SecurityCaseStepCheckSentence,
  readStepCheckDataTime,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState, {
  isStepCheckHolding,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { SecurityBlockReach } from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { RESPONSE_STEP_KINDS } from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import {
  CHECK_BLOCKED_EVERYWHERE,
  CHECK_BLOCKED_EVERYWHERE_UNTIL_LIFTED,
  CHECK_BLOCK_ENDED,
  CHECK_BLOCK_NONE,
  CHECK_BLOCK_NOT_HELD,
  CHECK_BLOCK_NOT_HELD_AT,
  CHECK_COULD_NOT_CHECK,
} from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  IndicatorBlock,
  IndicatorBlockDestination,
  IndicatorBlockReading,
} from "./Evidence/IndicatorBlocks";
import {
  StepCheck,
  StepCheckContext,
  StepCheckResult,
  StepCheckTarget,
  evidenceOf,
  isStillRegressed,
  sentence,
} from "./StepCheck";

/*
 * "BLOCK IT ON EVERY MACHINE" (#10346): a domain, a file - blocked, and
 * quarantined where Microsoft Defender can - and a command-and-control
 * address, read back from the project's blocklist:
 *
 *   Verified     a block of it everywhere is held - applied and read back
 *                within ten minutes - by an endpoint product: Microsoft
 *                Defender or CrowdStrike Falcon;
 *   Not Done     it is on the blocklist, but nothing holds it yet (still on
 *                its way, or refused, and why), or it is not blocked at all;
 *   Regressed    it was, and its block ended - lifted or expired - or
 *                stopped holding;
 *   Cannot Tell  the blocklist could not be read just now.
 *
 * A step a person ticked as done by hand - at a DNS filter, a proxy, an
 * EDR OneUptime is not connected to - with nothing on the blocklist is not
 * checked: what was done outside OneUptime is the person's to say.
 */

// The products that block on every machine, as an enforcement row names them.
const EVERY_MACHINE_PROVIDERS: ReadonlyArray<string> = [
  SecurityBlockDestinationProvider.MicrosoftDefender,
  SecurityBlockDestinationProvider.CrowdStrike,
];

// Where a block of the value is held on every machine, the earliest first.
function heldOnEveryMachine(
  block: IndicatorBlock,
): Array<IndicatorBlockDestination> {
  return block.holding
    .filter((holding: IndicatorBlockDestination): boolean => {
      return EVERY_MACHINE_PROVIDERS.includes(holding.provider);
    })
    .sort(
      (
        left: IndicatorBlockDestination,
        right: IndicatorBlockDestination,
      ): number => {
        return (
          (left.appliedAt?.getTime() || 0) - (right.appliedAt?.getTime() || 0)
        );
      },
    );
}

// Whether a person ticked the step done.
function isTicked(target: StepCheckTarget): boolean {
  return Boolean(target.task?.isDone);
}

export function decideIndicatorBlock(data: {
  value: string;
  now: Date;
  target: StepCheckTarget;
  reading: IndicatorBlockReading;
}): StepCheckResult | null {
  const { value, now, target, reading } = data;

  // Blocks on every machine only: an address blocked at the edge alone is another step's.
  const everywhere: Array<IndicatorBlock> = reading.blocks.filter(
    (block: IndicatorBlock): boolean => {
      return block.reach === SecurityBlockReach.Everywhere;
    },
  );

  for (const block of everywhere) {
    const held: Array<IndicatorBlockDestination> = heldOnEveryMachine(block);

    if (held.length === 0) {
      continue;
    }

    const first: IndicatorBlockDestination = held[0]!;
    const since: Date = first.appliedAt || block.createdAt;
    const doneSince: Date =
      (target.previous && isStepCheckHolding(target.previous.state)
        ? readStepCheckDataTime(target.previous.evidence.data, "doneSince")
        : null) || since;

    const line: SecurityCaseStepCheckSentence = block.expiresAt
      ? sentence(
          CHECK_BLOCKED_EVERYWHERE,
          { value, destination: first.destination },
          { times: { since, until: block.expiresAt } },
        )
      : sentence(
          CHECK_BLOCKED_EVERYWHERE_UNTIL_LIFTED,
          { value, destination: first.destination },
          { times: { since } },
        );

    return {
      state: SecurityCaseStepCheckState.Verified,
      evidence: evidenceOf({
        sentence: line,
        facts: held
          .slice(1)
          .map(
            (
              holding: IndicatorBlockDestination,
            ): SecurityCaseStepCheckSentence => {
              return block.expiresAt
                ? sentence(
                    CHECK_BLOCKED_EVERYWHERE,
                    { value, destination: holding.destination },
                    {
                      times: {
                        since: holding.appliedAt || block.createdAt,
                        until: block.expiresAt,
                      },
                    },
                  )
                : sentence(
                    CHECK_BLOCKED_EVERYWHERE_UNTIL_LIFTED,
                    { value, destination: holding.destination },
                    {
                      times: { since: holding.appliedAt || block.createdAt },
                    },
                  );
            },
          ),
        data: {
          doneSince,
          securityBlockId: block.id,
          expiresAt: block.expiresAt,
        },
      }),
    };
  }

  const wasHeld: boolean =
    Boolean(target.previous && isStepCheckHolding(target.previous.state)) ||
    isStillRegressed(target);

  // It held, and does no more: its block ended, or stopped holding.
  if (wasHeld) {
    const regressedAt: Date =
      (isStillRegressed(target)
        ? readStepCheckDataTime(target.previous?.evidence.data, "regressedAt")
        : null) ||
      reading.lastEndedAt ||
      now;

    return {
      state: SecurityCaseStepCheckState.Regressed,
      evidence: evidenceOf({
        sentence: sentence(
          everywhere.length > 0 ? CHECK_BLOCK_NOT_HELD : CHECK_BLOCK_ENDED,
          { value },
          { times: { time: regressedAt } },
        ),
        data: { regressedAt },
      }),
    };
  }

  // On the blocklist, and nothing holds it yet: on its way, or refused.
  if (everywhere.length > 0) {
    const block: IndicatorBlock = everywhere[0]!;

    return {
      state: SecurityCaseStepCheckState.NotDone,
      evidence: evidenceOf({
        sentence: sentence(CHECK_BLOCK_NOT_HELD, { value }),
        facts: block.notHolding
          .filter((notHolding: { reason: string | null }): boolean => {
            return Boolean(notHolding.reason);
          })
          .map(
            (notHolding: {
              destination: string;
              reason: string | null;
            }): SecurityCaseStepCheckSentence => {
              return sentence(CHECK_BLOCK_NOT_HELD_AT, {
                destination: notHolding.destination,
                reason: notHolding.reason || "",
              });
            },
          ),
        data: { securityBlockId: block.id },
      }),
      // The reconciler applies a block within a minute: look again soon.
      recheckInMinutes: 1,
    };
  }

  // Ticked by hand with nothing on the blocklist: done outside OneUptime, the person's to say.
  if (isTicked(target)) {
    return null;
  }

  return {
    state: SecurityCaseStepCheckState.NotDone,
    evidence: evidenceOf({ sentence: sentence(CHECK_BLOCK_NONE, { value }) }),
  };
}

function indicatorBlockCheck(kind: string): StepCheck {
  return {
    kind,
    // The blocklist is OneUptime's own: read as often as the address's block.
    intervalInMinutes: 5,
    check: async (
      context: StepCheckContext,
    ): Promise<StepCheckResult | null> => {
      const value: string = context.target.value;

      if (!value) {
        return null;
      }

      let reading: IndicatorBlockReading;

      try {
        reading = await context.evidence.readIndicatorBlocks(value);
      } catch {
        return {
          state: SecurityCaseStepCheckState.CannotTell,
          evidence: evidenceOf({
            sentence: sentence(CHECK_COULD_NOT_CHECK),
            data: { readFailed: true },
          }),
          recheckInMinutes: 5,
        };
      }

      return decideIndicatorBlock({
        value,
        now: context.now,
        target: context.target,
        reading,
      });
    },
  };
}

export const BlockDomainStepCheck: StepCheck = indicatorBlockCheck(
  RESPONSE_STEP_KINDS.blockDomain,
);
export const QuarantineFileStepCheck: StepCheck = indicatorBlockCheck(
  RESPONSE_STEP_KINDS.quarantineFile,
);
export const BlockAddressEverywhereStepCheck: StepCheck = indicatorBlockCheck(
  RESPONSE_STEP_KINDS.blockIpEverywhere,
);
