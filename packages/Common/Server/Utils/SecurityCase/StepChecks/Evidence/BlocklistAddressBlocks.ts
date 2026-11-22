import SecurityBlock from "../../../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockState,
  SecurityBlockValue,
  isSecurityBlockInForce,
  readSecurityBlockValue,
} from "../../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockDestinationProvider,
  SecurityBlockEnforcementState,
  isSecurityBlockEnforcementHolding,
} from "../../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { ResponseLinkKind } from "../../../../../Types/SecurityCase/SecurityCaseResponseLink";
import NetworkAddressBlockUtil from "../../../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  CHECK_BLOCK_CHALLENGED_AT,
  CHECK_BLOCK_ENFORCED_AT,
  CHECK_BLOCK_NOT_ENFORCED,
  CHECK_BLOCK_RANGE_CHALLENGED_AT,
  CHECK_BLOCK_RANGE_ENFORCED_AT,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import SecurityBlockEnforcementService from "../../../../Services/SecurityBlockEnforcementService";
import SecurityBlockService from "../../../../Services/SecurityBlockService";
import { sentence } from "../StepCheck";
import { AddressBlockEvidence, AddressBlockSource } from "./AddressBlocks";

// The products that block on every machine, as an enforcement row names them (#10346).
const EVERY_MACHINE_PROVIDERS: ReadonlyArray<string> = [
  SecurityBlockDestinationProvider.MicrosoftDefender,
  SecurityBlockDestinationProvider.CrowdStrike,
];

/*
 * THE PROJECT'S BLOCKLIST, AS A SOURCE OF AN ADDRESS'S BLOCKS (#10562).
 *
 * The block step of a case's Response Plan is Checked by OneUptime when a
 * destination holds a block of the address and has read it back: the
 * blocks of the address, or of a range that holds it, that are active and
 * not past their expiry (SecurityBlock), each with where it is enforced
 * (SecurityBlockEnforcement). One piece of evidence for each destination
 * that holds one - Applied, and confirmed by a read back within ten
 * minutes - naming the destination, since when it holds it and when it
 * last confirmed it, and linking to the block on the Blocklist.
 *
 * A block the Blocklist records that no destination holds is no evidence
 * that the address is blocked: it is said as one (isNotEnforced), so the
 * step says it is not enforced anywhere yet and stays Looks Done or Not
 * Done Yet - and looks again within a minute while a destination is still
 * applying it (isApplying). A read that fails throws: the step then says
 * OneUptime could not check it just now, never "not blocked".
 */

// What the Blocklist reads of a block, to say where it holds.
const BLOCK_SELECT: {
  _id: true;
  value: true;
  indicatorType: true;
  action: true;
  state: true;
  expiresAt: true;
  createdAt: true;
} = {
  _id: true,
  value: true,
  indicatorType: true,
  action: true,
  state: true,
  expiresAt: true,
  createdAt: true,
};

// Whether a block of `blockValue` holds the address: the address itself, or a range around it.
export function doesBlockHoldAddress(
  blockValue: string | undefined | null,
  address: SecurityBlockValue,
): boolean {
  const read: SecurityBlockValue | null = readSecurityBlockValue(blockValue);

  if (!read) {
    return false;
  }

  return (
    read.value === address.value ||
    NetworkAddressBlockUtil.containsBlock(read.block, address.block)
  );
}

// What one destination's hold of a block says, as the step's evidence.
export function getHeldBlockEvidence(data: {
  address: string;
  block: Pick<SecurityBlock, "value" | "action" | "createdAt">;
  row: Pick<
    SecurityBlockEnforcement,
    "destinationName" | "appliedAt" | "lastConfirmedAt"
  >;
}): AddressBlockEvidence {
  const destination: string = (data.row.destinationName || "").trim();
  const appliedAt: Date = new Date(
    data.row.appliedAt ||
      data.row.lastConfirmedAt ||
      data.block.createdAt ||
      Date.now(),
  );
  const confirmedAt: Date = new Date(data.row.lastConfirmedAt || appliedAt);
  const read: SecurityBlockValue | null = readSecurityBlockValue(
    data.block.value,
  );
  const isRange: boolean = Boolean(
    read && read.indicatorType === SecurityBlockIndicatorType.IpRange,
  );
  const isChallenge: boolean =
    data.block.action === SecurityBlockAction.Challenge;

  return {
    destination,
    appliedAt,
    sentence: sentence(
      isRange
        ? isChallenge
          ? CHECK_BLOCK_RANGE_CHALLENGED_AT
          : CHECK_BLOCK_RANGE_ENFORCED_AT
        : isChallenge
          ? CHECK_BLOCK_CHALLENGED_AT
          : CHECK_BLOCK_ENFORCED_AT,
      {
        address: data.address,
        destination,
        ...(isRange && read ? { range: read.value } : {}),
      },
      { times: { since: appliedAt, confirmed: confirmedAt } },
    ),
    link: {
      kind: ResponseLinkKind.OpenBlocklist,
      value: read?.value || data.address,
    },
  };
}

