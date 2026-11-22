import {
  CLOUD_ARMOR_ADDRESSES_PER_RULE,
  CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY,
  CLOUD_ARMOR_ADDRESS_GROUP_DESCRIPTION,
  CLOUD_ARMOR_ADDRESS_GROUP_ITEMS_PER_CALL,
  CLOUD_ARMOR_HIGHEST_PRIORITY,
  CLOUD_ARMOR_LOWEST_PRIORITY,
  CLOUD_ARMOR_MAX_ONEUPTIME_RULES,
  CloudArmorAddressAttribute,
  CloudArmorAddressGroupNames,
  CloudArmorBlocklistMode,
  CloudArmorPolicyRef,
  CloudArmorRecordedRule,
  CloudArmorRuleDetails,
  CloudArmorRuleDrift,
  CloudArmorRuleRead,
  buildCloudArmorGroupRule,
  buildCloudArmorRule,
  chooseCloudArmorMode,
  getCloudArmorAddressAttribute,
  getCloudArmorAddressGroupNames,
  getCloudArmorPassPriority,
  getCloudArmorRequiredPermissions,
  isCloudArmorGroupRule,
  readCloudArmorPriority,
  readCloudArmorRule,
  readCloudArmorRuleIndex,
  readCloudArmorUserIpHeaders,
  toCloudArmorRange,
} from "../../../../Types/CloudConnection/CloudArmorBlocklist";
import {
  CloudWafSlotPlan,
  CloudWafSlotRefusal,
  CloudWafValueSlot,
  getCloudWafFreePriorities,
  getCloudWafValueKey,
  planCloudWafValueSlots,
} from "../../../../Types/CloudConnection/CloudWafRuleSlots";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import {
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  CLOUD_WAF_REASONS,
  cloudWafReason,
} from "../../../../Types/SecurityBlocklist/CloudWafReasons";
import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafStatus,
} from "../../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import {
  SecurityBlockReason,
  fillSecurityBlockReason,
} from "../../../../Types/SecurityBlocklist/SecurityBlockReason";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import CloudArmorApi, {
  CloudArmorOperationError,
  readGoogleError,
} from "./CloudArmorApi";

/*
 * THE BLOCKLIST'S RULES IN ONE CLOUD ARMOR SECURITY POLICY (#10349).
 *
 * One CloudArmorPolicyBlocklist per policy a project picked, for one pass
 * of the reconciler (or one Check Again, Put It Back or Remove), signed in
 * as the connection's service account.
 *
 * Rules mode: OneUptime's rules each hold up to 10 ranges. A pass reads
 * the policy once, plans what goes where (CloudWafRuleSlots), and makes
 * each change with the rule method for it - addRule for a new rule,
 * patchRule for one whose addresses changed, removeRule for one that holds
 * nothing now - one rule at a time, each waited for. Before a rule is
 * patched or removed it is read again by its priority: a rule that is no
 * longer OneUptime's there is left alone.
 *
 * Address groups mode: the project's two groups hold the addresses, items
 * added and removed with addItems and removeItems, and one rule of
 * OneUptime's in each policy denies what either holds.
 *
 * A rule of OneUptime's someone set to preview, changed or deleted - or an
 * address group someone deleted - is left as they left it: what it holds
 * is said not to be in force, and why, until Put It Back.
 */

// A rule of OneUptime's, as a read finds it.
export enum CloudArmorOwnRuleState {
  InForce = "inForce",
  ToRewrite = "toRewrite",
  TurnedOff = "turnedOff",
  Changed = "changed",
}

interface OwnRule {
  index: number;
  priority: number;
  state: CloudArmorOwnRuleState;
  values: Array<string>;
}

interface GroupRule {
  priority: number;
  state: CloudArmorOwnRuleState;
}

interface GroupRead {
  name: string;
  family: 4 | 6;
  // Null when the group is not there.
  values: Array<string> | null;
  capacity: number;
}

interface PolicyRead {
  policy: JSONObject;
  rules: Array<JSONObject>;
  own: Array<OwnRule>;
  groupRule: GroupRule | null;
  deleted: Array<CloudArmorRecordedRule>;
  passPriority: number | null;
  freePriorities: Array<number>;
  userIpHeaders: Array<string>;
  policyType: string;
}

export interface CloudArmorHeld {
  value: string;
  // The rule or group that holds it: "priority 3", "oneuptime-1a2b3c4d-block-ipv4".
  holder: string;
  notInForce: SecurityBlockReason | null;
}

export interface CloudArmorState {
  status: SecurityBlockCloudWafStatus;
  reason: SecurityBlockReason | null;
  held: Array<CloudArmorHeld>;
  details: CloudArmorRuleDetails;
  capacity: number;
  fullReason: SecurityBlockReason;
}

export interface CloudArmorWriteResult {
  value: string;
  isDone: boolean;
  holder?: string | undefined;
  reason?: SecurityBlockReason | undefined;
}

export interface CloudArmorPolicyBlocklistData {
  api: CloudArmorApi;
  policy: CloudArmorPolicyRef;
  displayName: string;
  projectSuffix: string;
  clientAddress: SecurityBlockClientAddress;
  details: CloudArmorRuleDetails | null;
}

function statusOf(error: unknown): number | undefined {
  return error instanceof LlmProviderError ? error.statusCode : undefined;
}

function isQuotaError(error: unknown): boolean {
  const text: string = readGoogleError(error).toLowerCase();

  return text.includes("quota") || text.includes("limit exceeded");
}

// A failure said as a reason: its message is the reason in English.
export class CloudArmorError extends Error {
  public readonly reason: SecurityBlockReason;

  public constructor(reason: SecurityBlockReason) {
    super(fillSecurityBlockReason(reason));
    this.reason = reason;
  }
}

export default class CloudArmorPolicyBlocklist {
  private readonly data: CloudArmorPolicyBlocklistData;
  private cached: PolicyRead | null = null;
  private groupsCache: Array<GroupRead> | null = null;
  private record: CloudArmorRuleDetails | null;
  private isWaitingForPriority: boolean;

