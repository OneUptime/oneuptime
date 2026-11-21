import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockValue,
  getSecurityBlockValueKey,
  readSecurityBlockValue,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import MicrosoftDefenderEndpointClient, {
  DEFENDER_MAX_ACTIVE_INDICATORS,
  DefenderIndicator,
  DefenderIndicatorAction,
  DefenderIndicatorImportResult,
  DefenderIndicatorSubmission,
  DefenderIndicatorType,
} from "../../SecurityEvent/Response/MicrosoftDefenderEndpointClient";
import SecurityBlockDestination, {
  SecurityBlockCapacity,
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockSupport,
  SecurityBlockUpdate,
  SecurityBlockWriteResult,
} from "../SecurityBlockDestination";

/*
 * THE BLOCKLIST ON EVERY MACHINE, THROUGH MICROSOFT DEFENDER FOR ENDPOINT
 * (#10346): one destination per Microsoft Defender XDR connection whose
 * Block domains, addresses and files with Defender is on. Every call goes
 * through the connection's own client (MicrosoftDefenderEndpointClient),
 * with the credential the connection holds.
 *
 * Each block is one indicator, on every device (no device group):
 *
 *   a domain      DomainName, Block - with every name under it, as Defender
 *                 matches a domain;
 *   a URL         Url, Block - matched in full in Microsoft Edge, and by its
 *                 domain in other browsers, for HTTPS;
 *   an address    IpAddress, Block - only for an address blocked everywhere
 *                 (enforcesOnEveryMachine), one address at a time: Defender
 *                 takes no range, and an IPv6 address written in all eight
 *                 groups;
 *   a file        FileSha256, FileSha1 or FileMd5: Block, or
 *                 BlockAndRemediate to quarantine the copies it finds too.
 *
 * Its expirationTime is the block's, so Defender deletes the indicator by
 * itself when the block ends, even if OneUptime cannot reach Defender then;
 * a block renewed at OneUptime is renewed there (update()).
 *
 * OneUptime's own, and only them: an indicator it adds is filed under the
 * application "OneUptime" and says, in its description, which connection
 * added it ([oneuptime:<connection>]), and readBack() returns no other -
 * so the reconciler never touches an indicator a person made, or another
 * project's on the same tenant.
 */

// What an indicator's description carries to say this connection added it.
export function getDefenderIndicatorMarker(connectionId: string): string {
  return `[oneuptime:${connectionId}]`;
}

// An address as Defender takes it: IPv4 dotted, IPv6 in all eight groups.
export function toDefenderAddress(value: string): string {
  const read: SecurityBlockValue | null = readSecurityBlockValue(value);

  if (!read) {
    return value;
  }

  if (read.block.family === 4) {
    return read.value;
  }

  return read.block.groups
    .map((group: number): string => {
      return group.toString(16);
    })
    .join(":");
}

const INDICATOR_TYPES: Partial<
  Record<SecurityBlockIndicatorType, DefenderIndicatorType>
> = {
  [SecurityBlockIndicatorType.IpAddress]: DefenderIndicatorType.IpAddress,
  [SecurityBlockIndicatorType.Domain]: DefenderIndicatorType.DomainName,
  [SecurityBlockIndicatorType.Url]: DefenderIndicatorType.Url,
  [SecurityBlockIndicatorType.FileSha256]: DefenderIndicatorType.FileSha256,
  [SecurityBlockIndicatorType.FileSha1]: DefenderIndicatorType.FileSha1,
  [SecurityBlockIndicatorType.FileMd5]: DefenderIndicatorType.FileMd5,
};

// The block's action as an indicator's, and back.
function toDefenderAction(action: SecurityBlockAction): DefenderIndicatorAction {
  return action === SecurityBlockAction.BlockAndQuarantine
    ? DefenderIndicatorAction.BlockAndRemediate
    : DefenderIndicatorAction.Block;
}

function fromDefenderAction(action: string): string {
  switch (action) {
    case DefenderIndicatorAction.BlockAndRemediate:
      return SecurityBlockAction.BlockAndQuarantine;
    case DefenderIndicatorAction.Block:
      return SecurityBlockAction.Block;
    default:
      /*
       * One of OneUptime's set to something it never asks for - Audit,
       * Allowed - by someone at Defender: held as that, so no block wants
       * it, the reconciler removes it, and adds the block back as it was.
       */
      return action;
  }
}

