import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudRequiredTag from "../../../Models/DatabaseModels/CloudRequiredTag";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudTagCoverageDay from "../../../Models/DatabaseModels/CloudTagCoverageDay";
import CloudTagFinding from "../../../Models/DatabaseModels/CloudTagFinding";
import CloudTagSetting from "../../../Models/DatabaseModels/CloudTagSetting";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import User from "../../../Models/DatabaseModels/User";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CLOUD_COST_HISTORY_DAYS,
  addUtcDays,
  startOfUtcDay,
  toCloudCostDay,
} from "../../../Types/Cloud/CloudCost";
import {
  CloudRequiredTagRule,
  getCloudRequiredTagsForAccount,
  normalizeCloudTagKey,
} from "../../../Types/Cloud/CloudRequiredTags";
import {
  CloudCreateCall,
  findCloudCreateCall,
  getCloudResourceLogIds,
} from "../../../Types/Cloud/CloudResourceCreator";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import {
  CloudTagMissingJSON,
  readCloudTagMissing,
} from "../../../Types/Cloud/CloudTagCoverage";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudAccountService from "../../Services/CloudAccountService";
import CloudRequiredTagService from "../../Services/CloudRequiredTagService";
import CloudResourceService from "../../Services/CloudResourceService";
import CloudTagCoverageDayService from "../../Services/CloudTagCoverageDayService";
import CloudTagFindingService from "../../Services/CloudTagFindingService";
import CloudTagSettingService from "../../Services/CloudTagSettingService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import CloudTagCoverageReader, {
  CloudTagAccountKey,
} from "./CloudTagCoverageReader";
import CloudTagCreators from "./CloudTagCreators";
import CloudTagNotifier, {
  CloudTagNotice,
  CloudTagRecipient,
} from "./CloudTagNotifier";
import CloudTagSuggestions, {
  CLOUD_TAG_SUBJECT_SELECT,
  CloudTagSubject,
  CloudTagSubjectFindings,
  getCloudTagDeclaredCode,
  toCloudTagSubject,
} from "./CloudTagSuggestions";

/*
 * NEW CLOUD RESOURCES WITHOUT A REQUIRED TAG, CAUGHT THE DAY THEY APPEAR
 * (#11012).
 *
 * Every 15 minutes (Workers' Cloud:WatchCloudTags), for each project with
 * required tags:
 *
 *   1. New resources: those its accounts' connections listed in the last
 *      day, after the project required its first tag and after each
 *      account's first full listing (when the watcher first saw it listed
 *      in full, kept in CloudTagSetting.watchState) - a first listing's
 *      thousands of resources are not new. Each that lacks a required tag
 *      of its account is a finding (CloudTagFinding), with what it lacks
 *      and the value OneUptime suggests (CloudTagSuggestions). The
 *      inventory lists every 30 minutes, so a resource is found within the
 *      hour it is made.
 *   2. Open findings are read again: one that carries every tag now, or
 *      whose resource is gone, is closed - nobody is told of a resource
 *      that was tagged meanwhile.
 *   3. Who created it: the first create call of its account's change log
 *      that names it (CloudTagCreators), and the member of the project
 *      that caller is. A finding waits up to 45 minutes for it - CloudTrail
 *      delivers a call minutes after it is made - then is told without.
 *   4. Telling people (CloudTagNotifier): its creator and owners, else the
 *      project's owners, in one email an hour (or one a resource), and an
 *      alert per account when the project asks for one.
 *   5. Once a UTC day, each account's resources counted
 *      (CloudTagCoverageDay): coverage by resource's trend.
 *
 * Never throws: a project whose run fails is logged and run again next
 * time; what it could not do is done then.
 */

// How far back a resource is new, at most.
export const CLOUD_TAG_NEW_WINDOW_HOURS: number = 24;

// The new resources one run looks at, at most.
export const CLOUD_TAG_NEW_PER_RUN: number = 2000;

// The open findings one run reads again, at most.
export const CLOUD_TAG_OPEN_PER_RUN: number = 2000;

// How long a finding waits for who created it before it is told without.
export const CLOUD_TAG_CREATOR_WAIT_MINUTES: number = 45;

// How long after it is found a creator is still looked for.
export const CLOUD_TAG_CREATOR_LOOKUP_HOURS: number = 6;

