import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import { DataStoreFeedEventType } from "../../../../Models/DatabaseModels/DataStoreFeed";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import LogScrubRule from "../../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../../Models/DatabaseModels/TraceScrubRule";
import FixProductionCheck from "../../../../Types/AI/FixProductionCheck";
import {
  TelemetryLeakFixBaseline,
  TelemetryLeakFixPlace,
  TelemetryLeakFixStore,
} from "../../../../Types/AI/FixProductionBaseline";
import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { Gray500, Orange500, Red500 } from "../../../../Types/BrandColors";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import {
  FINDING_FRESHNESS_IN_DAYS,
  getTelemetryCheckIdOfDataType,
  isContainedTelemetryFinding,
  isTelemetryFindingCheck,
  isUnscrubbedTelemetryFinding,
} from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueResolution, {
  DataSecurityIssueResolutionDetails,
  DataSecurityIssueResolutionFix,
  DataSecurityIssueResolutionRule,
  readDataSecurityIssueResolutionDetails,
} from "../../../../Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../../Types/ObjectID";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreFindingService from "../../../Services/DataStoreFindingService";
import DataStoreService from "../../../Services/DataStoreService";
import LogScrubRuleService from "../../../Services/LogScrubRuleService";
import TraceScrubRuleService from "../../../Services/TraceScrubRuleService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import DataSecurityIssueResolutions, {
  describePullRequest,
  getResolutionFixOf,
} from "../../DataSecurity/DataSecurityIssueResolutions";
import DataSecurityRunner from "../../DataSecurity/DataSecurityRunner";
import { ContentScanOptions } from "../../DataSecurity/DataSecurityScanTypes";
import {
  CoveringScrubRule,
  findCoveringScrubRule,
  getScrubCoverage,
  ScrubCoverage,
} from "../../DataSecurity/Telemetry/TelemetryScrubCoverage";
import { getTelemetryStoreOwnerId } from "../../DataSecurity/Telemetry/TelemetryFindingOccurrences";
import logger from "../../Logger";
import DataSecurityFixTarget, {
  DataSecurityFixTargetRead,
} from "./DataSecurityFixTarget";
import {
  FixProductionVerdict,
  HOUR_IN_MS,
  decideDeployWait,
  isMeasureDue,
  watchedMilliseconds,
} from "./FixProductionVerdict";
import FixProductionVerifier, {
  RUN_TIME_BUDGET_MS,
  ShippedFix,
  VerifierRun,
} from "./FixProductionVerifier";
import TelemetryLeakFixReads, {
  LeakDataFound,
  LeakValuesChanged,
  getLeakStoreNoun,
  isProvableLeakStoreKind,
} from "./TelemetryLeakFixReads";
import {
  TELEMETRY_LEAK_FIX_THRESHOLDS,
  TelemetryLeakMeasure,
  TelemetryLeakTraffic,
  decideTelemetryLeakBaseline,
  decideTelemetryLeakVerdict,
} from "./TelemetryLeakFixVerdict";

/*
 * A MERGED CODE FIX OF A TELEMETRY LEAK, FOLLOWED TO PRODUCTION (#10368):
 * the TelemetryLeak check of FixProductionVerifier.
 *
 * On the fix's first check, the issues its task names are read
 * (DataSecurityFixTarget): each telemetry store they are on - a service's
 * logs, its spans - and the places their data was found, with the scrub
 * rules that hide each one at ingest now. How many of the store's records
 * the old version sent in the hour the leak was last seen is counted
 * then, while it is still kept. All of it is kept (TelemetryLeakFixBaseline).
 *
 * Then the deploy of the service that ships the merge is found like any
 * fix's, and its version is watched - about hourly - by what tells
 * (TelemetryLeakFixVerdict): the containing rules' counter, and the new
 * version's records at every place no rule covers. Once production proves
 * it, every issue the fix is for resolves as Fixed in code, with the pull
 * request and the version (DataSecurityIssueResolutions); the rules that
 * contained the leak are kept, named on the issue, which offers to remove
 * them.
 *
 * And after: a verified fix's issues are watched about hourly for the leak
 * coming back (watchVerifiedFixes) - the kept rules changing values again,
 * in any version, or the scan finding the data again where no rule is. The
 * issue then says which version brought it back, and opens again.
 */

