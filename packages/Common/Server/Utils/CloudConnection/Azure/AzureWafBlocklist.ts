import {
  AZURE_WAF_API_VERSIONS,
  AZURE_WAF_HIGHEST_PRIORITY,
  AZURE_WAF_LOWEST_PRIORITY,
  AZURE_WAF_MAX_ONEUPTIME_RULES,
  AzureWafMatchVariable,
  AzureWafOwnRule,
  AzureWafOwnRuleState,
  AzureWafPolicyAnalysis,
  AzureWafPolicyKind,
  AzureWafPolicyRef,
  AzureWafRecordedRule,
  AzureWafRuleDetails,
  AzureWafRuleDrift,
  analyzeAzureWafPolicy,
  buildAzureWafPolicyWrite,
  buildAzureWafRule,
  getAzureWafMatchVariable,
  getAzureWafRequiredActions,
  getAzureWafRuleName,
  isAzureActionPermitted,
  toAzureWafAddress,
} from "../../../../Types/CloudConnection/AzureWafBlocklist";
import {
  CloudWafSlotPlan,
  CloudWafSlotRefusal,
  CloudWafValueSlot,
  getCloudWafValueKey,
  planCloudWafValueSlots,
} from "../../../../Types/CloudConnection/CloudWafRuleSlots";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
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
import { buildQueryString } from "../../LlmObservability/LlmProviderHttp";
import AzureArm from "./AzureArm";

/*
 * THE BLOCKLIST'S RULES IN ONE AZURE WAF POLICY (#10348).
 *
 * One AzureWafPolicyBlocklist per policy a project picked, for one pass of
 * the reconciler (or one Check Again, Put It Back or Remove), signed in as
 * the connection's app. Azure writes a WAF policy only whole, so every
 * change is the same three steps:
 *
 *   1. read the policy, with its ETag;
 *   2. change OneUptime's rules (Types/CloudConnection/AzureWafBlocklist
 *      and CloudWafRuleSlots say how) and nothing else - every other rule,
 *      every setting and every managed rule written back as it was read;
 *   3. write it with the ETag in If-Match. Azure answers 412 when someone
 *      wrote the policy in between: the change is made again on a fresh
 *      read, up to AZURE_WAF_WRITE_ATTEMPTS times, and never written over
 *      what they wrote.
 *
 * Front Door accepts a write (202) and applies it at its edges over the
 * next minutes: until the policy's provisioning state is Succeeded again,
 * what it holds is Pending (isPropagating), and Applied from then on.
 *
 * A rule of OneUptime's that someone turned off, changed or deleted is
 * left as they left it: what it holds is said not to be in force, and why,
 * until Put It Back writes it again. A policy that is turned off, in
 * Detection mode or attached to nothing blocks nothing at all, and says so.
 */

export const AZURE_WAF_WRITE_ATTEMPTS: number = 3;

// The API version a caller's permissions at a scope are read with.
export const AZURE_PERMISSIONS_API_VERSION: string = "2022-04-01";

// What a policy holds of OneUptime's, as a read finds it.
export interface AzureWafHeld {
  value: string;
  // The rule that holds it: OneUptime1a2b3c4dBlock2.
  rule: string;
  // Held, and Azure still applying the policy.
  isPropagating: boolean;
  // Held, and not in force, and why.
  notInForce: SecurityBlockReason | null;
}

// Where a policy stands, as a read finds it.
export interface AzureWafState {
  status: SecurityBlockCloudWafStatus;
  // Why it is not enforcing; null when it is.
  reason: SecurityBlockReason | null;
  held: Array<AzureWafHeld>;
  // What the row keeps of it, brought up to date.
  details: AzureWafRuleDetails;
  // How many addresses it can hold of OneUptime's, and what one that does not fit says.
  capacity: number;
  fullReason: SecurityBlockReason;
}

export interface AzureWafWriteResult {
  value: string;
  isDone: boolean;
  rule?: string | undefined;
  reason?: SecurityBlockReason | undefined;
}

