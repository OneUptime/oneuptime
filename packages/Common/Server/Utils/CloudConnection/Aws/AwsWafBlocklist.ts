import {
  AWS_WAF_BLOCKLIST_SET_DESCRIPTION,
  AWS_WAF_IP_SET_MAX_ADDRESSES,
  AwsWafArn,
  AwsWafBlocklistEnforcement,
  AwsWafBlocklistRuleNames,
  AwsWafBlocklistRulePlan,
  AwsWafBlocklistSetRef,
  AwsWafBlocklistSetSpec,
  AwsWafScope,
  buildAwsWafBlocklistRule,
  findAwsWafBlocklistEnforcement,
  fromAwsWafAddress,
  getAwsWafBlocklistRuleNames,
  getAwsWafBlocklistSets,
  getAwsWafRulePriority,
  getAwsWafSampleClientAddress,
  pickAwsWafBlocklistPriorities,
  planAwsWafBlocklistRules,
  withoutAwsWafBlocklistRules,
} from "../../../../Types/CloudConnection/AwsWafBlocklist";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityBlockAction } from "../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafStatus,
} from "../../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { CloudConnectionSettings } from "../CloudConnectorTypes";
import {
  AwsWafCallOptions,
  AwsWafErrorCode,
  AwsWafIpSet,
  AwsWafIpSetSummary,
  AwsWafSampledRequest,
  AwsWafSession,
  AwsWafWebAcl,
  createAwsWafIpSet,
  deleteAwsWafIpSet,
  getAwsWafIpSet,
  getAwsWafSampledRequests,
  getAwsWafWebAcl,
  isAwsWafError,
  listAwsWafIpSets,
  openAwsWafSession,
  updateAwsWafIpSet,
  updateAwsWafWebAcl,
} from "./AwsWaf";

/*
 * THE BLOCKLIST'S IP SETS AND RULES IN ONE ACCOUNT'S AWS WAF (#10344).
 *
 * The web ACLs a project picks in one account, scope and Region share the
 * project's four IP sets there (Types/CloudConnection/AwsWafBlocklist), so
 * the sets are kept by an AwsWafBlocklistGroup: one per account, scope and
 * Region in a reconciler's pass, which signs in once, lists the sets once,
 * and writes each set at most once a pass. The reconciler drives one group
 * at a time (its destinations share a lock key), so a set has one writer.
 *
 *   A set is changed by reading it, changing what it holds, and writing it
 *   back with the read's lock token: UpdateIPSet replaces a set whole. A
 *   token gone stale - someone wrote it between - is refused with
 *   WAFOptimisticLockException, and the change is read and made again, up
 *   to AWS_WAF_LOCK_ATTEMPTS times. Each entry is answered: written, or
 *   not and why (the set holds AWS WAF's 10,000 already).
 *
 *   A web ACL takes OneUptime's two rules when OneUptime adds them itself:
 *   read, the rules placed at free priorities below the customer's first
 *   (planAwsWafBlocklistRules), written back with the lock token - every
 *   rule of the customer's as it was. A web ACL its team keeps in code is
 *   only read: whether its rules block OneUptime's sets.
 *
 * Every write is answered in words a person can act on, and anything this
 * module cannot do is said, never taken as done.
 */

// How many times a change is read and made again after a lock token went stale.
export const AWS_WAF_LOCK_ATTEMPTS: number = 3;

/*
 * How long OneUptime waits for AWS WAF to know an IP set it just made
 * before a web ACL may reference it (WAFUnavailableEntityException), and
 * how many times.
 */
export const AWS_WAF_UNAVAILABLE_WAIT_MS: number = 5000;
export const AWS_WAF_UNAVAILABLE_ATTEMPTS: number = 3;

// What a set change is asked to add: the block's value, and the CIDR the set holds it as.
export interface AwsWafSetAddition {
  value: string;
  cidr: string;
}

// What became of one value a set change was asked to add or remove.
export interface AwsWafSetWriteResult {
  value: string;
  isDone: boolean;
  error?: string | undefined;
}

