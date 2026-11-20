import ObjectID from "../../../../../Types/ObjectID";
import { ResponseLink } from "../../../../../Types/SecurityCase/SecurityCaseResponseLink";
import { SecurityCaseStepCheckSentence } from "../../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";

/*
 * THE BLOCKS OF AN ADDRESS THAT ARE IN FORCE AT A DESTINATION (#10340): the
 * strongest evidence for a Response Plan's "Block this address" step, which
 * makes it Verified - an active block, applied and read back where it is
 * enforced (Cloudflare, AWS WAF, a firewall reading the blocklist's feed).
 * The app's own requests still have the last word: one from the address
 * after the block is a block that is not holding (BlockAddressStepCheck).
 *
 * Each source of such blocks plugs in here. The blocklist (#10338) and its
 * destinations (#10342 and after) add theirs to ADDRESS_BLOCK_SOURCES:
 * until then there is none, and a block made anywhere is judged by the
 * app's requests alone - it looks done, and a person confirms it.
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
}

export interface AddressBlockSource {
  // For the logs: "Security blocklist".
  name: string;
  /*
   * The address's blocks in force, each applied and read back. Throws when
   * the source cannot be read: the step then cannot be verified from it.
   */
  readBlocks(data: {
    projectId: ObjectID;
    address: string;
    now: Date;
  }): Promise<Array<AddressBlockEvidence>>;
}

// The sources of blocks: the blocklist's destinations add theirs here (#10338, #10342).
export const ADDRESS_BLOCK_SOURCES: Array<AddressBlockSource> = [];

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