  public constructor(data: CloudArmorPolicyBlocklistData) {
    this.data = data;
    this.record = data.details
      ? (JSON.parse(JSON.stringify(data.details)) as CloudArmorRuleDetails)
      : null;
    this.isWaitingForPriority = Boolean(data.details?.isWaitingForPriority);
  }

  private get expectedAttribute(): CloudArmorAddressAttribute {
    return getCloudArmorAddressAttribute(this.data.clientAddress);
  }

  public get mode(): CloudArmorBlocklistMode {
    return this.record?.mode || CloudArmorBlocklistMode.Rules;
  }

  public get groupNames(): CloudArmorAddressGroupNames {
    return getCloudArmorAddressGroupNames(this.data.projectSuffix);
  }

  private policyValues(): Record<string, string> {
    return { policy: this.data.displayName || this.data.policy.name };
  }

  private explainFailure(
    error: unknown,
    isWrite: boolean,
  ): SecurityBlockReason {
    if (error instanceof CloudArmorError) {
      return error.reason;
    }

    const status: number | undefined = statusOf(error);
    const permissions: Array<string> = getCloudArmorRequiredPermissions({
      region: this.data.policy.region,
      mode: this.mode,
    });

    // Compute answers a quota used up with 403 too (reason quotaExceeded): not a missing permission.
    if (isWrite && isQuotaError(error)) {
      return cloudWafReason(CLOUD_WAF_REASONS.quotaUsedUp, {
        ...this.policyValues(),
        error: readGoogleError(error),
      });
    }

    if (status === 403) {
      return cloudWafReason(
        isWrite ? CLOUD_WAF_REASONS.mayNotWrite : CLOUD_WAF_REASONS.mayNotRead,
        {
          ...this.policyValues(),
          permission: isWrite ? permissions[1]! : permissions[0]!,
        },
      );
    }

    if (status === 404) {
      return cloudWafReason(
        CLOUD_WAF_REASONS.policyNotFound,
        this.policyValues(),
      );
    }

    if (isWrite || error instanceof CloudArmorOperationError) {
      return cloudWafReason(CLOUD_WAF_REASONS.refused, {
        ...this.policyValues(),
        cloud: "Cloud Armor",
        error: readGoogleError(error),
      });
    }

    return cloudWafReason(CLOUD_WAF_REASONS.couldNotRead, {
      ...this.policyValues(),
      error: readGoogleError(error),
    });
  }

  // ---------- Reading ----------

  private classifyRule(read: CloudArmorRuleRead): CloudArmorOwnRuleState {
    if (!read.isDeny || read.attribute === null) {
      return CloudArmorOwnRuleState.Changed;
    }

    if (read.attribute !== this.expectedAttribute) {
      if (read.attribute !== this.record?.attribute) {
        return CloudArmorOwnRuleState.Changed;
      }

      return read.isPreview
        ? CloudArmorOwnRuleState.TurnedOff
        : CloudArmorOwnRuleState.ToRewrite;
    }

    return read.isPreview
      ? CloudArmorOwnRuleState.TurnedOff
      : CloudArmorOwnRuleState.InForce;
  }

  // The expression OneUptime's address groups rule reads, reading the client's address where asked.
  private groupExpression(attribute: CloudArmorAddressAttribute): string {
    const rule: JSONObject = buildCloudArmorGroupRule({
      priority: 0,
      projectSuffix: this.data.projectSuffix,
      attribute,
    });

    return String(
      ((rule["match"] as JSONObject)["expr"] as JSONObject)["expression"],
    );
  }

  private classifyGroupRule(read: CloudArmorRuleRead): CloudArmorOwnRuleState {
    const expected: string = this.groupExpression(this.expectedAttribute);
    const written: string | null = this.record
      ? this.groupExpression(this.record.attribute)
      : null;

    if (!read.isDeny) {
      return CloudArmorOwnRuleState.Changed;
    }

    if (read.expression === expected) {
      return read.isPreview
        ? CloudArmorOwnRuleState.TurnedOff
        : CloudArmorOwnRuleState.InForce;
    }

    if (written !== null && read.expression === written) {
      return read.isPreview
        ? CloudArmorOwnRuleState.TurnedOff
        : CloudArmorOwnRuleState.ToRewrite;
    }

    return CloudArmorOwnRuleState.Changed;
  }

  // The policy, read once until it is written; again when asked.
  public async read(force: boolean = false): Promise<PolicyRead> {
    if (this.cached && !force) {
      return this.cached;
    }

    let policy: JSONObject;

    try {
      policy = await this.data.api.getPolicy(this.data.policy);
    } catch (error) {
      throw new CloudArmorError(this.explainFailure(error, false));
    }

    const rules: Array<JSONObject> = (
      Array.isArray(policy["rules"])
        ? (policy["rules"] as Array<JSONValue>)
        : []
    ).map((rule: JSONValue): JSONObject => {
      return rule && typeof rule === "object" && !Array.isArray(rule)
        ? (rule as JSONObject)
        : {};
    });
    const own: Array<OwnRule> = [];
    let groupRule: GroupRule | null = null;

    for (const rule of rules) {
      const read: CloudArmorRuleRead = readCloudArmorRule(rule);
      const priority: number | null = read.priority;

      if (priority === null) {
        continue;
      }

      if (isCloudArmorGroupRule(read.description, this.data.projectSuffix)) {
        groupRule = groupRule || {
          priority,
          state: this.classifyGroupRule(read),
        };
        continue;
      }

      const index: number | null = readCloudArmorRuleIndex(
        read.description,
        this.data.projectSuffix,
      );

      if (index === null) {
        continue;
      }

      const seen: Set<string> = new Set();

      own.push({
        index,
        priority,
        state: this.classifyRule(read),
        values: read.values.filter((value: string): boolean => {
          const key: string = getCloudWafValueKey(value);

          if (seen.has(key)) {
            return false;
          }

          seen.add(key);
          return true;
        }),
      });
    }

    own.sort((a: OwnRule, b: OwnRule): number => {
      return a.index - b.index;
    });

    const liveIndexes: Set<number> = new Set(
      own.map((rule: OwnRule): number => {
        return rule.index;
      }),
    );
    const passPriority: number | null = getCloudArmorPassPriority(rules);
    const usedPriorities: Array<number> = rules
      .map((rule: JSONObject): number | null => {
        return readCloudArmorPriority(rule);
      })
      .filter((priority: number | null): priority is number => {
        return priority !== null;
      });

    this.cached = {
      policy,
      rules,
      own,
      groupRule,
      deleted: (this.record?.rules || [])
        .filter((rule: CloudArmorRecordedRule): boolean => {
          return !liveIndexes.has(rule.index);
        })
        .map((rule: CloudArmorRecordedRule): CloudArmorRecordedRule => {
          return { ...rule, values: [...rule.values] };
        }),
      passPriority,
      freePriorities: getCloudWafFreePriorities({
        usedPriorities,
        passPriority,
        lowest: CLOUD_ARMOR_LOWEST_PRIORITY,
        highest: CLOUD_ARMOR_HIGHEST_PRIORITY,
        limit: CLOUD_ARMOR_MAX_ONEUPTIME_RULES,
      }),
      userIpHeaders: readCloudArmorUserIpHeaders(policy),
      policyType:
        typeof policy["type"] === "string"
          ? (policy["type"] as string)
          : "CLOUD_ARMOR",
    };

    return this.cached;
  }