// Where a web ACL stands, as a group last read or wrote it.
export interface AwsWafRuleState {
  status: SecurityBlockCloudWafStatus;
  // Why it is not enforcing; "" when it is.
  message: string;
  // The sets its rules enforce, by key ("block-ipv4").
  enforcedSetKeys: Array<string>;
  // Where OneUptime's rules are, or - not there yet - the free priorities they would take.
  priorities: { block: number | null; challenge: number | null };
  // The sets' ARNs, by key, as the rules reference them.
  setArns: Record<string, string>;
  // The metric name of the rule enforcing each action, whose sampled requests are evidence.
  sampledMetricNames: Partial<Record<SecurityBlockAction, string>>;
}

export interface AwsWafBlocklistGroupData {
  settings: CloudConnectionSettings;
  connectionId: ObjectID;
  // The project's: it names the sets and rules.
  externalId: string;
  accountId: string;
  region: string;
  scope: AwsWafScope;
  options?: AwsWafCallOptions | undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

// The CIDRs a set holds, keyed as blocks write values, for comparing.
function keyOf(cidr: string): string {
  return fromAwsWafAddress(cidr) || cidr.trim().toLowerCase();
}

export default class AwsWafBlocklistGroup {
  public readonly specs: Array<AwsWafBlocklistSetSpec>;
  public readonly ruleNames: AwsWafBlocklistRuleNames;
  public readonly data: AwsWafBlocklistGroupData;

  private session: AwsWafSession | null = null;
  // The project's sets as ListIPSets named them, by key; null until listed.
  private summaries: Map<string, AwsWafIpSetSummary> | null = null;
  // Each set as last read this pass, by key: dropped when it is written.
  private readonly reads: Map<string, AwsWafIpSet> = new Map();

  public constructor(data: AwsWafBlocklistGroupData) {
    this.data = data;
    this.specs = getAwsWafBlocklistSets(data.externalId);
    this.ruleNames = getAwsWafBlocklistRuleNames(data.externalId);
  }

  // One lock for every web ACL that shares these sets.
  public static getLockKey(data: {
    projectId: string;
    accountId: string;
    region: string;
    scope: AwsWafScope;
  }): string {
    return `AwsWaf:${data.projectId}:${data.accountId}:${data.scope}:${data.region}`;
  }

  public async getSession(): Promise<AwsWafSession> {
    if (!this.session) {
      this.session = await openAwsWafSession(this.data.settings, {
        ...(this.data.options || {}),
        connectionId: this.data.connectionId,
        accountId: this.data.accountId,
        region: this.data.region,
        scope: this.data.scope,
      });
    }

    return this.session;
  }

  public getSpec(key: string): AwsWafBlocklistSetSpec | undefined {
    return this.specs.find((spec: AwsWafBlocklistSetSpec): boolean => {
      return spec.key === key;
    });
  }

  /*
   * The project's sets that exist, by key, listed once a pass (again when
   * asked to, after one was made or went missing). A listing that stopped
   * short of its last page cannot say a set is missing: that throws, rather
   * than making a set that may be there.
   */
  public async listSets(
    force: boolean = false,
  ): Promise<Map<string, AwsWafIpSetSummary>> {
    if (this.summaries && !force) {
      return this.summaries;
    }

    const listed: {
      sets: Array<AwsWafIpSetSummary>;
      isComplete: boolean;
    } = await listAwsWafIpSets(await this.getSession());
    const byName: Map<string, AwsWafIpSetSummary> = new Map(
      listed.sets.map(
        (set: AwsWafIpSetSummary): [string, AwsWafIpSetSummary] => {
          return [set.name, set];
        },
      ),
    );
    const summaries: Map<string, AwsWafIpSetSummary> = new Map();

    for (const spec of this.specs) {
      const set: AwsWafIpSetSummary | undefined = byName.get(spec.name);

      if (set) {
        summaries.set(spec.key, set);
      }
    }

    if (!listed.isComplete && summaries.size < this.specs.length) {
      throw new Error(
        `AWS WAF listed more IP sets in ${this.data.region} than OneUptime reads, so it could not tell whether its own are there.`,
      );
    }

    this.summaries = summaries;

    return summaries;
  }

