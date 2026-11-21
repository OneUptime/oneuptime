import { SecurityConnectorCheck } from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  CLOUDFLARE_ACCESS_RULES_EDIT_PERMISSION,
  CLOUDFLARE_ACCESS_RULES_PER_ACCOUNT,
  CLOUDFLARE_ACCESS_RULE_MODES,
  CLOUDFLARE_BLOCK_LIST_NAMES,
  CLOUDFLARE_BLOCK_RULE_ACTIONS,
  CLOUDFLARE_BLOCK_RULE_DESCRIPTION,
  CLOUDFLARE_BLOCK_RULE_REFS,
  CLOUDFLARE_LIST_EDIT_PERMISSION,
  CLOUDFLARE_PLAN_LIMITS,
  CLOUDFLARE_WAF_EDIT_PERMISSION,
  CloudflareAccessRulesReason,
  CloudflareActionStatus,
  CloudflareBlockingMechanism,
  CloudflareBlockingStatus,
  CloudflareMechanismChoice,
  CloudflarePlan,
  CloudflareRuleState,
  CloudflareZoneRoom,
  CloudflareZoneRuleStatus,
  CloudflareZoneStatus,
  chooseCloudflareBlockingMechanisms,
  describeCloudflareRuleProblems,
  getCloudflareActionStatus,
  getCloudflareBlockListDescription,
  getCloudflareBlockRuleExpression,
  getCloudflareRuleProblems,
  getHighestCloudflarePlan,
  isOneUptimeCloudflareComment,
  readCloudflareBlockListProjectId,
  readCloudflarePlan,
  readCloudflareSkipRuleAddresses,
  toCloudflareAccessRuleConfiguration,
  CloudflareAccessRuleConfiguration,
} from "../../../../../Types/SecurityBlocklist/CloudflareBlocking";
import {
  SECURITY_BLOCK_ACTIONS,
  SecurityBlockAction,
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockWriteResult,
} from "../../../SecurityBlocklist/SecurityBlockDestination";
import { makeCheck } from "../Types";
import CloudflareClient, {
  CloudflareAccessRule,
  CloudflareAccessRulePage,
  CloudflareApiError,
  CloudflareBulkOperation,
  CloudflareFailureKind,
  CloudflareList,
  CloudflareListItem,
  CloudflareRule,
  CloudflareRuleInput,
  CloudflareRuleset,
  CloudflareWriteAccess,
  CloudflareZone,
  CloudflareZoneList,
} from "./CloudflareClient";

/*
 * ENFORCING A PROJECT'S BLOCKLIST AT CLOUDFLARE (#10343), through the
 * connection's own client (CloudflareClient), the one module that calls
 * Cloudflare. What it sets up, and how it names it, is
 * Types/SecurityBlocklist/CloudflareBlocking: two IP lists, one custom rule
 * per list in each zone blocking is on in, first in the phase, and IP Access
 * Rules where the plan has no list or rule to spare.
 *
 *   readAccount   what the account holds of OneUptime's: its lists, each
 *                 zone's rules, the plan, the customer's lists and skip rules;
 *   setUp         makes what is missing - at turn-on, a change of zones and
 *                 Put It Back - and takes OneUptime's rules out of zones no
 *                 longer chosen;
 *   check         reads it again without changing it (drift): a rule deleted,
 *                 turned off or changed by hand is reported, never put back
 *                 behind the person's back; a zone added since is set up;
 *   readHeld      the blocks the lists and IP Access Rules hold of
 *                 OneUptime's, each marked as not in force while a zone's
 *                 rule for its action is not;
 *   add, remove   the item operations, each a bulk operation polled until
 *                 Cloudflare says it completed or failed;
 *   tearDown      takes away all OneUptime added, and nothing else, when
 *                 blocking is turned off and the person asks it to;
 *   checkWriteAccess  the write permissions, for Test Connection and for
 *                 turning blocking on.
 *
 * Every write of one account is made by one OneUptime process at a time:
 * the reconciler's lock is the account's (CloudflareBlockDestination's
 * lockKey), as Cloudflare allows one pending bulk operation per account.
 */

// The most items one list write carries: larger writes go as several operations, one after another.
export const CLOUDFLARE_ITEMS_PER_OPERATION: number = 1000;

// How long a bulk operation is waited for before the pass moves on; the next read back says how it went.
export const CLOUDFLARE_OPERATION_WAIT_IN_MS: number = 30 * 1000;

// How long a write waits for another bulk operation of the account to finish, in all.
export const CLOUDFLARE_BUSY_WAIT_IN_MS: number = 30 * 1000;

// The most of a list's items one read back reads: an Enterprise account holds 500,000.
export const CLOUDFLARE_MAX_ITEMS_READ: number = 500000;

// The most zone pages read: a connection reads 50 zones at most.
const MAX_ZONE_PAGES: number = 4;

// The note OneUptime's IP Access Rules are found by.
const ONEUPTIME_NOTE_SEARCH: string = "OneUptime";

/*
 * The checks blocking adds to a test, as the test report names them, in the
 * order they run (checkWriteAccess). The Cloudflare docs page names them so.
 */
export const CLOUDFLARE_BLOCKING_CHECK_NAMES: Readonly<{
  // The account could not be read, so nothing else is checked.
  unreadable: string;
  setup: string;
  lists: string;
  rules: string;
  accessRules: string;
}> = {
  unreadable: "Read what blocking needs",
  setup: "How blocking is set up",
  lists: "Edit the lists",
  rules: "Edit custom rules in each zone",
  accessRules: "Edit IP Access Rules",
};

export interface CloudflareBlockingScope {
  projectId: string;
  accountId: string;
  // The zones the connection reads (its config.zoneIds); empty: every active zone of the account.
  readZoneIds: Array<string>;
  // The zones blocking is on in (its settings); empty: every zone the connection reads.
  blockZoneIds: Array<string>;
}

// One zone blocking is on in, as the account holds it.
export interface CloudflareZoneReading {
  zone: CloudflareZone;
  plan: CloudflarePlan;
  // The entry point of its custom rules, or null when it has none.
  ruleset: CloudflareRuleset | null;
  // OneUptime's rules there, by action.
  oneUptimeRules: Partial<Record<SecurityBlockAction, CloudflareRule>>;
  // What the zone's own skip rules let through by address.
  skipAddresses: Array<string>;
}

// What the account holds of blocking, read without changing it.
export interface CloudflareAccountReading {
  plan: CloudflarePlan;
  zones: Array<CloudflareZoneReading>;
  // Zones blocking was asked to be on in that the token no longer reads.
  missingZoneIds: Array<string>;
  // OneUptime's lists, by action.
  lists: Partial<Record<SecurityBlockAction, CloudflareList>>;
  // A list with OneUptime's name that another project, or no OneUptime project, made.
  foreignListNames: Array<string>;
  customerListCount: number;
  customerListItems: number;
}