// A refusal Azure answered, in its own words when it gave them.
export function readAzureError(error: unknown): string {
  if (error instanceof LlmProviderError) {
    try {
      const body: JSONObject = JSON.parse(error.responseBody || "{}");
      const inner: JSONValue | undefined = (body["error"] as JSONObject)?.[
        "message"
      ];

      if (typeof inner === "string" && inner.trim()) {
        return inner.trim();
      }
    } catch {
      // Not JSON: the error's own message says it.
    }
  }

  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

function statusOf(error: unknown): number | undefined {
  return error instanceof LlmProviderError ? error.statusCode : undefined;
}

export interface AzureWafPolicyBlocklistData {
  arm: AzureArm;
  policy: AzureWafPolicyRef;
  // The policy's name as people read it: the inventory's.
  displayName: string;
  projectSuffix: string;
  clientAddress: SecurityBlockClientAddress;
  // What the row keeps of the policy: OneUptime's rules as it last wrote them.
  details: AzureWafRuleDetails | null;
}

interface PolicyRead {
  policy: JSONObject;
  analysis: AzureWafPolicyAnalysis;
}

export default class AzureWafPolicyBlocklist {
  private readonly data: AzureWafPolicyBlocklistData;
  private cached: PolicyRead | null = null;
  private record: AzureWafRuleDetails | null;
  /*
   * Whether the last write had a block it could not place for want of a
   * free priority: kept on the row, so the policy says No Free Priority on
   * every pass until one is free, not only on the passes that write.
   */
  private isWaitingForPriority: boolean;

  public constructor(data: AzureWafPolicyBlocklistData) {
    this.data = data;
    this.record = data.details
      ? JSON.parse(JSON.stringify(data.details))
      : null;
    this.isWaitingForPriority = Boolean(data.details?.isWaitingForPriority);
  }

  public get kind(): AzureWafPolicyKind {
    return this.data.policy.kind;
  }

  public get expectedVariable(): AzureWafMatchVariable {
    return getAzureWafMatchVariable(this.kind, this.data.clientAddress);
  }

  private get url(): string {
    return `${this.data.arm.getManagementBaseUrl()}${this.data.policy.id}?${buildQueryString(
      [["api-version", AZURE_WAF_API_VERSIONS[this.kind]]],
    )}`;
  }

  private policyValues(): Record<string, string> {
    return { policy: this.data.displayName || this.data.policy.name };
  }

  // The policy, read once until it is written; again when asked.
  public async read(force: boolean = false): Promise<PolicyRead> {
    if (this.cached && !force) {
      return this.cached;
    }

    let policy: JSONObject;

    try {
      policy = await this.data.arm.getJson(this.url, "WAF policy request");
    } catch (error) {
      throw this.explainReadFailure(error);
    }

    this.cached = {
      policy,
      analysis: analyzeAzureWafPolicy({
        kind: this.kind,
        policy,
        projectSuffix: this.data.projectSuffix,
        expectedVariable: this.expectedVariable,
        details: this.record,
      }),
    };

    return this.cached;
  }

  // A read that failed, said as what to do: a missing role named, a policy gone said so.
  private explainReadFailure(error: unknown): Error {
    const status: number | undefined = statusOf(error);
    const reason: SecurityBlockReason =
      status === 403
        ? cloudWafReason(CLOUD_WAF_REASONS.mayNotRead, {
            ...this.policyValues(),
            permission: getAzureWafRequiredActions(this.kind)[0]!,
          })
        : status === 404
          ? cloudWafReason(CLOUD_WAF_REASONS.policyNotFound, this.policyValues())
          : cloudWafReason(CLOUD_WAF_REASONS.couldNotRead, {
              ...this.policyValues(),
              error: readAzureError(error),
            });

    return new AzureWafError(reason);
  }

  // The reason a write Azure refused is said with.
  private explainWriteFailure(error: unknown): SecurityBlockReason {
    const status: number | undefined = statusOf(error);

    if (status === 403) {
      return cloudWafReason(CLOUD_WAF_REASONS.mayNotWrite, {
        ...this.policyValues(),
        permission: getAzureWafRequiredActions(this.kind)[1]!,
      });
    }

    if (status === 404) {
      return cloudWafReason(CLOUD_WAF_REASONS.policyNotFound, this.policyValues());
    }

    if (status === 409) {
      return cloudWafReason(CLOUD_WAF_REASONS.busy, this.policyValues());
    }

    return cloudWafReason(CLOUD_WAF_REASONS.refused, {
      ...this.policyValues(),
      cloud: "Azure",
      error: readAzureError(error),
    });
  }

  // The record, as OneUptime last wrote the policy - or as setup found it.
  public getDetails(): AzureWafRuleDetails {
    const analysis: AzureWafPolicyAnalysis | undefined =
      this.cached?.analysis;

    return this.withPolicyFacts(
      this.record || {
        kind: this.kind,
        matchVariable: this.expectedVariable,
        addressesPerRule: analysis?.facts.addressesPerRule || 0,
        maxRules: analysis?.maxRules ?? AZURE_WAF_MAX_ONEUPTIME_RULES,
        rules: [],
        nextIndex: 1,
        drift: [],
        freePriorities: [],
        isWaitingForPriority: false,
        policy: {
          isEnabled: true,
          mode: "Prevention",
          isAttached: true,
          provisioningState: "",
          skuName: "",
        },
      },
    );
  }

  private withPolicyFacts(details: AzureWafRuleDetails): AzureWafRuleDetails {
    const analysis: AzureWafPolicyAnalysis | undefined =
      this.cached?.analysis;

    if (!analysis) {
      return { ...details, isWaitingForPriority: this.isWaitingForPriority };
    }

    return {
      ...details,
      isWaitingForPriority: this.isWaitingForPriority,
      kind: this.kind,
      addressesPerRule: analysis.facts.addressesPerRule,
      maxRules: analysis.maxRules,
      nextIndex: Math.max(details.nextIndex, analysis.nextIndex),
      freePriorities: analysis.freePriorities,
      drift: [
        ...analysis.own
          .filter((rule: AzureWafOwnRule): boolean => {
            return (
              rule.state === AzureWafOwnRuleState.TurnedOff ||
              rule.state === AzureWafOwnRuleState.Changed
            );
          })
          .map((rule: AzureWafOwnRule) => {
            return {
              name: rule.name,
              drift:
                rule.state === AzureWafOwnRuleState.TurnedOff
                  ? AzureWafRuleDrift.TurnedOff
                  : AzureWafRuleDrift.Changed,
            };
          }),
        ...analysis.deleted.map((rule: AzureWafRecordedRule) => {
          return { name: rule.name, drift: AzureWafRuleDrift.Deleted };
        }),
      ],
      policy: {
        isEnabled: analysis.facts.isEnabled,
        mode: analysis.facts.mode,
        isAttached: analysis.facts.isAttached,
        provisioningState: analysis.facts.provisioningState,
        skuName: analysis.facts.skuName,
      },
    };
  }

  /*
   * Why nothing the policy holds is in force, when that is so: it is turned
   * off, in Detection mode, attached to nothing, or Azure could not apply
   * its last change.
   */
  private policyNotInForce(
    analysis: AzureWafPolicyAnalysis,
  ): SecurityBlockReason | null {
    const facts: AzureWafPolicyAnalysis["facts"] = analysis.facts;
    const resourceState: string = facts.resourceState.toLowerCase();

    if (
      !facts.isEnabled ||
      resourceState === "disabled" ||
      resourceState === "disabling"
    ) {
      return cloudWafReason(CLOUD_WAF_REASONS.policyTurnedOff, this.policyValues());
    }

    if (facts.mode.toLowerCase() === "detection") {
      return cloudWafReason(
        CLOUD_WAF_REASONS.policyInDetection,
        this.policyValues(),
      );
    }

    if (!facts.isAttached) {
      return cloudWafReason(
        this.kind === AzureWafPolicyKind.ApplicationGateway
          ? CLOUD_WAF_REASONS.gatewayPolicyNotAttached
          : CLOUD_WAF_REASONS.frontDoorPolicyNotAttached,
        this.policyValues(),
      );
    }

    if (facts.provisioningState.toLowerCase() === "failed") {
      return cloudWafReason(
        CLOUD_WAF_REASONS.provisioningFailed,
        this.policyValues(),
      );
    }

    return null;
  }

  // Whether Azure is still applying the policy's last change.
  private isApplying(analysis: AzureWafPolicyAnalysis): boolean {
    const state: string = analysis.facts.provisioningState.toLowerCase();

    return Boolean(state) && state !== "succeeded" && state !== "failed";
  }

  private ruleReason(
    drift: AzureWafRuleDrift,
    rule: string,
  ): SecurityBlockReason {
    return cloudWafReason(
      drift === AzureWafRuleDrift.TurnedOff
        ? CLOUD_WAF_REASONS.ruleTurnedOff
        : drift === AzureWafRuleDrift.Changed
          ? CLOUD_WAF_REASONS.ruleChanged
          : CLOUD_WAF_REASONS.ruleDeleted,
      { ...this.policyValues(), rule },
    );
  }

  private noRoomReason(
    analysis: AzureWafPolicyAnalysis,
    refusal: CloudWafSlotRefusal,
  ): SecurityBlockReason {
    if (refusal === CloudWafSlotRefusal.Full) {
      return cloudWafReason(CLOUD_WAF_REASONS.full, this.policyValues(), {
        addresses: analysis.maxRules * analysis.facts.addressesPerRule,
      });
    }

    return analysis.passPriority === null
      ? cloudWafReason(CLOUD_WAF_REASONS.noFreePriorityAtAll, {
          ...this.policyValues(),
          lowest: String(AZURE_WAF_LOWEST_PRIORITY),
          highest: String(AZURE_WAF_HIGHEST_PRIORITY),
        })
      : cloudWafReason(CLOUD_WAF_REASONS.noFreePriority, {
          ...this.policyValues(),
          priority: String(analysis.passPriority),
        });
  }

  /*
   * Where the policy stands and what it holds of OneUptime's, from a read:
   * each rule's addresses, in force, Pending while Azure applies the
   * policy, or not in force and why.
   */
  public async readState(force: boolean = false): Promise<AzureWafState> {
    const { analysis } = await this.read(force);
    const policyReason: SecurityBlockReason | null =
      this.policyNotInForce(analysis);
    const isApplying: boolean = this.isApplying(analysis);
    const held: Array<AzureWafHeld> = [];
    let drift: SecurityBlockReason | null = null;

    for (const rule of analysis.own) {
      const ruleDrift: AzureWafRuleDrift | null =
        rule.state === AzureWafOwnRuleState.TurnedOff
          ? AzureWafRuleDrift.TurnedOff
          : rule.state === AzureWafOwnRuleState.Changed
            ? AzureWafRuleDrift.Changed
            : null;
      const ruleReason: SecurityBlockReason | null = ruleDrift
        ? this.ruleReason(ruleDrift, rule.name)
        : null;

      drift = drift || ruleReason;

      for (const value of rule.values) {
        held.push({
          value,
          rule: rule.name,
          isPropagating: isApplying,
          notInForce: policyReason || ruleReason,
        });
      }
    }

    for (const rule of analysis.deleted) {
      const ruleReason: SecurityBlockReason = this.ruleReason(
        AzureWafRuleDrift.Deleted,
        rule.name,
      );

      drift = drift || ruleReason;

      for (const value of rule.values) {
        held.push({
          value,
          rule: rule.name,
          isPropagating: false,
          notInForce: ruleReason,
        });
      }
    }

    const ownRules: number = analysis.own.length + analysis.deleted.length;
    const addable: number = Math.max(
      0,
      Math.min(analysis.freePriorities.length, analysis.maxRules - ownRules),
    );
    const isStuck: boolean =
      ownRules === 0 && analysis.freePriorities.length === 0;
    let status: SecurityBlockCloudWafStatus = SecurityBlockCloudWafStatus.Enforcing;
    let reason: SecurityBlockReason | null = null;

    if (policyReason) {
      status = SecurityBlockCloudWafStatus.Failed;
      reason = policyReason;
    } else if (drift) {
      status = SecurityBlockCloudWafStatus.Drifted;
      reason = drift;
    } else if (
      isStuck ||
      (this.isWaitingForPriority && analysis.freePriorities.length === 0)
    ) {
      status = SecurityBlockCloudWafStatus.NoFreePriority;
      reason = this.noRoomReason(analysis, CloudWafSlotRefusal.NoFreePriority);
    } else if (isApplying) {
      status = SecurityBlockCloudWafStatus.Applying;
      reason = cloudWafReason(CLOUD_WAF_REASONS.applying, this.policyValues());
    }

    return {
      status,
      reason,
      held,
      details: this.getDetails(),
      capacity: analysis.facts.addressesPerRule * (ownRules + addable),
      fullReason: this.noRoomReason(
        analysis,
        addable === 0 && analysis.freePriorities.length === 0
          ? CloudWafSlotRefusal.NoFreePriority
          : CloudWafSlotRefusal.Full,
      ),
    };
  }

  /*
   * The custom rules as they are to be written, from a read and a plan:
   * every other rule as it was; each of OneUptime's rules in force (and
   * each one waiting to read the new Client Address) built anew; one
   * turned off keeps being off, holding only what it still holds; one
   * changed by hand as the person left it.
   */
  private buildRules(data: {
    analysis: AzureWafPolicyAnalysis;
    slots: Array<CloudWafValueSlot>;
    // Rules to write as OneUptime writes them, whatever state they are in now (Put It Back).
    restore?: Set<number> | undefined;
  }): Array<JSONObject> {
    const byIndex: Map<number, AzureWafOwnRule> = new Map(
      data.analysis.own.map(
        (rule: AzureWafOwnRule): [number, AzureWafOwnRule] => {
          return [rule.index, rule];
        },
      ),
    );
    const rules: Array<JSONObject> = [...data.analysis.others];
    const written: Set<number> = new Set();

    for (const slot of data.slots) {
      const live: AzureWafOwnRule | undefined = byIndex.get(slot.index);
      const isRestored: boolean = Boolean(data.restore?.has(slot.index));

      written.add(slot.index);

      if (live && !isRestored && live.state === AzureWafOwnRuleState.Changed) {
        rules.push(live.json);
        continue;
      }

      const built: JSONObject = buildAzureWafRule({
        kind: this.kind,
        name: getAzureWafRuleName(this.data.projectSuffix, slot.index),
        priority: slot.priority,
        values: slot.values,
        matchVariable: this.expectedVariable,
      });

      if (live && !isRestored && live.state === AzureWafOwnRuleState.TurnedOff) {
        if (this.kind === AzureWafPolicyKind.ApplicationGateway) {
          built["state"] = "Disabled";
        } else {
          built["enabledState"] = "Disabled";
        }
      }

      rules.push(built);
    }

    // Changed rules the plan left out (it never plans them) stay as they are.
    for (const rule of data.analysis.own) {
      if (!written.has(rule.index) && rule.state === AzureWafOwnRuleState.Changed) {
        rules.push(rule.json);
      }
    }

    return rules;
  }

  /*
   * The record after a write: the slots written, and the deleted rules
   * still holding something. A rule changed by hand keeps what OneUptime
   * meant it to hold - its last record, less what this write removed -
   * never what the person left in it: Put It Back writes that back.
   */
  private recordWrite(data: {
    analysis: AzureWafPolicyAnalysis;
    slots: Array<CloudWafValueSlot>;
    deleted: Array<AzureWafRecordedRule>;
    removing?: Set<string> | undefined;
  }): void {
    const before: Map<number, AzureWafRecordedRule> = new Map(
      (this.record?.rules || []).map(
        (rule: AzureWafRecordedRule): [number, AzureWafRecordedRule] => {
          return [rule.index, rule];
        },
      ),
    );
    const changed: Map<number, AzureWafOwnRule> = new Map(
      data.analysis.own
        .filter((rule: AzureWafOwnRule): boolean => {
          return rule.state === AzureWafOwnRuleState.Changed;
        })
        .map((rule: AzureWafOwnRule): [number, AzureWafOwnRule] => {
          return [rule.index, rule];
        }),
    );
    const rules: Array<AzureWafRecordedRule> = [
      ...data.slots.map((slot: CloudWafValueSlot): AzureWafRecordedRule => {
        return {
          index: slot.index,
          name: getAzureWafRuleName(this.data.projectSuffix, slot.index),
          priority: slot.priority,
          values: [...slot.values],
        };
      }),
      ...Array.from(changed.values())
        .filter((rule: AzureWafOwnRule): boolean => {
          return !data.slots.some((slot: CloudWafValueSlot): boolean => {
            return slot.index === rule.index;
          });
        })
        .map((rule: AzureWafOwnRule): AzureWafRecordedRule => {
          return {
            index: rule.index,
            name: rule.name,
            priority: rule.priority,
            values: (before.get(rule.index)?.values || rule.values).filter(
              (value: string): boolean => {
                return !data.removing?.has(getCloudWafValueKey(value));
              },
            ),
          };
        }),
      ...data.deleted.filter((rule: AzureWafRecordedRule): boolean => {
        return rule.values.length > 0;
      }),
    ].sort((a: AzureWafRecordedRule, b: AzureWafRecordedRule): number => {
      return a.index - b.index;
    });

    this.record = {
      ...this.getDetails(),
      matchVariable: this.expectedVariable,
      rules,
      nextIndex: Math.max(
        data.analysis.nextIndex,
        ...rules.map((rule: AzureWafRecordedRule): number => {
          return rule.index + 1;
        }),
      ),
    };
  }

  // Writes the policy with its read's ETag. Throws Azure's answer; 412 is the caller's to read again.
  private async write(
    read: PolicyRead,
    customRules: Array<JSONObject>,
  ): Promise<void> {
    await this.data.arm.putIfMatch({
      url: this.url,
      body: buildAzureWafPolicyWrite({
        kind: this.kind,
        policy: read.policy,
        customRules,
      }),
      etag: read.analysis.facts.etag,
      step: "WAF policy update",
    });

    this.cached = null;
  }

  /*
   * What a pass removes and adds, in one write of the policy: removed from
   * every rule of OneUptime's that holds it, added to its rules in force,
   * then to new ones at the free priorities. Every value asked for is
   * answered; a rule changed by hand is never written.
   */
  public async change(changes: {
    add: Array<string>;
    remove: Array<string>;
  }): Promise<{
    added: Array<AzureWafWriteResult>;
    removed: Array<AzureWafWriteResult>;
  }> {
    const removing: Set<string> = new Set(
      changes.remove.map(getCloudWafValueKey),
    );
    const addable: Array<string> = [];
    const refused: Array<AzureWafWriteResult> = [];

    for (const value of changes.add) {
      if (toAzureWafAddress(this.kind, value)) {
        addable.push(value);
      } else {
        refused.push({
          value,
          isDone: false,
          reason:
            this.kind === AzureWafPolicyKind.ApplicationGateway
              ? cloudWafReason(CLOUD_WAF_REASONS.ipv4Only, { value })
              : cloudWafReason(CLOUD_WAF_REASONS.notAnAddress, {
                  product: "Azure WAF",
                }),
        });
      }
    }

    const failAll: (reason: SecurityBlockReason) => {
      added: Array<AzureWafWriteResult>;
      removed: Array<AzureWafWriteResult>;
    } = (reason: SecurityBlockReason) => {
      return {
        added: [
          ...addable.map((value: string): AzureWafWriteResult => {
            return { value, isDone: false, reason };
          }),
          ...refused,
        ],
        removed: changes.remove.map((value: string): AzureWafWriteResult => {
          return { value, isDone: false, reason };
        }),
      };
    };

    for (let attempt: number = 1; attempt <= AZURE_WAF_WRITE_ATTEMPTS; attempt++) {
      let read: PolicyRead;

      try {
        read = await this.read(attempt > 1);
      } catch (error) {
        return failAll(
          error instanceof AzureWafError
            ? error.reason
            : cloudWafReason(CLOUD_WAF_REASONS.couldNotRead, {
                ...this.policyValues(),
                error: readAzureError(error),
              }),
        );
      }

      const { analysis } = read;
      const slots: Array<CloudWafValueSlot> = analysis.own
        .filter((rule: AzureWafOwnRule): boolean => {
          return rule.state !== AzureWafOwnRuleState.Changed;
        })
        .map((rule: AzureWafOwnRule): CloudWafValueSlot => {
          return {
            index: rule.index,
            priority: rule.priority,
            values: [...rule.values],
            isFrozen: rule.state === AzureWafOwnRuleState.TurnedOff,
          };
        });
      const deletedHeld: number = analysis.deleted.length;
      const changedRules: number = analysis.own.filter(
        (rule: AzureWafOwnRule): boolean => {
          return rule.state === AzureWafOwnRuleState.Changed;
        },
      ).length;
      const plan: CloudWafSlotPlan = planCloudWafValueSlots({
        slots,
        add: addable,
        remove: changes.remove,
        perSlot: analysis.facts.addressesPerRule,
        maxSlots: Math.max(0, analysis.maxRules - deletedHeld - changedRules),
        freePriorities: analysis.freePriorities,
        nextIndex: analysis.nextIndex,
      });
      const deleted: Array<AzureWafRecordedRule> = analysis.deleted.map(
        (rule: AzureWafRecordedRule): AzureWafRecordedRule => {
          return {
            ...rule,
            values: rule.values.filter((value: string): boolean => {
              return !removing.has(getCloudWafValueKey(value));
            }),
          };
        },
      );
      const needsRewrite: boolean = analysis.own.some(
        (rule: AzureWafOwnRule): boolean => {
          return rule.state === AzureWafOwnRuleState.ToRewrite;
        },
      );
      const results: {
        added: Array<AzureWafWriteResult>;
        removed: Array<AzureWafWriteResult>;
      } = {
        added: [
          ...plan.added.map(
            (addition: CloudWafSlotPlan["added"][number]): AzureWafWriteResult => {
              return addition.isDone
                ? {
                    value: addition.value,
                    isDone: true,
                    rule: getAzureWafRuleName(
                      this.data.projectSuffix,
                      addition.slotIndex!,
                    ),
                  }
                : {
                    value: addition.value,
                    isDone: false,
                    reason: this.noRoomReason(analysis, addition.refusal!),
                  };
            },
          ),
          ...refused,
        ],
        removed: changes.remove.map((value: string): AzureWafWriteResult => {
          return { value, isDone: true };
        }),
      };

      // Kept until a write places every block it was given, or Put It Back or Remove.
      if (addable.length > 0) {
        this.isWaitingForPriority = plan.added.some(
          (addition: CloudWafSlotPlan["added"][number]): boolean => {
            return addition.refusal === CloudWafSlotRefusal.NoFreePriority;
          },
        );
      }

      if (!plan.isChanged && !needsRewrite) {
        this.recordWrite({ analysis, slots: plan.slots, deleted, removing });
        return results;
      }

      try {
        await this.write(read, this.buildRules({ analysis, slots: plan.slots }));
        this.recordWrite({ analysis, slots: plan.slots, deleted, removing });

        return results;
      } catch (error) {
        if (statusOf(error) === 412) {
          // Written by someone else since it was read: read it again, and change that.
          continue;
        }

        return failAll(this.explainWriteFailure(error));
      }
    }

    return failAll(
      cloudWafReason(CLOUD_WAF_REASONS.keptChanging, {
        ...this.policyValues(),
        tries: String(AZURE_WAF_WRITE_ATTEMPTS),
      }),
    );
  }

  /*
   * OneUptime's rules written again with the address the policy is now set
   * to read, when the person changed it in OneUptime since they were
   * written: a pass's first step. Returns whether it wrote the policy.
   */
  public async rewriteIfNeeded(): Promise<boolean> {
    const read: PolicyRead = await this.read();

    if (
      !read.analysis.own.some((rule: AzureWafOwnRule): boolean => {
        return rule.state === AzureWafOwnRuleState.ToRewrite;
      })
    ) {
      return false;
    }

    const result: { removed: Array<AzureWafWriteResult> } = await this.change({
      add: [],
      remove: [],
    });

    const failed: AzureWafWriteResult | undefined = result.removed.find(
      (item: AzureWafWriteResult): boolean => {
        return !item.isDone;
      },
    );

    if (failed?.reason) {
      throw new AzureWafError(failed.reason);
    }

    return true;
  }

  /*
   * Put It Back: every rule of OneUptime's someone turned off or changed
   * written again as OneUptime writes it, holding what it held, and every
   * rule someone deleted added again with what OneUptime last wrote in it -
   * at its own priority while that is free, else the lowest free one. A
   * deleted rule with no priority free stays deleted, and the policy says
   * so (No Free Priority).
   */
  public async putBack(): Promise<AzureWafState> {
    for (let attempt: number = 1; attempt <= AZURE_WAF_WRITE_ATTEMPTS; attempt++) {
      const read: PolicyRead = await this.read(attempt > 1);
      const { analysis } = read;
      const restore: Set<number> = new Set();
      const recorded: Map<number, AzureWafRecordedRule> = new Map(
        (this.record?.rules || []).map(
          (rule: AzureWafRecordedRule): [number, AzureWafRecordedRule] => {
            return [rule.index, rule];
          },
        ),
      );
      const slots: Array<CloudWafValueSlot> = analysis.own.map(
        (rule: AzureWafOwnRule): CloudWafValueSlot => {
          if (
            rule.state === AzureWafOwnRuleState.TurnedOff ||
            rule.state === AzureWafOwnRuleState.Changed
          ) {
            restore.add(rule.index);
          }

          /*
           * A rule turned off or changed by hand is written back holding
           * what OneUptime last meant it to hold - never what the person
           * left in it, nor a block lifted since.
           */
          const meant: Array<string> | undefined = recorded.get(
            rule.index,
          )?.values;

          return {
            index: rule.index,
            priority: rule.priority,
            values:
              restore.has(rule.index) && meant
                ? [...meant]
                : rule.values.length > 0
                  ? [...rule.values]
                  : [...(meant || [])],
            isFrozen: false,
          };
        },
      );
      const free: Array<number> = [...analysis.freePriorities];
      const stillDeleted: Array<AzureWafRecordedRule> = [];

      for (const rule of analysis.deleted) {
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

        slots.push({
          index: rule.index,
          priority,
          values: [...rule.values],
          isFrozen: false,
        });
      }

      const kept: Array<CloudWafValueSlot> = slots.filter(
        (slot: CloudWafValueSlot): boolean => {
          return slot.values.length > 0;
        },
      );

      if (restore.size === 0 && stillDeleted.length === analysis.deleted.length) {
        this.isWaitingForPriority = stillDeleted.length > 0;

        return await this.readState();
      }

      try {
        await this.write(
          read,
          this.buildRules({ analysis, slots: kept, restore }),
        );
        this.recordWrite({ analysis, slots: kept, deleted: stillDeleted });
        this.isWaitingForPriority = stillDeleted.length > 0;

        return await this.readState(true);
      } catch (error) {
        if (statusOf(error) === 412) {
          continue;
        }

        throw new AzureWafError(this.explainWriteFailure(error));
      }
    }

    throw new AzureWafError(
      cloudWafReason(CLOUD_WAF_REASONS.keptChanging, {
        ...this.policyValues(),
        tries: String(AZURE_WAF_WRITE_ATTEMPTS),
      }),
    );
  }

  /*
   * Every rule of OneUptime's taken out of the policy - in force, turned
   * off or changed - and every other rule written back as it was: when the
   * policy no longer enforces the blocklist. Returns whether it wrote it.
   */
  public async removeAll(): Promise<boolean> {
    for (let attempt: number = 1; attempt <= AZURE_WAF_WRITE_ATTEMPTS; attempt++) {
      const read: PolicyRead = await this.read(attempt > 1);

      if (read.analysis.own.length === 0) {
        this.record = { ...this.getDetails(), rules: [], drift: [] };
        return false;
      }

      try {
        await this.write(read, [...read.analysis.others]);
        this.record = { ...this.getDetails(), rules: [], drift: [] };

        return true;
      } catch (error) {
        if (statusOf(error) === 412) {
          continue;
        }

        throw new AzureWafError(this.explainWriteFailure(error));
      }
    }

    throw new AzureWafError(
      cloudWafReason(CLOUD_WAF_REASONS.keptChanging, {
        ...this.policyValues(),
        tries: String(AZURE_WAF_WRITE_ATTEMPTS),
      }),
    );
  }

  /*
   * Whether the connection's app may read and write the policy, asked
   * without writing anything: Azure's own answer of what the caller may do
   * there (Microsoft.Authorization/permissions). Each permission the
   * policy's kind takes, granted or not.
   */
  public async checkAccess(): Promise<
    Array<{ permission: string; isGranted: boolean }>
  > {
    const answer: JSONObject = await this.data.arm.getJson(
      `${this.data.arm.getManagementBaseUrl()}${this.data.policy.id}/providers/Microsoft.Authorization/permissions?${buildQueryString(
        [["api-version", AZURE_PERMISSIONS_API_VERSION]],
      )}`,
      "permissions request",
    );
    const permissions: Array<{
      actions: Array<string>;
      notActions: Array<string>;
    }> = (Array.isArray(answer["value"]) ? answer["value"] : []).map(
      (entry: JSONValue) => {
        const item: JSONObject =
          entry && typeof entry === "object" && !Array.isArray(entry)
            ? (entry as JSONObject)
            : {};
        const list: (key: string) => Array<string> = (
          key: string,
        ): Array<string> => {
          return (Array.isArray(item[key]) ? (item[key] as Array<JSONValue>) : [])
            .filter((action: JSONValue): action is string => {
              return typeof action === "string";
            });
        };

        return { actions: list("actions"), notActions: list("notActions") };
      },
    );

    return getAzureWafRequiredActions(this.kind).map((permission: string) => {
      return {
        permission,
        isGranted: isAzureActionPermitted({ action: permission, permissions }),
      };
    });
  }
}

// A failure said as a reason, for the destination and the row: its message is the reason in English.
export class AzureWafError extends Error {
  public readonly reason: SecurityBlockReason;

  public constructor(reason: SecurityBlockReason) {
    super(fillSecurityBlockReason(reason));
    this.reason = reason;
  }
}