  // The project's address groups, read once until written: what each holds, or null when it is not there.
  private async readGroups(force: boolean = false): Promise<Array<GroupRead>> {
    if (this.groupsCache && !force) {
      return this.groupsCache;
    }

    const names: CloudArmorAddressGroupNames = this.groupNames;
    const groups: Array<GroupRead> = [];

    for (const [name, family] of [
      [names.ipv4, 4],
      [names.ipv6, 6],
    ] as Array<[string, 4 | 6]>) {
      let group: JSONObject | null;

      try {
        group = await this.data.api.getAddressGroup({
          project: this.data.policy.project,
          location: "global",
          name,
        });
      } catch (error) {
        throw new CloudArmorError(this.explainFailure(error, false));
      }

      const values: Array<string> = [];

      for (const item of Array.isArray(group?.["items"])
        ? (group!["items"] as Array<JSONValue>)
        : []) {
        const read: SecurityBlockValue | null = readSecurityBlockValue(item);

        if (read) {
          values.push(read.value);
        }
      }

      const capacity: unknown = group?.["capacity"];

      groups.push({
        name,
        family,
        values: group ? values : null,
        capacity:
          typeof capacity === "number" && capacity > 0
            ? capacity
            : family === 4
              ? CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv4
              : CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv6,
      });
    }

    this.groupsCache = groups;

    return groups;
  }

  public getDetails(): CloudArmorRuleDetails {
    const read: PolicyRead | null = this.cached;
    const base: CloudArmorRuleDetails = this.record || {
      mode: CloudArmorBlocklistMode.Rules,
      policyType: read?.policyType || "CLOUD_ARMOR",
      attribute: this.expectedAttribute,
      rules: [],
      groupRulePriority: null,
      groups: null,
      nextIndex: 1,
      drift: [],
      freePriorities: [],
      isWaitingForPriority: false,
      userIpHeaders: [],
      tier: "",
    };

    if (!read) {
      return { ...base, isWaitingForPriority: this.isWaitingForPriority };
    }

    const drift: CloudArmorRuleDetails["drift"] = [
      ...read.own
        .filter((rule: OwnRule): boolean => {
          return (
            rule.state === CloudArmorOwnRuleState.TurnedOff ||
            rule.state === CloudArmorOwnRuleState.Changed
          );
        })
        .map((rule: OwnRule) => {
          return {
            priority: rule.priority,
            index: rule.index,
            drift:
              rule.state === CloudArmorOwnRuleState.TurnedOff
                ? CloudArmorRuleDrift.TurnedOff
                : CloudArmorRuleDrift.Changed,
          };
        }),
      ...read.deleted.map((rule: CloudArmorRecordedRule) => {
        return {
          priority: rule.priority,
          index: rule.index,
          drift: CloudArmorRuleDrift.Deleted,
        };
      }),
    ];

    if (base.mode === CloudArmorBlocklistMode.AddressGroups) {
      if (
        read.groupRule &&
        read.groupRule.state !== CloudArmorOwnRuleState.InForce &&
        read.groupRule.state !== CloudArmorOwnRuleState.ToRewrite
      ) {
        drift.push({
          priority: read.groupRule.priority,
          index: 0,
          drift:
            read.groupRule.state === CloudArmorOwnRuleState.TurnedOff
              ? CloudArmorRuleDrift.TurnedOff
              : CloudArmorRuleDrift.Changed,
        });
      } else if (!read.groupRule && base.groupRulePriority !== null) {
        drift.push({
          priority: base.groupRulePriority,
          index: 0,
          drift: CloudArmorRuleDrift.Deleted,
        });
      }
    }

    return {
      ...base,
      policyType: read.policyType,
      drift,
      freePriorities: read.freePriorities,
      isWaitingForPriority: this.isWaitingForPriority,
      userIpHeaders: read.userIpHeaders,
      nextIndex: Math.max(
        base.nextIndex,
        ...read.own.map((rule: OwnRule): number => {
          return rule.index + 1;
        }),
        1,
      ),
    };
  }

  private ruleReason(
    drift: CloudArmorRuleDrift,
    priority: number,
  ): SecurityBlockReason {
    return cloudWafReason(
      drift === CloudArmorRuleDrift.TurnedOff
        ? CLOUD_WAF_REASONS.priorityRuleTurnedOff
        : drift === CloudArmorRuleDrift.Changed
          ? CLOUD_WAF_REASONS.priorityRuleChanged
          : CLOUD_WAF_REASONS.priorityRuleDeleted,
      { ...this.policyValues(), priority: String(priority) },
    );
  }

