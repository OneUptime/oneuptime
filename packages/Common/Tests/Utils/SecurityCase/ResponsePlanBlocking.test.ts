import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockReach,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SecurityBlockHolder } from "../../../Types/SecurityBlocklist/SecurityBlockHolders";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import SecurityCaseStepCheckState from "../../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  C2_ATTACK_IDS,
  ResponsePlanInput,
  buildResponsePlan,
  findResponseBlock,
  getBlockingProducts,
} from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanBuilder";
import {
  ResponseActionKind,
  ResponseBlock,
  ResponsePlan,
  ResponseStep,
  ResponseStepCompletion,
} from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import {
  ACTION_BLOCK_FILE,
  ACTION_BLOCK_FOR_7_DAYS,
  STEP_BLOCK_C2_BY_HAND,
  STEP_BLOCK_DOMAIN,
  STEP_BLOCK_EVERYWHERE_WITH,
  STEP_BLOCK_FILE_WITH,
  STEP_BLOCK_EVERYWHERE_WAITING,
  STEP_QUARANTINE_FILE,
  STEP_QUARANTINE_FILE_WITH,
  STEP_QUARANTINE_FILE_WITH_TWO,
} from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanWords";
import { describe, expect, test } from "@jest/globals";

/*
 * A domain's, a file's and a command-and-control address's steps (#10346):
 * one click where an endpoint product the project connected blocks them -
 * named in the step - done while a product holds the block, waiting while
 * none does yet, and by hand where nothing connected blocks them.
 */

const DOMAIN: string = "evil.example";
const SHA256: string =
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";
const SHA1: string = "3395856ce81f2b7382dee72602f798b642f14140";
const ADDRESS: string = "35.196.249.14";

const DEFENDER: SecurityBlockHolder = {
  name: "Microsoft Defender",
  provider: SecurityBlockDestinationProvider.MicrosoftDefender,
  enforcesOnEveryMachine: true,
  blocks: [
    SecurityBlockIndicatorType.IpAddress,
    SecurityBlockIndicatorType.Domain,
    SecurityBlockIndicatorType.Url,
    SecurityBlockIndicatorType.FileSha256,
    SecurityBlockIndicatorType.FileSha1,
    SecurityBlockIndicatorType.FileMd5,
  ],
  quarantinesFiles: true,
};

const CROWDSTRIKE: SecurityBlockHolder = {
  name: "CrowdStrike Falcon (Production)",
  provider: SecurityBlockDestinationProvider.CrowdStrike,
  enforcesOnEveryMachine: true,
  blocks: [
    SecurityBlockIndicatorType.FileSha256,
    SecurityBlockIndicatorType.FileMd5,
  ],
  quarantinesFiles: false,
};

// An edge destination: addresses only, never on every machine.
const EDGE: SecurityBlockHolder = {
  name: "Cloudflare",
  provider: SecurityBlockDestinationProvider.Test,
  enforcesOnEveryMachine: false,
  blocks: [
    SecurityBlockIndicatorType.IpAddress,
    SecurityBlockIndicatorType.IpRange,
  ],
  quarantinesFiles: false,
};

function planFor(overrides: Partial<ResponsePlanInput> = {}): ResponsePlan {
  return buildResponsePlan({
    entities: [],
    mitreTactics: [],
    mitreTechniques: [],
    isAssigned: true,
    hasIncident: false,
    stage: SecurityCaseStage.Acknowledged,
    hasContainedStatus: true,
    matches: null,
    playbooks: [],
    ranPlaybookIds: [],
    tasks: [],
    ai: null,
    ...overrides,
  });
}

function stepOf(plan: ResponsePlan, key: string): ResponseStep {
  const step: ResponseStep | undefined = plan.steps.find(
    (candidate: ResponseStep): boolean => {
      return candidate.key === key;
    },
  );

  expect({ key, found: Boolean(step) }).toEqual({ key, found: true });

  return step!;
}

function blockOf(
  value: string,
  enforcedAt: Array<string>,
  reach: SecurityBlockReach = SecurityBlockReach.Everywhere,
): ResponseBlock {
  return { value, reach, action: SecurityBlockAction.Block, enforcedAt };
}

