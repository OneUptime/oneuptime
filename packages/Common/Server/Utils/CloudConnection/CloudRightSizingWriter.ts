import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CloudSavingKind,
  addUtcDays,
  getCloudCostResourceKey,
  startOfUtcDay,
} from "../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { getCloudResourceTypeDisplayName } from "../../../Types/Cloud/CloudResourceCatalog";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import {
  CLOUD_RIGHT_SIZING_PROFILES,
  CLOUD_RIGHT_SIZING_WINDOW_DAYS,
  CLOUD_SAVINGS_SOURCE_ONEUPTIME,
  CloudResourceDailyCost,
  CloudRightSizing,
  CloudRightSizingProfile,
  CloudRightSizingVerdict,
  CloudSizeSteps,
  CloudUsageObservation,
  buildCloudRightSizing,
  getCloudRightSizingProfile,
  getCloudRightSizingRecommendationId,
  getCloudSizeSteps,
  hasCloudRightSizingChange,
  isCloudRightSizingRecommendationId,
  isRecommenderSizeRecommendation,
  readCloudResourceSize,
  toCloudRightSizingEvidence,
} from "../../../Types/Cloud/CloudRightSizing";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudCostRecommendationService from "../../Services/CloudCostRecommendationService";
import CloudCostService from "../../Services/CloudCostService";
import CloudResourceService from "../../Services/CloudResourceService";
import MetricService from "../../Services/MetricService";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import logger from "../Logger";

/*
 * KEEPS ONEUPTIME'S OWN RIGHT-SIZING AMONG AN ACCOUNT'S WAYS TO SPEND LESS.
 *
 * Once a day, after a cloud connection has read its cloud's recommender
 * (CloudConnectionLanes' savings lane), every resource it reads that
 * OneUptime can size (CloudRightSizing's profiles: instances, databases,
 * caches, App Service plans) and no recommender has a word on - no
 * rightsizing, idle or newer-generation recommendation of its cloud's - is
 * sized from the last 14 days of its CPU and memory readings in OneUptime's
 * own metrics, and what it cost a day from its cloud's bill, when its cloud
 * bills it by name. One that a smaller size would do for is kept as a
 * CloudCostRecommendation of source OneUptime, its id
 * "oneuptime-rightsize:<the resource's id>", with what made it (evidence),
 * so Cloud > Savings, an account's Costs and the Overview's Ways to spend
 * less list it beside the clouds' own. It is kept in step: a resource that
 * no longer needs a smaller size, or that its cloud's recommender now
 * speaks for, loses it on the next run, and the cloud's writer never
 * removes it (CloudSavingsWriter).
 *
 * Reads are grouped: one per type and kind of reading (CPU's 95th
 * percentile, its highest, its count, memory's peak) over all the
 * resources of a type, grouped by the attributes that tell them apart -
 * never one per resource. Only the resources linked to the connection are
 * sized: two connections reading one account each size their own.
 */

// At most this many resources are sized per connection and day.
export const CLOUD_RIGHT_SIZING_MAX_RESOURCES: number = 2000;

/*
 * The most attributes a grouped read groups by (MetricService's own
 * limit): resources told apart by more are not sized.
 */
export const CLOUD_RIGHT_SIZING_MAX_GROUP_KEYS: number = 10;

// How much work resizing is, in the recommenders' own words.
export const CLOUD_RIGHT_SIZING_EFFORT: string = "Medium";

// The action a right-sizing is kept with: one of OneUptime's own words.
export const CLOUD_RIGHT_SIZING_ACTION: string = "Rightsize";

const COST_TABLE: string = AnalyticsTableName.CloudCost;

const COST_QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 60,
  timeoutOverflowMode: "throw",
});

// The days a resource's daily cost is taken from.
export const CLOUD_RIGHT_SIZING_COST_DAYS: number = 30;

const HOUR_MS: number = 60 * 60 * 1000;

// A resource OneUptime can size, as the writer reads it.
export interface CloudRightSizingCandidate {
  id: ObjectID;
  name: string;
  provider: CloudProvider;
  type: string;
  profile: CloudRightSizingProfile;
  size: string;
  // Its account's id in its cloud.
  accountId: string;
  region: string;
  providerResourceId: string;
  // The stored attributes that select its readings (CloudMonitoredResource).
  telemetryAttributes: Record<string, string>;
}