export type CloudflareSleep = (ms: number) => Promise<void>;

const realSleep: CloudflareSleep = (ms: number): Promise<void> => {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
};

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

function chunk<T>(items: ReadonlyArray<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = [];

  for (let index: number = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

// A value as blocks are written, or as given when it is no address.
function asBlockValue(value: string): string {
  const read: SecurityBlockValue | null = readSecurityBlockValue(value);

  return read ? read.value : value.trim().toLowerCase();
}

export function getCloudflareRuleInput(
  action: SecurityBlockAction,
): CloudflareRuleInput {
  return {
    ref: CLOUDFLARE_BLOCK_RULE_REFS[action],
    action: CLOUDFLARE_BLOCK_RULE_ACTIONS[action],
    expression: getCloudflareBlockRuleExpression(action),
    description: CLOUDFLARE_BLOCK_RULE_DESCRIPTION,
    enabled: true,
  };
}

// Where OneUptime's rule for an action stands, read from the rule Cloudflare holds.
export function getCloudflareRuleState(data: {
  action: SecurityBlockAction;
  rule: CloudflareRule | undefined;
  // Whether OneUptime set this zone's rule up before: a rule gone since was deleted.
  wasSetUp: boolean;
}): CloudflareRuleState {
  if (!data.rule) {
    return data.wasSetUp
      ? CloudflareRuleState.Deleted
      : CloudflareRuleState.NotSetUp;
  }

  if (!data.rule.enabled) {
    return CloudflareRuleState.TurnedOff;
  }

  const expected: CloudflareRuleInput = getCloudflareRuleInput(data.action);
  const sameExpression: boolean =
    data.rule.expression.replace(/\s+/g, " ").trim() === expected.expression;

  if (!sameExpression || data.rule.action !== expected.action) {
    return CloudflareRuleState.Changed;
  }

  return CloudflareRuleState.Enforcing;
}

export class CloudflareBlockingError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

export default class CloudflareBlocking {
  private client: CloudflareClient;
  private scope: CloudflareBlockingScope;
  private now: () => Date;
  private sleep: CloudflareSleep;

  public constructor(data: {
    client: CloudflareClient;
    scope: CloudflareBlockingScope;
    now?: (() => Date) | undefined;
    sleep?: CloudflareSleep | undefined;
  }) {
    this.client = data.client;
    this.scope = data.scope;
    this.now =
      data.now ||
      ((): Date => {
        return new Date();
      });
    this.sleep = data.sleep || realSleep;
  }

  // ---------- Reading what is there ----------

  public async readAccount(): Promise<CloudflareAccountReading> {
    const zoneList: CloudflareZoneList = await this.client.listZones({
      accountId: this.scope.accountId,
      maxPages: MAX_ZONE_PAGES,
    });

    const active: Array<CloudflareZone> = zoneList.zones.filter(
      (zone: CloudflareZone): boolean => {
        return zone.status === "" || zone.status === "active";
      },
    );

    // The zones the connection reads, then those blocking is on in.
    const read: Array<CloudflareZone> =
      this.scope.readZoneIds.length > 0
        ? active.filter((zone: CloudflareZone): boolean => {
            return this.scope.readZoneIds.includes(zone.id);
          })
        : active;
    const chosen: Array<CloudflareZone> =
      this.scope.blockZoneIds.length > 0
        ? read.filter((zone: CloudflareZone): boolean => {
            return this.scope.blockZoneIds.includes(zone.id);
          })
        : read;
    const missingZoneIds: Array<string> = this.scope.blockZoneIds.filter(
      (zoneId: string): boolean => {
        return !chosen.some((zone: CloudflareZone): boolean => {
          return zone.id === zoneId;
        });
      },
    );

    let lists: Array<CloudflareList>;

    try {
      lists = await this.client.listLists(this.scope.accountId);
    } catch (error) {
      if (
        error instanceof CloudflareApiError &&
        error.kind === CloudflareFailureKind.MissingPermission
      ) {
        throw new CloudflareBlockingError(
          `The API token cannot read the account's lists: give it ${CLOUDFLARE_LIST_EDIT_PERMISSION}. ${errorText(error)}`,
        );
      }

      throw error;
    }
    const oneUptimeLists: Partial<Record<SecurityBlockAction, CloudflareList>> =
      {};
    const foreignListNames: Array<string> = [];
    let customerListCount: number = 0;
    let customerListItems: number = 0;

    for (const list of lists) {
      const action: SecurityBlockAction | undefined =
        SECURITY_BLOCK_ACTIONS.find((candidate: SecurityBlockAction) => {
          return CLOUDFLARE_BLOCK_LIST_NAMES[candidate] === list.name;
        });

      if (!action) {
        customerListCount++;
        customerListItems += list.numItems;
        continue;
      }

      const owner: string | null = readCloudflareBlockListProjectId(
        list.description,
      );

      if (owner !== this.scope.projectId.toLowerCase()) {
        // Not this project's to change: counted as the customer's own.
        foreignListNames.push(list.name);
        customerListCount++;
        customerListItems += list.numItems;
        continue;
      }

      oneUptimeLists[action] = list;
    }

    const zones: Array<CloudflareZoneReading> = [];

    for (const zone of chosen) {
      let ruleset: CloudflareRuleset | null;

      try {
        ruleset = await this.client.getCustomRulesEntrypoint(zone.id);
      } catch (error) {
        if (
          error instanceof CloudflareApiError &&
          error.kind === CloudflareFailureKind.MissingPermission
        ) {
          throw new CloudflareBlockingError(
            `The API token cannot read the custom rules of ${zone.name}: give it ${CLOUDFLARE_WAF_EDIT_PERMISSION} on that zone. ${errorText(error)}`,
          );
        }

        throw error;
      }

      zones.push(this.readZone(zone, ruleset));
    }

    return {
      // Lists follow the account's highest plan: every zone the token reads says one.
      plan: getHighestCloudflarePlan(
        zoneList.zones.map((zone: CloudflareZone): CloudflarePlan => {
          return readCloudflarePlan(zone.planLegacyId);
        }),
      ),
      zones,
      missingZoneIds,
      lists: oneUptimeLists,
      foreignListNames,
      customerListCount,
      customerListItems,
    };
  }

  private readZone(
    zone: CloudflareZone,
    ruleset: CloudflareRuleset | null,
  ): CloudflareZoneReading {
    const oneUptimeRules: Partial<Record<SecurityBlockAction, CloudflareRule>> =
      {};
    const skipAddresses: Array<string> = [];

    for (const rule of ruleset?.rules || []) {
      const action: SecurityBlockAction | undefined =
        SECURITY_BLOCK_ACTIONS.find((candidate: SecurityBlockAction) => {
          return CLOUDFLARE_BLOCK_RULE_REFS[candidate] === rule.ref;
        });

      if (action) {
        oneUptimeRules[action] = rule;
        continue;
      }

      if (rule.action === "skip" && rule.enabled) {
        for (const value of readCloudflareSkipRuleAddresses(rule.expression)) {
          if (!skipAddresses.includes(value)) {
            skipAddresses.push(value);
          }
        }
      }
    }

    return {
      zone,
      plan: readCloudflarePlan(zone.planLegacyId),
      ruleset,
      oneUptimeRules,
      skipAddresses,
    };
  }

  // The mechanism of each action for what the account holds now (chooseCloudflareBlockingMechanisms).
  public static chooseMechanisms(
    reading: CloudflareAccountReading,
  ): Record<SecurityBlockAction, CloudflareMechanismChoice> {
    return chooseCloudflareBlockingMechanisms({
      plan: reading.plan,
      customerListCount: reading.customerListCount,
      oneUptimeLists: SECURITY_BLOCK_ACTIONS.filter(
        (action: SecurityBlockAction): boolean => {
          return Boolean(reading.lists[action]);
        },
      ),
      zones: reading.zones.map(
        (zone: CloudflareZoneReading): CloudflareZoneRoom => {
          return {
            id: zone.zone.id,
            name: zone.zone.name,
            plan: zone.plan,
            ruleCount: zone.ruleset?.rules.length || 0,
            oneUptimeRules: SECURITY_BLOCK_ACTIONS.filter(
              (action: SecurityBlockAction): boolean => {
                return Boolean(zone.oneUptimeRules[action]);
              },
            ),
          };
        },
      ),
    });
  }

  /*
   * The mechanisms a status keeps, or a new choice when it keeps none of
   * this account: once chosen, an action's mechanism stays until blocking is
   * turned off, as moving it would move every block.
   */
  private static mechanismsFor(
    reading: CloudflareAccountReading,
    previous: CloudflareBlockingStatus | null,
    accountId: string,
  ): Record<SecurityBlockAction, CloudflareMechanismChoice> {
    const chosen: Record<SecurityBlockAction, CloudflareMechanismChoice> =
      CloudflareBlocking.chooseMechanisms(reading);

    if (!previous || previous.accountId !== accountId) {
      return chosen;
    }

    for (const action of SECURITY_BLOCK_ACTIONS) {
      const kept: CloudflareActionStatus | null = getCloudflareActionStatus(
        previous,
        action,
      );

      if (kept) {
        chosen[action] = kept.choice;
      }
    }

    return chosen;
  }

  // ---------- Setting it up ----------

  /*
   * Makes what blocking needs and is missing: each list an action uses, and
   * in each zone asked (every zone blocking is on in, unless zoneIds names
   * some, as Put It Back does) the rule of each action that uses a list,
   * added first in the phase, turned on and written as OneUptime wrote it.
   * OneUptime's rules in zones no longer chosen are taken away. Throws when
   * Cloudflare refuses: the status the caller keeps says so.
   */
  public async setUp(data: {
    previous: CloudflareBlockingStatus | null;
    zoneIds?: Array<string> | undefined;
    requestedAt?: string | undefined;
  }): Promise<CloudflareBlockingStatus> {
    const reading: CloudflareAccountReading = await this.readAccount();

    if (reading.foreignListNames.length > 0) {
      throw new CloudflareBlockingError(
        `${reading.foreignListNames.join(" and ")} already exists in this Cloudflare account, and another OneUptime project or a person made it. OneUptime never changes a list it did not make for this project: rename or delete that list in Cloudflare, or turn blocking off in the project that made it.`,
      );
    }

    const mechanisms: Record<SecurityBlockAction, CloudflareMechanismChoice> =
      CloudflareBlocking.mechanismsFor(
        reading,
        data.previous,
        this.scope.accountId,
      );

    for (const action of SECURITY_BLOCK_ACTIONS) {
      if (
        mechanisms[action].mechanism !== CloudflareBlockingMechanism.List ||
        reading.lists[action]
      ) {
        continue;
      }

      try {
        reading.lists[action] = await this.client.createList(
          this.scope.accountId,
          {
            name: CLOUDFLARE_BLOCK_LIST_NAMES[action],
            description: getCloudflareBlockListDescription(
              this.scope.projectId,
            ),
          },
        );
      } catch (error) {
        if (
          error instanceof CloudflareApiError &&
          error.kind === CloudflareFailureKind.LimitReached
        ) {
          throw new CloudflareBlockingError(
            `Your Cloudflare plan has no list left for ${CLOUDFLARE_BLOCK_LIST_NAMES[action]}. Delete a list you no longer use in Cloudflare, then select Put It Back. ${errorText(error)}`,
          );
        }

        throw error;
      }
    }

    const asked: Array<CloudflareZoneReading> =
      data.zoneIds && data.zoneIds.length > 0
        ? reading.zones.filter((zone: CloudflareZoneReading): boolean => {
            return data.zoneIds!.includes(zone.zone.id);
          })
        : reading.zones;

    for (const zone of asked) {
      await this.setUpZone(zone, mechanisms);
    }

    await this.takeRulesOutOfZonesLeft(reading, data.previous);

    return this.describe({
      reading,
      mechanisms,
      previous: data.previous,
      ...(data.requestedAt ? { setupDoneFor: data.requestedAt } : {}),
    });
  }

  // One zone's rules: each action that uses a list has its rule, on and as written.
  private async setUpZone(
    zone: CloudflareZoneReading,
    mechanisms: Record<SecurityBlockAction, CloudflareMechanismChoice>,
  ): Promise<void> {
    const actions: Array<SecurityBlockAction> = SECURITY_BLOCK_ACTIONS.filter(
      (action: SecurityBlockAction): boolean => {
        return (
          mechanisms[action].mechanism === CloudflareBlockingMechanism.List
        );
      },
    );

    if (actions.length === 0) {
      return;
    }

    try {
      if (!zone.ruleset) {
        // A 404: no entry point yet. Made with OneUptime's rules, as the zone has none of its own.
        zone.ruleset = await this.client.createCustomRulesEntrypoint(
          zone.zone.id,
          actions.map(getCloudflareRuleInput),
        );
        Object.assign(zone, this.readZone(zone.zone, zone.ruleset));
        return;
      }

      for (const action of actions) {
        const rule: CloudflareRule | undefined = zone.oneUptimeRules[action];
        const state: CloudflareRuleState = getCloudflareRuleState({
          action,
          rule,
          wasSetUp: false,
        });

        if (state === CloudflareRuleState.Enforcing) {
          continue;
        }

        zone.ruleset = rule
          ? await this.client.updateCustomRule({
              zoneId: zone.zone.id,
              rulesetId: zone.ruleset.id,
              ruleId: rule.id,
              rule: getCloudflareRuleInput(action),
            })
          : await this.client.addCustomRule({
              zoneId: zone.zone.id,
              rulesetId: zone.ruleset.id,
              rule: getCloudflareRuleInput(action),
            });
        Object.assign(zone, this.readZone(zone.zone, zone.ruleset));
      }
    } catch (error) {
      if (
        error instanceof CloudflareApiError &&
        error.kind === CloudflareFailureKind.LimitReached
      ) {
        throw new CloudflareBlockingError(
          `${zone.zone.name} has no custom rule left for OneUptime's rule. Delete a custom rule you no longer use in Cloudflare, then select Put It Back. ${errorText(error)}`,
        );
      }

      if (
        error instanceof CloudflareApiError &&
        error.kind === CloudflareFailureKind.MissingPermission
      ) {
        throw new CloudflareBlockingError(
          `The API token cannot change the custom rules of ${zone.zone.name}: give it ${CLOUDFLARE_WAF_EDIT_PERMISSION} on that zone. ${errorText(error)}`,
        );
      }

      throw error;
    }
  }

  // OneUptime's rules in zones blocking was on in before and is not now.
  private async takeRulesOutOfZonesLeft(
    reading: CloudflareAccountReading,
    previous: CloudflareBlockingStatus | null,
  ): Promise<void> {
    const chosen: Set<string> = new Set(
      reading.zones.map((zone: CloudflareZoneReading): string => {
        return zone.zone.id;
      }),
    );

    for (const zone of previous?.zones || []) {
      if (chosen.has(zone.id)) {
        continue;
      }

      await this.takeRulesOutOfZone(zone.id);
    }
  }

  private async takeRulesOutOfZone(zoneId: string): Promise<void> {
    const ruleset: CloudflareRuleset | null =
      await this.client.getCustomRulesEntrypoint(zoneId);

    for (const rule of ruleset?.rules || []) {
      const isOneUptimes: boolean = SECURITY_BLOCK_ACTIONS.some(
        (action: SecurityBlockAction): boolean => {
          return CLOUDFLARE_BLOCK_RULE_REFS[action] === rule.ref;
        },
      );

      if (isOneUptimes && ruleset) {
        try {
          await this.client.deleteCustomRule({
            zoneId,
            rulesetId: ruleset.id,
            ruleId: rule.id,
          });
        } catch (error) {
          // Gone already is gone.
          if (
            !(error instanceof CloudflareApiError) ||
            error.kind !== CloudflareFailureKind.NotFound
          ) {
            throw error;
          }
        }
      }
    }
  }

  // ---------- Checking it, every few minutes ----------

  /*
   * What the account holds now, read without changing what OneUptime set
   * up: a rule deleted, turned off or changed at Cloudflare is reported, and
   * stays so until someone selects Put It Back. A zone blocking is on in that
   * OneUptime never set up - one added to the account since - is set up.
   */
  public async check(
    previous: CloudflareBlockingStatus | null,
  ): Promise<CloudflareBlockingStatus> {
    const reading: CloudflareAccountReading = await this.readAccount();
    const mechanisms: Record<SecurityBlockAction, CloudflareMechanismChoice> =
      CloudflareBlocking.mechanismsFor(reading, previous, this.scope.accountId);

    const known: Set<string> = new Set(
      (previous?.zones || []).map((zone: CloudflareZoneStatus): string => {
        return zone.id;
      }),
    );
    const failures: Array<string> = [];

    for (const zone of reading.zones) {
      if (!previous || known.has(zone.zone.id)) {
        continue;
      }

      /*
       * A zone that cannot take OneUptime's rule stays Not set up, and says
       * why: the blocks hold in every other zone meanwhile.
       */
      try {
        await this.setUpZone(zone, mechanisms);
      } catch (error) {
        failures.push(errorText(error));
      }
    }

    const status: CloudflareBlockingStatus = this.describe({
      reading,
      mechanisms,
      previous,
    });

    if (failures.length > 0) {
      status.error = failures.join(" ");
      status.errorAt = status.checkedAt;
    }

    return status;
  }

  // The status a reading says, kept with what the previous status fulfilled.
  public describe(data: {
    reading: CloudflareAccountReading;
    mechanisms: Record<SecurityBlockAction, CloudflareMechanismChoice>;
    previous: CloudflareBlockingStatus | null;
    setupDoneFor?: string | undefined;
  }): CloudflareBlockingStatus {
    const { reading, mechanisms, previous } = data;

    const zones: Array<CloudflareZoneStatus> = reading.zones.map(
      (zone: CloudflareZoneReading): CloudflareZoneStatus => {
        const before: CloudflareZoneStatus | undefined = previous?.zones.find(
          (candidate: CloudflareZoneStatus): boolean => {
            return candidate.id === zone.zone.id;
          },
        );
        const rules: Array<CloudflareZoneRuleStatus> = [];

        for (const action of SECURITY_BLOCK_ACTIONS) {
          if (
            mechanisms[action].mechanism !== CloudflareBlockingMechanism.List
          ) {
            continue;
          }

          const rule: CloudflareRule | undefined = zone.oneUptimeRules[action];
          const wasSetUp: boolean = Boolean(
            before?.rules.some((entry: CloudflareZoneRuleStatus): boolean => {
              return entry.action === action && Boolean(entry.ruleId);
            }),
          );

          rules.push({
            action,
            state: getCloudflareRuleState({ action, rule, wasSetUp }),
            ...(rule
              ? { ruleId: rule.id }
              : wasSetUp
                ? {
                    ruleId: before!.rules.find(
                      (entry: CloudflareZoneRuleStatus): boolean => {
                        return entry.action === action;
                      },
                    )?.ruleId,
                  }
                : {}),
          });
        }

        return {
          id: zone.zone.id,
          name: zone.zone.name,
          plan: zone.plan,
          rulesUsed: zone.ruleset?.rules.length || 0,
          rulesLimit: CLOUDFLARE_PLAN_LIMITS[zone.plan].customRulesPerZone,
          rules,
          ...(zone.skipAddresses.length > 0
            ? { skipAddresses: zone.skipAddresses }
            : {}),
        };
      },
    );

    const actions: Array<CloudflareActionStatus> = SECURITY_BLOCK_ACTIONS.map(
      (action: SecurityBlockAction): CloudflareActionStatus => {
        const choice: CloudflareMechanismChoice = mechanisms[action];
        const list: CloudflareList | undefined = reading.lists[action];

        return {
          action,
          choice,
          ...(list ? { listId: list.id } : {}),
          isInPlace:
            choice.mechanism === CloudflareBlockingMechanism.AccessRules ||
            Boolean(list),
        };
      },
    );

    const usesLists: boolean = actions.some(
      (entry: CloudflareActionStatus): boolean => {
        return entry.choice.mechanism === CloudflareBlockingMechanism.List;
      },
    );
    const usesAccessRules: boolean = actions.some(
      (entry: CloudflareActionStatus): boolean => {
        return (
          entry.choice.mechanism === CloudflareBlockingMechanism.AccessRules
        );
      },
    );

    let limit: number | null = null;

    if (usesLists && !usesAccessRules) {
      limit = Math.max(
        0,
        CLOUDFLARE_PLAN_LIMITS[reading.plan].listItems -
          reading.customerListItems,
      );
    } else if (usesAccessRules && !usesLists) {
      limit = CLOUDFLARE_ACCESS_RULES_PER_ACCOUNT;
    }

    const items: number = SECURITY_BLOCK_ACTIONS.reduce(
      (total: number, action: SecurityBlockAction): number => {
        return total + (reading.lists[action]?.numItems || 0);
      },
      0,
    );

    const status: CloudflareBlockingStatus = {
      checkedAt: this.now().toISOString(),
      accountId: this.scope.accountId,
      plan: reading.plan,
      actions,
      zones,
      usage: {
        items: usesAccessRules ? previous?.usage.items ?? items : items,
        limit,
      },
    };

    const setupDoneFor: string | undefined =
      data.setupDoneFor || previous?.setupDoneFor;

    if (setupDoneFor) {
      status.setupDoneFor = setupDoneFor;
    }

    if (previous?.removalDoneFor) {
      status.removalDoneFor = previous.removalDoneFor;
    }

    return status;
  }

  // ---------- The blocks it holds ----------

  /*
   * OneUptime's blocks in the lists and IP Access Rules the actions use,
   * each as blocks are written, by its item's or rule's id. An item whose
   * comment does not say OneUptime made it is someone else's, and left out.
   * While a zone's rule for an action does not enforce, that action's
   * blocks are held but not in force, and say where and why.
   */
  public async readHeld(
    status: CloudflareBlockingStatus,
  ): Promise<Array<SecurityBlockHeldItem>> {
    const held: Array<SecurityBlockHeldItem> = [];

    for (const action of SECURITY_BLOCK_ACTIONS) {
      const entry: CloudflareActionStatus | null = getCloudflareActionStatus(
        status,
        action,
      );

      if (!entry || !entry.isInPlace) {
        continue;
      }

      if (entry.choice.mechanism === CloudflareBlockingMechanism.List) {
        if (!entry.listId) {
          continue;
        }

        const notInForce: string | null = describeCloudflareRuleProblems(
          getCloudflareRuleProblems(status, action),
        );
        const read: { items: Array<CloudflareListItem>; isTruncated: boolean } =
          await this.client.listListItems({
            accountId: this.scope.accountId,
            listId: entry.listId,
            maxItems: CLOUDFLARE_MAX_ITEMS_READ,
          });

        for (const item of read.items) {
          if (!isOneUptimeCloudflareComment(item.comment)) {
            continue;
          }

          held.push({
            value: asBlockValue(item.ip),
            action,
            providerRef: item.id,
            ...(notInForce ? { notInForceReason: notInForce } : {}),
          });
        }

        continue;
      }

      for (const rule of await this.readOneUptimeAccessRules(action)) {
        held.push({
          value: asBlockValue(rule.value),
          action,
          providerRef: rule.id,
        });
      }
    }

    return held;
  }

  // OneUptime's IP Access Rules of one action, every page.
  private async readOneUptimeAccessRules(
    action: SecurityBlockAction,
  ): Promise<Array<CloudflareAccessRule>> {
    const rules: Array<CloudflareAccessRule> = [];

    for (let page: number = 1; ; page++) {
      const answer: CloudflareAccessRulePage =
        await this.client.listAccessRules({
          accountId: this.scope.accountId,
          page,
          perPage: 500,
          notes: ONEUPTIME_NOTE_SEARCH,
          mode: CLOUDFLARE_ACCESS_RULE_MODES[action],
        });

      for (const rule of answer.rules) {
        if (
          rule.mode === CLOUDFLARE_ACCESS_RULE_MODES[action] &&
          isOneUptimeCloudflareComment(rule.notes)
        ) {
          rules.push(rule);
        }
      }

      if (page >= answer.totalPages || answer.rules.length === 0) {
        return rules;
      }
    }
  }

  /*
   * Adds blocks: to its action's list, a bulk operation of at most
   * CLOUDFLARE_ITEMS_PER_OPERATION items at a time, each polled until
   * Cloudflare says how it went; or one IP Access Rule a block. A list that
   * is full refuses its items, which say so; a failure that is the
   * account's, not the item's (a permission, the rate limit, Cloudflare
   * down), is thrown, for the reconciler to try again later.
   */
  public async add(
    entries: Array<SecurityBlockEntry>,
    status: CloudflareBlockingStatus,
  ): Promise<Array<SecurityBlockWriteResult>> {
    const results: Array<SecurityBlockWriteResult> = [];

    for (const action of SECURITY_BLOCK_ACTIONS) {
      const ofAction: Array<SecurityBlockEntry> = entries.filter(
        (entry: SecurityBlockEntry): boolean => {
          return entry.action === action;
        },
      );

      if (ofAction.length === 0) {
        continue;
      }

      const entry: CloudflareActionStatus | null = getCloudflareActionStatus(
        status,
        action,
      );

      if (!entry || !entry.isInPlace) {
        results.push(
          ...ofAction.map(
            (block: SecurityBlockEntry): SecurityBlockWriteResult => {
              return {
                value: block.value,
                action,
                isDone: false,
                error: `${CLOUDFLARE_BLOCK_LIST_NAMES[action]} is not set up in Cloudflare`,
              };
            },
          ),
        );
        continue;
      }

      if (
        entry.choice.mechanism === CloudflareBlockingMechanism.List &&
        entry.listId
      ) {
        results.push(...(await this.addToList(entry.listId, action, ofAction)));
        continue;
      }

      results.push(...(await this.addAccessRules(action, ofAction)));
    }

    return results;
  }

  private async addToList(
    listId: string,
    action: SecurityBlockAction,
    entries: Array<SecurityBlockEntry>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    const results: Array<SecurityBlockWriteResult> = [];

    for (const batch of chunk(entries, CLOUDFLARE_ITEMS_PER_OPERATION)) {
      const operation: CloudflareBulkOperation = await this.runOperation(
        (): Promise<string> => {
          return this.client.addListItems({
            accountId: this.scope.accountId,
            listId,
            items: batch.map((entry: SecurityBlockEntry) => {
              return { ip: entry.value, comment: entry.comment };
            }),
          });
        },
      );

      const failure: string | null =
        operation.status === "failed"
          ? this.listFailure(action, operation.error)
          : null;

      for (const entry of batch) {
        results.push({
          value: entry.value,
          action,
          isDone: !failure,
          ...(failure ? { error: failure } : {}),
        });
      }
    }

    return results;
  }

  // What a failed list write says on each block it carried.
  private listFailure(action: SecurityBlockAction, error: string): string {
    const lower: string = error.toLowerCase();

    if (
      lower.includes("exceed") ||
      lower.includes("maximum") ||
      lower.includes("limit") ||
      lower.includes("full")
    ) {
      return `${CLOUDFLARE_BLOCK_LIST_NAMES[action]} is full: your Cloudflare plan holds no more list items. ${error}`;
    }

    return `Cloudflare did not add it to ${CLOUDFLARE_BLOCK_LIST_NAMES[action]}: ${error || "the operation failed"}`;
  }

  private async addAccessRules(
    action: SecurityBlockAction,
    entries: Array<SecurityBlockEntry>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    const results: Array<SecurityBlockWriteResult> = [];

    for (const entry of entries) {
      const configuration: CloudflareAccessRuleConfiguration | null =
        toCloudflareAccessRuleConfiguration(entry.value);

      if (!configuration) {
        results.push({
          value: entry.value,
          action,
          isDone: false,
          error: "Cloudflare's IP Access Rules cannot hold it",
        });
        continue;
      }

      try {
        const rule: CloudflareAccessRule = await this.client.createAccessRule({
          accountId: this.scope.accountId,
          mode: CLOUDFLARE_ACCESS_RULE_MODES[action],
          target: configuration.target,
          value: configuration.value,
          notes: entry.comment,
        });

        results.push({
          value: entry.value,
          action,
          isDone: true,
          providerRef: rule.id,
        });
      } catch (error) {
        if (
          error instanceof CloudflareApiError &&
          (error.kind === CloudflareFailureKind.LimitReached ||
            error.kind === CloudflareFailureKind.BadRequest)
        ) {
          results.push({
            value: entry.value,
            action,
            isDone: false,
            error:
              error.kind === CloudflareFailureKind.LimitReached
                ? `Cloudflare's IP Access Rules are full (${CLOUDFLARE_ACCESS_RULES_PER_ACCOUNT.toLocaleString("en-US")}). ${errorText(error)}`
                : errorText(error),
          });
          continue;
        }

        if (
          error instanceof CloudflareApiError &&
          error.kind === CloudflareFailureKind.MissingPermission
        ) {
          throw new CloudflareBlockingError(
            `The API token cannot add IP Access Rules: give it ${CLOUDFLARE_ACCESS_RULES_EDIT_PERMISSION}. ${errorText(error)}`,
          );
        }

        throw error;
      }
    }

    return results;
  }

  /*
   * Takes blocks away by the item or rule each was read back with; never one
   * read back as someone else's, as readHeld never returns those.
   */
  public async remove(
    items: Array<SecurityBlockHeldItem>,
    status: CloudflareBlockingStatus,
  ): Promise<Array<SecurityBlockWriteResult>> {
    const results: Array<SecurityBlockWriteResult> = [];

    for (const action of SECURITY_BLOCK_ACTIONS) {
      const ofAction: Array<SecurityBlockHeldItem> = items.filter(
        (item: SecurityBlockHeldItem): boolean => {
          return item.action === action;
        },
      );

      if (ofAction.length === 0) {
        continue;
      }

      const entry: CloudflareActionStatus | null = getCloudflareActionStatus(
        status,
        action,
      );
      const withRef: Array<SecurityBlockHeldItem> = ofAction.filter(
        (item: SecurityBlockHeldItem): boolean => {
          return Boolean(item.providerRef);
        },
      );

      for (const item of ofAction) {
        if (!item.providerRef) {
          results.push({
            value: item.value,
            action,
            isDone: false,
            error: "Cloudflare's reference to it was not read",
          });
        }
      }

      if (
        entry?.choice.mechanism === CloudflareBlockingMechanism.List &&
        entry.listId
      ) {
        for (const batch of chunk(withRef, CLOUDFLARE_ITEMS_PER_OPERATION)) {
          const listId: string = entry.listId;
          const operation: CloudflareBulkOperation = await this.runOperation(
            (): Promise<string> => {
              return this.client.deleteListItems({
                accountId: this.scope.accountId,
                listId,
                itemIds: batch.map((item: SecurityBlockHeldItem): string => {
                  return item.providerRef!;
                }),
              });
            },
          );

          for (const item of batch) {
            results.push({
              value: item.value,
              action,
              isDone: operation.status !== "failed",
              ...(operation.status === "failed"
                ? {
                    error: `Cloudflare did not remove it from ${CLOUDFLARE_BLOCK_LIST_NAMES[action]}: ${operation.error || "the operation failed"}`,
                  }
                : {}),
            });
          }
        }

        continue;
      }

      for (const item of withRef) {
        try {
          await this.client.deleteAccessRule(
            this.scope.accountId,
            item.providerRef!,
          );
          results.push({ value: item.value, action, isDone: true });
        } catch (error) {
          if (
            error instanceof CloudflareApiError &&
            error.kind === CloudflareFailureKind.NotFound
          ) {
            results.push({ value: item.value, action, isDone: true });
            continue;
          }

          throw error;
        }
      }
    }

    return results;
  }

  /*
   * One bulk operation, sent once the account has none pending (a write
   * turned away for another is waited for, CLOUDFLARE_BUSY_WAIT_IN_MS in
   * all), then polled until Cloudflare says it completed or failed. One
   * still running after CLOUDFLARE_OPERATION_WAIT_IN_MS is left to run: the
   * read back that follows says what it did.
   */
  private async runOperation(
    send: () => Promise<string>,
  ): Promise<CloudflareBulkOperation> {
    let operationId: string = "";
    let waitedForBusy: number = 0;

    for (;;) {
      try {
        operationId = await send();
        break;
      } catch (error) {
        if (
          error instanceof CloudflareApiError &&
          error.kind === CloudflareFailureKind.Busy &&
          waitedForBusy < CLOUDFLARE_BUSY_WAIT_IN_MS
        ) {
          const wait: number = 5000;
          waitedForBusy += wait;
          await this.sleep(wait);
          continue;
        }

        if (
          error instanceof CloudflareApiError &&
          error.kind === CloudflareFailureKind.MissingPermission
        ) {
          throw new CloudflareBlockingError(
            `The API token cannot change the lists: give it ${CLOUDFLARE_LIST_EDIT_PERMISSION}. ${errorText(error)}`,
          );
        }

        if (
          error instanceof CloudflareApiError &&
          error.kind === CloudflareFailureKind.Busy
        ) {
          throw new CloudflareBlockingError(
            `Another change to this Cloudflare account's lists was still running after ${Math.round(CLOUDFLARE_BUSY_WAIT_IN_MS / 1000)} seconds: Cloudflare runs one at a time. OneUptime tries again shortly. ${errorText(error)}`,
          );
        }

        throw error;
      }
    }

    let waited: number = 0;
    let step: number = 500;

    for (;;) {
      const operation: CloudflareBulkOperation =
        await this.client.getBulkOperation(this.scope.accountId, operationId);

      if (operation.status === "completed" || operation.status === "failed") {
        return operation;
      }

      if (waited >= CLOUDFLARE_OPERATION_WAIT_IN_MS) {
        return operation;
      }

      await this.sleep(step);
      waited += step;
      step = Math.min(step * 2, 4000);
    }
  }

  // ---------- Taking it all away ----------

  /*
   * Takes away everything OneUptime added for this project, and nothing
   * else: its rules in every zone it knows of, its items in its lists, each
   * of its lists once nothing else is left in it (a list holding an item
   * someone added by hand is left, and said to be), and its IP Access Rules
   * - one request each, so a removal of many goes on across passes, within
   * budgetInMs each. Returns whether it is done, and how many blocks are
   * left to take away.
   */
  public async tearDown(data: {
    previous: CloudflareBlockingStatus | null;
    budgetInMs: number;
  }): Promise<{ isDone: boolean; left: number; keptLists: Array<string> }> {
    const startedAt: number = this.now().getTime();
    const reading: CloudflareAccountReading = await this.readAccount();

    const zoneIds: Set<string> = new Set([
      ...(data.previous?.zones || []).map(
        (zone: CloudflareZoneStatus): string => {
          return zone.id;
        },
      ),
      ...reading.zones.map((zone: CloudflareZoneReading): string => {
        return zone.zone.id;
      }),
    ]);

    for (const zoneId of zoneIds) {
      await this.takeRulesOutOfZone(zoneId);
    }

    const keptLists: Array<string> = [];

    for (const action of SECURITY_BLOCK_ACTIONS) {
      const list: CloudflareList | undefined = reading.lists[action];

      if (!list) {
        continue;
      }

      const read: { items: Array<CloudflareListItem>; isTruncated: boolean } =
        await this.client.listListItems({
          accountId: this.scope.accountId,
          listId: list.id,
          maxItems: CLOUDFLARE_MAX_ITEMS_READ,
        });
      const ours: Array<CloudflareListItem> = read.items.filter(
        (item: CloudflareListItem): boolean => {
          return isOneUptimeCloudflareComment(item.comment);
        },
      );

      for (const batch of chunk(ours, CLOUDFLARE_ITEMS_PER_OPERATION)) {
        const operation: CloudflareBulkOperation = await this.runOperation(
          (): Promise<string> => {
            return this.client.deleteListItems({
              accountId: this.scope.accountId,
              listId: list.id,
              itemIds: batch.map((item: CloudflareListItem): string => {
                return item.id;
              }),
            });
          },
        );

        if (operation.status === "failed") {
          throw new CloudflareBlockingError(
            `Cloudflare did not remove OneUptime's addresses from ${list.name}: ${operation.error || "the operation failed"}`,
          );
        }

        if (operation.status !== "completed") {
          // Still running: the list is deleted on a later pass, once it is empty.
          return { isDone: false, left: ours.length, keptLists };
        }
      }

      if (read.items.length > ours.length || read.isTruncated) {
        keptLists.push(list.name);
        continue;
      }

      try {
        await this.client.deleteList(this.scope.accountId, list.id);
      } catch (error) {
        if (
          !(error instanceof CloudflareApiError) ||
          error.kind !== CloudflareFailureKind.NotFound
        ) {
          throw error;
        }
      }
    }

    let left: number = 0;

    for (const action of SECURITY_BLOCK_ACTIONS) {
      const rules: Array<CloudflareAccessRule> =
        await this.readOneUptimeAccessRules(action);

      for (const rule of rules) {
        if (this.now().getTime() - startedAt >= data.budgetInMs) {
          left++;
          continue;
        }

        try {
          await this.client.deleteAccessRule(this.scope.accountId, rule.id);
        } catch (error) {
          if (
            error instanceof CloudflareApiError &&
            error.kind === CloudflareFailureKind.NotFound
          ) {
            continue;
          }

          if (
            error instanceof CloudflareApiError &&
            error.kind === CloudflareFailureKind.RateLimited
          ) {
            left++;
            continue;
          }

          throw error;
        }
      }
    }

    return { isDone: left === 0, left, keptLists };
  }

  // ---------- Whether the token may do it ----------

  /*
   * The checks blocking adds to Test Connection, and that turning blocking
   * on asks first: how it would be set up - which mechanism each action
   * takes, and why - and whether the token may write what that needs, each
   * permission asked without writing (CloudflareClient.probeWriteAccess). A
   * check that cannot tell says so, and never passes.
   */
  public async checkWriteAccess(): Promise<{
    checks: Array<SecurityConnectorCheck>;
    reading: CloudflareAccountReading | null;
  }> {
    const checks: Array<SecurityConnectorCheck> = [];
    let startedAtMs: number = Date.now();
    let reading: CloudflareAccountReading;

    try {
      reading = await this.readAccount();
    } catch (error) {
      const isPermission: boolean =
        error instanceof CloudflareApiError &&
        error.kind === CloudflareFailureKind.MissingPermission;

      checks.push(
        makeCheck({
          key: "blocking-setup",
          name: CLOUDFLARE_BLOCKING_CHECK_NAMES.unreadable,
          status: "fail",
          startedAtMs,
          message: errorText(error),
          remediation: isPermission
            ? `Give the token ${CLOUDFLARE_LIST_EDIT_PERMISSION}, and ${CLOUDFLARE_WAF_EDIT_PERMISSION} on each zone to block in.`
            : "Test again in a few minutes.",
        }),
      );
      return { checks, reading: null };
    }

    const mechanisms: Record<SecurityBlockAction, CloudflareMechanismChoice> =
      CloudflareBlocking.chooseMechanisms(reading);
    const usesLists: boolean = SECURITY_BLOCK_ACTIONS.some(
      (action: SecurityBlockAction): boolean => {
        return (
          mechanisms[action].mechanism === CloudflareBlockingMechanism.List
        );
      },
    );
    const usesAccessRules: boolean = SECURITY_BLOCK_ACTIONS.some(
      (action: SecurityBlockAction): boolean => {
        return (
          mechanisms[action].mechanism ===
          CloudflareBlockingMechanism.AccessRules
        );
      },
    );

    checks.push(
      makeCheck({
        key: "blocking-setup",
        name: CLOUDFLARE_BLOCKING_CHECK_NAMES.setup,
        status:
          reading.foreignListNames.length > 0 ||
          reading.missingZoneIds.length > 0
            ? "fail"
            : "pass",
        startedAtMs,
        message: CloudflareBlocking.describeSetupPlan(reading, mechanisms),
        ...(reading.foreignListNames.length > 0
          ? {
              remediation: `OneUptime never changes a list it did not make for this project. Rename or delete ${reading.foreignListNames.join(" and ")} in Cloudflare, or turn blocking off in the project that made it.`,
            }
          : reading.missingZoneIds.length > 0
            ? {
                remediation:
                  "Choose the zones to block in again: the token no longer reads some of them.",
              }
            : {}),
      }),
    );

    if (usesLists) {
      startedAtMs = Date.now();
      checks.push(
        await this.probeCheck({
          key: "blocking-lists",
          name: CLOUDFLARE_BLOCKING_CHECK_NAMES.lists,
          permission: CLOUDFLARE_LIST_EDIT_PERMISSION,
          startedAtMs,
          probe: (): Promise<CloudflareWriteAccess> => {
            return this.client.probeWriteAccess({
              kind: "lists",
              accountId: this.scope.accountId,
            });
          },
          passMessage: `The API token can make and change OneUptime's lists (${CLOUDFLARE_LIST_EDIT_PERMISSION}).`,
        }),
      );

      startedAtMs = Date.now();
      const missing: Array<string> = [];
      const unknown: Array<string> = [];

      for (const zone of reading.zones) {
        try {
          const access: CloudflareWriteAccess =
            await this.client.probeWriteAccess({
              kind: "rules",
              zoneId: zone.zone.id,
              rulesetId: zone.ruleset?.id || null,
            });

          if (access === CloudflareWriteAccess.Missing) {
            missing.push(zone.zone.name);
          }
        } catch {
          unknown.push(zone.zone.name);
        }
      }

      checks.push(
        makeCheck({
          key: "blocking-rules",
          name: CLOUDFLARE_BLOCKING_CHECK_NAMES.rules,
          status: missing.length ? "fail" : unknown.length ? "warn" : "pass",
          startedAtMs,
          message: missing.length
            ? `The API token cannot change the custom rules of ${missing.join(", ")}: it lacks ${CLOUDFLARE_WAF_EDIT_PERMISSION} there.`
            : unknown.length
              ? `OneUptime could not tell whether the API token can change the custom rules of ${unknown.join(", ")}. Test again in a few minutes.`
              : `The API token can add OneUptime's rules in ${reading.zones.length === 1 ? "the zone" : `all ${reading.zones.length} zones`} (${CLOUDFLARE_WAF_EDIT_PERMISSION}).`,
          ...(missing.length
            ? {
                remediation: `Edit the token in Cloudflare and give it ${CLOUDFLARE_WAF_EDIT_PERMISSION} on ${missing.length === 1 ? "this zone" : "these zones"}, or choose only the zones it can change.`,
              }
            : {}),
        }),
      );
    }

    if (usesAccessRules) {
      startedAtMs = Date.now();
      checks.push(
        await this.probeCheck({
          key: "blocking-access-rules",
          name: CLOUDFLARE_BLOCKING_CHECK_NAMES.accessRules,
          permission: CLOUDFLARE_ACCESS_RULES_EDIT_PERMISSION,
          startedAtMs,
          probe: (): Promise<CloudflareWriteAccess> => {
            return this.client.probeWriteAccess({
              kind: "access-rules",
              accountId: this.scope.accountId,
            });
          },
          passMessage: `The API token can add and remove IP Access Rules (${CLOUDFLARE_ACCESS_RULES_EDIT_PERMISSION}).`,
        }),
      );
    }

    return { checks, reading };
  }

  private async probeCheck(data: {
    key: string;
    name: string;
    permission: string;
    startedAtMs: number;
    probe: () => Promise<CloudflareWriteAccess>;
    passMessage: string;
  }): Promise<SecurityConnectorCheck> {
    try {
      const access: CloudflareWriteAccess = await data.probe();

      if (access === CloudflareWriteAccess.Granted) {
        return makeCheck({
          key: data.key,
          name: data.name,
          status: "pass",
          startedAtMs: data.startedAtMs,
          message: data.passMessage,
        });
      }

      return makeCheck({
        key: data.key,
        name: data.name,
        status: "fail",
        startedAtMs: data.startedAtMs,
        message: `The API token lacks ${data.permission}.`,
        remediation: `Edit the token in Cloudflare and add ${data.permission}, or paste a new token that has it.`,
      });
    } catch (error) {
      return makeCheck({
        key: data.key,
        name: data.name,
        status: "warn",
        startedAtMs: data.startedAtMs,
        message: `OneUptime could not tell whether the API token has ${data.permission}: ${errorText(error)}`,
        remediation: "Test again in a few minutes.",
      });
    }
  }

  /*
   * How blocking would be set up, in one paragraph: each action's
   * mechanism and why, and on a Free zone how many of its custom rules
   * OneUptime's take.
   */
  public static describeSetupPlan(
    reading: CloudflareAccountReading,
    mechanisms: Record<SecurityBlockAction, CloudflareMechanismChoice>,
  ): string {
    const sentences: Array<string> = [];

    if (reading.foreignListNames.length > 0) {
      sentences.push(
        `${reading.foreignListNames.join(" and ")} already exists in this account, made by another OneUptime project or a person.`,
      );
    }

    if (reading.missingZoneIds.length > 0) {
      sentences.push(
        `The token no longer reads ${reading.missingZoneIds.length === 1 ? "one of the zones" : `${reading.missingZoneIds.length} of the zones`} chosen to block in.`,
      );
    }

    for (const action of SECURITY_BLOCK_ACTIONS) {
      const choice: CloudflareMechanismChoice = mechanisms[action];
      const what: string =
        action === SecurityBlockAction.Block ? "Blocks" : "Challenges";

      if (choice.mechanism === CloudflareBlockingMechanism.List) {
        sentences.push(
          `${what} go to the list ${CLOUDFLARE_BLOCK_LIST_NAMES[action]}, with a custom rule in each zone.`,
        );
        continue;
      }

      sentences.push(
        choice.reason === CloudflareAccessRulesReason.NoRuleLeft
          ? `${what} go to IP Access Rules: ${choice.zoneName} uses ${choice.rulesUsed} of its ${choice.rulesLimit} custom rules.`
          : `${what} go to IP Access Rules: the account's plan has ${choice.lists === 1 ? "one list" : `${choice.lists} lists`}, and none is left.`,
      );
    }

    for (const zone of reading.zones) {
      const taken: number = SECURITY_BLOCK_ACTIONS.filter(
        (action: SecurityBlockAction): boolean => {
          return (
            mechanisms[action].mechanism === CloudflareBlockingMechanism.List
          );
        },
      ).length;

      if (zone.plan === CloudflarePlan.Free && taken > 0) {
        sentences.push(
          `On ${zone.zone.name}'s Free plan, OneUptime's ${taken === 1 ? "rule takes 1" : `rules take ${taken}`} of its ${CLOUDFLARE_PLAN_LIMITS[CloudflarePlan.Free].customRulesPerZone} custom rules.`,
        );
      }
    }

    return sentences.join(" ");
  }
}