describe("a domain's step", () => {
  const key: string = `contain:block-domain:${DOMAIN}`;
  const entities: ResponsePlanInput["entities"] = [
    { type: SecurityEntityType.Domain, value: DOMAIN },
  ];

  test("by hand at a DNS filter while nothing connected blocks domains", () => {
    for (const blocklist of [
      undefined,
      { holders: [EDGE, CROWDSTRIKE], blocks: [] },
    ]) {
      const step: ResponseStep = stepOf(planFor({ entities, blocklist }), key);

      expect(step.text).toEqual({
        template: STEP_BLOCK_DOMAIN,
        values: { value: DOMAIN },
      });
      expect(step.isOutsideOneUptime).toBe(true);
      expect(step.action).toBeUndefined();
    }
  });

  test("one click with Microsoft Defender: blocked on every machine for 7 days", () => {
    const step: ResponseStep = stepOf(
      planFor({ entities, blocklist: { holders: [DEFENDER], blocks: [] } }),
      key,
    );

    expect(step.text).toEqual({
      template: STEP_BLOCK_EVERYWHERE_WITH,
      values: { value: DOMAIN, product: "Microsoft Defender" },
    });
    expect(step.isOutsideOneUptime).toBe(false);
    expect(step.copyValue).toBe(DOMAIN);
    expect(step.isDone).toBe(false);
    expect(step.action).toEqual({
      kind: ResponseActionKind.BlockIndicator,
      title: ACTION_BLOCK_FOR_7_DAYS,
      block: {
        value: DOMAIN,
        action: SecurityBlockAction.Block,
        reach: SecurityBlockReach.Everywhere,
        duration: SecurityBlockDuration.SevenDays,
      },
    });
  });

  test("on the blocklist and held by nothing yet: waiting, with no button and not done", () => {
    const step: ResponseStep = stepOf(
      planFor({
        entities,
        blocklist: { holders: [DEFENDER], blocks: [blockOf(DOMAIN, [])] },
      }),
      key,
    );

    expect(step.isDone).toBe(false);
    expect(step.action).toBeUndefined();
    expect(step.detail).toEqual({
      template: STEP_BLOCK_EVERYWHERE_WAITING,
      values: { product: "Microsoft Defender" },
    });
  });

  test("held: done by the case, whoever ticks it", () => {
    const step: ResponseStep = stepOf(
      planFor({
        entities,
        blocklist: {
          holders: [DEFENDER],
          blocks: [blockOf("Evil.Example", ["Microsoft Defender"])],
        },
      }),
      key,
    );

    expect(step.isDone).toBe(true);
    expect(step.completion).toBe(ResponseStepCompletion.ByCase);
    expect(step.action).toBeUndefined();
  });

  test("a step OneUptime verified has no button", () => {
    const step: ResponseStep = stepOf(
      planFor({
        entities,
        blocklist: { holders: [DEFENDER], blocks: [] },
        checks: [
          {
            stepKey: key,
            state: SecurityCaseStepCheckState.Verified,
            evidence: {
              sentence: { template: "Held.", values: {} },
              facts: [],
              links: [],
              data: {},
            },
          },
        ],
      }),
      key,
    );

    expect(step.isDone).toBe(true);
    expect(step.action).toBeUndefined();
  });
});

describe("a file's step", () => {
  const key: string = `contain:quarantine-file:${SHA256}`;
  const entities: ResponsePlanInput["entities"] = [
    { type: SecurityEntityType.FileHash, value: SHA256 },
  ];

  test("by hand while nothing connected blocks files", () => {
    const step: ResponseStep = stepOf(
      planFor({ entities, blocklist: { holders: [EDGE], blocks: [] } }),
      key,
    );

    expect(step.text.template).toBe(STEP_QUARANTINE_FILE);
    expect(step.action).toBeUndefined();
  });

  test("blocked and quarantined with Microsoft Defender, for 30 days", () => {
    const step: ResponseStep = stepOf(
      planFor({ entities, blocklist: { holders: [DEFENDER], blocks: [] } }),
      key,
    );

    expect(step.text).toEqual({
      template: STEP_QUARANTINE_FILE_WITH,
      values: { value: SHA256, product: "Microsoft Defender" },
    });
    expect(step.action).toEqual({
      kind: ResponseActionKind.BlockIndicator,
      title: ACTION_BLOCK_FILE,
      block: {
        value: SHA256,
        action: SecurityBlockAction.BlockAndQuarantine,
        reach: SecurityBlockReach.Everywhere,
        duration: SecurityBlockDuration.ThirtyDays,
      },
    });
  });

  test("blocked with CrowdStrike alone, which quarantines nothing: a block, never a quarantine", () => {
    const step: ResponseStep = stepOf(
      planFor({ entities, blocklist: { holders: [CROWDSTRIKE], blocks: [] } }),
      key,
    );

    expect(step.text).toEqual({
      template: STEP_BLOCK_FILE_WITH,
      values: { value: SHA256, product: "CrowdStrike Falcon" },
    });
    expect(step.action?.block?.action).toBe(SecurityBlockAction.Block);
  });

  test("with both: quarantined with Microsoft Defender, and blocked with CrowdStrike too", () => {
    const step: ResponseStep = stepOf(
      planFor({
        entities,
        blocklist: { holders: [CROWDSTRIKE, DEFENDER], blocks: [] },
      }),
      key,
    );

    expect(step.text).toEqual({
      template: STEP_QUARANTINE_FILE_WITH_TWO,
      values: {
        value: SHA256,
        product: "Microsoft Defender",
        otherProduct: "CrowdStrike Falcon",
      },
    });
  });

  test("a SHA-1 CrowdStrike cannot block is done by hand when CrowdStrike is all there is", () => {
    const sha1Key: string = `contain:quarantine-file:${SHA1}`;
    const step: ResponseStep = stepOf(
      planFor({
        entities: [{ type: SecurityEntityType.FileHash, value: SHA1 }],
        blocklist: { holders: [CROWDSTRIKE], blocks: [] },
      }),
      sha1Key,
    );

    expect(step.text.template).toBe(STEP_QUARANTINE_FILE);
    expect(step.action).toBeUndefined();
  });

  test("held by CrowdStrike: done", () => {
    const step: ResponseStep = stepOf(
      planFor({
        entities,
        blocklist: {
          holders: [DEFENDER, CROWDSTRIKE],
          blocks: [
            {
              value: SHA256.toUpperCase(),
              reach: SecurityBlockReach.Everywhere,
              action: SecurityBlockAction.BlockAndQuarantine,
              enforcedAt: ["CrowdStrike Falcon (Production)"],
            },
          ],
        },
      }),
      key,
    );

    expect(step.isDone).toBe(true);
  });
});

