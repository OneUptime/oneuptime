import { SecurityBlockAction } from "./SecurityBlock";

/*
 * CAN THIS DESTINATION CHALLENGE? (#10350)
 *
 * A challenge asks the person behind a request to pass a check a script
 * cannot: Cloudflare's Managed Challenge, AWS WAF's Challenge action. People
 * pass it and bots do not, so a mistaken challenge costs little, which is
 * why an automatic response policy challenges the noisiest attackers
 * (scanners) rather than blocking them.
 *
 * Not every destination of the blocklist can challenge. A firewall that
 * reads a feed, Azure WAF and Google Cloud Armor can only turn a request
 * away. Each destination says which it is (SecurityBlockDestination's
 * canChallenge; left out, it cannot), and a block says what it wants where
 * a challenge cannot be held:
 *
 *   - a block that falls back (challengeFallsBackToBlock, set by the
 *     automatic response policies) is held there as a Block, for the same
 *     time - "a one-hour block of a scanner costs little", and a challenge
 *     held nowhere at an edge that cannot challenge would leave that edge
 *     open;
 *   - any other challenge - a person's Challenge Instead, chosen so that
 *     nobody is turned away - is not held there, and the destination says
 *     why ("Azure WAF cannot challenge"), as it always has.
 *
 * Pure, so the reconciler (which hands each destination its entries), a
 * destination that serves its list from the blocks themselves (a feed),
 * and the Dashboard (which says "blocked there instead") read one rule.
 */

// A destination as this rule reads it: whether it can challenge.
export interface SecurityBlockChallengeDestination {
  // Left out, or anything but true: it cannot.
  canChallenge?: boolean | null | undefined;
}

// A block as this rule reads it: what it does, and whether a challenge of it falls back to a block.
export interface SecurityBlockChallengeShape {
  action?: SecurityBlockAction | string | null | undefined;
  challengeFallsBackToBlock?: boolean | null | undefined;
}

// Whether a destination can challenge: only one that says so can.
export function canSecurityBlockDestinationChallenge(
  destination: SecurityBlockChallengeDestination,
): boolean {
  return destination.canChallenge === true;
}

/*
 * What a destination is to do with a block: Block, or Challenge. A block's
 * own action, except a challenge that falls back to a block at a destination
 * that cannot challenge, which it holds as a Block. A challenge that does
 * not fall back stays a Challenge, for the destination to refuse (its
 * supports()) with why.
 */
export function getSecurityBlockActionAt(
  block: SecurityBlockChallengeShape,
  destination: SecurityBlockChallengeDestination,
): SecurityBlockAction {
  if (block.action !== SecurityBlockAction.Challenge) {
    return SecurityBlockAction.Block;
  }

  if (
    block.challengeFallsBackToBlock === true &&
    !canSecurityBlockDestinationChallenge(destination)
  ) {
    return SecurityBlockAction.Block;
  }

  return SecurityBlockAction.Challenge;
}

// Whether a destination holds a block's challenge as a block instead.
export function isSecurityBlockChallengeHeldAsBlockAt(
  block: SecurityBlockChallengeShape,
  destination: SecurityBlockChallengeDestination,
): boolean {
  return (
    block.action === SecurityBlockAction.Challenge &&
    getSecurityBlockActionAt(block, destination) === SecurityBlockAction.Block
  );
}