// How far before a resource's listing its create call may be.
export const CLOUD_TAG_CREATOR_LOOK_BACK_HOURS: number = 3;

// How often an email of everything new goes out: once an hour.
export const CLOUD_TAG_DIGEST_EVERY_MINUTES: number = 60;

// What the watcher keeps in CloudTagSetting.watchState.
export interface CloudTagWatchState {
  // When each account (its row id) was first seen listed in full.
  accounts: Record<string, string>;
  // When the last email of everything new went out.
  lastDigestAt?: string | undefined;
  // The last UTC day the resources were counted, "2026-11-24".
  lastCountedDay?: string | undefined;
}

export interface CloudTagWatchResult {
  found: number;
  resolved: number;
  creatorsFound: number;
  emailsSent: number;
  alertsRaised: number;
  daysCounted: number;
}

export function readCloudTagWatchState(value: unknown): CloudTagWatchState {
  const state: CloudTagWatchState = { accounts: {} };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return state;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const accounts: unknown = record["accounts"];

  if (accounts && typeof accounts === "object" && !Array.isArray(accounts)) {
    for (const [id, at] of Object.entries(
      accounts as Record<string, unknown>,
    )) {
      if (typeof at === "string" && !Number.isNaN(new Date(at).getTime())) {
        state.accounts[id] = at;
      }
    }
  }

  if (
    typeof record["lastDigestAt"] === "string" &&
    !Number.isNaN(new Date(record["lastDigestAt"]).getTime())
  ) {
    state.lastDigestAt = record["lastDigestAt"];
  }

  if (typeof record["lastCountedDay"] === "string") {
    state.lastCountedDay = record["lastCountedDay"];
  }

  return state;
}

/*
 * Whether an email of everything new is due: never sent, or the last one
 * went out an hour ago (a few minutes' leeway, so a run that starts a
 * little early does not wait another quarter of an hour).
 */
export function isCloudTagDigestDue(data: {
  lastDigestAt: string | undefined;
  now: Date;
}): boolean {
  if (!data.lastDigestAt) {
    return true;
  }

  const last: number = new Date(data.lastDigestAt).getTime();

  return (
    Number.isNaN(last) ||
    data.now.getTime() - last >=
      (CLOUD_TAG_DIGEST_EVERY_MINUTES - 5) * 60 * 1000
  );
}

/*
 * Whether a finding may be told now: its creator is known, or it waited
 * long enough for the change log.
 */
export function isCloudTagFindingDue(data: {
  creatorActor: string | null | undefined;
  foundAt: Date;
  now: Date;
}): boolean {
  return (
    Boolean(data.creatorActor) ||
    data.now.getTime() - data.foundAt.getTime() >=
      CLOUD_TAG_CREATOR_WAIT_MINUTES * 60 * 1000
  );
}

function readMissing(value: unknown): Array<CloudTagMissingJSON> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readCloudTagMissing)
    .filter((item: CloudTagMissingJSON | null): boolean => {
      return Boolean(item);
    }) as Array<CloudTagMissingJSON>;
}

interface WatchedAccount {
  row: CloudAccount;
  key: CloudTagAccountKey;
}

