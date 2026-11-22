import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueGroup from "../../../Models/DatabaseModels/DataSecurityIssueGroup";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { readCloudTags } from "../../../Types/Cloud/CloudInventory";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import {
  DATA_SECURITY_ISSUE_GROUP_CHECK_IDS,
  DataSecurityIssueGroupCode,
  DataSecurityIssueGroupDraft,
  DataSecurityIssueGroupFacts,
  DataSecurityIssueGroupIssue,
  DataSecurityIssueGroupStore,
  MIN_ISSUES_PER_GROUP,
  getIssueGroupOriginName,
  getStoreCauseTags,
  getStoreStackName,
  groupIssuesByCause,
  readDataSecurityIssueGroupFacts,
  withDeclaredCode,
} from "../../../Types/DataSecurity/DataSecurityIssueGroup";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DECLARED_CODE_KIND_NAMES,
  DeclaredCode,
  readDeclaredCode,
} from "../../../Utils/AiRemediation/DeclaredCodeChange";
import CodeRepositoryService, {
  Service as CodeRepositoryServiceClass,
} from "../../Services/CodeRepositoryService";
import DataSecurityIssueGroupService from "../../Services/DataSecurityIssueGroupService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataStoreService from "../../Services/DataStoreService";
import QueryHelper from "../../Types/Database/QueryHelper";
import DeclaredCodeOwner, {
  DeclaredCodeOwnerCandidate,
  getRepositoryFullName,
} from "../AI/Remediation/DeclaredCodeOwner";
import CloudAiTargets from "../AI/ResourceAccess/CloudAiTargets";
import { ResolvableRepository } from "../CodeRepository/StackTraceRepoResolver";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataSecurityStoreCreators, {
  StoreToFindCreatorOf,
} from "./DataSecurityStoreCreators";

/*
 * GROUPING A PROJECT'S DATA SECURITY ISSUES BY WHAT MADE THEM (#10370).
 *
 * Run after every evaluation (queued by DataSecurityEvaluator), so a group
 * forms as its issues open, takes in new ones, and counts them as they
 * resolve:
 *
 *  1. The project's open issues of the checks one mistake can fail on many
 *     stores at once (isIssueGroupCheck), with the group each is in.
 *  2. Their stores: name, kind, cloud, region, account and tags, the code
 *     their tags say declares them (CloudAiTargets.getManagedAsCode), and -
 *     for a store whose tags name nothing that made it - the identity that
 *     created it, where the change log names one (DataSecurityStoreCreators).
 *  3. The groups the facts make (Types/DataSecurity/DataSecurityIssueGroup):
 *     the strongest fact first, two issues at least, one group per issue,
 *     and an issue stays in its group while its store shares the group's
 *     fact.
 *  4. For a group of a module's or a stack's tag whose stores are declared
 *     as code, the repository and the files that declare them
 *     (DeclaredCodeOwner, by the module's or stack's name): the file or
 *     module that declares them is the strongest fact of all. Looked up
 *     once a day per group, a few groups a run, each within a time limit.
 *  5. Each group kept - made, or its facts and counts brought up to date -
 *     and each issue's group written; an open issue that no longer shares
 *     its group's fact leaves it. A resolved issue keeps its group, so the
 *     group says how many are fixed; a group whose last open issue resolved
 *     says when (fixedAt), and is open again if one reopens.
 *  6. A group nothing holds any more - fewer than two issues of any status,
 *     and no fix of its own - is deleted.
 *
 * Then OneUptime AI names the groups whose facts changed, and proposes
 * their fix (DataSecurityIssueGroupFix), as the project's AI rules say -
 * neither of which this waits on.
 *
 * Read and written as OneUptime, the project scoped on every query. Never
 * throws: an evaluation ended, whatever this could group.
 */

// The most open issues one run groups; the rest wait for the next.
export const MAX_OPEN_ISSUES_GROUPED: number = 20000;

// The most stores read at once.
const STORE_PAGE_SIZE: number = 500;

// The most issues read at once.
const ISSUE_PAGE_SIZE: number = 1000;

// The most groups one run looks up the code of.
export const MAX_CODE_LOOKUPS_PER_RUN: number = 10;

// How long one lookup of the code that declares a group's stores may take.
export const CODE_LOOKUP_TIMEOUT_IN_MS: number = 20 * 1000;

