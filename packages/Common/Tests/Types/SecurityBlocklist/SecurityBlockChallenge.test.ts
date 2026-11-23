import { SecurityBlockAction } from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  canSecurityBlockDestinationChallenge,
  getSecurityBlockActionAt,
  isSecurityBlockChallengeHeldAsBlockAt,
} from "../../../Types/SecurityBlocklist/SecurityBlockChallenge";
import { describe, expect, test } from "@jest/globals";

/*
 * Can this destination challenge? (#10350): a destination says whether it
 * can, and a block whether its challenge falls back to a block where it
 * cannot. An automatic response policy's challenge is held as a block for
 * the same time at an edge that cannot challenge; a person's challenge is
 * never turned into a block behind their back.
 */

const CAN: { canChallenge: boolean } = { canChallenge: true };
const CANNOT: { canChallenge: boolean } = { canChallenge: false };

describe("canSecurityBlockDestinationChallenge", () => {
  test("only a destination that says it can, can", () => {
    expect(canSecurityBlockDestinationChallenge(CAN)).toBe(true);
    expect(canSecurityBlockDestinationChallenge(CANNOT)).toBe(false);
  });

  test("a destination that says nothing cannot: a feed or a firewall list written before the contract", () => {
    expect(canSecurityBlockDestinationChallenge({})).toBe(false);
    expect(canSecurityBlockDestinationChallenge({ canChallenge: null })).toBe(
      false,
    );
    expect(
      canSecurityBlockDestinationChallenge({ canChallenge: undefined }),
    ).toBe(false);
  });
});

describe("getSecurityBlockActionAt", () => {
  test("a block is a block everywhere", () => {
    for (const destination of [CAN, CANNOT, {}]) {
      for (const challengeFallsBackToBlock of [true, false, undefined]) {
        expect(
          getSecurityBlockActionAt(
            { action: SecurityBlockAction.Block, challengeFallsBackToBlock },
            destination,
          ),
        ).toBe(SecurityBlockAction.Block);
      }
    }
  });

  test("a block written without an action is a block, as the reconciler reads it", () => {
    expect(getSecurityBlockActionAt({}, CAN)).toBe(SecurityBlockAction.Block);
    expect(getSecurityBlockActionAt({ action: null }, CANNOT)).toBe(
      SecurityBlockAction.Block,
    );
  });

  test("a challenge stays a challenge where it can be held, whether it falls back or not", () => {
    expect(
      getSecurityBlockActionAt(
        {
          action: SecurityBlockAction.Challenge,
          challengeFallsBackToBlock: true,
        },
        CAN,
      ),
    ).toBe(SecurityBlockAction.Challenge);
    expect(
      getSecurityBlockActionAt(
        {
          action: SecurityBlockAction.Challenge,
          challengeFallsBackToBlock: false,
        },
        CAN,
      ),
    ).toBe(SecurityBlockAction.Challenge);
  });

  test("a policy's challenge is held as a block where the edge cannot challenge", () => {
    expect(
      getSecurityBlockActionAt(
        {
          action: SecurityBlockAction.Challenge,
          challengeFallsBackToBlock: true,
        },
        CANNOT,
      ),
    ).toBe(SecurityBlockAction.Block);
    expect(
      getSecurityBlockActionAt(
        {
          action: SecurityBlockAction.Challenge,
          challengeFallsBackToBlock: true,
        },
        {},
      ),
    ).toBe(SecurityBlockAction.Block);
  });

  test("a person's challenge stays a challenge where it cannot be held, for the destination to refuse with why", () => {
    for (const challengeFallsBackToBlock of [false, null, undefined]) {
      expect(
        getSecurityBlockActionAt(
          { action: SecurityBlockAction.Challenge, challengeFallsBackToBlock },
          CANNOT,
        ),
      ).toBe(SecurityBlockAction.Challenge);
    }
  });
});

describe("isSecurityBlockChallengeHeldAsBlockAt", () => {
  test("says when a challenge is held as a block instead", () => {
    expect(
      isSecurityBlockChallengeHeldAsBlockAt(
        {
          action: SecurityBlockAction.Challenge,
          challengeFallsBackToBlock: true,
        },
        CANNOT,
      ),
    ).toBe(true);
  });

  test("never for a challenge held as one, a challenge that does not fall back, or a block", () => {
    expect(
      isSecurityBlockChallengeHeldAsBlockAt(
        {
          action: SecurityBlockAction.Challenge,
          challengeFallsBackToBlock: true,
        },
        CAN,
      ),
    ).toBe(false);
    expect(
      isSecurityBlockChallengeHeldAsBlockAt(
        {
          action: SecurityBlockAction.Challenge,
          challengeFallsBackToBlock: false,
        },
        CANNOT,
      ),
    ).toBe(false);
    expect(
      isSecurityBlockChallengeHeldAsBlockAt(
        { action: SecurityBlockAction.Block, challengeFallsBackToBlock: true },
        CANNOT,
      ),
    ).toBe(false);
  });
});