/*
 * Resources of one type that tell themselves apart by the same attributes,
 * read together: the attributes all of them share are the read's filter,
 * and it is grouped by every one of them.
 */
export interface CloudRightSizingReadGroup {
  profile: CloudRightSizingProfile;
  // Every attribute, in order: what a row is matched to its resource by.
  keys: Array<string>;
  // The attributes all of the group share, and their values.
  filter: Record<string, string>;
  candidates: Array<CloudRightSizingCandidate>;
}

export interface CloudRightSizingRecord {
  cloudResourceId: ObjectID;
  accountId: string;
  recommendationId: string;
  region: string;
  resourceId: string;
  resourceType: string;
  resourceName: string;
  currentConfiguration: string;
  recommendedConfiguration: string;
  monthlySavings: number;
  monthlyCost: number | null;
  currency: string;
  evidence: JSONObject;
}

export interface CloudRightSizingWriteResult {
  // Resources sized: read, and enough readings to say.
  judged: number;
  // Right-sizings kept: a smaller size would do.
  kept: number;
  removed: number;
}

function readAttributes(value: unknown): Record<string, string> {
  const attributes: Record<string, string> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return attributes;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key && typeof entry === "string" && entry.trim()) {
      attributes[key] = entry;
    }
  }

  return attributes;
}

function isProvider(value: unknown): value is CloudProvider {
  return Object.values(CloudProvider).includes(value as CloudProvider);
}

// A row's grouped attributes, as one key: the values in the group's order.
function attributeKeyOf(
  keys: Array<string>,
  attributes: Record<string, unknown>,
): string {
  return JSON.stringify(
    keys.map((key: string): string => {
      const value: unknown = attributes[key];
      return value === null || value === undefined ? "" : String(value);
    }),
  );
}

export default class CloudRightSizingWriter {
  /*
   * The resources OneUptime sizes: of a type it can size, with a size it
   * knows that is no burstable one, scoped to their metrics, and that no
   * recommender of their cloud speaks for. At most the cap, the first
   * listed first.
   */
  public static selectCandidates(data: {
    resources: Array<CloudResource>;
    // The resources a recommender of their cloud speaks for (row ids).
    coveredByRecommender: Set<string>;
  }): Array<CloudRightSizingCandidate> {
    const candidates: Array<CloudRightSizingCandidate> = [];

    for (const resource of data.resources) {
      if (candidates.length >= CLOUD_RIGHT_SIZING_MAX_RESOURCES) {
        break;
      }

      const id: string = resource.id?.toString() || "";
      const provider: unknown = resource.cloudProvider;
      const type: string = (resource.cloudResourceType || "").trim();

      if (
        !id ||
        resource.isArchived ||
        !isProvider(provider) ||
        data.coveredByRecommender.has(id)
      ) {
        continue;
      }

      const profile: CloudRightSizingProfile | null =
        getCloudRightSizingProfile(provider, type);

      if (!profile) {
        continue;
      }

      const size: string | null = readCloudResourceSize(
        profile,
        resource.cloudProperties,
      );
      const steps: CloudSizeSteps = getCloudSizeSteps(profile.ladder, size);
      const telemetryAttributes: Record<string, string> = readAttributes(
        resource.telemetryAttributes,
      );

      if (
        !size ||
        !steps.isKnown ||
        steps.isBurstable ||
        Object.keys(telemetryAttributes).length === 0
      ) {
        continue;
      }

      candidates.push({
        id: resource.id!,
        name: (resource.name || "").trim(),
        provider,
        type: profile.type,
        profile,
        size,
        accountId: (resource.cloudAccountId || "").trim(),
        region: (resource.cloudRegion || "").trim(),
        providerResourceId: (resource.providerResourceId || "").trim(),
        telemetryAttributes,
      });
    }

    return candidates;
  }