const ROOT: { isRoot: true } = { isRoot: true };

// The most findings of one store a fix is watched at.
export const MAX_LEAK_PLACES_PER_STORE: number = 200;

// What a store and its places are read with.
interface StoreToWatch {
  store: DataStore;
  issueIds: Array<string>;
}

export default class TelemetryLeakFixWatch {
  public static async verify(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
  ): Promise<void> {
    const mergedAt: Date = FixProductionVerifier.mergedAtOf(fix, run);
    let baseline: TelemetryLeakFixBaseline | undefined =
      fix.productionBaseline?.telemetryLeak;

    if (!baseline) {
      const target: DataSecurityFixTargetRead | null = fix.aiRunId
        ? await DataSecurityFixTarget.read(fix.aiRunId)
        : null;

      if (!target) {
        await FixProductionVerifier.settle(fix, run, {
          status: FixProductionStatus.Unverifiable,
          summary:
            "The Data Security issue this fix was opened for no longer exists, so whether the service still writes its data cannot be told.",
        });
        return;
      }

      const read: TelemetryLeakFixBaseline | FixProductionVerdict | null =
        await FixProductionVerifier.readOrSettle({
          fix,
          run,
          // A deploy is waited for as long: the baseline as well.
          isOver: Boolean(decideDeployWait({ mergedAt, now: run.now })),
          summary:
            "The telemetry of the issue's service could not be read in the 14 days after the fix merged, so whether the fix stopped the leak cannot be told.",
          read: (): Promise<
            TelemetryLeakFixBaseline | FixProductionVerdict
          > => {
            return TelemetryLeakFixWatch.readBaseline({
              fix,
              target,
              mergedAt,
              now: run.now,
            });
          },
        });

      if (!read) {
        return;
      }

      if ("status" in read) {
        await FixProductionVerifier.settle(fix, run, read);
        return;
      }

      baseline = read;
      await FixProductionVerifier.saveBaseline(fix, {
        telemetryLeak: baseline,
      });
    }

    const shipped: ShippedFix | null = await FixProductionVerifier.awaitDeploy({
      fix,
      run,
      serviceId: new ObjectID(baseline.serviceId),
      mergedAt,
    });

    if (!shipped) {
      return;
    }

    if (shipped.isNew) {
      await TelemetryLeakFixWatch.noteShipped({ fix, baseline, shipped });
    }

    const watched: number = watchedMilliseconds({
      deployedAt: shipped.deployedAt,
      now: run.now,
      rolloutGraceMinutes: TELEMETRY_LEAK_FIX_THRESHOLDS.rolloutGraceMinutes,
    });

    // About hourly from the rollout grace on: in between there is little new.
    if (
      !shipped.isNew &&
      (watched <= 0 ||
        !isMeasureDue({
          watchedMs: watched,
          minWatchHours: 0,
          maxWatchDays: TELEMETRY_LEAK_FIX_THRESHOLDS.maxWatchDays,
        }))
    ) {
      return;
    }

    const watchedFor: TelemetryLeakFixBaseline = baseline;
    const measure: TelemetryLeakMeasure | null =
      await FixProductionVerifier.readOrSettle({
        fix,
        run,
        isOver:
          watched >=
          TELEMETRY_LEAK_FIX_THRESHOLDS.maxWatchDays * 24 * HOUR_IN_MS,
        summary:
          "The deployed fix's telemetry could not be read before the watch ended, so whether it stopped the leak cannot be told.",
        read: (): Promise<TelemetryLeakMeasure> => {
          return TelemetryLeakFixWatch.measure({
            fix,
            baseline: watchedFor,
            shipped,
            now: run.now,
          });
        },
      });

    if (!measure) {
      return;
    }

    const verdict: FixProductionVerdict = decideTelemetryLeakVerdict({
      deployedAt: shipped.deployedAt,
      now: run.now,
      deployLabel: FixProductionVerifier.deployLabelOf(shipped),
      measure,
    });
    const statusChanged: boolean = fix.productionStatus !== verdict.status;

    await FixProductionVerifier.settle(
      fix,
      run,
      verdict,
      shipped.isNew ? shipped : undefined,
    );

    if (!statusChanged) {
      return;
    }

    if (verdict.status === FixProductionStatus.Verified) {
      await TelemetryLeakFixWatch.markFixed({
        fix,
        baseline,
        shipped,
        verifiedAt: run.now,
      });
    } else if (
      verdict.status === FixProductionStatus.Regressed ||
      verdict.status === FixProductionStatus.Unverifiable
    ) {
      await TelemetryLeakFixWatch.noteVerdict({ fix, baseline, verdict });
    }
  }