// How long a group's code, or that none was found, is trusted before it is looked up again.
export const CODE_LOOKUP_KEPT_FOR_IN_HOURS: number = 24;

// The most groups of one project read at once.
const MAX_GROUPS_READ: number = 5000;

const ROOT: { isRoot: true } = { isRoot: true };

// When a group's code was looked up, kept with its facts.
const CODE_LOOKED_UP_AT_KEY: string = "codeLookedUpAt";

export interface IssueGroupingOutcome {
  // Groups with open issues after the run.
  openGroups: number;
  created: number;
  updated: number;
  deleted: number;
  // Issues whose group changed: joined one, or left one.
  issuesMoved: number;
  // The groups whose open issues or facts changed: what is named and proposed again.
  changedGroupIds: Array<ObjectID>;
}

function idOf(record: { _id?: unknown; id?: unknown }): string {
  const value: unknown = record.id || record._id;

  return value ? String(value).toLowerCase() : "";
}

async function withinTime<T>(
  work: Promise<T>,
  timeoutInMs: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout: Promise<null> = new Promise<null>(
    (resolve: (value: null) => void) => {
      timer = setTimeout(() => {
        resolve(null);
      }, timeoutInMs);
    },
  );

  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    logger.debug(
      `DataSecurity grouping: a lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

// A group's facts as stored with when its code was last looked up.
function readCodeLookedUpAt(value: unknown): Date | null {
  const raw: unknown =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)[CODE_LOOKED_UP_AT_KEY]
      : null;
  const at: Date | null = typeof raw === "string" ? new Date(raw) : null;

  return at && !Number.isNaN(at.getTime()) ? at : null;
}

// What a group keeps of its facts, with when its code was looked up.
export function toStoredFacts(
  facts: DataSecurityIssueGroupFacts,
  codeLookedUpAt: Date | null,
): JSONObject {
  const stored: JSONObject = JSON.parse(JSON.stringify(facts)) as JSONObject;

  if (codeLookedUpAt) {
    stored[CODE_LOOKED_UP_AT_KEY] = codeLookedUpAt.toISOString();
  }

  return stored;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export default class DataSecurityIssueGrouper {
  @CaptureSpan()
  public static async groupProject(data: {
    projectId: ObjectID;
    now?: Date | undefined;
  }): Promise<IssueGroupingOutcome> {
    const outcome: IssueGroupingOutcome = {
      openGroups: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      issuesMoved: 0,
      changedGroupIds: [],
    };

    try {
      return await DataSecurityIssueGrouper.group({
        projectId: data.projectId,
        now: data.now || OneUptimeDate.getCurrentDate(),
        outcome,
      });
    } catch (error) {
      logger.error(
        `DataSecurity grouping: could not group the issues of project ${data.projectId.toString()}: ${error}`,
      );
      return outcome;
    }
  }

  private static async group(data: {
    projectId: ObjectID;
    now: Date;
    outcome: IssueGroupingOutcome;
  }): Promise<IssueGroupingOutcome> {
    const { projectId, now, outcome } = data;
    const groups: Array<DataSecurityIssueGroup> =
      await DataSecurityIssueGroupService.findBy({
        query: { projectId },
        select: {
          _id: true,
          groupKey: true,
          checkId: true,
          cause: true,
          facts: true,
          issueCount: true,
          openIssueCount: true,
          fixedAt: true,
          codeTaskId: true,
        },
        skip: 0,
        limit: MAX_GROUPS_READ,
        props: ROOT,
      });
    const groupsById: Map<string, DataSecurityIssueGroup> = new Map();
    const groupsByKey: Map<string, DataSecurityIssueGroup> = new Map();

    for (const group of groups) {
      groupsById.set(idOf(group), group);

      if (group.groupKey) {
        groupsByKey.set(group.groupKey, group);
      }
    }

    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueGrouper.readOpenIssues(projectId);
    const stores: Map<string, DataStore> =
      await DataSecurityIssueGrouper.readStores(
        projectId,
        Array.from(
          new Set(
            issues.map((issue: DataSecurityIssue): string => {
              return issue.dataStoreId?.toString() || "";
            }),
          ),
        ).filter(Boolean),
      );
    const groupingStores: Array<DataSecurityIssueGroupStore> =
      await DataSecurityIssueGrouper.toGroupingStores(projectId, stores);
    const groupingIssues: Array<DataSecurityIssueGroupIssue> = issues
      .filter((issue: DataSecurityIssue): boolean => {
        return stores.has(issue.dataStoreId?.toString().toLowerCase() || "");
      })
      .map((issue: DataSecurityIssue): DataSecurityIssueGroupIssue => {
        const group: DataSecurityIssueGroup | undefined = groupsById.get(
          issue.dataSecurityIssueGroupId?.toString().toLowerCase() || "",
        );

        return {
          id: idOf(issue),
          checkId: issue.checkId || "",
          dataStoreId: issue.dataStoreId!.toString().toLowerCase(),
          groupKey: group?.groupKey || null,
        };
      });
    const drafts: Array<DataSecurityIssueGroupDraft> = groupIssuesByCause({
      issues: groupingIssues,
      stores: groupingStores,
    });

    // 4. The code that declares each group's stores.
    const codeOf: Map<string, DataSecurityIssueGroupCode | null> =
      await DataSecurityIssueGrouper.findCode({
        projectId,
        drafts,
        groupsByKey,
        stores: groupingStores,
        now,
      });

    // 5. Each group kept, and each issue's group written.
    const groupIdOfKey: Map<string, ObjectID> = new Map();
    const touched: Set<string> = new Set();

    for (const draft of drafts) {
      const existing: DataSecurityIssueGroup | undefined = groupsByKey.get(
        draft.key,
      );
      const lookedUp: {
        code: DataSecurityIssueGroupCode | null;
        at: Date | null;
      } = DataSecurityIssueGrouper.codeFor({
        draft,
        existing,
        codeOf,
        now,
      });
      const facts: DataSecurityIssueGroupFacts = withDeclaredCode(
        draft.facts,
        lookedUp.code,
      );
      const stored: JSONObject = toStoredFacts(facts, lookedUp.at);

      if (!existing) {
        const group: DataSecurityIssueGroup = new DataSecurityIssueGroup();

        group.projectId = projectId;
        group.groupKey = draft.key;
        group.checkId = draft.checkId;
        group.cause = facts.cause;
        group.facts = stored;
        group.issueCount = draft.issueIds.length;
        group.openIssueCount = draft.issueIds.length;
        group.groupedAt = now;

        const created: DataSecurityIssueGroup =
          await DataSecurityIssueGroupService.create({
            data: group,
            props: ROOT,
          });

        groupIdOfKey.set(draft.key, created.id!);
        groupsById.set(idOf(created), created);
        outcome.created++;
        outcome.changedGroupIds.push(created.id!);
        touched.add(idOf(created));
        continue;
      }

      groupIdOfKey.set(draft.key, existing.id!);
      touched.add(idOf(existing));

      if (
        existing.cause !== facts.cause ||
        !sameJson(
          readDataSecurityIssueGroupFacts(existing.facts),
          readDataSecurityIssueGroupFacts(stored),
        )
      ) {
        await DataSecurityIssueGroupService.updateOneById({
          id: existing.id!,
          data: { cause: facts.cause, facts: stored } as never,
          props: ROOT,
        });
        outcome.updated++;

        if (
          !outcome.changedGroupIds.some((id: ObjectID): boolean => {
            return idOf({ id }) === idOf(existing);
          })
        ) {
          outcome.changedGroupIds.push(existing.id!);
        }
      }
    }

    // Each issue to the group it ended up in; one that left its group, out of it.
    const target: Map<string, string> = new Map();

    for (const draft of drafts) {
      const groupId: string = idOf({ id: groupIdOfKey.get(draft.key) });

      for (const issueId of draft.issueIds) {
        target.set(issueId, groupId);
      }
    }

    const moves: Map<string, Array<string>> = new Map();

    for (const issue of issues) {
      const issueId: string = idOf(issue);
      const before: string =
        issue.dataSecurityIssueGroupId?.toString().toLowerCase() || "";
      const after: string = target.get(issueId) || "";

      if (before === after) {
        continue;
      }

      const list: Array<string> = moves.get(after) || [];

      list.push(issueId);
      moves.set(after, list);

      for (const groupId of [before, after]) {
        if (groupId) {
          touched.add(groupId);
        }
      }

      // A group that lost or took in an issue is named and proposed again.
      for (const groupId of [before, after]) {
        const group: DataSecurityIssueGroup | undefined =
          groupsById.get(groupId);

        if (
          group?.id &&
          !outcome.changedGroupIds.some((id: ObjectID): boolean => {
            return idOf({ id }) === groupId;
          })
        ) {
          outcome.changedGroupIds.push(group.id);
        }
      }
    }

    for (const [groupId, issueIds] of moves) {
      for (
        let start: number = 0;
        start < issueIds.length;
        start += ISSUE_PAGE_SIZE
      ) {
        const batch: Array<string> = issueIds.slice(
          start,
          start + ISSUE_PAGE_SIZE,
        );

        await DataSecurityIssueService.updateBy({
          query: { _id: QueryHelper.any(batch), projectId },
          data: {
            dataSecurityIssueGroupId: groupId ? new ObjectID(groupId) : null,
          } as never,
          skip: 0,
          limit: batch.length,
          props: ROOT,
        });
        outcome.issuesMoved += batch.length;
      }
    }

    // A group that had open issues before is counted again: its last may have resolved.
    for (const group of groups) {
      if ((group.openIssueCount || 0) > 0) {
        touched.add(idOf(group));
      }
    }

    // 5 and 6: each touched group counted again, and one nothing holds deleted.
    for (const groupId of touched) {
      const group: DataSecurityIssueGroup | undefined = groupsById.get(groupId);

      if (!group?.id) {
        continue;
      }

      const [issueCount, openIssueCount]: [number, number] = await Promise.all([
        DataSecurityIssueGrouper.countMembers(projectId, group.id),
        DataSecurityIssueGrouper.countMembers(
          projectId,
          group.id,
          DataSecurityIssueStatus.Open,
        ),
      ]);

      if (issueCount < MIN_ISSUES_PER_GROUP && !group.codeTaskId) {
        await DataSecurityIssueService.updateBy({
          query: { projectId, dataSecurityIssueGroupId: group.id },
          data: { dataSecurityIssueGroupId: null } as never,
          skip: 0,
          limit: MIN_ISSUES_PER_GROUP,
          props: ROOT,
        });
        await DataSecurityIssueGroupService.hardDeleteBy({
          query: { _id: group.id, projectId },
          skip: 0,
          limit: 1,
          props: ROOT,
        });
        outcome.deleted++;
        outcome.changedGroupIds = outcome.changedGroupIds.filter(
          (id: ObjectID): boolean => {
            return idOf({ id }) !== groupId;
          },
        );
        continue;
      }

      const fixedAt: Date | null =
        openIssueCount > 0 ? null : group.fixedAt || now;
      const changes: JSONObject = {};

      if (group.issueCount !== issueCount) {
        changes["issueCount"] = issueCount;
      }

      if (group.openIssueCount !== openIssueCount) {
        changes["openIssueCount"] = openIssueCount;
      }

      if (
        (group.fixedAt ? new Date(group.fixedAt).getTime() : null) !==
        (fixedAt ? fixedAt.getTime() : null)
      ) {
        changes["fixedAt"] = fixedAt;
      }

      changes["groupedAt"] = now;

      await DataSecurityIssueGroupService.updateOneById({
        id: group.id,
        data: changes as never,
        props: ROOT,
      });

      if (openIssueCount > 0) {
        outcome.openGroups++;
      }
    }

    return outcome;
  }

  // How many issues a group holds, of a status or of any.
  private static async countMembers(
    projectId: ObjectID,
    groupId: ObjectID,
    status?: DataSecurityIssueStatus | undefined,
  ): Promise<number> {
    return (
      await DataSecurityIssueService.countBy({
        query: {
          projectId,
          dataSecurityIssueGroupId: groupId,
          ...(status ? { status } : {}),
        },
        props: ROOT,
      })
    ).toNumber();
  }

  // The project's open issues of the checks one mistake can fail at once.
  private static async readOpenIssues(
    projectId: ObjectID,
  ): Promise<Array<DataSecurityIssue>> {
    const issues: Array<DataSecurityIssue> = [];

    for (
      let skip: number = 0;
      skip < MAX_OPEN_ISSUES_GROUPED;
      skip += ISSUE_PAGE_SIZE
    ) {
      const page: Array<DataSecurityIssue> =
        await DataSecurityIssueService.findBy({
          query: {
            projectId,
            status: DataSecurityIssueStatus.Open,
            checkId: QueryHelper.any([...DATA_SECURITY_ISSUE_GROUP_CHECK_IDS]),
          },
          select: {
            _id: true,
            checkId: true,
            dataStoreId: true,
            dataSecurityIssueGroupId: true,
          },
          sort: { createdAt: SortOrder.Ascending },
          skip,
          limit: ISSUE_PAGE_SIZE,
          props: ROOT,
        });

      issues.push(...page);

      if (page.length < ISSUE_PAGE_SIZE) {
        break;
      }
    }

    return issues;
  }

  // The stores of those issues, by id: an archived one is no group's.
  private static async readStores(
    projectId: ObjectID,
    storeIds: Array<string>,
  ): Promise<Map<string, DataStore>> {
    const stores: Map<string, DataStore> = new Map();

    for (
      let start: number = 0;
      start < storeIds.length;
      start += STORE_PAGE_SIZE
    ) {
      const batch: Array<string> = storeIds.slice(
        start,
        start + STORE_PAGE_SIZE,
      );
      const page: Array<DataStore> = await DataStoreService.findBy({
        query: { projectId, _id: QueryHelper.any(batch) },
        select: {
          _id: true,
          name: true,
          kind: true,
          provider: true,
          region: true,
          cloudAccountNumber: true,
          cloudTags: true,
          providerResourceId: true,
          cloudResourceId: true,
          isArchived: true,
        },
        skip: 0,
        limit: batch.length,
        props: ROOT,
      });

      for (const store of page) {
        if (!store.isArchived) {
          stores.set(idOf(store), store);
        }
      }
    }

    return stores;
  }

  /*
   * The stores as grouping reads them, with the identity that created each
   * store whose tags name nothing that made it - the stores a console made.
   */
  private static async toGroupingStores(
    projectId: ObjectID,
    stores: Map<string, DataStore>,
  ): Promise<Array<DataSecurityIssueGroupStore>> {
    const tagsOf: Map<string, Dictionary<string>> = new Map();
    const needsCreator: Array<StoreToFindCreatorOf> = [];

    for (const [id, store] of stores) {
      const tags: Dictionary<string> = readCloudTags(store.cloudTags);

      tagsOf.set(id, tags);

      if (!getStoreStackName(tags) && getStoreCauseTags(tags).length === 0) {
        needsCreator.push({
          id,
          cloudResourceId: store.cloudResourceId?.toString(),
          providerResourceId: store.providerResourceId || undefined,
        });
      }
    }

    const creators: Map<string, string> =
      needsCreator.length > 0
        ? await DataSecurityStoreCreators.read({
            projectId,
            stores: needsCreator,
          })
        : new Map();

    return Array.from(stores.entries()).map(
      ([id, store]: [string, DataStore]): DataSecurityIssueGroupStore => {
        const tags: Dictionary<string> = tagsOf.get(id) || {};

        return {
          id,
          name: store.name || "",
          kind: store.kind || undefined,
          provider: store.provider || undefined,
          region: store.region || undefined,
          accountNumber: store.cloudAccountNumber || undefined,
          tags,
          managedAsCode: CloudAiTargets.getManagedAsCode(tags),
          creator: creators.get(id) || null,
        };
      },
    );
  }

  /*
   * The code a group's draft rests on: the code looked up this run, else
   * the code its group keeps while it is fresh and of the same module or
   * stack, else none.
   */
  private static codeFor(data: {
    draft: DataSecurityIssueGroupDraft;
    existing: DataSecurityIssueGroup | undefined;
    codeOf: Map<string, DataSecurityIssueGroupCode | null>;
    now: Date;
  }): { code: DataSecurityIssueGroupCode | null; at: Date | null } {
    if (data.codeOf.has(data.draft.key)) {
      return { code: data.codeOf.get(data.draft.key) || null, at: data.now };
    }

    const stored: DataSecurityIssueGroupFacts | null = data.existing
      ? readDataSecurityIssueGroupFacts(data.existing.facts)
      : null;

    return {
      code: stored?.code || null,
      at: data.existing ? readCodeLookedUpAt(data.existing.facts) : null,
    };
  }

  /*
   * The repository, and the files, that declare each group's stores, for
   * the groups due a look: of a module's or a stack's tag, declared as
   * code, never looked up or not for a day - at most
   * MAX_CODE_LOOKUPS_PER_RUN, each within CODE_LOOKUP_TIMEOUT_IN_MS. Each
   * repository's tree is read once per run, whatever groups ask.
   */
  private static async findCode(data: {
    projectId: ObjectID;
    drafts: Array<DataSecurityIssueGroupDraft>;
    groupsByKey: Map<string, DataSecurityIssueGroup>;
    stores: Array<DataSecurityIssueGroupStore>;
    now: Date;
  }): Promise<Map<string, DataSecurityIssueGroupCode | null>> {
    const found: Map<string, DataSecurityIssueGroupCode | null> = new Map();
    const due: Array<DataSecurityIssueGroupDraft> = data.drafts
      .filter((draft: DataSecurityIssueGroupDraft): boolean => {
        if (
          draft.declaredAsCodeCount === 0 ||
          !getIssueGroupOriginName(draft.facts)
        ) {
          return false;
        }

        const lookedUpAt: Date | null = readCodeLookedUpAt(
          data.groupsByKey.get(draft.key)?.facts,
        );

        return (
          !lookedUpAt ||
          data.now.getTime() - lookedUpAt.getTime() >
            CODE_LOOKUP_KEPT_FOR_IN_HOURS * 60 * 60 * 1000
        );
      })
      .slice(0, MAX_CODE_LOOKUPS_PER_RUN);

    if (due.length === 0) {
      return found;
    }

    let repositories: Array<ResolvableRepository> = [];

    try {
      repositories = await CodeRepositoryService.getResolvableRepositories(
        data.projectId,
      );
    } catch (error) {
      logger.debug(
        `DataSecurity grouping: could not read the repositories of project ${data.projectId.toString()}: ${error}`,
      );
    }

    // Nothing to look in: the groups are looked up again once there is.
    if (repositories.length === 0) {
      return found;
    }

    const trees: Map<string, Promise<Array<string>>> = new Map();
    const getTreePaths: (
      repository: ResolvableRepository,
    ) => Promise<Array<string>> = (
      repository: ResolvableRepository,
    ): Promise<Array<string>> => {
      const cached: Promise<Array<string>> | undefined = trees.get(
        repository.id,
      );

      if (cached) {
        return cached;
      }

      const reading: Promise<Array<string>> =
        CodeRepositoryServiceClass.getRepositoryTreePaths(repository);

      trees.set(repository.id, reading);

      return reading;
    };
    const storesById: Map<string, DataSecurityIssueGroupStore> = new Map(
      data.stores.map(
        (
          store: DataSecurityIssueGroupStore,
        ): [string, DataSecurityIssueGroupStore] => {
          return [store.id, store];
        },
      ),
    );

    for (const draft of due) {
      const declared: DataSecurityIssueGroupStore | undefined =
        draft.dataStoreIds
          .map((id: string): DataSecurityIssueGroupStore | undefined => {
            return storesById.get(id);
          })
          .find((store: DataSecurityIssueGroupStore | undefined): boolean => {
            return Boolean(store?.managedAsCode);
          });
      const declaredCode: DeclaredCode | null = readDeclaredCode(
        draft.facts.managedAsCode || declared?.managedAsCode,
      );
      const originName: string | null = getIssueGroupOriginName(draft.facts);

      if (!declaredCode || !originName || !declared) {
        continue;
      }

      const candidates: Array<DeclaredCodeOwnerCandidate> | null =
        await withinTime(
          DeclaredCodeOwner.rank({
            declaredCode,
            resource: { name: originName, tags: declared.tags },
            repositories,
            getTreePaths,
          }),
          CODE_LOOKUP_TIMEOUT_IN_MS,
        );

      if (!candidates) {
        continue;
      }

      const best: DeclaredCodeOwnerCandidate | null =
        DeclaredCodeOwner.getBest(candidates);

      found.set(
        draft.key,
        best
          ? {
              repositoryId: best.repository.id,
              repositoryName: getRepositoryFullName(best.repository),
              paths: best.matchedPaths.slice(0, 3),
              codeKind: DECLARED_CODE_KIND_NAMES[declaredCode.kind],
              reason: best.reason,
            }
          : null,
      );
    }

    return found;
  }
}
