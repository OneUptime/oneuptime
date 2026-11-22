import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import SecurityBlockDestination, {
  SecurityBlockCapacity,
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockSupport,
  SecurityBlockWriteResult,
} from "./SecurityBlockDestination";

/*
 * A DESTINATION THAT ENFORCES THE BLOCKLIST IN MEMORY (#10338), for the
 * reconciler's tests and for each provider's issue to test against before
 * it has a provider of its own: it behaves as a provider does, and lets a
 * test make it misbehave as providers do.
 *
 *   - It holds OneUptime's items and the customer's own (addCustomerItem),
 *     and readBack() returns only OneUptime's, as every destination must:
 *     the reconciler can never see, and so never remove, the customer's.
 *   - removeAtProvider() takes an item away behind OneUptime's back, as a
 *     person editing the list at the provider would (drift).
 *   - canChallenge and ipv4Only make it refuse entries it cannot hold,
 *     with a reason; capacity makes it full.
 *   - failNextCalls makes its next calls throw, as a provider that is down
 *     does, and refuseValue makes it turn one entry down, as a provider
 *     refuses a value.
 *   - propagating makes it hold an entry that is not in force yet.
 *   - batchesWrites gives it update(), as a provider that replaces its
 *     lists whole has: a pass's removals and additions in one call.
 *
 * Never registered in production: a project's destinations come from
 * SecurityBlockDestinations' sources, which hold no test destination.
 */

export interface TestSecurityBlockDestinationOptions {
  key?: string | undefined;
  lockKey?: string | undefined;
  name?: string | undefined;
  connectionId?: ObjectID | null | undefined;
  canChallenge?: boolean | undefined;
  ipv4Only?: boolean | undefined;
  // The most entries it holds; null or left out for no limit.
  capacity?: number | null | undefined;
  fullReason?: string | undefined;
  // Whether it takes a pass's removals and additions in one call (update()).
  batchesWrites?: boolean | undefined;
}

export type TestDestinationCall =
  | "capacity"
  | "apply"
  | "remove"
  | "update"
  | "readBack";

interface StoredItem {
  value: string;
  action: SecurityBlockAction;
  providerRef: string;
  isOneUptimes: boolean;
  confirmedAt?: Date | undefined;
}

function itemKey(value: string, action: SecurityBlockAction): string {
  return `${action}|${value}`;
}