  // A set as it is now, read once a pass until it is written; null when it does not exist.
  public async readSet(key: string): Promise<AwsWafIpSet | null> {
    const cached: AwsWafIpSet | undefined = this.reads.get(key);

    if (cached) {
      return cached;
    }

    const summary: AwsWafIpSetSummary | undefined = (await this.listSets()).get(
      key,
    );

    if (!summary) {
      return null;
    }

    try {
      const set: AwsWafIpSet = await getAwsWafIpSet(
        await this.getSession(),
        summary,
      );

      this.reads.set(key, set);

      return set;
    } catch (error) {
      if (isAwsWafError(error, AwsWafErrorCode.Nonexistent)) {
        // Deleted since it was listed.
        this.summaries?.delete(key);
        return null;
      }

      throw error;
    }
  }

  // The values a set holds, as blocks write them.
  public static valuesOf(set: AwsWafIpSet): Array<string> {
    return set.addresses
      .map((cidr: string): string | null => {
        return fromAwsWafAddress(cidr);
      })
      .filter((value: string | null): value is string => {
        return Boolean(value);
      });
  }

  /*
   * The project's four sets here, each made (empty) if it is not: what a
   * web ACL's rules reference, and what a team keeping its web ACL in code
   * references in theirs. Their ARNs by key.
   */
  public async ensureSets(): Promise<Record<string, string>> {
    const arns: Record<string, string> = {};

    for (const spec of this.specs) {
      const summary: AwsWafIpSetSummary = await this.ensureSet(spec, []);
      arns[spec.key] = summary.arn;
    }

    return arns;
  }

  /*
   * A set made if it is not there, holding the addresses given; the one
   * there if it is. Made by another writer at the same moment (a duplicate),
   * the one there is used.
   */
  private async ensureSet(
    spec: AwsWafBlocklistSetSpec,
    addresses: Array<string>,
  ): Promise<AwsWafIpSetSummary> {
    const existing: AwsWafIpSetSummary | undefined = (
      await this.listSets()
    ).get(spec.key);

    if (existing) {
      return existing;
    }

    try {
      const made: AwsWafIpSetSummary = await createAwsWafIpSet(
        await this.getSession(),
        {
          name: spec.name,
          description: AWS_WAF_BLOCKLIST_SET_DESCRIPTION,
          ipAddressVersion: spec.ipAddressVersion,
          addresses,
        },
      );

      this.summaries?.set(spec.key, made);
      this.reads.delete(spec.key);

      return made;
    } catch (error) {
      if (isAwsWafError(error, AwsWafErrorCode.Duplicate)) {
        const listed: AwsWafIpSetSummary | undefined = (
          await this.listSets(true)
        ).get(spec.key);

        if (listed) {
          return listed;
        }
      }

      if (isAwsWafError(error, AwsWafErrorCode.LimitsExceeded)) {
        throw new Error(
          `AWS WAF could not make IP set ${spec.name}: the account has as many IP sets in ${this.data.region} as AWS allows (100 unless raised). Delete one you no longer use, or ask AWS for more.`,
        );
      }

      throw error;
    }
  }

