import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  getSecurityBlockValueKey,
  isSecurityBlockAction,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import CrowdStrikeFalconResponseClient, {
  CrowdStrikeIoc,
  CrowdStrikeIocType,
  CrowdStrikeIocWriteResult,
} from "../../SecurityEvent/Response/CrowdStrikeFalconResponseClient";
import SecurityBlockDestination, {
  SecurityBlockCapacity,
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockSupport,
  SecurityBlockEndMove,
  SecurityBlockWriteResult,
} from "../SecurityBlockDestination";

/*
 * THE BLOCKLIST'S FILES ON EVERY COMPUTER, THROUGH CROWDSTRIKE FALCON
 * (#10346): one destination per CrowdStrike Falcon connection whose Block
 * files with CrowdStrike is on. Every call goes through the connection's
 * own client (CrowdStrikeFalconResponseClient), with the credential it
 * holds.
 *
 * Each file block is one custom IOC of its SHA-256 or MD5 hash, set to
 * prevent on Windows, Mac and Linux - Falcon stops the file running, and
 * quarantines it as the host's prevention policy says. Falcon takes no
 * SHA-1, and on a computer only detects a domain or an address - prevent is
 * for hashes there - so the destination holds files alone and says why of
 * the rest: such a block is "Not applied" here, and enforced wherever else
 * holds it.
 *
 * Its expiration is the block's. Past it Falcon sets the IOC to no action,
 * which read back is an IOC that has ended: the reconciler removes it, or -
 * for a block renewed - sets it to prevent again with the new end
 * (moveEnds()).
 *
 * OneUptime's own, and only them: an IOC it adds has the source
 * "OneUptime" and says in its description which connection added it, and
 * with which action ([oneuptime:<connection>:<action>]); readBack() returns
 * no other.
 */

const IOC_TYPES: Partial<
  Record<SecurityBlockIndicatorType, CrowdStrikeIocType>
> = {
  [SecurityBlockIndicatorType.FileSha256]: "sha256",
  [SecurityBlockIndicatorType.FileMd5]: "md5",
};

// What every write says in Falcon's audit trail.
export const CROWDSTRIKE_IOC_COMMENT: string = "OneUptime blocklist";

// The start of what an IOC's description carries to say this connection added it.
export function getCrowdStrikeIocMarker(connectionId: string): string {
  return `[oneuptime:${connectionId}:`;
}