export default class TestSecurityBlockDestination
  implements SecurityBlockDestination
{
  public readonly key: string;
  public readonly lockKey: string | undefined;
  public readonly provider: SecurityBlockDestinationProvider =
    SecurityBlockDestinationProvider.Test;
  public readonly name: string;
  public readonly connectionId: ObjectID | null;

  public canChallenge: boolean;
  public ipv4Only: boolean;
  public capacityLimit: number | null;
  public fullReason: string | undefined;

  // Only for one that batches its writes (batchesWrites).
  public readonly update?: (changes: {
    add: Array<SecurityBlockEntry>;
    remove: Array<SecurityBlockHeldItem>;
  }) => Promise<{
    applied: Array<SecurityBlockWriteResult>;
    removed: Array<SecurityBlockWriteResult>;
  }>;

  // Every call made of it, in order, with the values it was handed.
  public readonly calls: Array<{
    call: TestDestinationCall;
    values: Array<string>;
  }> = [];

  // Items it holds now, OneUptime's and the customer's.
  private readonly items: Map<string, StoredItem> = new Map();

  private failuresLeft: Partial<Record<TestDestinationCall, number>> = {};
  private failureMessage: string = "The test destination is down.";
  private readonly refusedValues: Map<string, string> = new Map();
  private readonly propagatingValues: Set<string> = new Set();
  private nextReference: number = 1;

  public constructor(options?: TestSecurityBlockDestinationOptions) {
    this.key = options?.key || "Test:destination";
    this.lockKey = options?.lockKey;
    this.name = options?.name || "Test destination";
    this.connectionId =
      options?.connectionId === undefined ? null : options.connectionId;
    this.canChallenge = options?.canChallenge ?? true;
    this.ipv4Only = options?.ipv4Only ?? false;
    this.capacityLimit =
      options?.capacity === undefined ? null : options.capacity;
    this.fullReason = options?.fullReason;

    if (options?.batchesWrites) {
      this.update = async (changes: {
        add: Array<SecurityBlockEntry>;
        remove: Array<SecurityBlockHeldItem>;
      }): Promise<{
        applied: Array<SecurityBlockWriteResult>;
        removed: Array<SecurityBlockWriteResult>;
      }> => {
        this.record("update", [
          ...changes.remove.map((item: SecurityBlockHeldItem): string => {
            return `-${item.value}`;
          }),
          ...changes.add.map((entry: SecurityBlockEntry): string => {
            return `+${entry.value}`;
          }),
        ]);
        this.throwIfFailing("update");

        return {
          removed: this.removeItems(changes.remove),
          applied: this.applyEntries(changes.add),
        };
      };
    }
  }

  // ---------- The destination ----------

  public supports(entry: {
    indicatorType: SecurityBlockIndicatorType;
    action: SecurityBlockAction;
    value: string;
  }): SecurityBlockSupport {
    if (entry.action === SecurityBlockAction.Challenge && !this.canChallenge) {
      return {
        isSupported: false,
        reason: `${this.name} cannot challenge`,
      };
    }

    const read: SecurityBlockValue | null = readSecurityBlockValue(entry.value);

    if (this.ipv4Only && read?.block.family === 6) {
      return {
        isSupported: false,
        reason: `${this.name} matches IPv4 only`,
      };
    }

    return { isSupported: true };
  }

  public async capacity(): Promise<SecurityBlockCapacity> {
    this.record("capacity", []);
    this.throwIfFailing("capacity");

    return {
      limit: this.capacityLimit,
      ...(this.fullReason ? { fullReason: this.fullReason } : {}),
    };
  }

  public async apply(
    entries: Array<SecurityBlockEntry>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    this.record(
      "apply",
      entries.map((entry: SecurityBlockEntry): string => {
        return entry.value;
      }),
    );
    this.throwIfFailing("apply");

    return this.applyEntries(entries);
  }

  private applyEntries(
    entries: Array<SecurityBlockEntry>,
  ): Array<SecurityBlockWriteResult> {
    return entries.map(
      (entry: SecurityBlockEntry): SecurityBlockWriteResult => {
        const refusal: string | undefined = this.refusedValues.get(entry.value);

        if (refusal) {
          return {
            value: entry.value,
            action: entry.action,
            isDone: false,
            error: refusal,
          };
        }

        const key: string = itemKey(entry.value, entry.action);
        const existing: StoredItem | undefined = this.items.get(key);
        const providerRef: string =
          existing?.providerRef || `test-item-${this.nextReference++}`;

        this.items.set(key, {
          value: entry.value,
          action: entry.action,
          providerRef,
          isOneUptimes: true,
        });

        return {
          value: entry.value,
          action: entry.action,
          isDone: true,
          providerRef,
        };
      },
    );
  }

  public async remove(
    items: Array<SecurityBlockHeldItem>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    this.record(
      "remove",
      items.map((item: SecurityBlockHeldItem): string => {
        return item.value;
      }),
    );
    this.throwIfFailing("remove");

    return this.removeItems(items);
  }

  private removeItems(
    items: Array<SecurityBlockHeldItem>,
  ): Array<SecurityBlockWriteResult> {
    return items.map(
      (item: SecurityBlockHeldItem): SecurityBlockWriteResult => {
        const key: string = itemKey(item.value, item.action);
        const stored: StoredItem | undefined = this.items.get(key);

        // Never the customer's own: only what OneUptime added is OneUptime's to take away.
        if (stored?.isOneUptimes) {
          this.items.delete(key);
        }

        return {
          value: item.value,
          action: item.action,
          isDone: Boolean(!stored || stored.isOneUptimes),
        };
      },
    );
  }

  public async readBack(): Promise<Array<SecurityBlockHeldItem>> {
    this.record("readBack", []);
    this.throwIfFailing("readBack");

    return Array.from(this.items.values())
      .filter((item: StoredItem): boolean => {
        return item.isOneUptimes;
      })
      .map((item: StoredItem): SecurityBlockHeldItem => {
        return {
          value: item.value,
          action: item.action,
          providerRef: item.providerRef,
          ...(item.confirmedAt ? { confirmedAt: item.confirmedAt } : {}),
          ...(this.propagatingValues.has(item.value)
            ? { isPropagating: true }
            : {}),
        };
      });
  }

  // ---------- What a test does to it ----------

  // Every item it holds of OneUptime's, as values.
  public getOneUptimeValues(action?: SecurityBlockAction): Array<string> {
    return Array.from(this.items.values())
      .filter((item: StoredItem): boolean => {
        return item.isOneUptimes && (!action || item.action === action);
      })
      .map((item: StoredItem): string => {
        return item.value;
      })
      .sort();
  }

  // The customer's own items it still holds, as values.
  public getCustomerValues(): Array<string> {
    return Array.from(this.items.values())
      .filter((item: StoredItem): boolean => {
        return !item.isOneUptimes;
      })
      .map((item: StoredItem): string => {
        return item.value;
      })
      .sort();
  }

  // An item of the customer's own, which OneUptime must never touch.
  public addCustomerItem(value: string, action: SecurityBlockAction): void {
    this.items.set(itemKey(value, action), {
      value,
      action,
      providerRef: `customer-item-${this.nextReference++}`,
      isOneUptimes: false,
    });
  }

  // An item taken away at the provider, behind OneUptime's back.
  public removeAtProvider(value: string, action: SecurityBlockAction): void {
    this.items.delete(itemKey(value, action));
  }

  // An item OneUptime added before, still at the provider: one left behind.
  public addOneUptimeItem(data: {
    value: string;
    action: SecurityBlockAction;
    confirmedAt?: Date | undefined;
  }): void {
    this.items.set(itemKey(data.value, data.action), {
      value: data.value,
      action: data.action,
      providerRef: `test-item-${this.nextReference++}`,
      isOneUptimes: true,
      confirmedAt: data.confirmedAt,
    });
  }

  // The next `times` calls of a kind throw, as a provider that is down does.
  public failNextCalls(
    call: TestDestinationCall,
    times: number,
    message?: string,
  ): void {
    this.failuresLeft[call] = times;

    if (message) {
      this.failureMessage = message;
    }
  }

  // An entry the provider turns down, with its words.
  public refuseValue(value: string, error: string): void {
    this.refusedValues.set(value, error);
  }

  public stopRefusing(value: string): void {
    this.refusedValues.delete(value);
  }

  // An entry held, but not yet in force everywhere.
  public setPropagating(value: string, isPropagating: boolean): void {
    if (isPropagating) {
      this.propagatingValues.add(value);
    } else {
      this.propagatingValues.delete(value);
    }
  }

  public countCalls(call: TestDestinationCall): number {
    return this.calls.filter((made: { call: TestDestinationCall }): boolean => {
      return made.call === call;
    }).length;
  }

  private record(call: TestDestinationCall, values: Array<string>): void {
    this.calls.push({ call, values });
  }

  private throwIfFailing(call: TestDestinationCall): void {
    const left: number = this.failuresLeft[call] || 0;

    if (left > 0) {
      this.failuresLeft[call] = left - 1;
      throw new Error(this.failureMessage);
    }
  }
}