  /*
   * What the fix is watched for, read once: the issues' telemetry stores
   * of one service, the places their data was found, the rules hiding each
   * at ingest, and the old version's traffic in the leak's last hour. A
   * verdict instead when nothing can tell.
   */
  public static async readBaseline(data: {
    fix: AIAgentTaskPullRequest;
    target: DataSecurityFixTargetRead;
    mergedAt: Date;
    now: Date;
  }): Promise<TelemetryLeakFixBaseline | FixProductionVerdict> {
    const projectId: ObjectID = data.fix.projectId!;
    const stores: Array<StoreToWatch> = await TelemetryLeakFixWatch.readStores({
      projectId,
      issueIds: data.target.issueIds,
    });
    const first: StoreToWatch | undefined = stores[0];
    const serviceId: string | null = first
      ? getTelemetryStoreOwnerId(first.store)
      : null;

    if (!first || !serviceId) {
      return {
        status: FixProductionStatus.Unverifiable,
        summary:
          "The telemetry store of the issue this fix was opened for no longer exists, so whether its service still writes the data cannot be told.",
      };
    }

    const coverage: ScrubCoverage = await getScrubCoverage(projectId);
    const watchedStores: Array<TelemetryLeakFixStore> = [];
    let placeCount: number = 0;
    let unreadable: number = 0;

    // One service's stores: its deploys ship the fix.
    for (const watched of stores) {
      if (getTelemetryStoreOwnerId(watched.store) !== serviceId) {
        continue;
      }

      const kind: string = watched.store.kind || "";
      const places: Array<TelemetryLeakFixPlace> =
        await TelemetryLeakFixWatch.readPlaces({
          projectId,
          store: watched.store,
          issueIds: watched.issueIds,
          coverage,
          serviceId,
          now: data.now,
        });

      placeCount += places.length;

      if (!isProvableLeakStoreKind(kind)) {
        unreadable += places.length;
        continue;
      }

      if (places.length === 0) {
        continue;
      }

      const before: { records: number; hour: Date } =
        await TelemetryLeakFixWatch.readRecordsBefore({
          projectId,
          kind,
          serviceId,
          places,
          mergedAt: data.mergedAt,
        });

      watchedStores.push({
        dataStoreId: watched.store.id!.toString(),
        kind,
        issueIds: watched.issueIds,
        places,
        recordsBefore: before.records,
        recordsBeforeHour: before.hour.toISOString(),
      });
    }

    const nothing: FixProductionVerdict | null = decideTelemetryLeakBaseline({
      placeCount,
      unreadablePlaceCount: unreadable,
    });

    if (nothing) {
      return nothing;
    }

    const from: Date = OneUptimeDate.addRemoveDurationInDays(
      data.mergedAt,
      -TELEMETRY_LEAK_FIX_THRESHOLDS.baselineDays,
    );
    const changedBefore: LeakValuesChanged =
      await TelemetryLeakFixReads.readValuesChanged({
        projectId,
        serviceId,
        scrubRuleIds: TelemetryLeakFixWatch.ruleIdsOf(watchedStores),
        since: from,
        until: data.mergedAt,
      });

    return {
      serviceId,
      stores: watchedStores,
      taskId: data.target.taskId.toString(),
      valuesChangedBefore: changedBefore.valuesChanged,
      from: from.toISOString(),
      to: data.mergedAt.toISOString(),
    };
  }