  private noRoomReason(
    read: PolicyRead,
    refusal: CloudWafSlotRefusal,
  ): SecurityBlockReason {
    if (refusal === CloudWafSlotRefusal.Full) {
      return cloudWafReason(CLOUD_WAF_REASONS.rulesFull, this.policyValues(), {
        addresses:
          CLOUD_ARMOR_MAX_ONEUPTIME_RULES * CLOUD_ARMOR_ADDRESSES_PER_RULE,
      });
    }

    return read.passPriority === null
      ? cloudWafReason(CLOUD_WAF_REASONS.noFreePriorityAtAll, {
          ...this.policyValues(),
          lowest: String(CLOUD_ARMOR_LOWEST_PRIORITY),
          highest: String(CLOUD_ARMOR_HIGHEST_PRIORITY),
        })
      : cloudWafReason(CLOUD_WAF_REASONS.noFreePriority, {
          ...this.policyValues(),
          priority: String(read.passPriority),
        });
  }

  /*
   * Where the policy stands and what it holds of OneUptime's, from a read:
   * each rule's addresses (or each group's), in force, or not and why.
   */
  public async readState(force: boolean = false): Promise<CloudArmorState> {
    const read: PolicyRead = await this.read(force);
    const held: Array<CloudArmorHeld> = [];
    let drift: SecurityBlockReason | null = null;
    let capacity: number = 0;
    let isStuck: boolean = false;

    if (this.mode === CloudArmorBlocklistMode.AddressGroups) {
      const groups: Array<GroupRead> = await this.readGroups(force);
      const ruleReason: SecurityBlockReason | null = read.groupRule
        ? read.groupRule.state === CloudArmorOwnRuleState.TurnedOff
          ? this.ruleReason(
              CloudArmorRuleDrift.TurnedOff,
              read.groupRule.priority,
            )
          : read.groupRule.state === CloudArmorOwnRuleState.Changed
            ? this.ruleReason(
                CloudArmorRuleDrift.Changed,
                read.groupRule.priority,
              )
            : null
        : this.record?.groupRulePriority !== null &&
            this.record?.groupRulePriority !== undefined
          ? this.ruleReason(
              CloudArmorRuleDrift.Deleted,
              this.record.groupRulePriority,
            )
          : null;

      drift = ruleReason;

      for (const group of groups) {
        if (group.values === null) {
          if (this.record?.groups) {
            drift =
              drift ||
              cloudWafReason(CLOUD_WAF_REASONS.groupDeleted, {
                group: group.name,
              });
          }

          continue;
        }

        capacity += group.capacity;

        for (const value of group.values) {
          held.push({
            value,
            holder: group.name,
            // A group holds its items whatever the rule; the rule decides whether they are in force.
            notInForce: ruleReason,
          });
        }
      }

      isStuck = !read.groupRule && read.freePriorities.length === 0;
    } else {
      for (const rule of read.own) {
        const ruleDrift: CloudArmorRuleDrift | null =
          rule.state === CloudArmorOwnRuleState.TurnedOff
            ? CloudArmorRuleDrift.TurnedOff
            : rule.state === CloudArmorOwnRuleState.Changed
              ? CloudArmorRuleDrift.Changed
              : null;
        const ruleReason: SecurityBlockReason | null = ruleDrift
          ? this.ruleReason(ruleDrift, rule.priority)
          : null;

        drift = drift || ruleReason;

        for (const value of rule.values) {
          held.push({
            value,
            holder: `priority ${rule.priority}`,
            notInForce: ruleReason,
          });
        }
      }

      for (const rule of read.deleted) {
        const ruleReason: SecurityBlockReason = this.ruleReason(
          CloudArmorRuleDrift.Deleted,
          rule.priority,
        );

        drift = drift || ruleReason;

        for (const value of rule.values) {
          held.push({
            value,
            holder: `priority ${rule.priority}`,
            notInForce: ruleReason,
          });
        }
      }

      const ownRules: number = read.own.length + read.deleted.length;
      const addable: number = Math.max(
        0,
        Math.min(
          read.freePriorities.length,
          CLOUD_ARMOR_MAX_ONEUPTIME_RULES - ownRules,
        ),
      );

      capacity = CLOUD_ARMOR_ADDRESSES_PER_RULE * (ownRules + addable);
      isStuck = ownRules === 0 && read.freePriorities.length === 0;
    }

    let status: SecurityBlockCloudWafStatus =
      SecurityBlockCloudWafStatus.Enforcing;
    let reason: SecurityBlockReason | null = null;

    if (drift) {
      status = SecurityBlockCloudWafStatus.Drifted;
      reason = drift;
    } else if (
      isStuck ||
      (this.isWaitingForPriority && read.freePriorities.length === 0)
    ) {
      status = SecurityBlockCloudWafStatus.NoFreePriority;
      reason = this.noRoomReason(read, CloudWafSlotRefusal.NoFreePriority);
    }

    return {
      status,
      reason,
      held,
      details: this.getDetails(),
      capacity,
      fullReason: this.noRoomReason(
        read,
        read.freePriorities.length === 0
          ? CloudWafSlotRefusal.NoFreePriority
          : CloudWafSlotRefusal.Full,
      ),
    };
  }

  // ---------- Setting up ----------

  /*
   * What Check Again does first: the mode picked, once, from the project's
   * Cloud Armor tier and the policy's type - address groups for a global
   * backend policy of an Enterprise project, rules otherwise - and, in
   * address groups mode, the groups made and OneUptime's rule placed.
   */
  public async setUp(): Promise<CloudArmorState> {
    const read: PolicyRead = await this.read();

    if (!this.record) {
      let tier: string = "";

      try {
        tier = await this.data.api.getProjectTier(this.data.policy.project);
      } catch (error) {
        throw new CloudArmorError(this.explainFailure(error, false));
      }

      this.record = {
        mode: chooseCloudArmorMode({
          tier,
          policyType: read.policyType,
          region: this.data.policy.region,
        }),
        policyType: read.policyType,
        attribute: this.expectedAttribute,
        rules: [],
        groupRulePriority: null,
        groups: null,
        nextIndex: 1,
        drift: [],
        freePriorities: read.freePriorities,
        isWaitingForPriority: false,
        userIpHeaders: read.userIpHeaders,
        tier,
      };
    }

    if (this.mode === CloudArmorBlocklistMode.AddressGroups) {
      await this.ensureGroupsAndRule();
    } else {
      await this.rewriteIfNeeded();
    }

    return await this.readState(true);
  }