  /*
   * The candidates as reads: by type and by the attributes that tell its
   * resources apart.
   */
  public static groupForReads(
    candidates: Array<CloudRightSizingCandidate>,
  ): Array<CloudRightSizingReadGroup> {
    const groups: Map<string, CloudRightSizingReadGroup> = new Map();

    for (const candidate of candidates) {
      const keys: Array<string> = Object.keys(
        candidate.telemetryAttributes,
      ).sort();
      const groupKey: string = JSON.stringify([
        candidate.provider,
        candidate.type,
        keys,
      ]);
      let group: CloudRightSizingReadGroup | undefined = groups.get(groupKey);

      if (!group) {
        group = {
          profile: candidate.profile,
          keys,
          filter: {},
          candidates: [],
        };
        groups.set(groupKey, group);
      }

      group.candidates.push(candidate);
    }

    for (const group of groups.values()) {
      for (const key of group.keys) {
        const values: Set<string> = new Set<string>(
          group.candidates.map(
            (candidate: CloudRightSizingCandidate): string => {
              return candidate.telemetryAttributes[key] || "";
            },
          ),
        );

        if (values.size === 1) {
          group.filter[key] = Array.from(values)[0]!;
        }
      }
    }

    return Array.from(groups.values());
  }

  // A grouped read's rows, by the candidate each is about (its row id).
  public static matchRows(
    group: CloudRightSizingReadGroup,
    rows: Array<AggregatedModel>,
  ): Map<string, AggregatedModel> {
    const byAttributes: Map<string, CloudRightSizingCandidate> = new Map();

    for (const candidate of group.candidates) {
      byAttributes.set(
        attributeKeyOf(group.keys, candidate.telemetryAttributes),
        candidate,
      );
    }

    const matched: Map<string, AggregatedModel> = new Map();

    for (const row of rows) {
      const attributes: unknown = row["attributes"];

      if (!attributes || typeof attributes !== "object") {
        continue;
      }

      const candidate: CloudRightSizingCandidate | undefined = byAttributes.get(
        attributeKeyOf(group.keys, attributes as Record<string, unknown>),
      );

      if (candidate && !matched.has(candidate.id.toString())) {
        matched.set(candidate.id.toString(), row);
      }
    }

    return matched;
  }

  /*
   * What each group's readings say, from its four grouped reads: the CPU's
   * 95th percentile (whose time is its first reading in the window), its
   * highest reading and how many there are, and memory's peak.
   */
  public static toObservations(data: {
    group: CloudRightSizingReadGroup;
    cpuP95: Array<AggregatedModel>;
    cpuMax: Array<AggregatedModel>;
    cpuCount: Array<AggregatedModel>;
    memoryMax: Array<AggregatedModel>;
    end: Date;
  }): Map<string, CloudUsageObservation> {
    const p95: Map<string, AggregatedModel> = CloudRightSizingWriter.matchRows(
      data.group,
      data.cpuP95,
    );
    const max: Map<string, AggregatedModel> = CloudRightSizingWriter.matchRows(
      data.group,
      data.cpuMax,
    );
    const count: Map<string, AggregatedModel> =
      CloudRightSizingWriter.matchRows(data.group, data.cpuCount);
    const memory: Map<string, AggregatedModel> =
      CloudRightSizingWriter.matchRows(data.group, data.memoryMax);
    const cpuScale: number = data.group.profile.cpu.toPercent;
    const memoryScale: number = data.group.profile.memory?.toPercent || 1;
    const observations: Map<string, CloudUsageObservation> = new Map();

    const valueOf: (row: AggregatedModel | undefined) => number | null = (
      row: AggregatedModel | undefined,
    ): number | null => {
      const value: number = Number(row?.value);
      return row && Number.isFinite(value) ? value : null;
    };

    for (const candidate of data.group.candidates) {
      const id: string = candidate.id.toString();
      const p95Row: AggregatedModel | undefined = p95.get(id);

      if (!p95Row) {
        continue;
      }

      const first: number = new Date(p95Row.timestamp).getTime();
      const cpuP95: number | null = valueOf(p95Row);
      const cpuMax: number | null = valueOf(max.get(id));
      const memoryPeak: number | null = valueOf(memory.get(id));

      observations.set(id, {
        cpuP95Percent: cpuP95 === null ? null : cpuP95 * cpuScale,
        cpuMaxPercent: cpuMax === null ? null : cpuMax * cpuScale,
        memoryPeakPercent:
          memoryPeak === null ? null : memoryPeak * memoryScale,
        samples: Math.max(0, Math.round(valueOf(count.get(id)) || 0)),
        observedHours: Number.isFinite(first)
          ? Math.max(0, (data.end.getTime() - first) / HOUR_MS)
          : 0,
      });
    }

    return observations;
  }