  // The issues' telemetry stores, each with its issues the fix is for.
  private static async readStores(data: {
    projectId: ObjectID;
    issueIds: ReadonlyArray<ObjectID>;
  }): Promise<Array<StoreToWatch>> {
    if (data.issueIds.length === 0) {
      return [];
    }

    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId: data.projectId,
          _id: new Includes(
            data.issueIds.map((id: ObjectID): string => {
              return id.toString();
            }),
          ),
        } as never,
        select: { _id: true, dataStoreId: true, checkId: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: ROOT,
      });
    const issuesByStore: Map<string, Array<string>> = new Map();

    for (const issue of issues) {
      const storeId: string = issue.dataStoreId?.toString() || "";

      if (!issue.id || !storeId || !isTelemetryFindingCheck(issue.checkId)) {
        continue;
      }

      issuesByStore.set(storeId, [
        ...(issuesByStore.get(storeId) || []),
        issue.id.toString(),
      ]);
    }

    if (issuesByStore.size === 0) {
      return [];
    }

    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId: data.projectId,
        _id: new Includes(Array.from(issuesByStore.keys())),
      } as never,
      select: { _id: true, kind: true, serviceId: true, storeKey: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: ROOT,
    });

    return stores
      .filter((store: DataStore): boolean => {
        return Boolean(store.id);
      })
      .map((store: DataStore): StoreToWatch => {
        return {
          store,
          issueIds: issuesByStore.get(store.id!.toString()) || [],
        };
      });
  }

  /*
   * The places a store's issues found their data at: every finding their
   * checks count now, hidden at ingest or not, with the log or trace rules
   * that hide it (a metric pipeline rule counts nothing, so it is no rule
   * here).
   */
  private static async readPlaces(data: {
    projectId: ObjectID;
    store: DataStore;
    issueIds: ReadonlyArray<string>;
    coverage: ScrubCoverage;
    serviceId: string;
    now: Date;
  }): Promise<Array<TelemetryLeakFixPlace>> {
    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId: data.projectId,
          _id: new Includes([...data.issueIds]),
        } as never,
        select: { _id: true, checkId: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: ROOT,
      });
    const checkIds: Set<string> = new Set(
      issues.map((issue: DataSecurityIssue): string => {
        return issue.checkId || "";
      }),
    );
    const findings: Array<DataStoreFinding> =
      await DataStoreFindingService.findBy({
        query: {
          projectId: data.projectId,
          dataStoreId: data.store.id!,
          isSuppressed: false,
          lastSeenAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.addRemoveDurationInDays(
              data.now,
              -FINDING_FRESHNESS_IN_DAYS,
            ),
          ),
        },
        select: {
          _id: true,
          dataTypeId: true,
          location: true,
          confidence: true,
          matchCount: true,
          isConfirmed: true,
          isAiSuggested: true,
          isScrubbed: true,
          fixedAt: true,
          lastSeenAt: true,
        },
        skip: 0,
        limit: MAX_LEAK_PLACES_PER_STORE,
        props: ROOT,
      });
    const places: Array<TelemetryLeakFixPlace> = [];

    for (const finding of findings) {
      if (
        !finding.id ||
        !finding.dataTypeId ||
        !finding.location ||
        !checkIds.has(getTelemetryCheckIdOfDataType(finding.dataTypeId)) ||
        !(
          isUnscrubbedTelemetryFinding(finding) ||
          isContainedTelemetryFinding(finding)
        )
      ) {
        continue;
      }

      const rule: CoveringScrubRule | null = findCoveringScrubRule(
        data.coverage,
        {
          kind: data.store.kind as DataStoreKind,
          dataTypeId: finding.dataTypeId,
          location: finding.location,
          serviceId: data.serviceId,
        },
      );

      places.push({
        findingId: finding.id.toString(),
        dataTypeId: finding.dataTypeId,
        location: finding.location,
        scrubRuleIds:
          rule && (rule.signal === "log" || rule.signal === "trace")
            ? [rule.id]
            : [],
        ...(finding.lastSeenAt
          ? { lastSeenAt: new Date(finding.lastSeenAt).toISOString() }
          : {}),
      });
    }

    return places;
  }

  /*
   * The store's records the old version sent in the hour its data was last
   * seen - or, when that hour is past the store's retention, in the hour
   * before the merge.
   */
  private static async readRecordsBefore(data: {
    projectId: ObjectID;
    kind: string;
    serviceId: string;
    places: ReadonlyArray<TelemetryLeakFixPlace>;
    mergedAt: Date;
  }): Promise<{ records: number; hour: Date }> {
    const lastSeen: number = Math.max(
      0,
      ...data.places.map((place: TelemetryLeakFixPlace): number => {
        return place.lastSeenAt ? new Date(place.lastSeenAt).getTime() : 0;
      }),
    );
    const hours: Array<Date> = [];

    if (lastSeen > 0 && lastSeen <= data.mergedAt.getTime()) {
      hours.push(new Date(Math.floor(lastSeen / HOUR_IN_MS) * HOUR_IN_MS));
    }

    hours.push(new Date(data.mergedAt.getTime() - HOUR_IN_MS));

    for (const hour of hours) {
      const records: number = await TelemetryLeakFixReads.countRecords({
        projectId: data.projectId,
        kind: data.kind,
        serviceId: data.serviceId,
        since: hour,
        until: new Date(hour.getTime() + HOUR_IN_MS),
      });

      if (records > 0) {
        return { records, hour };
      }
    }

    return { records: 0, hour: hours[hours.length - 1]! };
  }

  /*
   * The deployed fix, measured: what its containing rules changed, what its
   * records at the places no rule covers held, and its traffic - in its
   * version when the service's telemetry names it, else from the rollout
   * grace on.
   */
  public static async measure(data: {
    fix: AIAgentTaskPullRequest;
    baseline: TelemetryLeakFixBaseline;
    shipped: ShippedFix;
    now: Date;
  }): Promise<TelemetryLeakMeasure> {
    const projectId: ObjectID = data.fix.projectId!;
    const version: string | undefined =
      await FixProductionVerifier.versionToRead({
        projectId,
        serviceId: new ObjectID(data.baseline.serviceId),
        shipped: data.shipped,
        now: data.now,
      });
    const since: Date = FixProductionVerifier.sinceDeployWindowStart({
      shipped: data.shipped,
      version,
    });
    const ruleIds: Array<string> = TelemetryLeakFixWatch.ruleIdsOf(
      data.baseline.stores,
    );
    const changed: LeakValuesChanged =
      await TelemetryLeakFixReads.readValuesChanged({
        projectId,
        serviceId: data.baseline.serviceId,
        scrubRuleIds: ruleIds,
        since,
        version,
      });
    const options: ContentScanOptions | null = data.baseline.stores.some(
      (store: TelemetryLeakFixStore): boolean => {
        return TelemetryLeakFixWatch.uncoveredPlacesOf(store).length > 0;
      },
    )
      ? (await DataSecurityRunner.getScanSetup(projectId)).options
      : null;
    const traffic: Array<TelemetryLeakTraffic> = [];
    let recordsRead: number = 0;
    let recordsWithData: number = 0;

    for (const store of data.baseline.stores) {
      const uncovered: Array<TelemetryLeakFixPlace> =
        TelemetryLeakFixWatch.uncoveredPlacesOf(store);

      if (uncovered.length > 0 && options) {
        const found: LeakDataFound =
          await TelemetryLeakFixReads.findDataAtPlaces({
            projectId,
            kind: store.kind,
            serviceId: data.baseline.serviceId,
            places: uncovered,
            since,
            until: data.now,
            version,
            options,
          });

        recordsRead += found.recordsRead;
        recordsWithData += found.recordsWithData;
      }

      traffic.push({
        noun: getLeakStoreNoun(store.kind),
        before: store.recordsBefore,
        since: await TelemetryLeakFixReads.countRecords({
          projectId,
          kind: store.kind,
          serviceId: data.baseline.serviceId,
          since,
          until: data.now,
          version,
        }),
      });
    }

    return {
      valuesChanged: changed.valuesChanged,
      recordsRead,
      recordsWithData,
      hasRules: ruleIds.length > 0,
      hasUncoveredPlaces: data.baseline.stores.some(
        (store: TelemetryLeakFixStore): boolean => {
          return TelemetryLeakFixWatch.uncoveredPlacesOf(store).length > 0;
        },
      ),
      traffic,
    };
  }

  public static ruleIdsOf(
    stores: ReadonlyArray<TelemetryLeakFixStore>,
  ): Array<string> {
    const ids: Set<string> = new Set<string>();

    for (const store of stores) {
      for (const place of store.places) {
        for (const id of place.scrubRuleIds) {
          ids.add(id);
        }
      }
    }

    return Array.from(ids);
  }

  public static uncoveredPlacesOf(
    store: TelemetryLeakFixStore,
  ): Array<TelemetryLeakFixPlace> {
    return store.places.filter((place: TelemetryLeakFixPlace): boolean => {
      return place.scrubRuleIds.length === 0;
    });
  }

  public static issueIdsOf(
    baseline: TelemetryLeakFixBaseline,
  ): Array<ObjectID> {
    return baseline.stores.flatMap(
      (store: TelemetryLeakFixStore): Array<ObjectID> => {
        return store.issueIds.map((id: string): ObjectID => {
          return new ObjectID(id);
        });
      },
    );
  }

  public static findingIdsOf(
    baseline: TelemetryLeakFixBaseline,
  ): Array<ObjectID> {
    return baseline.stores.flatMap(
      (store: TelemetryLeakFixStore): Array<ObjectID> => {
        return store.places.map((place: TelemetryLeakFixPlace): ObjectID => {
          return new ObjectID(place.findingId);
        });
      },
    );
  }

  /*
   * The fix production proved: every issue it is for is Fixed in code, with
   * the pull request, the version and the rules kept.
   */
  public static async markFixed(data: {
    fix: AIAgentTaskPullRequest;
    baseline: TelemetryLeakFixBaseline;
    shipped: ShippedFix;
    verifiedAt: Date;
  }): Promise<void> {
    const taskId: ObjectID | undefined =
      data.baseline.taskId && ObjectID.isValidUUID(data.baseline.taskId)
        ? new ObjectID(data.baseline.taskId)
        : undefined;

    await DataSecurityIssueResolutions.markFixedInCode({
      projectId: data.fix.projectId!,
      issueIds: TelemetryLeakFixWatch.issueIdsOf(data.baseline),
      fix: getResolutionFixOf({
        pullRequest: data.fix,
        taskId,
        version: data.shipped.deployedVersion,
        commitSha: data.shipped.deployedCommitSha,
        deployedAt: data.shipped.deployedAt,
      }),
      verifiedAt: data.verifiedAt,
      keptRules: await TelemetryLeakFixWatch.readKeptRules({
        projectId: data.fix.projectId!,
        ruleIds: TelemetryLeakFixWatch.ruleIdsOf(data.baseline.stores),
      }),
      findingIds: TelemetryLeakFixWatch.findingIdsOf(data.baseline),
    });
  }

  // The rules that contained the leak and still exist: kept, and named.
  public static async readKeptRules(data: {
    projectId: ObjectID;
    ruleIds: ReadonlyArray<string>;
  }): Promise<Array<DataSecurityIssueResolutionRule>> {
    if (data.ruleIds.length === 0) {
      return [];
    }

    const query: never = {
      projectId: data.projectId,
      _id: new Includes([...data.ruleIds]),
    } as never;
    const [logRules, traceRules]: [Array<LogScrubRule>, Array<TraceScrubRule>] =
      await Promise.all([
        LogScrubRuleService.findBy({
          query,
          select: { _id: true, name: true },
          skip: 0,
          limit: LIMIT_MAX,
          props: ROOT,
        }),
        TraceScrubRuleService.findBy({
          query,
          select: { _id: true, name: true },
          skip: 0,
          limit: LIMIT_MAX,
          props: ROOT,
        }),
      ]);

    return [
      ...logRules.map((rule: LogScrubRule): DataSecurityIssueResolutionRule => {
        return {
          id: rule.id!.toString(),
          signal: "log",
          name: rule.name || "",
        };
      }),
      ...traceRules.map(
        (rule: TraceScrubRule): DataSecurityIssueResolutionRule => {
          return {
            id: rule.id!.toString(),
            signal: "trace",
            name: rule.name || "",
          };
        },
      ),
    ];
  }

  // The deploy that ships the fix is found: the issues say it is being watched.
  private static async noteShipped(data: {
    fix: AIAgentTaskPullRequest;
    baseline: TelemetryLeakFixBaseline;
    shipped: ShippedFix;
  }): Promise<void> {
    const pullRequest: MarkdownText = describePullRequest(
      getResolutionFixOf({ pullRequest: data.fix }),
    );
    const deploy: string = FixProductionVerifier.deployLabelOf(data.shipped);

    await DataSecurityIssueResolutions.noteOnIssues({
      projectId: data.fix.projectId!,
      issueIds: TelemetryLeakFixWatch.issueIdsOf(data.baseline),
      eventType: DataSecurityIssueFeedEventType.FixShipped,
      color: Orange500,
      markdown: mdText`The fix in ${pullRequest} merged and shipped in ${deploy}. OneUptime is watching whether the new version still writes the data: the issue counts as fixed once it has run a day, over as much traffic as the old version sent in the hour the leak was last seen.`,
    });
  }

  // The fix did not stop it, or nothing could tell: the issues say so.
  private static async noteVerdict(data: {
    fix: AIAgentTaskPullRequest;
    baseline: TelemetryLeakFixBaseline;
    verdict: FixProductionVerdict;
  }): Promise<void> {
    const pullRequest: MarkdownText = describePullRequest(
      getResolutionFixOf({ pullRequest: data.fix }),
    );
    const isRegressed: boolean =
      data.verdict.status === FixProductionStatus.Regressed;

    await DataSecurityIssueResolutions.noteOnIssues({
      projectId: data.fix.projectId!,
      issueIds: TelemetryLeakFixWatch.issueIdsOf(data.baseline),
      eventType: isRegressed
        ? DataSecurityIssueFeedEventType.FixRegressed
        : DataSecurityIssueFeedEventType.FixUnverifiable,
      ...(isRegressed
        ? { storeEventType: DataStoreFeedEventType.IssueFixRegressed }
        : {}),
      color: isRegressed ? Red500 : Gray500,
      markdown: isRegressed
        ? mdText`The fix in ${pullRequest} did not stop the leak. ${data.verdict.summary}`
        : mdText`OneUptime could not tell whether the fix in ${pullRequest} stopped the leak. ${data.verdict.summary}`,
    });
  }

  /*
   * THE LEAK COMING BACK. Every verified fix's issues, about hourly: an
   * issue still fixed by it whose kept rules changed a value since, or
   * whose findings the scan saw again, came back - in the version that
   * changed most, or the version of the newest record that still held it.
   * Never throws for one fix.
   */
  public static async watchVerifiedFixes(run: VerifierRun): Promise<void> {
    let fixes: Array<AIAgentTaskPullRequest> = [];

    try {
      fixes = await AIAgentTaskPullRequestService.findBy({
        query: {
          productionCheck: FixProductionCheck.TelemetryLeak,
          productionStatus: FixProductionStatus.Verified,
        } as never,
        select: {
          _id: true,
          projectId: true,
          productionBaseline: true,
        } as never,
        limit: LIMIT_MAX,
        skip: 0,
        props: ROOT,
      });
    } catch (error) {
      logger.error(
        `Fix verification: could not read the verified telemetry leak fixes to watch: ${error}`,
      );
      return;
    }

    for (const fix of fixes) {
      if (
        OneUptimeDate.getCurrentDate().getTime() - run.now.getTime() >=
        RUN_TIME_BUDGET_MS
      ) {
        return;
      }

      try {
        await TelemetryLeakFixWatch.watchVerifiedFix(fix, run);
      } catch (error) {
        logger.error(
          `Fix verification: could not watch verified fix ${fix.id?.toString()} for its leak coming back; it is watched again next hour: ${error}`,
        );
      }
    }
  }

  public static async watchVerifiedFix(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
  ): Promise<void> {
    const baseline: TelemetryLeakFixBaseline | undefined =
      fix.productionBaseline?.telemetryLeak;
    const projectId: ObjectID | undefined = fix.projectId || undefined;

    if (!baseline || !projectId) {
      return;
    }

    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId,
          _id: new Includes(
            TelemetryLeakFixWatch.issueIdsOf(baseline).map(
              (id: ObjectID): string => {
                return id.toString();
              },
            ),
          ),
          status: DataSecurityIssueStatus.Resolved,
          resolution: DataSecurityIssueResolution.FixedInCode,
        } as never,
        select: {
          _id: true,
          dataStoreId: true,
          resolution: true,
          resolutionDetails: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: ROOT,
      });
    const fixId: string = fix.id?.toString() || "";

    for (const issue of issues) {
      const details: DataSecurityIssueResolutionDetails =
        readDataSecurityIssueResolutionDetails(issue.resolutionDetails);
      const store: TelemetryLeakFixStore | undefined = baseline.stores.find(
        (candidate: TelemetryLeakFixStore): boolean => {
          return candidate.dataStoreId === issue.dataStoreId?.toString();
        },
      );

      // Fixed by another fix since: that fix watches it.
      if (
        !store ||
        !details.at ||
        details.fix?.pullRequestId !== fixId ||
        details.regression
      ) {
        continue;
      }

      const cameBackIn: { version?: string | undefined } | null =
        await TelemetryLeakFixWatch.readComingBack({
          projectId,
          serviceId: baseline.serviceId,
          store,
          keptRuleIds: (details.scrubRules || []).map(
            (rule: DataSecurityIssueResolutionRule): string => {
              return rule.id;
            },
          ),
          verifiedAt: new Date(details.at),
          now: run.now,
        });

      if (!cameBackIn) {
        continue;
      }

      await DataSecurityIssueResolutions.markCameBack({
        projectId,
        issue,
        regression: {
          at: run.now.toISOString(),
          ...(cameBackIn.version ? { version: cameBackIn.version } : {}),
          ...(details.fix
            ? { fix: details.fix as DataSecurityIssueResolutionFix }
            : {}),
        },
        findingIds: store.places.map((place: TelemetryLeakFixPlace) => {
          return new ObjectID(place.findingId);
        }),
      });
    }
  }

  /*
   * Whether the leak came back since the fix was verified, and in which
   * version: the kept rules changing a value again, in any version; or the
   * scan finding the data again at a place no rule hides - its version read
   * from the newest records still holding it. Null when it did not.
   */
  public static async readComingBack(data: {
    projectId: ObjectID;
    serviceId: string;
    store: TelemetryLeakFixStore;
    keptRuleIds: ReadonlyArray<string>;
    verifiedAt: Date;
    now: Date;
  }): Promise<{ version?: string | undefined } | null> {
    const changed: LeakValuesChanged =
      await TelemetryLeakFixReads.readValuesChanged({
        projectId: data.projectId,
        serviceId: data.serviceId,
        scrubRuleIds: data.keptRuleIds,
        since: data.verifiedAt,
      });

    if (changed.valuesChanged > 0) {
      return changed.versions[0] ? { version: changed.versions[0] } : {};
    }

    const findings: Array<DataStoreFinding> =
      await DataStoreFindingService.findBy({
        query: {
          projectId: data.projectId,
          _id: new Includes(
            data.store.places.map((place: TelemetryLeakFixPlace): string => {
              return place.findingId;
            }),
          ),
        } as never,
        select: {
          _id: true,
          dataTypeId: true,
          location: true,
          lastSeenAt: true,
          fixedAt: true,
          isScrubbed: true,
        },
        skip: 0,
        limit: MAX_LEAK_PLACES_PER_STORE,
        props: ROOT,
      });
    const seenAgain: Array<DataStoreFinding> = findings.filter(
      (finding: DataStoreFinding): boolean => {
        return Boolean(
          finding.fixedAt &&
            finding.lastSeenAt &&
            new Date(finding.lastSeenAt).getTime() >
              new Date(finding.fixedAt).getTime(),
        );
      },
    );

    if (seenAgain.length === 0) {
      return null;
    }

    const options: ContentScanOptions = (
      await DataSecurityRunner.getScanSetup(data.projectId)
    ).options;
    const found: LeakDataFound = await TelemetryLeakFixReads.findDataAtPlaces({
      projectId: data.projectId,
      kind: data.store.kind,
      serviceId: data.serviceId,
      places: seenAgain.map((finding: DataStoreFinding) => {
        return {
          dataTypeId: finding.dataTypeId || "",
          location: finding.location || "",
        };
      }),
      since: data.verifiedAt,
      until: data.now,
      options,
    });

    return found.versions[0] ? { version: found.versions[0] } : {};
  }
}