  /*
   * Address groups mode: the two groups made where they never were, and
   * OneUptime's rule placed in the policy where it never was. A group or a
   * rule someone deleted is not made again (Put It Back does).
   */
  private async ensureGroupsAndRule(
    isPuttingBack: boolean = false,
  ): Promise<void> {
    const groups: Array<GroupRead> = await this.readGroups();
    const names: CloudArmorAddressGroupNames = this.groupNames;

    if (!this.record?.groups || isPuttingBack) {
      for (const group of groups) {
        if (group.values !== null) {
          continue;
        }

        try {
          await this.data.api.createAddressGroup({
            project: this.data.policy.project,
            location: "global",
            name: group.name,
            type: group.family === 4 ? "IPV4" : "IPV6",
            capacity:
              group.family === 4
                ? CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv4
                : CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv6,
            description: CLOUD_ARMOR_ADDRESS_GROUP_DESCRIPTION,
          });
        } catch (error) {
          throw new CloudArmorError(this.explainFailure(error, true));
        }
      }

      this.groupsCache = null;
      this.record = { ...this.getDetails(), groups: names };
    }

    const read: PolicyRead = await this.read();
    const isDeleted: boolean =
      !read.groupRule && this.record!.groupRulePriority !== null;

    if (
      read.groupRule &&
      read.groupRule.state === CloudArmorOwnRuleState.ToRewrite
    ) {
      await this.writeGroupRule(read.groupRule.priority, true);
      return;
    }

    if (read.groupRule || (isDeleted && !isPuttingBack)) {
      return;
    }

    const wanted: number | null = this.record!.groupRulePriority;
    const priority: number | undefined =
      wanted !== null && read.freePriorities.includes(wanted)
        ? wanted
        : read.freePriorities[0];

    if (priority === undefined) {
      this.isWaitingForPriority = true;
      return;
    }

    await this.writeGroupRule(priority, false);
  }

  private async writeGroupRule(
    priority: number,
    isPatch: boolean,
  ): Promise<void> {
    const rule: JSONObject = buildCloudArmorGroupRule({
      priority,
      projectSuffix: this.data.projectSuffix,
      attribute: this.expectedAttribute,
    });

    try {
      if (isPatch) {
        await this.data.api.patchRule(this.data.policy, priority, rule);
      } else {
        await this.data.api.addRule(this.data.policy, rule);
      }
    } catch (error) {
      throw new CloudArmorError(this.explainFailure(error, true));
    }

    this.cached = null;
    this.isWaitingForPriority = false;
    this.record = {
      ...this.getDetails(),
      groupRulePriority: priority,
      attribute: this.expectedAttribute,
    };
  }

  // ---------- Changing ----------

  /*
   * What a pass removes and adds. Rules mode: one rule method a rule that
   * changes. Address groups mode: one addItems and one removeItems a group
   * that changes. Every value asked for is answered.
   */
  public async change(changes: {
    add: Array<string>;
    remove: Array<string>;
  }): Promise<{
    added: Array<CloudArmorWriteResult>;
    removed: Array<CloudArmorWriteResult>;
  }> {
    const addable: Array<string> = [];
    const refused: Array<CloudArmorWriteResult> = [];

    for (const value of changes.add) {
      if (toCloudArmorRange(value)) {
        addable.push(value);
      } else {
        refused.push({
          value,
          isDone: false,
          reason: cloudWafReason(CLOUD_WAF_REASONS.notAnAddress, {
            product: "Cloud Armor",
          }),
        });
      }
    }

    try {
      const result: {
        added: Array<CloudArmorWriteResult>;
        removed: Array<CloudArmorWriteResult>;
      } =
        this.mode === CloudArmorBlocklistMode.AddressGroups
          ? await this.changeGroups({ add: addable, remove: changes.remove })
          : await this.changeRules({ add: addable, remove: changes.remove });

      return { added: [...result.added, ...refused], removed: result.removed };
    } catch (error) {
      const reason: SecurityBlockReason = this.explainFailure(error, true);

      return {
        added: [
          ...addable.map((value: string): CloudArmorWriteResult => {
            return { value, isDone: false, reason };
          }),
          ...refused,
        ],
        removed: changes.remove.map((value: string): CloudArmorWriteResult => {
          return { value, isDone: false, reason };
        }),
      };
    }
  }