export default class CrowdStrikeBlockDestination
  implements SecurityBlockDestination
{
  public readonly key: string;
  public readonly provider: SecurityBlockDestinationProvider =
    SecurityBlockDestinationProvider.CrowdStrike;
  public readonly name: string;
  public readonly connectionId: ObjectID;
  public readonly enforcesOnEveryMachine: boolean = true;
  // Falcon blocks the file; its prevention policy, not the IOC, quarantines it.
  public readonly quarantinesFiles: boolean = false;

  private readonly client: CrowdStrikeFalconResponseClient;
  private readonly marker: string;

  public constructor(data: {
    connectionId: ObjectID;
    name: string;
    client: CrowdStrikeFalconResponseClient;
  }) {
    this.connectionId = data.connectionId;
    this.key = `CrowdStrike:${data.connectionId.toString()}`;
    this.name = data.name;
    this.client = data.client;
    this.marker = getCrowdStrikeIocMarker(data.connectionId.toString());
  }

  public supports(entry: {
    indicatorType: SecurityBlockIndicatorType;
    action: SecurityBlockAction;
    value: string;
  }): SecurityBlockSupport {
    if (IOC_TYPES[entry.indicatorType]) {
      return entry.action === SecurityBlockAction.Challenge
        ? {
            isSupported: false,
            reason: "CrowdStrike Falcon cannot challenge, only block",
          }
        : { isSupported: true };
    }

    switch (entry.indicatorType) {
      case SecurityBlockIndicatorType.FileSha1:
        return {
          isSupported: false,
          reason:
            "CrowdStrike Falcon blocks a file by its SHA-256 or MD5 hash, never its SHA-1",
        };
      case SecurityBlockIndicatorType.Url:
        return {
          isSupported: false,
          reason: "CrowdStrike Falcon has no URL indicators",
        };
      default:
        return {
          isSupported: false,
          reason:
            "CrowdStrike Falcon only detects a domain or an address on a computer, and never blocks it",
        };
    }
  }

  // Falcon documents no limit worth counting on the IOCs a customer holds.
  public async capacity(): Promise<SecurityBlockCapacity> {
    return { limit: null };
  }

  public async readBack(): Promise<Array<SecurityBlockHeldItem>> {
    const held: Array<SecurityBlockHeldItem> = [];

    for (const ioc of await this.client.listIocs()) {
      const action: SecurityBlockAction | null = this.readAction(ioc);

      if (!action) {
        continue;
      }

      const isPreventing: boolean = ioc.action === "prevent" && !ioc.isExpired;

      held.push({
        value: getSecurityBlockValueKey(ioc.value),
        action,
        providerRef: ioc.id,
        /*
         * An IOC that no longer prevents - Falcon set it to no action at its
         * expiration, or someone changed it - has ended, and is not in force:
         * the reconciler removes it, or renews it for a block still active.
         */
        ...(isPreventing
          ? { expiresAt: ioc.expiration }
          : { expiresAt: new Date(0), isPropagating: true }),
      });
    }

    return held;
  }

  public async apply(
    entries: Array<SecurityBlockEntry>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    const results: Array<CrowdStrikeIocWriteResult> =
      await this.client.createIocs(
        entries.map((entry: SecurityBlockEntry) => {
          return {
            type: IOC_TYPES[entry.indicatorType] || "sha256",
            value: entry.value,
            description: this.describe(entry),
            expiration: entry.expiresAt,
          };
        }),
        CROWDSTRIKE_IOC_COMMENT,
      );

    return entries.map(
      (entry: SecurityBlockEntry, index: number): SecurityBlockWriteResult => {
        const result: CrowdStrikeIocWriteResult | undefined = results[index];

        return {
          value: entry.value,
          action: entry.action,
          isDone: Boolean(result?.isDone),
          ...(result?.id ? { providerRef: result.id } : {}),
          ...(result && !result.isDone
            ? {
                error: `CrowdStrike Falcon refused it: ${result.error || "no reason given"}`,
              }
            : {}),
        };
      },
    );
  }

  public async remove(
    items: Array<SecurityBlockHeldItem>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    const ids: Array<string> = items
      .map((item: SecurityBlockHeldItem): string => {
        return item.providerRef || "";
      })
      .filter(Boolean);

    await this.client.deleteIocs(ids, CROWDSTRIKE_IOC_COMMENT);

    return items.map(
      (item: SecurityBlockHeldItem): SecurityBlockWriteResult => {
        return item.providerRef
          ? { value: item.value, action: item.action, isDone: true }
          : {
              value: item.value,
              action: item.action,
              isDone: false,
              error:
                "OneUptime does not know which CrowdStrike Falcon IOC holds it",
            };
      },
    );
  }

  // A renewed block's IOC: its expiration moved, and set to prevent again.
  public async moveEnds(
    updates: Array<SecurityBlockEndMove>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    const known: Array<SecurityBlockEndMove> = updates.filter(
      (update: SecurityBlockEndMove): boolean => {
        return Boolean(update.item.providerRef);
      },
    );

    await this.client.updateIocs(
      known.map((update: SecurityBlockEndMove) => {
        return {
          id: update.item.providerRef!,
          description: this.describe(update.entry),
          expiration: update.entry.expiresAt,
        };
      }),
      CROWDSTRIKE_IOC_COMMENT,
    );

    return updates.map(
      (update: SecurityBlockEndMove): SecurityBlockWriteResult => {
        return update.item.providerRef
          ? {
              value: update.entry.value,
              action: update.entry.action,
              isDone: true,
            }
          : {
              value: update.entry.value,
              action: update.entry.action,
              isDone: false,
              error:
                "OneUptime does not know which CrowdStrike Falcon IOC holds it",
            };
      },
    );
  }

  // What an IOC's description says: the block's comment, and whose it is, with which action.
  private describe(entry: SecurityBlockEntry): string {
    return `${entry.comment} ${this.marker}${entry.action}]`;
  }

  // The action an IOC this connection added was made for, or null for one it did not add.
  private readAction(ioc: CrowdStrikeIoc): SecurityBlockAction | null {
    const start: number = ioc.description.indexOf(this.marker);

    if (start === -1) {
      return null;
    }

    const rest: string = ioc.description.slice(start + this.marker.length);
    const end: number = rest.indexOf("]");
    const action: string = end === -1 ? "" : rest.slice(0, end);

    return isSecurityBlockAction(action) ? action : SecurityBlockAction.Block;
  }
}
