import {
  IndicatorBlock,
  IndicatorBlockReading,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/IndicatorBlocks";
import {
  BlockAddressEverywhereStepCheck,
  BlockDomainStepCheck,
  QuarantineFileStepCheck,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/IndicatorBlockStepChecks";
import { StepCheckResult } from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheck";
import {
  STEP_CHECKS,
  getStepCheck,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheckRegistry";
import {
  SecurityBlockAction,
  SecurityBlockReach,
} from "../../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  CHECK_BLOCKED_EVERYWHERE,
  CHECK_BLOCKED_EVERYWHERE_UNTIL_LIFTED,
  CHECK_BLOCK_ENDED,
  CHECK_BLOCK_NONE,
  CHECK_BLOCK_NOT_HELD,
  CHECK_BLOCK_NOT_HELD_AT,
  CHECK_COULD_NOT_CHECK,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  RecordingEvidence,
  at,
  context,
  fakeEvidence,
  planStep,
  previousCheck,
  stepTarget,
  tick,
} from "../../../../Helpers/SecurityCaseStepChecks";
import { describe, expect, test } from "@jest/globals";

/*
 * "Block it on every machine" (#10346): a domain, a file and a
 * command-and-control address are checked against the blocklist - done
 * when an endpoint product holds a block of the value everywhere, not done
 * while it is on its way or refused, and regressed when it stops.
 */

const DOMAIN: string = "evil.example";
const DOMAIN_KEY: string = `contain:block-domain:${DOMAIN}`;
const FILE: string =
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";
const FILE_KEY: string = `contain:quarantine-file:${FILE}`;
const ADDRESS: string = "198.51.100.7";
const ADDRESS_KEY: string = `contain:block-ip-everywhere:${ADDRESS}`;

function block(data: {
  reach?: SecurityBlockReach;
  holding?: Array<{ provider: string; destination: string; minute: number }>;
  notHolding?: Array<{ destination: string; reason: string | null }>;
  expiresAt?: Date | null;
}): IndicatorBlock {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    reach: data.reach || SecurityBlockReach.Everywhere,
    action: SecurityBlockAction.Block,
    createdAt: at(5),
    expiresAt:
      data.expiresAt === undefined ? at(5 + 7 * 24 * 60) : data.expiresAt,
    holding: (data.holding || []).map(
      (holding: { provider: string; destination: string; minute: number }) => {
        return {
          provider: holding.provider,
          destination: holding.destination,
          appliedAt: at(holding.minute),
        };
      },
    ),
    notHolding: (data.notHolding || []).map(
      (notHolding: { destination: string; reason: string | null }) => {
        return {
          destination: notHolding.destination,
          provider: SecurityBlockDestinationProvider.MicrosoftDefender,
          reason: notHolding.reason,
        };
      },
    ),
  };
}

const DEFENDER: { provider: string; destination: string; minute: number } = {
  provider: SecurityBlockDestinationProvider.MicrosoftDefender,
  destination: "Microsoft Defender",
  minute: 6,
};

async function checkDomain(data: {
  reading?: IndicatorBlockReading;
  minute: number;
  previous?: ReturnType<typeof previousCheck> | null;
  task?: ReturnType<typeof tick> | null;
  failing?: boolean;
  recording?: RecordingEvidence;
}): Promise<StepCheckResult | null> {
  const recording: RecordingEvidence =
    data.recording ||
    fakeEvidence({
      ...(data.reading ? { indicatorBlocks: data.reading } : {}),
      ...(data.failing ? { failing: ["readIndicatorBlocks"] } : {}),
    });

  return await BlockDomainStepCheck.check(
    context({
      target: stepTarget({
        step: planStep(DOMAIN_KEY, DOMAIN),
        previous: data.previous || null,
        task: data.task || null,
      }),
      evidence: recording.evidence,
      minute: data.minute,
    }),
  );
}

describe("the three steps are checked", () => {
  test("each is registered under its step's kind", () => {
    for (const check of [
      BlockDomainStepCheck,
      QuarantineFileStepCheck,
      BlockAddressEverywhereStepCheck,
    ]) {
      expect(STEP_CHECKS).toContain(check);
    }

    expect(getStepCheck(DOMAIN_KEY)).toBe(BlockDomainStepCheck);
    expect(getStepCheck(FILE_KEY)).toBe(QuarantineFileStepCheck);
    expect(getStepCheck(ADDRESS_KEY)).toBe(BlockAddressEverywhereStepCheck);
    // The edge's block of an address is its own step, checked its own way.
    expect(getStepCheck(`contain:block-ip:${ADDRESS}`)).not.toBe(
      BlockAddressEverywhereStepCheck,
    );
  });
});

describe("Block the domain on every machine", () => {
  test("done once Microsoft Defender holds a block of it everywhere, since it was applied, until it ends", async () => {
    const recording: RecordingEvidence = fakeEvidence({
      indicatorBlocks: {
        blocks: [block({ holding: [DEFENDER] })],
        lastEndedAt: null,
      },
    });
    const result: StepCheckResult | null = await checkDomain({
      minute: 10,
      recording,
    });

    expect(result?.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result?.evidence.sentence).toEqual({
      template: CHECK_BLOCKED_EVERYWHERE,
      values: { value: DOMAIN, destination: "Microsoft Defender" },
      times: {
        since: at(6).toISOString(),
        until: at(5 + 7 * 24 * 60).toISOString(),
      },
    });
    expect(result?.evidence.data).toEqual(
      expect.objectContaining({
        doneSince: at(6).toISOString(),
        securityBlockId: "44444444-4444-4444-8444-444444444444",
      }),
    );
    // The value as the step names it.
    expect(recording.reads).toEqual([
      { reader: "readIndicatorBlocks", asked: DOMAIN },
    ]);
  });

  test("a block with no end says it holds until lifted, and each other product that holds it is a fact", async () => {
    const result: StepCheckResult | null = await checkDomain({
      minute: 10,
      reading: {
        blocks: [
          block({
            expiresAt: null,
            holding: [
              {
                provider: SecurityBlockDestinationProvider.CrowdStrike,
                destination: "CrowdStrike Falcon",
                minute: 8,
              },
              DEFENDER,
            ],
          }),
        ],
        lastEndedAt: null,
      },
    });

    expect(result?.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result?.evidence.sentence).toEqual({
      template: CHECK_BLOCKED_EVERYWHERE_UNTIL_LIFTED,
      values: { value: DOMAIN, destination: "Microsoft Defender" },
      times: { since: at(6).toISOString() },
    });
    expect(result?.evidence.facts).toEqual([
      {
        template: CHECK_BLOCKED_EVERYWHERE_UNTIL_LIFTED,
        values: { value: DOMAIN, destination: "CrowdStrike Falcon" },
        times: { since: at(8).toISOString() },
      },
    ]);
  });

  test("held at the edge alone is not done: a firewall at the edge does not block it on a laptop", async () => {
    const result: StepCheckResult | null = await checkDomain({
      minute: 10,
      reading: {
        blocks: [
          block({
            holding: [
              {
                provider: SecurityBlockDestinationProvider.Test,
                destination: "Cloudflare",
                minute: 6,
              },
            ],
          }),
        ],
        lastEndedAt: null,
      },
    });

    expect(result?.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result?.evidence.sentence.template).toBe(CHECK_BLOCK_NOT_HELD);
  });

  test("on the blocklist and refused: not done, saying why, and looked at again in a minute", async () => {
    const result: StepCheckResult | null = await checkDomain({
      minute: 10,
      reading: {
        blocks: [
          block({
            notHolding: [
              {
                destination: "Microsoft Defender",
                reason:
                  "Microsoft Defender holds 15,000 indicators at most, the tenant's own included",
              },
              { destination: "CrowdStrike Falcon", reason: null },
            ],
          }),
        ],
        lastEndedAt: null,
      },
    });

    expect(result?.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result?.evidence.sentence).toEqual({
      template: CHECK_BLOCK_NOT_HELD,
      values: { value: DOMAIN },
    });
    expect(result?.evidence.facts).toEqual([
      {
        template: CHECK_BLOCK_NOT_HELD_AT,
        values: {
          destination: "Microsoft Defender",
          reason:
            "Microsoft Defender holds 15,000 indicators at most, the tenant's own included",
        },
      },
    ]);
    expect(result?.recheckInMinutes).toBe(1);
  });

  test("not blocked at all: not done, even when an address of the same text is blocked at the edge", async () => {
    const result: StepCheckResult | null = await checkDomain({
      minute: 10,
      reading: {
        blocks: [
          block({ reach: SecurityBlockReach.Edge, holding: [DEFENDER] }),
        ],
        lastEndedAt: null,
      },
    });

    expect(result?.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result?.evidence.sentence).toEqual({
      template: CHECK_BLOCK_NONE,
      values: { value: DOMAIN },
    });
  });

  test("ticked by hand with nothing on the blocklist is not checked: done outside OneUptime is the person's to say", async () => {
    expect(
      await checkDomain({ minute: 10, task: tick(DOMAIN_KEY, 9) }),
    ).toBeNull();
  });

  test("its block ended: regressed at the moment it ended, and stays so until the step is ticked again", async () => {
    const previous: ReturnType<typeof previousCheck> = previousCheck({
      stepKey: DOMAIN_KEY,
      state: SecurityCaseStepCheckState.Verified,
      evidence: {
        sentence: { template: CHECK_BLOCKED_EVERYWHERE, values: {} },
        facts: [],
        links: [],
        data: { doneSince: at(6).toISOString() },
      },
      stateSince: at(6),
    });

    const result: StepCheckResult | null = await checkDomain({
      minute: 60,
      previous,
      reading: { blocks: [], lastEndedAt: at(45) },
    });

    expect(result?.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(result?.evidence.sentence).toEqual({
      template: CHECK_BLOCK_ENDED,
      values: { value: DOMAIN },
      times: { time: at(45).toISOString() },
    });

    const again: StepCheckResult | null = await checkDomain({
      minute: 70,
      previous: previousCheck({
        stepKey: DOMAIN_KEY,
        state: SecurityCaseStepCheckState.Regressed,
        evidence: result!.evidence,
        stateSince: at(60),
      }),
      reading: { blocks: [], lastEndedAt: at(45) },
    });

    expect(again?.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(again?.evidence.data?.["regressedAt"]).toBe(at(45).toISOString());
  });

  test("still blocked but no longer held: regressed, saying nothing holds it", async () => {
    const result: StepCheckResult | null = await checkDomain({
      minute: 60,
      previous: previousCheck({
        stepKey: DOMAIN_KEY,
        state: SecurityCaseStepCheckState.Verified,
        evidence: {
          sentence: { template: CHECK_BLOCKED_EVERYWHERE, values: {} },
          facts: [],
          links: [],
          data: {},
        },
        stateSince: at(6),
      }),
      reading: { blocks: [block({})], lastEndedAt: null },
    });

    expect(result?.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(result?.evidence.sentence.template).toBe(CHECK_BLOCK_NOT_HELD);
    expect(result?.evidence.sentence.times).toEqual({
      time: at(60).toISOString(),
    });
  });

  test("done since the first time it held, while it keeps holding", async () => {
    const result: StepCheckResult | null = await checkDomain({
      minute: 600,
      previous: previousCheck({
        stepKey: DOMAIN_KEY,
        state: SecurityCaseStepCheckState.Verified,
        evidence: {
          sentence: { template: CHECK_BLOCKED_EVERYWHERE, values: {} },
          facts: [],
          links: [],
          data: { doneSince: at(6).toISOString() },
        },
        stateSince: at(6),
      }),
      reading: {
        // Defender re-added it at minute 300 after a renewal.
        blocks: [block({ holding: [{ ...DEFENDER, minute: 300 }] })],
        lastEndedAt: null,
      },
    });

    expect(result?.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result?.evidence.data?.["doneSince"]).toBe(at(6).toISOString());
  });

  test("a blocklist that cannot be read cannot tell, and is looked at again in five minutes", async () => {
    const result: StepCheckResult | null = await checkDomain({
      minute: 10,
      failing: true,
    });

    expect(result?.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result?.evidence.sentence.template).toBe(CHECK_COULD_NOT_CHECK);
    expect(result?.recheckInMinutes).toBe(5);
  });
});

describe("the file and the command-and-control address", () => {
  test("a file is done once CrowdStrike holds it, and an address only once it is blocked everywhere", async () => {
    const file: StepCheckResult | null = await QuarantineFileStepCheck.check(
      context({
        target: stepTarget({ step: planStep(FILE_KEY, FILE) }),
        evidence: fakeEvidence({
          indicatorBlocks: {
            blocks: [
              block({
                holding: [
                  {
                    provider: SecurityBlockDestinationProvider.CrowdStrike,
                    destination: "CrowdStrike Falcon",
                    minute: 7,
                  },
                ],
              }),
            ],
            lastEndedAt: null,
          },
        }).evidence,
        minute: 10,
      }),
    );

    expect(file?.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(file?.evidence.sentence.values["destination"]).toBe(
      "CrowdStrike Falcon",
    );

    const edgeOnly: StepCheckResult | null =
      await BlockAddressEverywhereStepCheck.check(
        context({
          target: stepTarget({ step: planStep(ADDRESS_KEY, ADDRESS) }),
          evidence: fakeEvidence({
            indicatorBlocks: {
              blocks: [
                block({
                  reach: SecurityBlockReach.Edge,
                  holding: [
                    {
                      provider: SecurityBlockDestinationProvider.Test,
                      destination: "Cloudflare",
                      minute: 6,
                    },
                  ],
                }),
              ],
              lastEndedAt: null,
            },
          }).evidence,
          minute: 10,
        }),
      );

    expect(edgeOnly?.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(edgeOnly?.evidence.sentence.template).toBe(CHECK_BLOCK_NONE);
  });

  test("a step without a value is not checked", async () => {
    expect(
      await QuarantineFileStepCheck.check(
        context({
          target: stepTarget({ step: planStep("contain:quarantine-file:") }),
          evidence: fakeEvidence().evidence,
          minute: 10,
        }),
      ),
    ).toBeNull();
  });
});