export default class MicrosoftDefenderBlockDestination
  implements SecurityBlockDestination
{
  public readonly key: string;
  public readonly provider: SecurityBlockDestinationProvider =
    SecurityBlockDestinationProvider.MicrosoftDefender;
  public readonly name: string;
  public readonly connectionId: ObjectID;
  public readonly enforcesOnEveryMachine: boolean = true;
  public readonly quarantinesFiles: boolean = true;

  private readonly client: MicrosoftDefenderEndpointClient;
  private readonly marker: string;

  /*
   * The last list read in this pass: capacity() and the readBack() right
   * after it read the tenant once. A read after a write reads again.
   */
  private listed: Array<DefenderIndicator> | null = null;

  public constructor(data: {
    connectionId: ObjectID;
    name: string;
    client: MicrosoftDefenderEndpointClient;
  }) {
    this.connectionId = data.connectionId;
    this.key = `MicrosoftDefender:${data.connectionId.toString()}`;
    this.name = data.name;
    this.client = data.client;
    this.marker = getDefenderIndicatorMarker(data.connectionId.toString());
  }

  public supports(entry: {
    indicatorType: SecurityBlockIndicatorType;
    action: SecurityBlockAction;
    value: string;
  }): SecurityBlockSupport {
    if (entry.action === SecurityBlockAction.Challenge) {
      return {
        isSupported: false,
        reason: "Microsoft Defender cannot challenge, only block",
      };
    }

    if (entry.indicatorType === SecurityBlockIndicatorType.IpRange) {
      return {
        isSupported: false,
        reason:
          "Microsoft Defender blocks one address at a time, never a range",
      };
    }

    if (!INDICATOR_TYPES[entry.indicatorType]) {
      return {
        isSupported: false,
        reason: "Microsoft Defender cannot block this",
      };
    }

    return { isSupported: true };
  }

  public async capacity(): Promise<SecurityBlockCapacity> {
    this.listed = await this.client.listIndicators();

    return {
      limit: DEFENDER_MAX_ACTIVE_INDICATORS,
      fullReason: `Microsoft Defender holds ${DEFENDER_MAX_ACTIVE_INDICATORS.toLocaleString("en-US")} indicators at most, the tenant's own included`,
    };
  }

  public async readBack(): Promise<Array<SecurityBlockHeldItem>> {
    const listed: Array<DefenderIndicator> =
      this.listed || (await this.client.listIndicators());

    // Read once for capacity() and the readBack() after it; afresh after a write.
    this.listed = null;

    const held: Array<SecurityBlockHeldItem> = [];

    for (const indicator of listed) {
      if (!indicator.description.includes(this.marker)) {
        continue;
      }

      held.push({
        value: getSecurityBlockValueKey(indicator.indicatorValue),
        action: fromDefenderAction(indicator.action) as SecurityBlockAction,
        providerRef: indicator.id,
        expiresAt: indicator.expirationTime,
      });
    }

    return held;
  }

  public async apply(
    entries: Array<SecurityBlockEntry>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    this.listed = null;

    const results: Array<DefenderIndicatorImportResult> =
      await this.client.importIndicators(
        entries.map((entry: SecurityBlockEntry): DefenderIndicatorSubmission => {
          return this.toSubmission(entry);
        }),
      );

    return entries.map(
      (entry: SecurityBlockEntry, index: number): SecurityBlockWriteResult => {
        const result: DefenderIndicatorImportResult | undefined =
          results[index];

        return {
          value: entry.value,
          action: entry.action,
          isDone: Boolean(result && !result.isFailed),
          ...(result?.id ? { providerRef: result.id } : {}),
          ...(result?.isFailed
            ? {
                error: `Microsoft Defender refused it: ${result.failureReason || "no reason given"}`,
              }
            : {}),
        };
      },
    );
  }

  public async remove(
    items: Array<SecurityBlockHeldItem>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    this.listed = null;

    const ids: Array<string> = items
      .map((item: SecurityBlockHeldItem): string => {
        return item.providerRef || "";
      })
      .filter(Boolean);

    const failures: Map<string, string> = new Map(
      (await this.client.deleteIndicators(ids)).map(
        (failure: { id: string; error: string }): [string, string] => {
          return [failure.id, failure.error];
        },
      ),
    );

    return items.map((item: SecurityBlockHeldItem): SecurityBlockWriteResult => {
      const error: string | undefined = item.providerRef
        ? failures.get(item.providerRef)
        : "OneUptime does not know which Microsoft Defender indicator holds it";

      return {
        value: item.value,
        action: item.action,
        isDone: !error,
        ...(error ? { error } : {}),
      };
    });
  }

  /*
   * A renewed block's indicator, renewed: the old one deleted and the
   * block's added again with its new end - Defender's import never
   * replaces an indicator of the same value, so a renewal is a delete and
   * an add, a moment apart.
   */
  public async update(
    updates: Array<SecurityBlockUpdate>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    await this.remove(
      updates.map((update: SecurityBlockUpdate): SecurityBlockHeldItem => {
        return update.item;
      }),
    );

    return await this.apply(
      updates.map((update: SecurityBlockUpdate): SecurityBlockEntry => {
        return update.entry;
      }),
    );
  }

  private toSubmission(entry: SecurityBlockEntry): DefenderIndicatorSubmission {
    const value: string =
      entry.indicatorType === SecurityBlockIndicatorType.IpAddress
        ? toDefenderAddress(entry.value)
        : entry.value;

    return {
      indicatorValue: value,
      indicatorType:
        INDICATOR_TYPES[entry.indicatorType] || DefenderIndicatorType.DomainName,
      action: toDefenderAction(entry.action),
      title: `OneUptime: ${entry.value}`,
      description: `${entry.comment} ${this.marker}`,
      expirationTime: entry.expiresAt,
    };
  }
}