  /*
   * One set's change, as one write: read it, take away what is to be
   * removed, add what is to be added - the oldest first, while the set
   * has room - and write it back with the read's lock token, read and made
   * again when the token went stale. A set not there is made, holding what
   * is added. Every value asked for is answered.
   */
  public async changeSet(
    key: string,
    change: { add: Array<AwsWafSetAddition>; remove: Array<string> },
  ): Promise<{
    added: Array<AwsWafSetWriteResult>;
    removed: Array<AwsWafSetWriteResult>;
  }> {
    const spec: AwsWafBlocklistSetSpec | undefined = this.getSpec(key);

    if (!spec) {
      throw new Error(`OneUptime keeps no IP set "${key}".`);
    }

    const failAll: (error: string) => {
      added: Array<AwsWafSetWriteResult>;
      removed: Array<AwsWafSetWriteResult>;
    } = (error: string) => {
      return {
        added: change.add.map((addition: AwsWafSetAddition) => {
          return { value: addition.value, isDone: false, error };
        }),
        removed: change.remove.map((value: string) => {
          return { value, isDone: false, error };
        }),
      };
    };

    for (let attempt: number = 1; attempt <= AWS_WAF_LOCK_ATTEMPTS; attempt++) {
      let set: AwsWafIpSet | null;

      try {
        set = await this.readSet(key);

        if (!set) {
          // Nothing to remove from a set that is not there; what is added makes it.
          const room: Array<AwsWafSetAddition> = change.add.slice(
            0,
            AWS_WAF_IP_SET_MAX_ADDRESSES,
          );

          if (room.length > 0) {
            await this.ensureSet(
              spec,
              room.map((addition: AwsWafSetAddition): string => {
                return addition.cidr;
              }),
            );
          }

          return {
            added: change.add.map(
              (addition: AwsWafSetAddition, index: number) => {
                return index < AWS_WAF_IP_SET_MAX_ADDRESSES
                  ? { value: addition.value, isDone: true }
                  : {
                      value: addition.value,
                      isDone: false,
                      error: this.fullReason(spec),
                    };
              },
            ),
            removed: change.remove.map((value: string) => {
              return { value, isDone: true };
            }),
          };
        }
      } catch (error) {
        return failAll(errorText(error));
      }

      const removing: Set<string> = new Set(change.remove.map(keyOf));
      const next: Array<string> = [];
      const held: Set<string> = new Set();

      for (const cidr of set.addresses) {
        const valueKey: string = keyOf(cidr);

        if (removing.has(valueKey) || held.has(valueKey)) {
          continue;
        }

        held.add(valueKey);
        next.push(cidr);
      }

      const added: Array<AwsWafSetWriteResult> = [];

      for (const addition of change.add) {
        const valueKey: string = keyOf(addition.cidr);

        if (held.has(valueKey)) {
          added.push({ value: addition.value, isDone: true });
          continue;
        }

        if (next.length >= AWS_WAF_IP_SET_MAX_ADDRESSES) {
          added.push({
            value: addition.value,
            isDone: false,
            error: this.fullReason(spec),
          });
          continue;
        }

        held.add(valueKey);
        next.push(addition.cidr);
        added.push({ value: addition.value, isDone: true });
      }

      const removed: Array<AwsWafSetWriteResult> = change.remove.map(
        (value: string) => {
          return { value, isDone: true };
        },
      );
      const isSame: boolean =
        next.length === set.addresses.length &&
        next.every((cidr: string, index: number): boolean => {
          return cidr === set!.addresses[index];
        });

      if (isSame) {
        return { added, removed };
      }

      try {
        await updateAwsWafIpSet(await this.getSession(), {
          set,
          description: set.description || AWS_WAF_BLOCKLIST_SET_DESCRIPTION,
          addresses: next,
          lockToken: set.lockToken,
        });
        this.reads.delete(key);

        return { added, removed };
      } catch (error) {
        this.reads.delete(key);

        if (isAwsWafError(error, AwsWafErrorCode.OptimisticLock)) {
          // Someone wrote it since it was read: read it again, and make the change on that.
          continue;
        }

        if (isAwsWafError(error, AwsWafErrorCode.Nonexistent)) {
          // Deleted since it was read: made again on the next try.
          this.summaries?.delete(key);
          continue;
        }

        if (isAwsWafError(error, AwsWafErrorCode.LimitsExceeded)) {
          return {
            added: added.map((result: AwsWafSetWriteResult) => {
              return result.isDone &&
                !set!.addresses.some((cidr: string): boolean => {
                  return keyOf(cidr) === keyOf(result.value);
                })
                ? {
                    value: result.value,
                    isDone: false,
                    error: this.fullReason(spec),
                  }
                : result;
            }),
            removed: removed.map((result: AwsWafSetWriteResult) => {
              return {
                value: result.value,
                isDone: false,
                error: `AWS WAF refused the write to IP set ${spec.name} as over its limits.`,
              };
            }),
          };
        }

        return failAll(errorText(error));
      }
    }

    return failAll(
      `IP set ${spec.name} kept changing while OneUptime wrote it (${AWS_WAF_LOCK_ATTEMPTS} tries). OneUptime tries again shortly.`,
    );
  }