describe("a command-and-control address", () => {
  const key: string = `contain:block-ip-everywhere:${ADDRESS}`;
  const entities: ResponsePlanInput["entities"] = [
    { type: SecurityEntityType.IpAddress, value: ADDRESS },
  ];

  test("a scanner's address is blocked at the edge alone: no step on every machine", () => {
    const plan: ResponsePlan = planFor({
      entities,
      mitreTactics: ["TA0001"],
      blocklist: { holders: [DEFENDER], blocks: [] },
    });

    expect(
      plan.steps.some((step: ResponseStep): boolean => {
        return step.key === key;
      }),
    ).toBe(false);
    expect(stepOf(plan, `contain:block-ip:${ADDRESS}`)).toBeTruthy();
  });

  test.each(
    C2_ATTACK_IDS.map((id: string) => {
      return [id];
    }),
  )(
    "a case about command and control (%s) blocks it on every machine too, with Microsoft Defender",
    (id: string) => {
      const plan: ResponsePlan = planFor({
        entities,
        mitreTactics: id.startsWith("TA") ? [id] : [],
        mitreTechniques: id.startsWith("TA") ? [] : [id],
        blocklist: { holders: [DEFENDER], blocks: [] },
      });
      const step: ResponseStep = stepOf(plan, key);

      expect(step.text).toEqual({
        template: STEP_BLOCK_EVERYWHERE_WITH,
        values: { value: ADDRESS, product: "Microsoft Defender" },
      });
      expect(step.action?.block).toEqual({
        value: ADDRESS,
        action: SecurityBlockAction.Block,
        reach: SecurityBlockReach.Everywhere,
        duration: SecurityBlockDuration.SevenDays,
      });
      // Beside the edge's block, never in its place.
      expect(stepOf(plan, `contain:block-ip:${ADDRESS}`)).toBeTruthy();
    },
  );

  test("by hand at an EDR or egress firewall while nothing connected blocks addresses on every machine", () => {
    const step: ResponseStep = stepOf(
      planFor({
        entities,
        mitreTactics: ["TA0011"],
        blocklist: { holders: [EDGE, CROWDSTRIKE], blocks: [] },
      }),
      key,
    );

    expect(step.text).toEqual({
      template: STEP_BLOCK_C2_BY_HAND,
      values: { value: ADDRESS },
    });
    expect(step.isOutsideOneUptime).toBe(true);
  });

  test("blocked at the edge alone is not blocked on every machine", () => {
    const step: ResponseStep = stepOf(
      planFor({
        entities,
        mitreTactics: ["TA0011"],
        blocklist: {
          holders: [DEFENDER, EDGE],
          blocks: [blockOf(ADDRESS, ["Cloudflare"], SecurityBlockReach.Edge)],
        },
      }),
      key,
    );

    expect(step.isDone).toBe(false);
    expect(step.action?.kind).toBe(ResponseActionKind.BlockIndicator);
  });
});

describe("findResponseBlock and getBlockingProducts", () => {
  test("a block everywhere covers the edge; one at the edge never covers everywhere", () => {
    const blocklist: { holders: []; blocks: Array<ResponseBlock> } = {
      holders: [],
      blocks: [blockOf(ADDRESS, [], SecurityBlockReach.Edge)],
    };

    expect(
      findResponseBlock({
        blocklist,
        value: ADDRESS,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toBeNull();
    expect(
      findResponseBlock({
        blocklist,
        value: ADDRESS,
        reach: SecurityBlockReach.Edge,
      }),
    ).toEqual(blocklist.blocks[0]);

    blocklist.blocks = [blockOf("https://Evil.example/Login", [])];

    expect(
      findResponseBlock({
        blocklist,
        value: "https://evil.example/login",
        reach: SecurityBlockReach.Edge,
      }),
    ).toEqual(blocklist.blocks[0]);
  });

  test("each product once, by its own name, whatever the connection is called", () => {
    expect(
      getBlockingProducts([
        CROWDSTRIKE,
        DEFENDER,
        { ...DEFENDER, name: "Microsoft Defender (EU)" },
        EDGE,
      ]),
    ).toEqual(["CrowdStrike Falcon", "Microsoft Defender", "Cloudflare"]);
  });
});