export default class CloudTagWatcher {
  // Every project with a required tag, each in turn. Returns the projects run.
  @CaptureSpan()
  public static async runAll(now: Date): Promise<number> {
    const rows: Array<CloudRequiredTag> = await CloudRequiredTagService.findBy({
      query: {},
      select: { projectId: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
    const projectIds: Array<string> = Array.from(
      new Set(
        rows
          .map((row: CloudRequiredTag): string => {
            return row.projectId?.toString() || "";
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          }),
      ),
    );

    for (const projectId of projectIds) {
      await CloudTagWatcher.runForProject({
        projectId: new ObjectID(projectId),
        now,
      });
    }

    return projectIds.length;
  }

  @CaptureSpan()
  public static async runForProject(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<CloudTagWatchResult> {
    const result: CloudTagWatchResult = {
      found: 0,
      resolved: 0,
      creatorsFound: 0,
      emailsSent: 0,
      alertsRaised: 0,
      daysCounted: 0,
    };

    try {
      const ruleRows: Array<CloudRequiredTag> =
        await CloudRequiredTagService.findBy({
          query: { projectId: data.projectId },
          select: {
            _id: true,
            tagKey: true,
            allowedValues: true,
            cloudAccountId: true,
            createdAt: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          sort: { createdAt: SortOrder.Ascending },
          props: { isRoot: true },
        });
      const rules: Array<CloudRequiredTagRule> =
        await CloudTagCoverageReader.readRules(data.projectId);

      if (rules.length === 0) {
        return result;
      }

      // The project watches from its first required tag on.
      const watchedSince: Date =
        ruleRows[0]?.createdAt || OneUptimeDate.getCurrentDate();
      const setting: CloudTagSetting =
        await CloudTagSettingService.getOrCreateForProject(data.projectId);
      const state: CloudTagWatchState = readCloudTagWatchState(
        setting.watchState,
      );
      const accountRows: Array<CloudAccount> = await CloudAccountService.findBy(
        {
          query: { projectId: data.projectId },
          select: {
            _id: true,
            name: true,
            provider: true,
            accountId: true,
            inventoryListedAt: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        },
      );
      const accounts: Array<WatchedAccount> = [];

      for (const row of accountRows) {
        if (!row.id || !row.accountId || !row.provider) {
          continue;
        }

        const id: string = row.id.toString();

        // An account is watched from its first full listing seen on.
        if (!state.accounts[id] && row.inventoryListedAt) {
          state.accounts[id] = new Date(row.inventoryListedAt).toISOString();
        }

        accounts.push({
          row,
          key: {
            provider: row.provider as string,
            accountId: row.accountId,
            rowId: id,
          },
        });
      }

      result.found = await CloudTagWatcher.findNewResources({
        projectId: data.projectId,
        rules,
        accounts,
        state,
        watchedSince,
        now: data.now,
      });

      result.resolved = await CloudTagWatcher.readOpenFindingsAgain({
        projectId: data.projectId,
        rules,
        accounts,
        now: data.now,
      });

      result.creatorsFound = await CloudTagWatcher.findCreators({
        projectId: data.projectId,
        now: data.now,
      });

      const told: { emails: number; alerts: number } =
        await CloudTagWatcher.tell({
          projectId: data.projectId,
          setting,
          state,
          accounts,
          now: data.now,
        });
      result.emailsSent = told.emails;
      result.alertsRaised = told.alerts;

      result.daysCounted = await CloudTagWatcher.countDay({
        projectId: data.projectId,
        rules,
        accounts,
        state,
        now: data.now,
      });

      await CloudTagSettingService.updateOneById({
        id: setting.id!,
        data: { watchState: state as unknown as JSONObject } as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    } catch (error) {
      logger.error(
        `CloudTagWatcher: project ${data.projectId.toString()} could not be watched: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return result;
  }

  // The account a resource is of, among the project's.
  private static accountOf(
    accounts: Array<WatchedAccount>,
    resource: { provider: string; accountId: string },
  ): WatchedAccount | undefined {
    return accounts.find((account: WatchedAccount): boolean => {
      return (
        account.key.provider === resource.provider &&
        account.key.accountId.toLowerCase() === resource.accountId.toLowerCase()
      );
    });
  }

  private static toMissingJson(findings: CloudTagSubjectFindings): JSONArray {
    return findings.missing as unknown as JSONArray;
  }

  // Step 1: the new resources that lack a required tag become findings.
  private static async findNewResources(data: {
    projectId: ObjectID;
    rules: Array<CloudRequiredTagRule>;
    accounts: Array<WatchedAccount>;
    state: CloudTagWatchState;
    watchedSince: Date;
    now: Date;
  }): Promise<number> {
    const since: Date = new Date(
      Math.max(
        data.watchedSince.getTime(),
        data.now.getTime() - CLOUD_TAG_NEW_WINDOW_HOURS * 60 * 60 * 1000,
      ),
    );
    const resources: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId: data.projectId,
        cloudResourceKind: CloudResourceKind.Resource,
        cloudConnectionId: QueryHelper.notNull(),
        isArchived: false,
        createdAt: QueryHelper.greaterThan(since),
      },
      select: { ...CLOUD_TAG_SUBJECT_SELECT, createdAt: true },
      skip: 0,
      limit: CLOUD_TAG_NEW_PER_RUN,
      sort: { createdAt: SortOrder.Ascending },
      props: { isRoot: true },
    });

    // Only those made after their account's first full listing was seen.
    const candidates: Array<CloudResource> = resources.filter(
      (resource: CloudResource): boolean => {
        const account: WatchedAccount | undefined = CloudTagWatcher.accountOf(
          data.accounts,
          {
            provider: (resource.cloudProvider as string) || "",
            accountId: resource.cloudAccountId || "",
          },
        );
        const watchedFrom: string | undefined = account
          ? data.state.accounts[account.key.rowId]
          : undefined;

        return Boolean(
          resource.id &&
            resource.createdAt &&
            watchedFrom &&
            new Date(resource.createdAt).getTime() >
              new Date(watchedFrom).getTime(),
        );
      },
    );

    if (candidates.length === 0) {
      return 0;
    }

    // A resource is new once: one with a finding already is not looked at again.
    const existing: Array<CloudTagFinding> =
      await CloudTagFindingService.findBy({
        query: {
          projectId: data.projectId,
          cloudResourceId: QueryHelper.any(
            candidates.map((resource: CloudResource): ObjectID => {
              return resource.id!;
            }),
          ),
        },
        select: { cloudResourceId: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });
    const known: Set<string> = new Set<string>(
      existing.map((row: CloudTagFinding): string => {
        return row.cloudResourceId?.toString() || "";
      }),
    );
    const subjects: Array<CloudTagSubject> = candidates
      .filter((resource: CloudResource): boolean => {
        return !known.has(resource.id!.toString());
      })
      .map(toCloudTagSubject);
    const findings: Array<CloudTagSubjectFindings> =
      await CloudTagSuggestions.findMissing({
        projectId: data.projectId,
        subjects,
        rulesOf: (subject: CloudTagSubject): Array<CloudRequiredTagRule> => {
          return getCloudRequiredTagsForAccount(
            data.rules,
            CloudTagWatcher.accountOf(data.accounts, subject)?.key.rowId ||
              null,
          );
        },
      });
    let found: number = 0;

    for (const entry of findings) {
      const finding: CloudTagFinding = new CloudTagFinding();
      finding.projectId = data.projectId;
      finding.cloudResourceId = entry.subject.id;

      const account: WatchedAccount | undefined = CloudTagWatcher.accountOf(
        data.accounts,
        entry.subject,
      );

      if (account?.row.id) {
        finding.cloudAccountId = account.row.id;
      }

      finding.missingTags = CloudTagWatcher.toMissingJson(entry);
      finding.foundAt = data.now;

      try {
        await CloudTagFindingService.create({
          data: finding,
          props: { isRoot: true },
        });
        found++;
      } catch (error) {
        // Another worker found it first: its finding stands.
        logger.debug(
          `CloudTagWatcher: a finding for resource ${entry.subject.id.toString()} was not kept: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return found;
  }

  /*
   * Step 2: each open finding read again - closed when its resource
   * carries every tag now or is gone, its suggestions brought up to date
   * otherwise.
   */
  private static async readOpenFindingsAgain(data: {
    projectId: ObjectID;
    rules: Array<CloudRequiredTagRule>;
    accounts: Array<WatchedAccount>;
    now: Date;
  }): Promise<number> {
    const open: Array<CloudTagFinding> = await CloudTagFindingService.findBy({
      query: { projectId: data.projectId, resolvedAt: QueryHelper.isNull() },
      select: { _id: true, cloudResourceId: true, missingTags: true },
      skip: 0,
      limit: CLOUD_TAG_OPEN_PER_RUN,
      sort: { foundAt: SortOrder.Ascending },
      props: { isRoot: true },
    });

    if (open.length === 0) {
      return 0;
    }

    const resources: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(
          open.map((finding: CloudTagFinding): ObjectID => {
            return finding.cloudResourceId!;
          }),
        ),
      },
      select: CLOUD_TAG_SUBJECT_SELECT,
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
    const live: Array<CloudTagSubject> = resources
      .filter((resource: CloudResource): boolean => {
        return Boolean(resource.id) && !resource.isArchived;
      })
      .map(toCloudTagSubject);
    const stillLacking: Array<CloudTagSubjectFindings> =
      await CloudTagSuggestions.findMissing({
        projectId: data.projectId,
        subjects: live,
        rulesOf: (subject: CloudTagSubject): Array<CloudRequiredTagRule> => {
          return getCloudRequiredTagsForAccount(
            data.rules,
            CloudTagWatcher.accountOf(data.accounts, subject)?.key.rowId ||
              null,
          );
        },
      });
    const lackingById: Map<string, CloudTagSubjectFindings> = new Map();

    for (const entry of stillLacking) {
      lackingById.set(entry.subject.id.toString(), entry);
    }

    let resolved: number = 0;

    for (const finding of open) {
      const entry: CloudTagSubjectFindings | undefined = lackingById.get(
        finding.cloudResourceId?.toString() || "",
      );

      try {
        if (!entry) {
          await CloudTagFindingService.updateOneById({
            id: finding.id!,
            data: { resolvedAt: data.now } as never,
            props: { isRoot: true, ignoreHooks: true },
          });
          resolved++;
          continue;
        }

        const missing: JSONArray = CloudTagWatcher.toMissingJson(entry);

        if (JSON.stringify(missing) !== JSON.stringify(finding.missingTags)) {
          await CloudTagFindingService.updateOneById({
            id: finding.id!,
            data: { missingTags: missing } as never,
            props: { isRoot: true, ignoreHooks: true },
          });
        }
      } catch (error) {
        logger.error(
          `CloudTagWatcher: finding ${finding.id?.toString()} could not be brought up to date: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return resolved;
  }

  /*
   * Step 3: who created each new resource whose creator is not known yet,
   * from the change log, and the member of the project they are.
   */
  private static async findCreators(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<number> {
    const lookedSince: Date = new Date(
      data.now.getTime() - CLOUD_TAG_CREATOR_LOOKUP_HOURS * 60 * 60 * 1000,
    );
    const pending: Array<CloudTagFinding> = await CloudTagFindingService.findBy(
      {
        query: {
          projectId: data.projectId,
          resolvedAt: QueryHelper.isNull(),
          creatorActor: QueryHelper.isNull(),
          foundAt: QueryHelper.greaterThan(lookedSince),
        },
        select: {
          _id: true,
          cloudResourceId: true,
          cloudResource: {
            _id: true,
            cloudProvider: true,
            providerResourceId: true,
            createdAt: true,
          },
        },
        skip: 0,
        limit: CLOUD_TAG_OPEN_PER_RUN,
        props: { isRoot: true },
      },
    );

    if (pending.length === 0) {
      return 0;
    }

    const rowIds: Array<string> = [];
    const logIds: Set<string> = new Set<string>();
    let earliest: number = data.now.getTime();

    for (const finding of pending) {
      const resource: CloudResource | undefined = finding.cloudResource;

      if (!resource?.id) {
        continue;
      }

      rowIds.push(resource.id.toString());

      for (const id of getCloudResourceLogIds(
        resource.cloudProvider as string,
        resource.providerResourceId || "",
      )) {
        logIds.add(id);
      }

      if (resource.createdAt) {
        earliest = Math.min(earliest, new Date(resource.createdAt).getTime());
      }
    }

    const calls: Array<CloudCreateCall> =
      await CloudTagCreators.readCreateCalls({
        projectId: data.projectId,
        start: new Date(
          earliest - CLOUD_TAG_CREATOR_LOOK_BACK_HOURS * 60 * 60 * 1000,
        ),
        end: data.now,
        resourceRowIds: rowIds,
        logIds: Array.from(logIds),
      });
    let creatorsFound: number = 0;

    for (const finding of pending) {
      const resource: CloudResource | undefined = finding.cloudResource;

      if (!resource?.id) {
        continue;
      }

      const call: CloudCreateCall | null = findCloudCreateCall({
        calls,
        resourceRowId: resource.id.toString(),
        resourceIds: getCloudResourceLogIds(
          resource.cloudProvider as string,
          resource.providerResourceId || "",
        ),
      });

      if (!call || !call.actor) {
        continue;
      }

      const member: User | null = await CloudTagCreators.findMember({
        projectId: data.projectId,
        actor: call.actor,
      });

      try {
        await CloudTagFindingService.updateOneById({
          id: finding.id!,
          data: {
            creatorActor: call.actor.slice(0, 500),
            ...(member?.id ? { creatorUserId: member.id } : {}),
          } as never,
          props: { isRoot: true, ignoreHooks: true },
        });
        creatorsFound++;
      } catch (error) {
        logger.error(
          `CloudTagWatcher: the creator of finding ${finding.id?.toString()} could not be kept: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return creatorsFound;
  }

  /*
   * Step 4: telling people of the findings due - by email, once an hour or
   * one a resource, and by an alert per account when the project asks.
   */
  private static async tell(data: {
    projectId: ObjectID;
    setting: CloudTagSetting;
    state: CloudTagWatchState;
    accounts: Array<WatchedAccount>;
    now: Date;
  }): Promise<{ emails: number; alerts: number }> {
    const emailEachResource: boolean = data.setting.emailEachResource === true;

    // Everything new goes out once an hour, unless each resource goes alone.
    if (
      !emailEachResource &&
      !isCloudTagDigestDue({
        lastDigestAt: data.state.lastDigestAt,
        now: data.now,
      })
    ) {
      return { emails: 0, alerts: 0 };
    }

    const open: Array<CloudTagFinding> = await CloudTagFindingService.findBy({
      query: {
        projectId: data.projectId,
        resolvedAt: QueryHelper.isNull(),
        notifiedAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        cloudResourceId: true,
        cloudAccountId: true,
        missingTags: true,
        creatorActor: true,
        creatorUserId: true,
        foundAt: true,
        cloudResource: {
          _id: true,
          name: true,
          cloudProvider: true,
          cloudResourceType: true,
          providerResourceId: true,
          cloudTags: true,
        },
      },
      skip: 0,
      limit: CLOUD_TAG_OPEN_PER_RUN,
      sort: { foundAt: SortOrder.Ascending },
      props: { isRoot: true },
    });
    const due: Array<CloudTagFinding> = open.filter(
      (finding: CloudTagFinding): boolean => {
        return Boolean(
          finding.foundAt &&
            finding.cloudResource &&
            isCloudTagFindingDue({
              creatorActor: finding.creatorActor,
              foundAt: new Date(finding.foundAt),
              now: data.now,
            }),
        );
      },
    );

    if (due.length === 0) {
      return { emails: 0, alerts: 0 };
    }

    const accountName: (id: ObjectID | undefined) => string = (
      id: ObjectID | undefined,
    ): string => {
      const account: WatchedAccount | undefined = data.accounts.find(
        (candidate: WatchedAccount): boolean => {
          return candidate.key.rowId === id?.toString();
        },
      );

      return (account?.row.name || account?.row.accountId || "").trim();
    };
    const notices: Array<CloudTagNotice> = due.map(
      (finding: CloudTagFinding): CloudTagNotice => {
        const resource: CloudResource = finding.cloudResource!;

        return {
          findingId: finding.id!,
          resourceId: finding.cloudResourceId!,
          resourceName: (
            resource.name ||
            resource.providerResourceId ||
            ""
          ).trim(),
          provider: (resource.cloudProvider as string) || "",
          type: resource.cloudResourceType || "",
          accountRowId: finding.cloudAccountId || null,
          accountName: accountName(finding.cloudAccountId),
          creatorActor: finding.creatorActor || null,
          creatorUserId: finding.creatorUserId || null,
          missing: readMissing(finding.missingTags),
          declaredCode: CloudTagWatcher.declaredCodeOf(resource),
        };
      },
    );
    let emails: number = 0;
    let alerts: number = 0;

    if (data.setting.notifyPeople !== false) {
      const recipients: Array<CloudTagRecipient> =
        await CloudTagNotifier.getRecipients({
          projectId: data.projectId,
          notices,
        });

      emails = await CloudTagNotifier.email({
        projectId: data.projectId,
        recipients,
        emailEachResource,
      });
    }

    if (data.setting.raiseAlert) {
      const policies: Array<OnCallDutyPolicy> =
        await CloudTagWatcher.readPolicies(data.setting);

      alerts = await CloudTagNotifier.raiseAlerts({
        projectId: data.projectId,
        notices,
        alertSeverityId: data.setting.alertSeverityId || null,
        onCallDutyPolicyIds: policies
          .map((policy: OnCallDutyPolicy): ObjectID | null => {
            return policy.id || null;
          })
          .filter((id: ObjectID | null): boolean => {
            return Boolean(id);
          }) as Array<ObjectID>,
        now: data.now,
      });
    }

    // Told, or nobody to tell: never told again.
    await CloudTagFindingService.updateBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(
          due.map((finding: CloudTagFinding): ObjectID => {
            return finding.id!;
          }),
        ),
      },
      data: { notifiedAt: data.now } as never,
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true, ignoreHooks: true },
    });

    if (!emailEachResource) {
      data.state.lastDigestAt = data.now.toISOString();
    }

    return { emails, alerts };
  }

  // The code that declares a resource, as the page reads it from its tags.
  private static declaredCodeOf(resource: CloudResource): string | null {
    return getCloudTagDeclaredCode(toCloudTagSubject(resource).tags);
  }

  private static async readPolicies(
    setting: CloudTagSetting,
  ): Promise<Array<OnCallDutyPolicy>> {
    const withPolicies: CloudTagSetting | null =
      await CloudTagSettingService.findOneById({
        id: setting.id!,
        select: { onCallDutyPolicies: { _id: true } },
        props: { isRoot: true },
      });

    return withPolicies?.onCallDutyPolicies || [];
  }

  /*
   * Step 5: once a UTC day, each account's resources counted - those
   * listed, those carrying every required tag of the account, and each tag.
   */
  private static async countDay(data: {
    projectId: ObjectID;
    rules: Array<CloudRequiredTagRule>;
    accounts: Array<WatchedAccount>;
    state: CloudTagWatchState;
    now: Date;
  }): Promise<number> {
    const day: Date = startOfUtcDay(data.now);
    const dayText: string = toCloudCostDay(day);

    if (data.state.lastCountedDay === dayText || data.accounts.length === 0) {
      return 0;
    }

    const built: { sql: string; params: Array<unknown> } =
      CloudTagCoverageReader.buildResourceCountSql({
        projectId: data.projectId,
        accounts: data.accounts.map((account: WatchedAccount) => {
          return account.key;
        }),
        rules: data.rules,
      });
    const rows: Array<Record<string, unknown>> =
      await CloudResourceService.getRepository().manager.query(
        built.sql,
        built.params,
      );
    let counted: number = 0;

    for (const account of data.accounts) {
      const row: Record<string, unknown> | undefined = rows.find(
        (candidate: Record<string, unknown>): boolean => {
          return (
            String(candidate["provider"] || "") === account.key.provider &&
            String(candidate["account"] || "") ===
              account.key.accountId.toLowerCase()
          );
        },
      );
      const accountRules: Array<CloudRequiredTagRule> =
        getCloudRequiredTagsForAccount(data.rules, account.key.rowId);
      const keyCounts: JSONObject = {};

      for (const rule of accountRules) {
        const index: number = data.rules.findIndex(
          (candidate: CloudRequiredTagRule): boolean => {
            return candidate.id === rule.id;
          },
        );

        keyCounts[normalizeCloudTagKey(rule.key)] = Number(
          row?.[`r${index}`] || 0,
        );
      }

      const existing: CloudTagCoverageDay | null =
        await CloudTagCoverageDayService.findOneBy({
          query: { cloudAccountId: account.row.id!, day },
          select: { _id: true },
          props: { isRoot: true },
        });

      try {
        if (existing?.id) {
          await CloudTagCoverageDayService.updateOneById({
            id: existing.id,
            data: {
              resourceCount: Number(row?.["total"] || 0),
              coveredCount: Number(row?.["covered"] || 0),
              keyCounts,
            } as never,
            props: { isRoot: true, ignoreHooks: true },
          });
        } else {
          const count: CloudTagCoverageDay = new CloudTagCoverageDay();
          count.projectId = data.projectId;
          count.cloudAccountId = account.row.id!;
          count.day = day;
          count.resourceCount = Number(row?.["total"] || 0);
          count.coveredCount = Number(row?.["covered"] || 0);
          count.keyCounts = keyCounts;

          await CloudTagCoverageDayService.create({
            data: count,
            props: { isRoot: true },
          });
        }

        counted++;
      } catch (error) {
        logger.error(
          `CloudTagWatcher: account ${account.key.rowId}'s count could not be kept: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Kept as long as the costs are.
    await CloudTagCoverageDayService.hardDeleteBy({
      query: {
        projectId: data.projectId,
        day: QueryHelper.lessThan(addUtcDays(day, -CLOUD_COST_HISTORY_DAYS)),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    data.state.lastCountedDay = dayText;

    return counted;
  }
}