  // What an entry that does not fit says, after "Not applied: ".
  public fullReason(spec: AwsWafBlocklistSetSpec): string {
    return `the AWS WAF IP set ${spec.name} is full (${AWS_WAF_IP_SET_MAX_ADDRESSES.toLocaleString("en-US")})`;
  }

  // ---------- A web ACL's rules ----------

  /*
   * When the web ACL's rules of the blocklist last turned the address away,
   * by action, from the requests AWS WAF sampled for each rule over the
   * window (at most the last three hours): AWS WAF's own word that a block
   * holds. The address is matched where the web ACL reads the client's
   * address. Left out for an action whose rule sampled nothing from it.
   */
  public async readSampledBlocks(data: {
    webAcl: AwsWafArn;
    clientAddress: SecurityBlockClientAddress;
    // The rule of each action that blocks the sets, by its metric name.
    metricNames: Partial<Record<SecurityBlockAction, string>>;
    address: string;
    from: Date;
    to: Date;
  }): Promise<Partial<Record<SecurityBlockAction, Date>>> {
    const address: string | null = fromAwsWafAddress(data.address);
    const latest: Partial<Record<SecurityBlockAction, Date>> = {};

    if (!address) {
      return latest;
    }

    for (const action of [
      SecurityBlockAction.Block,
      SecurityBlockAction.Challenge,
    ]) {
      const metricName: string | undefined = data.metricNames[action];

      if (!metricName) {
        continue;
      }

      const samples: Array<AwsWafSampledRequest> =
        await getAwsWafSampledRequests(await this.getSession(), {
          webAclArn: data.webAcl.arn,
          webAclName: data.webAcl.name,
          ruleMetricName: metricName,
          from: data.from,
          to: data.to,
          maxItems: 500,
        });

      for (const sample of samples) {
        const isFromAddress: boolean =
          getAwsWafSampleClientAddress({
            clientIp: sample.clientIp,
            headers: sample.headers,
            clientAddress: data.clientAddress,
          }) === address;

        // Turned away by the rule's own action: BLOCK, or CHALLENGE.
        if (
          !sample.timestamp ||
          !isFromAddress ||
          sample.action !== action.toUpperCase()
        ) {
          continue;
        }

        const seen: Date | undefined = latest[action];

        if (!seen || sample.timestamp.getTime() > seen.getTime()) {
          latest[action] = sample.timestamp;
        }
      }
    }

    return latest;
  }

  public async readWebAcl(webAcl: AwsWafArn): Promise<AwsWafWebAcl> {
    return await getAwsWafWebAcl(await this.getSession(), {
      name: webAcl.name,
      id: webAcl.id,
      arn: webAcl.arn,
    });
  }

  // The sets as the rules reference them: those that exist, by key, with their action.
  public async getSetRefs(): Promise<Array<AwsWafBlocklistSetRef>> {
    const summaries: Map<string, AwsWafIpSetSummary> = await this.listSets();

    return this.specs
      .filter((spec: AwsWafBlocklistSetSpec): boolean => {
        return summaries.has(spec.key);
      })
      .map((spec: AwsWafBlocklistSetSpec): AwsWafBlocklistSetRef => {
        return {
          key: spec.key,
          arn: summaries.get(spec.key)!.arn,
          action: spec.action,
        };
      });
  }