  private async changeGroups(changes: {
    add: Array<string>;
    remove: Array<string>;
  }): Promise<{
    added: Array<CloudArmorWriteResult>;
    removed: Array<CloudArmorWriteResult>;
  }> {
    if (!this.record?.groups) {
      await this.ensureGroupsAndRule();
    }

    const groups: Array<GroupRead> = await this.readGroups();
    const added: Array<CloudArmorWriteResult> = [];
    const removed: Array<CloudArmorWriteResult> = [];

    for (const group of groups) {
      const familyOf: (value: string) => boolean = (value: string): boolean => {
        return readSecurityBlockValue(value)?.block.family === group.family;
      };
      const adding: Array<string> = changes.add.filter(familyOf);
      const removing: Array<string> = changes.remove.filter(familyOf);

      if (group.values === null) {
        // Deleted by hand: nothing is put in it, nor made again, until Put It Back.
        const reason: SecurityBlockReason = cloudWafReason(
          CLOUD_WAF_REASONS.groupDeleted,
          { group: group.name },
        );

        added.push(
          ...adding.map((value: string): CloudArmorWriteResult => {
            return { value, isDone: false, reason };
          }),
        );
        removed.push(
          ...removing.map((value: string): CloudArmorWriteResult => {
            return { value, isDone: true };
          }),
        );
        continue;
      }

      const held: Set<string> = new Set(group.values.map(getCloudWafValueKey));
      const toRemove: Array<string> = removing.filter((value: string) => {
        return held.has(getCloudWafValueKey(value));
      });

      for (const value of toRemove) {
        held.delete(getCloudWafValueKey(value));
      }

      const room: number = Math.max(0, group.capacity - held.size);
      const toAdd: Array<string> = [];

      for (const value of adding) {
        const key: string = getCloudWafValueKey(value);

        if (held.has(key)) {
          added.push({ value, isDone: true, holder: group.name });
          continue;
        }

        if (toAdd.length >= room) {
          added.push({
            value,
            isDone: false,
            reason: cloudWafReason(
              CLOUD_WAF_REASONS.groupFull,
              { group: group.name },
              { capacity: group.capacity },
            ),
          });
          continue;
        }

        held.add(key);
        toAdd.push(value);
      }

      const perCall: number =
        group.family === 4
          ? CLOUD_ARMOR_ADDRESS_GROUP_ITEMS_PER_CALL.ipv4
          : CLOUD_ARMOR_ADDRESS_GROUP_ITEMS_PER_CALL.ipv6;
      const ranges: (values: Array<string>) => Array<string> = (
        values: Array<string>,
      ): Array<string> => {
        return values
          .map((value: string): string | null => {
            return toCloudArmorRange(value);
          })
          .filter((range: string | null): range is string => {
            return Boolean(range);
          });
      };

      for (let start: number = 0; start < toRemove.length; start += perCall) {
        await this.data.api.changeAddressGroupItems({
          project: this.data.policy.project,
          location: "global",
          name: group.name,
          items: ranges(toRemove.slice(start, start + perCall)),
          isAdding: false,
        });
      }

      removed.push(
        ...removing.map((value: string): CloudArmorWriteResult => {
          return { value, isDone: true };
        }),
      );

      for (let start: number = 0; start < toAdd.length; start += perCall) {
        await this.data.api.changeAddressGroupItems({
          project: this.data.policy.project,
          location: "global",
          name: group.name,
          items: ranges(toAdd.slice(start, start + perCall)),
          isAdding: true,
        });
      }

      added.push(
        ...toAdd.map((value: string): CloudArmorWriteResult => {
          return { value, isDone: true, holder: group.name };
        }),
      );
    }

    this.groupsCache = null;

    // The rule that denies what the groups hold, placed when it never was.
    if (
      added.some((result: CloudArmorWriteResult): boolean => {
        return result.isDone;
      })
    ) {
      await this.ensureGroupsAndRule();
    }

    return { added, removed };
  }

  // Whether the rule at a priority is still this rule of OneUptime's, read again before it is written.
  private async isStillOwn(priority: number, index: number): Promise<boolean> {
    const rule: JSONObject | null = await this.data.api.getRule(
      this.data.policy,
      priority,
    );

    return (
      rule !== null &&
      readCloudArmorRuleIndex(rule["description"], this.data.projectSuffix) ===
        index
    );
  }

