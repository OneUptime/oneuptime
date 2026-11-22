import ObjectID from "../../../../../Types/ObjectID";
import { ResponseLink } from "../../../../../Types/SecurityCase/SecurityCaseResponseLink";
import { SecurityCaseStepCheckSentence } from "../../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import AwsWafBlockedRequests from "./AwsWafBlockedRequests";
import SecurityBlocklistAddressBlockSource from "./BlocklistAddressBlocks";

/*
 * THE BLOCKS OF AN ADDRESS THAT ARE IN FORCE AT A DESTINATION (#10340): the
 * strongest evidence for a Response Plan's "Block this address" step, which
 * makes it Verified - an active block, applied and read back where it is
 * enforced (Cloudflare, AWS WAF, a firewall reading the blocklist's feed).
 * The app's own requests still have the last word: one from the address
 * after the block is a block that is not holding (BlockAddressStepCheck).
 *
 * Each source of such blocks plugs in here. The project's Blocklist (#10338)
 * is one (#10562): its destinations apply each block and read it back, so
 * a block made from the case's step, from the Blocklist page or by a
 * playbook is checked the same way. A block made by hand anywhere else is
 * judged by the app's requests alone - it looks done, and a person
 * confirms it.
 */

export interface AddressBlockEvidence {
  // Where the block is enforced, as its product names it: "Cloudflare".
  destination: string;
  // When it was applied there and read back.
  appliedAt: Date;
  // What the step says of it, in the source's own words (keys of StepCheckWords' kind).
  sentence: SecurityCaseStepCheckSentence;
  // The block where it is enforced, or on the blocklist.
  link?: ResponseLink | undefined;
  /*
   * What the destination says of its own about the block, beside the
   * sentence: Cloudflare, how many of the address's requests its rule
   * stopped since the block (#10343). Facts add to the evidence; they never
   * decide the step.
   */
  facts?: Array<SecurityCaseStepCheckSentence> | undefined;
  /*
   * A block the source records that no destination holds (#10562): never
   * evidence that the address is blocked. The step says it is not enforced
   * anywhere yet, and keeps what the app's requests say.
   */
  isNotEnforced?: boolean | undefined;
  // Of one not enforced: a destination is still applying it, so the step looks again soon.
  isApplying?: boolean | undefined;
}

export interface AddressBlockSource {
  // For the logs: "Security blocklist".
  name: string;
  /*
   * The address's blocks in force, each applied and read back - and any it
   * records that nothing holds, said as such (isNotEnforced). Throws when
   * the source cannot be read: the step then says OneUptime could not
   * check it just now.
   */
  readBlocks(data: {
    projectId: ObjectID;
    address: string;
    now: Date;
  }): Promise<Array<AddressBlockEvidence>>;
}

/*
 * The sources of blocks: the project's Blocklist (#10338, #10562), and AWS
 * WAF's own word - the requests its web ACLs turned away, from those it
 * sampled (#10344). A destination read apart from the Blocklist adds its own.
 */
export const ADDRESS_BLOCK_SOURCES: Array<AddressBlockSource> = [
  SecurityBlocklistAddressBlockSource,
  AwsWafBlockedRequests,
];

// The evidence that the address is blocked: what a destination holds, never what it only records.
export function getEnforcedAddressBlocks(
  blocks: ReadonlyArray<AddressBlockEvidence>,
): Array<AddressBlockEvidence> {
  return blocks.filter((block: AddressBlockEvidence): boolean => {
    return !block.isNotEnforced;
  });
}

export default class AddressBlocks {
  public static async read(data: {
    projectId: ObjectID;
    address: string;
    now: Date;
    sources?: ReadonlyArray<AddressBlockSource> | undefined;
  }): Promise<Array<AddressBlockEvidence>> {
    const blocks: Array<AddressBlockEvidence> = [];

    for (const source of data.sources || ADDRESS_BLOCK_SOURCES) {
      blocks.push(
        ...(await source.readBlocks({
          projectId: data.projectId,
          address: data.address,
          now: data.now,
        })),
      );
    }

    return blocks;
  }
}