  /*
   * Where a web ACL stands, read and never written: which of the sets its
   * rules enforce, reading the client's address as the web ACL is set to;
   * where OneUptime's rules are, or the free priorities they would take.
   */
  public async readRuleState(data: {
    webAcl: AwsWafArn;
    clientAddress: SecurityBlockClientAddress;
    addsRule: boolean;
    read?: AwsWafWebAcl | undefined;
  }): Promise<AwsWafRuleState> {
    const read: AwsWafWebAcl =
      data.read || (await this.readWebAcl(data.webAcl));
    const refs: Array<AwsWafBlocklistSetRef> = await this.getSetRefs();
    const rules: Array<unknown> = Array.isArray(read.webAcl["Rules"])
      ? (read.webAcl["Rules"] as Array<unknown>)
      : [];
    const enforcement: AwsWafBlocklistEnforcement =
      findAwsWafBlocklistEnforcement({
        rules,
        sets: refs,
        clientAddress: data.clientAddress,
      });
    const setArns: Record<string, string> = {};

    for (const ref of refs) {
      setArns[ref.key] = ref.arn;
    }

    const priorities: { block: number | null; challenge: number | null } =
      this.getPriorities(rules);
    const missing: Array<AwsWafBlocklistSetSpec> = this.specs.filter(
      (spec: AwsWafBlocklistSetSpec): boolean => {
        return !enforcement.enforcedSetKeys.includes(spec.key);
      },
    );

    if (missing.length === 0) {
      return {
        status: SecurityBlockCloudWafStatus.Enforcing,
        message: "",
        enforcedSetKeys: enforcement.enforcedSetKeys,
        priorities,
        setArns,
        sampledMetricNames: enforcement.sampledMetricNames,
      };
    }

    const names: string = missing
      .map((spec: AwsWafBlocklistSetSpec): string => {
        return spec.name;
      })
      .join(", ");

    return {
      status: data.addsRule
        ? SecurityBlockCloudWafStatus.Checking
        : SecurityBlockCloudWafStatus.WaitingForRule,
      message: data.addsRule
        ? `OneUptime's rule in ${data.webAcl.name} does not block ${names} yet.`
        : `${data.webAcl.name} has no rule that blocks ${names} yet. Add OneUptime's rule to it, as its Rule tab shows.`,
      enforcedSetKeys: enforcement.enforcedSetKeys,
      priorities,
      setArns,
      sampledMetricNames: enforcement.sampledMetricNames,
    };
  }

  /*
   * Where OneUptime's rules are in a web ACL, or - one that is not there -
   * the free priority below the customer's first rule it would take.
   */
  private getPriorities(rules: Array<unknown>): {
    block: number | null;
    challenge: number | null;
  } {
    const find: (name: string) => number | null = (
      name: string,
    ): number | null => {
      const rule: unknown = rules.find((candidate: unknown): boolean => {
        return (
          Boolean(candidate) &&
          typeof candidate === "object" &&
          (candidate as JSONObject)["Name"] === name
        );
      });

      return rule ? getAwsWafRulePriority(rule) : null;
    };
    const block: number | null = find(this.ruleNames.block);
    const challenge: number | null = find(this.ruleNames.challenge);
    const missing: number =
      (block === null ? 1 : 0) + (challenge === null ? 1 : 0);

    if (missing === 0) {
      return { block, challenge };
    }

    const own: Array<string> = [this.ruleNames.block, this.ruleNames.challenge];
    const customerPriorities: Array<number> = rules
      .filter((rule: unknown): boolean => {
        return !own.includes(String((rule as JSONObject)?.["Name"] || ""));
      })
      .map((rule: unknown): number | null => {
        return getAwsWafRulePriority(rule);
      })
      .filter((priority: number | null): priority is number => {
        return priority !== null;
      });
    const free: Array<number> | null = pickAwsWafBlocklistPriorities({
      customerPriorities,
      keptPriorities: [block, challenge].filter(
        (priority: number | null): priority is number => {
          return priority !== null;
        },
      ),
      count: missing,
    });
    const picked: Array<number> = free || [];

    return {
      block: block ?? (picked.length > 0 ? picked.shift()! : null),
      challenge: challenge ?? (picked.length > 0 ? picked.shift()! : null),
    };
  }