  private async changeRules(changes: {
    add: Array<string>;
    remove: Array<string>;
  }): Promise<{
    added: Array<CloudArmorWriteResult>;
    removed: Array<CloudArmorWriteResult>;
  }> {
    const read: PolicyRead = await this.read();
    const removing: Set<string> = new Set(
      changes.remove.map(getCloudWafValueKey),
    );
    const slots: Array<CloudWafValueSlot> = read.own
      .filter((rule: OwnRule): boolean => {
        return rule.state !== CloudArmorOwnRuleState.Changed;
      })
      .map((rule: OwnRule): CloudWafValueSlot => {
        return {
          index: rule.index,
          priority: rule.priority,
          values: [...rule.values],
          isFrozen: rule.state === CloudArmorOwnRuleState.TurnedOff,
        };
      });
    const changed: number = read.own.filter((rule: OwnRule): boolean => {
      return rule.state === CloudArmorOwnRuleState.Changed;
    }).length;
    const plan: CloudWafSlotPlan = planCloudWafValueSlots({
      slots,
      add: changes.add,
      remove: changes.remove,
      perSlot: CLOUD_ARMOR_ADDRESSES_PER_RULE,
      maxSlots: Math.max(
        0,
        CLOUD_ARMOR_MAX_ONEUPTIME_RULES - read.deleted.length - changed,
      ),
      freePriorities: read.freePriorities,
      nextIndex: Math.max(
        this.record?.nextIndex || 1,
        ...read.deleted.map((rule: CloudArmorRecordedRule): number => {
          return rule.index + 1;
        }),
      ),
    });
    const byIndex: Map<number, OwnRule> = new Map(
      read.own.map((rule: OwnRule): [number, OwnRule] => {
        return [rule.index, rule];
      }),
    );
    const failed: Map<number, SecurityBlockReason> = new Map();
    const writtenSlots: Array<CloudWafValueSlot> = [];

    const build: (slot: CloudWafValueSlot) => JSONObject = (
      slot: CloudWafValueSlot,
    ): JSONObject => {
      const rule: JSONObject = buildCloudArmorRule({
        priority: slot.priority,
        projectSuffix: this.data.projectSuffix,
        index: slot.index,
        values: slot.values,
        attribute: this.expectedAttribute,
      });

      // A rule someone set to preview stays in preview: only its addresses change.
      if (byIndex.get(slot.index)?.state === CloudArmorOwnRuleState.TurnedOff) {
        rule["preview"] = true;
      }

      return rule;
    };

    for (const slot of plan.emptied) {
      try {
        if (await this.isStillOwn(slot.priority, slot.index)) {
          await this.data.api.removeRule(this.data.policy, slot.priority);
        }
      } catch (error) {
        failed.set(slot.index, this.explainFailure(error, true));
        writtenSlots.push(slot);
      }
    }

    const toPatch: Array<CloudWafValueSlot> = [
      ...plan.changed,
      ...plan.slots.filter((slot: CloudWafValueSlot): boolean => {
        return (
          byIndex.get(slot.index)?.state === CloudArmorOwnRuleState.ToRewrite &&
          !plan.changed.includes(slot)
        );
      }),
    ];

    for (const slot of plan.slots) {
      const isNew: boolean = plan.created.includes(slot);
      const isPatched: boolean = toPatch.includes(slot);

      if (!isNew && !isPatched) {
        writtenSlots.push(slot);
        continue;
      }

      try {
        if (isNew) {
          await this.data.api.addRule(this.data.policy, build(slot));
        } else if (await this.isStillOwn(slot.priority, slot.index)) {
          await this.data.api.patchRule(
            this.data.policy,
            slot.priority,
            build(slot),
          );
        }

        writtenSlots.push(slot);
      } catch (error) {
        failed.set(slot.index, this.explainFailure(error, true));

        // What it held before stays recorded as it was.
        const before: OwnRule | undefined = byIndex.get(slot.index);

        if (before) {
          writtenSlots.push({
            index: before.index,
            priority: before.priority,
            values: [...before.values],
            isFrozen: slot.isFrozen,
          });
        }
      }
    }

    this.cached = null;

    if (changes.add.length > 0) {
      this.isWaitingForPriority = plan.added.some(
        (addition: CloudWafSlotPlan["added"][number]): boolean => {
          return addition.refusal === CloudWafSlotRefusal.NoFreePriority;
        },
      );
    }

    const meant: Map<number, CloudArmorRecordedRule> = new Map(
      (this.record?.rules || []).map(
        (rule: CloudArmorRecordedRule): [number, CloudArmorRecordedRule] => {
          return [rule.index, rule];
        },
      ),
    );
    const deleted: Array<CloudArmorRecordedRule> = read.deleted
      .map((rule: CloudArmorRecordedRule): CloudArmorRecordedRule => {
        return {
          ...rule,
          values: rule.values.filter((value: string): boolean => {
            return !removing.has(getCloudWafValueKey(value));
          }),
        };
      })
      .filter((rule: CloudArmorRecordedRule): boolean => {
        return rule.values.length > 0;
      });

    this.record = {
      ...this.getDetails(),
      attribute:
        failed.size === 0
          ? this.expectedAttribute
          : this.record?.attribute || this.expectedAttribute,
      rules: [
        ...writtenSlots.map(
          (slot: CloudWafValueSlot): CloudArmorRecordedRule => {
            return {
              index: slot.index,
              priority: slot.priority,
              values: [...slot.values],
            };
          },
        ),
        // A rule changed by hand keeps what OneUptime meant it to hold, less what this pass removed.
        ...read.own
          .filter((rule: OwnRule): boolean => {
            return rule.state === CloudArmorOwnRuleState.Changed;
          })
          .map((rule: OwnRule): CloudArmorRecordedRule => {
            return {
              index: rule.index,
              priority: rule.priority,
              values: (meant.get(rule.index)?.values || rule.values).filter(
                (value: string): boolean => {
                  return !removing.has(getCloudWafValueKey(value));
                },
              ),
            };
          }),
        ...deleted,
      ].sort((a: CloudArmorRecordedRule, b: CloudArmorRecordedRule): number => {
        return a.index - b.index;
      }),
      nextIndex: Math.max(
        this.record?.nextIndex || 1,
        ...plan.slots.map((slot: CloudWafValueSlot): number => {
          return slot.index + 1;
        }),
      ),
    };

    const slotOf: Map<string, number> = new Map();

    for (const addition of plan.added) {
      if (addition.slotIndex !== undefined) {
        slotOf.set(getCloudWafValueKey(addition.value), addition.slotIndex);
      }
    }

    return {
      added: plan.added.map(
        (
          addition: CloudWafSlotPlan["added"][number],
        ): CloudArmorWriteResult => {
          if (!addition.isDone) {
            return {
              value: addition.value,
              isDone: false,
              reason: this.noRoomReason(read, addition.refusal!),
            };
          }

          const reason: SecurityBlockReason | undefined = failed.get(
            addition.slotIndex!,
          );

          return reason
            ? { value: addition.value, isDone: false, reason }
            : {
                value: addition.value,
                isDone: true,
                holder: `priority ${
                  plan.slots.find((slot: CloudWafValueSlot): boolean => {
                    return slot.index === addition.slotIndex;
                  })?.priority ?? ""
                }`,
              };
        },
      ),
      removed: changes.remove.map((value: string): CloudArmorWriteResult => {
        const holder: OwnRule | undefined = read.own.find(
          (rule: OwnRule): boolean => {
            return rule.values.some((candidate: string): boolean => {
              return (
                getCloudWafValueKey(candidate) === getCloudWafValueKey(value)
              );
            });
          },
        );
        const reason: SecurityBlockReason | undefined = holder
          ? failed.get(holder.index)
          : undefined;

        return reason
          ? { value, isDone: false, reason }
          : { value, isDone: true };
      }),
    };
  }

  /*
   * OneUptime's rules written again with the address the policy is now set
   * to read, when the person changed it in OneUptime since they were
   * written: a pass's first step.
   */
  public async rewriteIfNeeded(): Promise<boolean> {
    if (!this.record) {
      return false;
    }

    if (this.mode === CloudArmorBlocklistMode.AddressGroups) {
      const read: PolicyRead = await this.read();

      if (read.groupRule?.state === CloudArmorOwnRuleState.ToRewrite) {
        await this.writeGroupRule(read.groupRule.priority, true);
        return true;
      }

      return false;
    }

    const read: PolicyRead = await this.read();

    if (
      !read.own.some((rule: OwnRule): boolean => {
        return rule.state === CloudArmorOwnRuleState.ToRewrite;
      })
    ) {
      return false;
    }

    const result: { removed: Array<CloudArmorWriteResult> } =
      await this.changeRules({ add: [], remove: [] });

    void result;

    return true;
  }