  // One grouped read of a group's readings over the window.
  private static async readGroup(data: {
    projectId: ObjectID;
    group: CloudRightSizingReadGroup;
    names: Array<string>;
    aggregationType: AggregationType;
    start: Date;
    end: Date;
  }): Promise<Array<AggregatedModel>> {
    if (data.names.length === 0) {
      return [];
    }

    const result: AggregatedResult = await MetricService.aggregateBy({
      query: {
        projectId: data.projectId,
        name:
          data.names.length === 1 ? data.names[0]! : new Includes(data.names),
        time: new InBetween<Date>(data.start, data.end),
        attributes: data.group.filter,
      } as never,
      aggregationType: data.aggregationType,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      aggregationInterval: AggregationInterval.Total,
      startTimestamp: data.start,
      endTimestamp: data.end,
      groupByAttributeKeys: data.group.keys,
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    return (result.data || []) as Array<AggregatedModel>;
  }

  /*
   * What the readings of the last 14 days say of each candidate (its row
   * id). A group whose reads fail is left out, and logged: its resources
   * are sized on the next run.
   */
  public static async readObservations(data: {
    projectId: ObjectID;
    candidates: Array<CloudRightSizingCandidate>;
    now: Date;
  }): Promise<Map<string, CloudUsageObservation>> {
    const end: Date = data.now;
    const start: Date = addUtcDays(end, -CLOUD_RIGHT_SIZING_WINDOW_DAYS);
    const observations: Map<string, CloudUsageObservation> = new Map();

    for (const group of CloudRightSizingWriter.groupForReads(data.candidates)) {
      if (group.keys.length > CLOUD_RIGHT_SIZING_MAX_GROUP_KEYS) {
        continue;
      }

      try {
        const read: (
          names: Array<string>,
          aggregationType: AggregationType,
        ) => Promise<Array<AggregatedModel>> = (
          names: Array<string>,
          aggregationType: AggregationType,
        ): Promise<Array<AggregatedModel>> => {
          return CloudRightSizingWriter.readGroup({
            projectId: data.projectId,
            group,
            names,
            aggregationType,
            start,
            end,
          });
        };

        const cpuP95: Array<AggregatedModel> = await read(
          group.profile.cpu.names,
          AggregationType.P95,
        );

        // No CPU readings at all: nothing more to read for the group.
        if (cpuP95.length === 0) {
          continue;
        }

        const cpuMax: Array<AggregatedModel> = await read(
          group.profile.cpu.names,
          AggregationType.Max,
        );
        const cpuCount: Array<AggregatedModel> = await read(
          group.profile.cpu.names,
          AggregationType.Count,
        );
        const memoryMax: Array<AggregatedModel> = group.profile.memory
          ? await read(group.profile.memory.names, AggregationType.Max)
          : [];

        for (const [id, observation] of CloudRightSizingWriter.toObservations({
          group,
          cpuP95,
          cpuMax,
          cpuCount,
          memoryMax,
          end,
        })) {
          observations.set(id, observation);
        }
      } catch (error) {
        logger.error(
          `Cloud right-sizing: the readings of ${group.profile.type} could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return observations;
  }

  /*
   * What each candidate cost a day over the days its cloud billed it in the
   * last 30, by its cost key (getCloudCostResourceKey), in the currency
   * most of it was billed in.
   */
  public static buildDailyCostsStatement(data: {
    projectId: ObjectID;
    resourceKeys: Array<string>;
    start: Date;
    end: Date;
  }): Statement {
    const statement: Statement = SQL`SELECT resourceId AS resourceKey, currency AS currencyCode, sum(cost) AS total, uniqExact(toDate(day, 'UTC')) AS days FROM ${COST_TABLE} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND resourceId IN ${{
      type: TableColumnType.Text,
      value: new Includes(data.resourceKeys),
    }} AND day >= ${{
      type: TableColumnType.Date,
      value: data.start,
    }} AND day < ${{
      type: TableColumnType.Date,
      value: data.end,
    }} GROUP BY resourceKey, currencyCode`;

    statement.append(COST_QUERY_SETTINGS);

    return statement;
  }

  // The daily-costs rows, read back: each key's currency with the most.
  public static readDailyCostRows(
    rows: Array<JSONObject>,
  ): Map<string, CloudResourceDailyCost> {
    const costs: Map<string, CloudResourceDailyCost> = new Map();

    for (const row of rows) {
      const key: string = String(row["resourceKey"] ?? "");
      const total: number = Number(row["total"]);
      const days: number = Math.round(Number(row["days"]));

      if (!key || !Number.isFinite(total) || total <= 0 || !(days > 0)) {
        continue;
      }

      const existing: CloudResourceDailyCost | undefined = costs.get(key);
      const amount: number = total / days;

      if (!existing || existing.amount * existing.days < total) {
        costs.set(key, {
          amount,
          currency: String(row["currencyCode"] || CLOUD_COST_DEFAULT_CURRENCY),
          days: Math.min(days, CLOUD_RIGHT_SIZING_COST_DAYS),
        });
      }
    }

    return costs;
  }

  public static async readDailyCosts(data: {
    projectId: ObjectID;
    candidates: Array<CloudRightSizingCandidate>;
    now: Date;
  }): Promise<Map<string, CloudResourceDailyCost>> {
    const keys: Array<string> = Array.from(
      new Set<string>(
        data.candidates
          .map((candidate: CloudRightSizingCandidate): string => {
            return getCloudCostResourceKey(
              candidate.provider,
              candidate.providerResourceId,
            );
          })
          .filter((key: string): boolean => {
            return key.length > 0;
          }),
      ),
    );

    if (keys.length === 0) {
      return new Map();
    }

    const end: Date = addUtcDays(startOfUtcDay(data.now), 1);
    const start: Date = addUtcDays(end, -CLOUD_RIGHT_SIZING_COST_DAYS);

    try {
      const result: Results = await CloudCostService.executeQuery(
        CloudRightSizingWriter.buildDailyCostsStatement({
          projectId: data.projectId,
          resourceKeys: keys,
          start,
          end,
        }),
      );
      const response: DbJSONResponse = await result.json<{
        data?: Array<JSONObject>;
      }>();

      return CloudRightSizingWriter.readDailyCostRows(
        (response.data || []) as Array<JSONObject>,
      );
    } catch (error) {
      // No cost, no saving said: the change is kept without one.
      logger.error(
        `Cloud right-sizing: what the resources cost could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return new Map();
    }
  }

  // A right-sizing with a smaller size, as the row it is kept as.
  public static toRecord(data: {
    candidate: CloudRightSizingCandidate;
    sizing: CloudRightSizing;
  }): CloudRightSizingRecord | null {
    if (
      data.sizing.verdict !== CloudRightSizingVerdict.Overprovisioned ||
      !hasCloudRightSizingChange(data.sizing)
    ) {
      return null;
    }

    return {
      cloudResourceId: data.candidate.id,
      accountId: data.candidate.accountId,
      recommendationId: getCloudRightSizingRecommendationId(
        data.candidate.id.toString(),
      ),
      region: data.candidate.region,
      resourceId: data.candidate.providerResourceId,
      resourceType: getCloudResourceTypeDisplayName(
        data.candidate.provider,
        data.candidate.type,
      ),
      resourceName: data.candidate.name,
      currentConfiguration: data.sizing.currentSize || "",
      recommendedConfiguration: data.sizing.recommendedSize || "",
      monthlySavings: data.sizing.monthlySavings,
      monthlyCost: data.sizing.monthlyCost,
      currency: data.sizing.currency || CLOUD_COST_DEFAULT_CURRENCY,
      evidence: toCloudRightSizingEvidence(
        data.sizing,
      ) as unknown as JSONObject,
    };
  }

  /*
   * The connection's resources, as the writer reads them: the right-sizable
   * types only.
   */
  private static async loadResources(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    provider: CloudProvider;
  }): Promise<Array<CloudResource>> {
    const types: Array<string> = CLOUD_RIGHT_SIZING_PROFILES.filter(
      (profile: CloudRightSizingProfile): boolean => {
        return profile.provider === data.provider;
      },
    ).map((profile: CloudRightSizingProfile): string => {
      return profile.type;
    });

    if (types.length === 0) {
      return [];
    }

    return await CloudResourceService.findBy({
      query: {
        projectId: data.projectId,
        cloudConnectionId: data.connectionId,
        cloudResourceKind: CloudResourceKind.Resource,
        cloudResourceType: new Includes(types),
      },
      select: {
        _id: true,
        name: true,
        cloudProvider: true,
        cloudResourceType: true,
        cloudProperties: true,
        telemetryAttributes: true,
        providerResourceId: true,
        cloudAccountId: true,
        cloudRegion: true,
        isArchived: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
  }

  /*
   * Sizes the connection's resources and keeps the right-sizings in step.
   * Never throws: a run that fails part way is logged, and what it could
   * not do is done on the next run.
   */
  public static async run(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    provider: CloudProvider;
    // An account's id in its cloud (lower case) -> its CloudAccount row id.
    accountRows: Map<string, ObjectID>;
    now: Date;
  }): Promise<CloudRightSizingWriteResult> {
    const result: CloudRightSizingWriteResult = {
      judged: 0,
      kept: 0,
      removed: 0,
    };

    try {
      const resources: Array<CloudResource> =
        await CloudRightSizingWriter.loadResources(data);
      const resourceIds: Array<ObjectID> = resources
        .map((resource: CloudResource): ObjectID | null => {
          return resource.id || null;
        })
        .filter((id: ObjectID | null): boolean => {
          return Boolean(id);
        }) as Array<ObjectID>;

      // What is kept already, and which resources a recommender speaks for.
      const existing: Array<CloudCostRecommendation> =
        resourceIds.length > 0
          ? await CloudCostRecommendationService.findBy({
              query: {
                projectId: data.projectId,
                cloudResourceId: new Includes(resourceIds),
              },
              select: {
                _id: true,
                recommendationId: true,
                cloudResourceId: true,
                kind: true,
              },
              skip: 0,
              limit: LIMIT_MAX,
              props: { isRoot: true },
            })
          : [];
      const covered: Set<string> = new Set<string>();
      const kept: Map<string, ObjectID> = new Map();

      for (const row of existing) {
        if (!row.id || !row.cloudResourceId) {
          continue;
        }

        if (isCloudRightSizingRecommendationId(row.recommendationId)) {
          kept.set(row.recommendationId!, row.id);
        } else if (
          isRecommenderSizeRecommendation({
            kind: row.kind,
            recommendationId: row.recommendationId,
          })
        ) {
          covered.add(row.cloudResourceId.toString());
        }
      }

      const candidates: Array<CloudRightSizingCandidate> =
        CloudRightSizingWriter.selectCandidates({
          resources,
          coveredByRecommender: covered,
        });

      const observations: Map<string, CloudUsageObservation> =
        candidates.length > 0
          ? await CloudRightSizingWriter.readObservations({
              projectId: data.projectId,
              candidates,
              now: data.now,
            })
          : new Map();
      const costs: Map<string, CloudResourceDailyCost> =
        observations.size > 0
          ? await CloudRightSizingWriter.readDailyCosts({
              projectId: data.projectId,
              candidates: candidates.filter(
                (candidate: CloudRightSizingCandidate): boolean => {
                  return observations.has(candidate.id.toString());
                },
              ),
              now: data.now,
            })
          : new Map();

      const records: Array<CloudRightSizingRecord> = [];

      for (const candidate of candidates) {
        const observation: CloudUsageObservation | undefined = observations.get(
          candidate.id.toString(),
        );

        if (!observation) {
          continue;
        }

        const sizing: CloudRightSizing = buildCloudRightSizing({
          profile: candidate.profile,
          size: candidate.size,
          observation,
          dailyCost:
            costs.get(
              getCloudCostResourceKey(
                candidate.provider,
                candidate.providerResourceId,
              ),
            ) || null,
        });

        if (sizing.verdict === CloudRightSizingVerdict.NotEnoughHistory) {
          continue;
        }

        result.judged++;

        const record: CloudRightSizingRecord | null =
          CloudRightSizingWriter.toRecord({ candidate, sizing });

        if (record) {
          records.push(record);
        }
      }

      result.kept = await CloudRightSizingWriter.keep({
        projectId: data.projectId,
        provider: data.provider,
        accountRows: data.accountRows,
        records,
        existing: kept,
        now: data.now,
      });

      /*
       * What is no longer true: a resource's right-sizing not made this
       * time - it needs no smaller size now, a recommender speaks for it,
       * or too few readings came in - and one whose resource is gone.
       */
      const written: Set<string> = new Set<string>(
        records.map((record: CloudRightSizingRecord): string => {
          return record.recommendationId;
        }),
      );
      const stale: Array<ObjectID> = Array.from(kept.entries())
        .filter(([recommendationId]: [string, ObjectID]): boolean => {
          return !written.has(recommendationId);
        })
        .map(([, id]: [string, ObjectID]): ObjectID => {
          return id;
        });

      if (stale.length > 0) {
        result.removed += await CloudCostRecommendationService.hardDeleteBy({
          query: {
            projectId: data.projectId,
            _id: new Includes(stale),
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        });
      }

      result.removed += await CloudCostRecommendationService.hardDeleteBy({
        query: {
          projectId: data.projectId,
          provider: data.provider,
          source: CLOUD_SAVINGS_SOURCE_ONEUPTIME,
          cloudResourceId: new IsNull(),
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Cloud connection ${data.connectionId.toString()}: OneUptime's right-sizing could not be kept: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return result;
  }

  // Writes each right-sizing: brought up to date, or created.
  private static async keep(data: {
    projectId: ObjectID;
    provider: CloudProvider;
    accountRows: Map<string, ObjectID>;
    records: Array<CloudRightSizingRecord>;
    // What is kept already: its recommendation id -> its row id.
    existing: Map<string, ObjectID>;
    now: Date;
  }): Promise<number> {
    let kept: number = 0;

    for (const record of data.records) {
      const cloudAccountId: ObjectID | undefined = data.accountRows.get(
        record.accountId.trim().toLowerCase(),
      );

      // A resource of an account OneUptime holds no row for is not kept.
      if (!cloudAccountId) {
        continue;
      }

      const fields: Partial<CloudCostRecommendation> = {
        cloudAccountId,
        cloudResourceId: record.cloudResourceId,
        region: record.region,
        resourceId: record.resourceId,
        resourceType: record.resourceType,
        resourceName: record.resourceName,
        kind: CloudSavingKind.Rightsize,
        action: CLOUD_RIGHT_SIZING_ACTION,
        currentConfiguration: record.currentConfiguration,
        recommendedConfiguration: record.recommendedConfiguration,
        monthlySavings: record.monthlySavings,
        currency: record.currency,
        effort: CLOUD_RIGHT_SIZING_EFFORT,
        source: CLOUD_SAVINGS_SOURCE_ONEUPTIME,
        evidence: record.evidence,
        lastSeenAt: data.now,
      };

      if (record.monthlyCost !== null) {
        fields.monthlyCost = record.monthlyCost;
      }

      try {
        const existingId: ObjectID | undefined = data.existing.get(
          record.recommendationId,
        );

        if (existingId) {
          await CloudCostRecommendationService.updateOneById({
            id: existingId,
            data: fields as never,
            props: { isRoot: true, ignoreHooks: true },
          });
        } else {
          const row: CloudCostRecommendation = new CloudCostRecommendation();
          row.projectId = data.projectId;
          row.provider = data.provider;
          row.recommendationId = record.recommendationId;
          Object.assign(row, fields);

          await CloudCostRecommendationService.create({
            data: row,
            props: { isRoot: true, ignoreHooks: true },
          });
        }

        kept++;
      } catch (error) {
        logger.error(
          `Cloud right-sizing: a right-sizing could not be kept: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return kept;
  }
}