  /*
   * OneUptime's two rules in a web ACL, as they should be: the sets made if
   * they are not, the web ACL read, the rules placed or rewritten in place
   * (planAwsWafBlocklistRules) and written back with its lock token - read
   * and placed again when the token went stale, and waited for while AWS WAF
   * does not know a set it just made. Never a rule of the customer's
   * changed, renumbered or dropped.
   */
  public async ensureRules(data: {
    webAcl: AwsWafArn;
    clientAddress: SecurityBlockClientAddress;
  }): Promise<AwsWafRuleState> {
    const setArns: Record<string, string> = await this.ensureSets();
    let unavailable: number = 0;

    for (let attempt: number = 1; attempt <= AWS_WAF_LOCK_ATTEMPTS; ) {
      const read: AwsWafWebAcl = await this.readWebAcl(data.webAcl);
      const rules: Array<unknown> = Array.isArray(read.webAcl["Rules"])
        ? (read.webAcl["Rules"] as Array<unknown>)
        : [];
      const build: (
        action: SecurityBlockAction,
        name: string,
        ipv4: string,
        ipv6: string,
      ) => (priority: number) => JSONObject = (
        action: SecurityBlockAction,
        name: string,
        ipv4: string,
        ipv6: string,
      ): ((priority: number) => JSONObject) => {
        return (priority: number): JSONObject => {
          return buildAwsWafBlocklistRule({
            name,
            action,
            priority,
            ipv4SetArn: setArns[ipv4]!,
            ipv6SetArn: setArns[ipv6]!,
            clientAddress: data.clientAddress,
          });
        };
      };
      const plan: AwsWafBlocklistRulePlan = planAwsWafBlocklistRules({
        rules,
        wanted: [
          {
            action: SecurityBlockAction.Block,
            name: this.ruleNames.block,
            build: build(
              SecurityBlockAction.Block,
              this.ruleNames.block,
              "block-ipv4",
              "block-ipv6",
            ),
          },
          {
            action: SecurityBlockAction.Challenge,
            name: this.ruleNames.challenge,
            build: build(
              SecurityBlockAction.Challenge,
              this.ruleNames.challenge,
              "challenge-ipv4",
              "challenge-ipv6",
            ),
          },
        ],
      });

      if (!plan.isPlaced) {
        const state: AwsWafRuleState = await this.readRuleState({
          webAcl: data.webAcl,
          clientAddress: data.clientAddress,
          addsRule: true,
          read,
        });

        return {
          ...state,
          status: SecurityBlockCloudWafStatus.NoFreePriority,
          message: `${data.webAcl.name} has no free priority below its first rule (priority ${plan.firstPriority}) for OneUptime's ${plan.needed === 1 ? "rule" : "two rules"}, and OneUptime never renumbers your rules. Free ${plan.needed === 1 ? "a priority" : "two priorities"} below it, and OneUptime adds ${plan.needed === 1 ? "its rule" : "them"} there.`,
        };
      }

      if (!plan.isChanged) {
        return await this.readRuleState({
          webAcl: data.webAcl,
          clientAddress: data.clientAddress,
          addsRule: true,
          read,
        });
      }

      try {
        await updateAwsWafWebAcl(await this.getSession(), {
          webAcl: read,
          rules: plan.rules,
          name: data.webAcl.name,
        });

        // What AWS holds now is read back by the caller; this is what was written.
        return await this.readRuleState({
          webAcl: data.webAcl,
          clientAddress: data.clientAddress,
          addsRule: true,
          read: {
            webAcl: { ...read.webAcl, Rules: plan.rules },
            lockToken: read.lockToken,
          },
        });
      } catch (error) {
        if (isAwsWafError(error, AwsWafErrorCode.OptimisticLock)) {
          attempt++;
          continue;
        }

        if (
          isAwsWafError(error, AwsWafErrorCode.Unavailable) &&
          unavailable < AWS_WAF_UNAVAILABLE_ATTEMPTS
        ) {
          // A set just made is not known everywhere yet: wait, then try again.
          unavailable++;
          await (await this.getSession()).sleep(AWS_WAF_UNAVAILABLE_WAIT_MS);
          continue;
        }

        return this.failedState({
          setArns,
          message: isAwsWafError(error, AwsWafErrorCode.LimitsExceeded)
            ? `AWS WAF refused OneUptime's rules in ${data.webAcl.name} as over its limits: the web ACL may use no more capacity, or reference no more IP sets (50). Make room in it, and OneUptime adds its rules.`
            : `OneUptime could not add its rules to ${data.webAcl.name}: ${errorText(error)}`,
        });
      }
    }

    return this.failedState({
      setArns,
      message: `${data.webAcl.name} kept changing while OneUptime added its rules (${AWS_WAF_LOCK_ATTEMPTS} tries). OneUptime tries again shortly.`,
    });
  }