export const SecurityBlocklistAddressBlockSource: AddressBlockSource = {
  name: "Security blocklist",
  readBlocks: async (data: {
    projectId: ObjectID;
    address: string;
    now: Date;
  }): Promise<Array<AddressBlockEvidence>> => {
    const address: SecurityBlockValue | null = readSecurityBlockValue(
      data.address,
    );

    if (!address) {
      return [];
    }

    // The blocks that hold the address: its own, and every active range (a range holds it by containment).
    const [own, ranges]: [Array<SecurityBlock>, Array<SecurityBlock>] =
      await Promise.all([
        SecurityBlockService.findBy({
          query: {
            projectId: data.projectId,
            state: SecurityBlockState.Active,
            value: address.value,
          },
          select: BLOCK_SELECT,
          skip: 0,
          // One at the edge and one on every machine (#10346) at most.
          limit: 2,
          props: { isRoot: true },
        }),
        SecurityBlockService.findBy({
          query: {
            projectId: data.projectId,
            state: SecurityBlockState.Active,
            indicatorType: SecurityBlockIndicatorType.IpRange,
          },
          select: BLOCK_SELECT,
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        }),
      ]);

    const holding: Array<SecurityBlock> = [...own, ...ranges].filter(
      (block: SecurityBlock): boolean => {
        return (
          Boolean(block.id) &&
          isSecurityBlockInForce(block, data.now) &&
          doesBlockHoldAddress(block.value, address)
        );
      },
    );

    if (holding.length === 0) {
      return [];
    }

    const rows: Array<SecurityBlockEnforcement> =
      await SecurityBlockEnforcementService.findForBlocks({
        projectId: data.projectId,
        securityBlockIds: holding.map((block: SecurityBlock): ObjectID => {
          return block.id!;
        }),
      });

    const evidence: Array<AddressBlockEvidence> = [];

    for (const block of holding) {
      /*
       * Where the address is blocked at the edge: a product on every machine
       * (#10346) stops the machines reaching the address, never the
       * address's requests reaching the app, so its hold is not this step's.
       */
      const ofBlock: Array<SecurityBlockEnforcement> = rows.filter(
        (row: SecurityBlockEnforcement): boolean => {
          return (
            row.securityBlockId?.toString() === block.id!.toString() &&
            !EVERY_MACHINE_PROVIDERS.includes(row.provider || "")
          );
        },
      );
      const held: Array<SecurityBlockEnforcement> = ofBlock.filter(
        (row: SecurityBlockEnforcement): boolean => {
          return isSecurityBlockEnforcementHolding(row, data.now);
        },
      );

      for (const row of held) {
        evidence.push(
          getHeldBlockEvidence({ address: data.address, block, row }),
        );
      }

      if (held.length > 0) {
        continue;
      }

      // Recorded, and held nowhere: never evidence that the address is blocked.
      evidence.push({
        destination: "",
        appliedAt: new Date(block.createdAt || data.now),
        sentence: sentence(CHECK_BLOCK_NOT_ENFORCED, {
          value: block.value || data.address,
        }),
        link: {
          kind: ResponseLinkKind.OpenBlocklist,
          value: block.value || data.address,
        },
        isNotEnforced: true,
        isApplying: ofBlock.some((row: SecurityBlockEnforcement): boolean => {
          return (
            row.state === SecurityBlockEnforcementState.Pending ||
            row.state === SecurityBlockEnforcementState.Applied
          );
        }),
      });
    }

    return evidence;
  },
};

export default SecurityBlocklistAddressBlockSource;