  /*
   * Put It Back: every rule of OneUptime's someone set to preview or
   * changed written again as OneUptime writes it, every rule someone
   * deleted added again with what OneUptime last wrote in it - at its own
   * priority while that is free, else the lowest free one - and, in address
   * groups mode, a deleted group made again (empty: the next pass fills it).
   */
  public async putBack(): Promise<CloudArmorState> {
    const read: PolicyRead = await this.read(true);

    if (this.mode === CloudArmorBlocklistMode.AddressGroups) {
      if (
        read.groupRule &&
        (read.groupRule.state === CloudArmorOwnRuleState.TurnedOff ||
          read.groupRule.state === CloudArmorOwnRuleState.Changed)
      ) {
        await this.writeGroupRule(read.groupRule.priority, true);
      }

      await this.ensureGroupsAndRule(true);

      return await this.readState(true);
    }

    const free: Array<number> = [...read.freePriorities];
    const recorded: Map<number, CloudArmorRecordedRule> = new Map(
      (this.record?.rules || []).map(
        (rule: CloudArmorRecordedRule): [number, CloudArmorRecordedRule] => {
          return [rule.index, rule];
        },
      ),
    );
    const written: Array<CloudArmorRecordedRule> = [];
    const stillDeleted: Array<CloudArmorRecordedRule> = [];

    for (const rule of read.own) {
      const isRestored: boolean =
        rule.state === CloudArmorOwnRuleState.TurnedOff ||
        rule.state === CloudArmorOwnRuleState.Changed;
      const meant: Array<string> | undefined = recorded.get(rule.index)?.values;
      // What OneUptime last meant it to hold - never what the person left in it.
      const values: Array<string> =
        isRestored && meant
          ? [...meant]
          : rule.values.length > 0
            ? rule.values
            : meant || [];

      if (isRestored) {
        try {
          await this.data.api.patchRule(
            this.data.policy,
            rule.priority,
            buildCloudArmorRule({
              priority: rule.priority,
              projectSuffix: this.data.projectSuffix,
              index: rule.index,
              values,
              attribute: this.expectedAttribute,
            }),
          );
        } catch (error) {
          throw new CloudArmorError(this.explainFailure(error, true));
        }
      }

      written.push({ index: rule.index, priority: rule.priority, values });
    }

    for (const rule of read.deleted) {
      if (rule.values.length === 0) {
        continue;
      }

      const own: number = free.indexOf(rule.priority);
      const priority: number | undefined =
        own >= 0 ? free.splice(own, 1)[0] : free.shift();

      if (priority === undefined) {
        stillDeleted.push(rule);
        continue;
      }

      try {
        await this.data.api.addRule(
          this.data.policy,
          buildCloudArmorRule({
            priority,
            projectSuffix: this.data.projectSuffix,
            index: rule.index,
            values: rule.values,
            attribute: this.expectedAttribute,
          }),
        );
      } catch (error) {
        throw new CloudArmorError(this.explainFailure(error, true));
      }

      written.push({ index: rule.index, priority, values: [...rule.values] });
    }

    this.cached = null;
    this.isWaitingForPriority = stillDeleted.length > 0;
    this.record = {
      ...this.getDetails(),
      attribute: this.expectedAttribute,
      rules: [...written, ...stillDeleted].sort(
        (a: CloudArmorRecordedRule, b: CloudArmorRecordedRule): number => {
          return a.index - b.index;
        },
      ),
    };

    return await this.readState(true);
  }

  /*
   * Every rule of OneUptime's taken out of the policy, read again by its
   * priority first so a rule that is not OneUptime's any more is never
   * removed. The address groups are the caller's to delete, once no other
   * policy of the project uses them (removeGroups).
   */
  public async removeAll(): Promise<void> {
    const read: PolicyRead = await this.read(true);
    const priorities: Array<{ priority: number; index: number | null }> = [
      ...read.own.map((rule: OwnRule) => {
        return { priority: rule.priority, index: rule.index };
      }),
      ...(read.groupRule
        ? [{ priority: read.groupRule.priority, index: null }]
        : []),
    ];

    for (const item of priorities) {
      try {
        const rule: JSONObject | null = await this.data.api.getRule(
          this.data.policy,
          item.priority,
        );
        const isOwn: boolean =
          rule !== null &&
          (item.index === null
            ? isCloudArmorGroupRule(
                rule["description"],
                this.data.projectSuffix,
              )
            : readCloudArmorRuleIndex(
                rule["description"],
                this.data.projectSuffix,
              ) === item.index);

        if (isOwn) {
          await this.data.api.removeRule(this.data.policy, item.priority);
        }
      } catch (error) {
        throw new CloudArmorError(this.explainFailure(error, true));
      }
    }

    this.cached = null;
    this.record = {
      ...this.getDetails(),
      rules: [],
      drift: [],
      groupRulePriority: null,
    };
  }

  // The project's address groups deleted: when no policy of the project uses them any more.
  public async removeGroups(): Promise<Array<string>> {
    const left: Array<string> = [];

    for (const name of [this.groupNames.ipv4, this.groupNames.ipv6]) {
      try {
        await this.data.api.deleteAddressGroup({
          project: this.data.policy.project,
          location: "global",
          name,
        });
      } catch {
        // Still referenced by a rule of the customer's, or not OneUptime's to delete: left, and named.
        left.push(name);
      }
    }

    this.groupsCache = null;

    return left;
  }

  /*
   * Whether the connection's service account may read and write the
   * policy (and, in address groups mode, its groups), asked without
   * writing anything: testIamPermissions on the policy's project.
   */
  public async checkAccess(): Promise<
    Array<{ permission: string; isGranted: boolean }>
  > {
    const wanted: Array<string> = getCloudArmorRequiredPermissions({
      region: this.data.policy.region,
      mode: this.record?.mode || (await this.readWouldBeMode()),
    });
    const granted: Set<string> = await this.data.api.testPermissions({
      project: this.data.policy.project,
      permissions: wanted,
    });

    return wanted.map((permission: string) => {
      return { permission, isGranted: granted.has(permission) };
    });
  }

  /*
   * The mode a policy not set up yet would be set up in, so its access is
   * checked for what setting it up takes: address groups need Network
   * Security's permissions too. Null when the project's tier or the policy
   * cannot be read yet - the permissions that read them are asked for then.
   */
  private async readWouldBeMode(): Promise<CloudArmorBlocklistMode | null> {
    try {
      const tier: string = await this.data.api.getProjectTier(
        this.data.policy.project,
      );
      const read: PolicyRead = await this.read();

      return chooseCloudArmorMode({
        tier,
        policyType: read.policyType,
        region: this.data.policy.region,
      });
    } catch {
      return null;
    }
  }
}