  private failedState(data: {
    setArns: Record<string, string>;
    message: string;
  }): AwsWafRuleState {
    return {
      status: SecurityBlockCloudWafStatus.Failed,
      message: data.message,
      enforcedSetKeys: [],
      priorities: { block: null, challenge: null },
      setArns: data.setArns,
      sampledMetricNames: {},
    };
  }

  /*
   * OneUptime's rules taken out of a web ACL, every other rule written back
   * as it was: when the web ACL stops enforcing the blocklist. Nothing to
   * do when they are not there. Returns whether it wrote the web ACL.
   */
  public async removeRules(webAcl: AwsWafArn): Promise<boolean> {
    for (let attempt: number = 1; attempt <= AWS_WAF_LOCK_ATTEMPTS; attempt++) {
      const read: AwsWafWebAcl = await this.readWebAcl(webAcl);
      const rules: Array<unknown> = Array.isArray(read.webAcl["Rules"])
        ? (read.webAcl["Rules"] as Array<unknown>)
        : [];
      const kept: Array<JSONObject> = withoutAwsWafBlocklistRules(
        rules,
        this.ruleNames,
      );

      if (kept.length === rules.length) {
        return false;
      }

      try {
        await updateAwsWafWebAcl(await this.getSession(), {
          webAcl: read,
          rules: kept,
          name: webAcl.name,
        });

        return true;
      } catch (error) {
        if (isAwsWafError(error, AwsWafErrorCode.OptimisticLock)) {
          continue;
        }

        throw error;
      }
    }

    throw new Error(
      `${webAcl.name} kept changing while OneUptime took its rules out (${AWS_WAF_LOCK_ATTEMPTS} tries). Try again.`,
    );
  }

  /*
   * The project's sets here emptied and deleted, once no web ACL of the
   * project uses them: emptied first, so a rule that still references one -
   * a web ACL kept in code - blocks nothing; deleted when nothing
   * references it (AWS WAF refuses otherwise, and the empty set stays).
   * Returns the sets left behind, by name.
   */
  public async emptyAndDeleteSets(): Promise<Array<string>> {
    const left: Array<string> = [];

    for (const spec of this.specs) {
      const emptied: {
        added: Array<AwsWafSetWriteResult>;
        removed: Array<AwsWafSetWriteResult>;
      } = await this.changeSet(spec.key, {
        add: [],
        remove: ((await this.readSet(spec.key))?.addresses || []).map(keyOf),
      });
      const failed: AwsWafSetWriteResult | undefined = emptied.removed.find(
        (result: AwsWafSetWriteResult): boolean => {
          return !result.isDone;
        },
      );

      if (failed) {
        throw new Error(
          failed.error || `OneUptime could not empty IP set ${spec.name}.`,
        );
      }

      const set: AwsWafIpSet | null = await this.readSet(spec.key);

      if (!set) {
        continue;
      }

      try {
        await deleteAwsWafIpSet(await this.getSession(), {
          set,
          lockToken: set.lockToken,
        });
        this.summaries?.delete(spec.key);
        this.reads.delete(spec.key);
      } catch (error) {
        if (isAwsWafError(error, AwsWafErrorCode.Nonexistent)) {
          continue;
        }

        if (
          isAwsWafError(error, AwsWafErrorCode.Associated) ||
          isAwsWafError(error, AwsWafErrorCode.OptimisticLock)
        ) {
          // Still referenced by a rule - a web ACL kept in code - or written meanwhile: left, empty.
          left.push(spec.name);
          continue;
        }

        throw error;
      }
    }

    return left;
  }
}
