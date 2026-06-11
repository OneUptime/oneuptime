import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import ProfileSampleDatabaseService from "./ProfileSampleService";
import ProfileDatabaseService from "./ProfileService";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Includes from "../../Types/BaseDatabase/Includes";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { DbJSONResponse, Results } from "./AnalyticsDatabaseService";

// --- Interfaces ---

export interface ProfileFlamegraphNode {
  functionName: string;
  fileName: string;
  lineNumber: number;
  selfValue: number;
  totalValue: number;
  children: ProfileFlamegraphNode[];
  frameType: string;
}

export interface FlamegraphRequest {
  projectId: ObjectID;
  profileId?: string;
  startTime?: Date;
  endTime?: Date;
  serviceIds?: Array<ObjectID>;
  /**
   * Single profile type to filter on. Kept for backwards compat. When
   * `profileTypes` is also supplied, `profileTypes` wins.
   */
  profileType?: string;
  /**
   * Multiple raw profile-type strings to OR together. The UI maps a
   * user-facing category (e.g. "CPU") to all the raw type strings real
   * agents actually emit (e.g. ["cpu", "samples"]).
   */
  profileTypes?: Array<string>;
}

export interface FlamegraphResult {
  flamegraph: ProfileFlamegraphNode;
  /**
   * True when the unique-stack LIMIT was hit, i.e. the smallest stacks in
   * the window were dropped and the tree undercounts the true totals.
   */
  truncated: boolean;
}

export interface FunctionListItem {
  functionName: string;
  fileName: string;
  selfValue: number;
  totalValue: number;
  sampleCount: number;
  frameType: string;
}

export interface FunctionListRequest {
  projectId: ObjectID;
  /**
   * When present, restricts the list to the samples of a single ingested
   * profile so the per-profile detail view and the windowed view share
   * one code path.
   */
  profileId?: string;
  /**
   * Optional when profileId is given: a single profile's samples are
   * already bounded, and forcing a window here would silently drop any
   * profile captured before the window started.
   */
  startTime?: Date;
  endTime?: Date;
  serviceIds?: Array<ObjectID>;
  profileType?: string;
  profileTypes?: Array<string>;
  limit?: number;
  sortBy?: "selfValue" | "totalValue" | "sampleCount";
}

export interface FunctionListResult {
  functions: Array<FunctionListItem>;
  /**
   * Sum of `value` across ALL sample rows matching the filters (computed
   * pre-limit, same unit as the per-function values). Lets the UI render
   * accurate "% of total" figures even when the list is truncated.
   */
  windowTotal: number;
  /**
   * True when the unique-stack LIMIT was hit, i.e. the smallest stacks in
   * the window were dropped and per-function values undercount.
   */
  truncated: boolean;
}

export interface ServiceActivityRequest {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  /**
   * Single profile type to filter on. Kept for backwards compat. When
   * `profileTypes` is also supplied, `profileTypes` wins.
   */
  profileType?: string;
  /**
   * Multiple raw profile-type strings to OR together. The UI maps a
   * user-facing category (e.g. "CPU") to all the raw type strings real
   * agents actually emit (e.g. ["cpu", "samples"]).
   */
  profileTypes?: Array<string>;
}

export interface ServiceActivityItem {
  primaryEntityId: string;
  sampleCount: number;
  profileCount: number;
  totalValue: number;
}

export interface DiffFlamegraphRequest {
  projectId: ObjectID;
  baselineStartTime: Date;
  baselineEndTime: Date;
  comparisonStartTime: Date;
  comparisonEndTime: Date;
  serviceIds?: Array<ObjectID>;
  profileType?: string;
  profileTypes?: Array<string>;
}

export interface DiffFlamegraphNode {
  functionName: string;
  fileName: string;
  lineNumber: number;
  baselineValue: number;
  comparisonValue: number;
  delta: number;
  deltaPercent: number;
  selfBaselineValue: number;
  selfComparisonValue: number;
  selfDelta: number;
  children: DiffFlamegraphNode[];
  frameType: string;
}

interface ParsedFrame {
  functionName: string;
  fileName: string;
  lineNumber: number;
}

// --- Service ---

export class ProfileAggregationService {
  private static readonly TABLE_NAME: string = AnalyticsTableName.ProfileSample;
  private static readonly PROFILE_TABLE_NAME: string =
    AnalyticsTableName.Profile;
  private static readonly DEFAULT_FUNCTION_LIST_LIMIT: number = 50;
  /**
   * Cap on unique (stacktrace, frameTypes) groups fetched per query.
   * Sample reads GROUP BY stack identity and ORDER BY summed value, so
   * hitting this cap drops the *smallest* stacks first — truncation is
   * deterministic and barely visible in a flamegraph, unlike a LIMIT over
   * raw unordered sample rows.
   */
  private static readonly MAX_STACK_FETCH: number = 10000;

  /**
   * Build a flamegraph tree from ProfileSample records.
   *
   * Each sample has a `stacktrace` array where each element follows the
   * format "functionName@fileName:lineNumber".  The array is ordered
   * LEAF-FIRST (index 0 = leaf, last index = root) — the pprof
   * Sample.location_id and OTLP Stack.location_indices conventions both
   * store the innermost frame first, and ingestion preserves wire order.
   *
   * Samples are pre-aggregated in ClickHouse by stack identity, then
   * stacks sharing common prefixes are merged into a tree of
   * ProfileFlamegraphNode objects.
   */
  @CaptureSpan()
  public static async getFlamegraph(
    request: FlamegraphRequest,
  ): Promise<FlamegraphResult> {
    const statement: Statement =
      ProfileAggregationService.buildGroupedStackQuery(request);

    const dbResult: Results =
      await ProfileSampleDatabaseService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];
    const truncated: boolean =
      rows.length >= ProfileAggregationService.MAX_STACK_FETCH;

    // Build the tree from the pre-aggregated stacks
    const root: ProfileFlamegraphNode = {
      functionName: "(root)",
      fileName: "",
      lineNumber: 0,
      selfValue: 0,
      totalValue: 0,
      children: [],
      frameType: "",
    };

    /*
     * Per-node child index so frame lookup is O(1) instead of a linear
     * children.find() — wide fan-out (thousands of siblings under root)
     * made the scan quadratic. Kept outside the nodes so the serialized
     * tree shape is unchanged.
     */
    const childIndex: WeakMap<
      ProfileFlamegraphNode,
      Map<string, ProfileFlamegraphNode>
    > = new WeakMap();

    for (const row of rows) {
      const stacktrace: Array<string> =
        (row["stacktrace"] as Array<string>) || [];
      const frameTypes: Array<string> =
        (row["frameTypes"] as Array<string>) || [];
      const value: number = Number(row["totalValue"] || 0);

      if (stacktrace.length === 0) {
        continue;
      }

      /*
       * Walk down the tree, creating nodes as needed. Stored stacks are
       * leaf-first, so iterate from the END of the array (root) toward
       * index 0 (leaf) to build the tree root-to-leaf.
       */
      let currentNode: ProfileFlamegraphNode = root;
      currentNode.totalValue += value;

      for (let i: number = stacktrace.length - 1; i >= 0; i--) {
        const frame: ParsedFrame = ProfileAggregationService.parseFrame(
          stacktrace[i]!,
        );
        const frameType: string = frameTypes[i] || "";
        const frameKey: string = `${frame.functionName}@${frame.fileName}:${frame.lineNumber}`;

        let index: Map<string, ProfileFlamegraphNode> | undefined =
          childIndex.get(currentNode);

        if (!index) {
          index = new Map<string, ProfileFlamegraphNode>();
          childIndex.set(currentNode, index);
        }

        let childNode: ProfileFlamegraphNode | undefined = index.get(frameKey);

        if (!childNode) {
          childNode = {
            functionName: frame.functionName,
            fileName: frame.fileName,
            lineNumber: frame.lineNumber,
            selfValue: 0,
            totalValue: 0,
            children: [],
            frameType: frameType,
          };
          currentNode.children.push(childNode);
          index.set(frameKey, childNode);
        }

        childNode.totalValue += value;

        // Index 0 is the leaf frame in leaf-first storage — it gets selfValue
        if (i === 0) {
          childNode.selfValue += value;
        }

        currentNode = childNode;
      }
    }

    return { flamegraph: root, truncated };
  }

  /**
   * Return the top functions aggregated across samples, sorted by the
   * requested metric (selfValue, totalValue, or sampleCount), along with
   * the pre-limit window total so callers can show "% of total" figures.
   */
  @CaptureSpan()
  public static async getFunctionList(
    request: FunctionListRequest,
  ): Promise<FunctionListResult> {
    const filters: FlamegraphRequest = {
      projectId: request.projectId,
      ...(request.startTime !== undefined && { startTime: request.startTime }),
      ...(request.endTime !== undefined && { endTime: request.endTime }),
      ...(request.profileId !== undefined && { profileId: request.profileId }),
      ...(request.serviceIds !== undefined && {
        serviceIds: request.serviceIds,
      }),
      ...(request.profileType !== undefined && {
        profileType: request.profileType,
      }),
      ...(request.profileTypes !== undefined && {
        profileTypes: request.profileTypes,
      }),
    };

    const statement: Statement =
      ProfileAggregationService.buildGroupedStackQuery(filters);
    const windowTotalStatement: Statement =
      ProfileAggregationService.buildWindowTotalQuery(filters);

    /*
     * The window total must be computed over ALL matching rows (pre-limit),
     * so it cannot be derived from the capped grouped result. It is a
     * single cheap aggregate, so run both queries concurrently.
     */
    const [dbResult, windowTotalDbResult]: [Results, Results] =
      await Promise.all([
        ProfileSampleDatabaseService.executeQuery(statement),
        ProfileSampleDatabaseService.executeQuery(windowTotalStatement),
      ]);

    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();
    const windowTotalResponse: DbJSONResponse = await windowTotalDbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];
    const truncated: boolean =
      rows.length >= ProfileAggregationService.MAX_STACK_FETCH;

    const windowTotalRows: Array<JSONObject> = windowTotalResponse.data || [];
    const windowTotal: number = Number(
      windowTotalRows[0]?.["windowTotal"] || 0,
    );

    // Aggregate per-function stats from the pre-aggregated stacks
    const functionMap: Map<
      string,
      {
        functionName: string;
        fileName: string;
        selfValue: number;
        totalValue: number;
        sampleCount: number;
        frameType: string;
      }
    > = new Map();

    for (const row of rows) {
      const stacktrace: Array<string> =
        (row["stacktrace"] as Array<string>) || [];
      const frameTypes: Array<string> =
        (row["frameTypes"] as Array<string>) || [];
      const value: number = Number(row["totalValue"] || 0);
      /*
       * Each grouped row stands in for `sampleCount` raw samples sharing
       * one stack, so per-function sample counts add the group size, not 1.
       */
      const groupSampleCount: number = Number(row["sampleCount"] || 0);

      if (stacktrace.length === 0) {
        continue;
      }

      const seenInThisSample: Set<string> = new Set();

      for (let i: number = 0; i < stacktrace.length; i++) {
        const frame: ParsedFrame = ProfileAggregationService.parseFrame(
          stacktrace[i]!,
        );
        const frameType: string = frameTypes[i] || "";
        const key: string = `${frame.functionName}@${frame.fileName}:${frame.lineNumber}`;
        // Stacks are stored leaf-first, so index 0 is the leaf frame.
        const isLeaf: boolean = i === 0;

        let entry: FunctionListItem | undefined = functionMap.get(key);

        if (!entry) {
          entry = {
            functionName: frame.functionName,
            fileName: frame.fileName,
            selfValue: 0,
            totalValue: 0,
            sampleCount: 0,
            frameType: frameType,
          };
          functionMap.set(key, entry);
        }

        // totalValue: count the value once per unique function per stack
        if (!seenInThisSample.has(key)) {
          entry.totalValue += value;
          entry.sampleCount += groupSampleCount;
          seenInThisSample.add(key);
        }

        // selfValue: only the leaf frame
        if (isLeaf) {
          entry.selfValue += value;
        }
      }
    }

    // Sort
    const sortBy: string = request.sortBy || "selfValue";
    const items: Array<FunctionListItem> = Array.from(functionMap.values());

    items.sort((a: FunctionListItem, b: FunctionListItem) => {
      if (sortBy === "totalValue") {
        return b.totalValue - a.totalValue;
      }

      if (sortBy === "sampleCount") {
        return b.sampleCount - a.sampleCount;
      }

      return b.selfValue - a.selfValue;
    });

    const limit: number =
      request.limit ?? ProfileAggregationService.DEFAULT_FUNCTION_LIST_LIMIT;

    return {
      functions: items.slice(0, limit),
      windowTotal,
      truncated,
    };
  }

  /**
   * Build a diff flamegraph comparing two time ranges.
   * Returns a tree where each node has baseline/comparison values and deltas.
   */
  @CaptureSpan()
  public static async getDiffFlamegraph(
    request: DiffFlamegraphRequest,
  ): Promise<DiffFlamegraphNode> {
    /*
     * The two windows are independent reads, so fetch them concurrently —
     * sequential awaits doubled the latency of every diff request.
     */
    const [baselineResult, comparisonResult]: [
      FlamegraphResult,
      FlamegraphResult,
    ] = await Promise.all([
      ProfileAggregationService.getFlamegraph({
        projectId: request.projectId,
        startTime: request.baselineStartTime,
        endTime: request.baselineEndTime,
        ...(request.serviceIds !== undefined && {
          serviceIds: request.serviceIds,
        }),
        ...(request.profileType !== undefined && {
          profileType: request.profileType,
        }),
        ...(request.profileTypes !== undefined && {
          profileTypes: request.profileTypes,
        }),
      }),
      ProfileAggregationService.getFlamegraph({
        projectId: request.projectId,
        startTime: request.comparisonStartTime,
        endTime: request.comparisonEndTime,
        ...(request.serviceIds !== undefined && {
          serviceIds: request.serviceIds,
        }),
        ...(request.profileType !== undefined && {
          profileType: request.profileType,
        }),
        ...(request.profileTypes !== undefined && {
          profileTypes: request.profileTypes,
        }),
      }),
    ]);

    return ProfileAggregationService.mergeDiffTrees(
      baselineResult.flamegraph,
      comparisonResult.flamegraph,
    );
  }

  private static mergeDiffTrees(
    baseline: ProfileFlamegraphNode | null,
    comparison: ProfileFlamegraphNode | null,
  ): DiffFlamegraphNode {
    const baselineValue: number = baseline?.totalValue || 0;
    const comparisonValue: number = comparison?.totalValue || 0;
    const delta: number = comparisonValue - baselineValue;
    const deltaPercent: number =
      baselineValue > 0
        ? (delta / baselineValue) * 100
        : comparisonValue > 0
          ? 100
          : 0;

    const node: DiffFlamegraphNode = {
      functionName:
        baseline?.functionName || comparison?.functionName || "(root)",
      fileName: baseline?.fileName || comparison?.fileName || "",
      lineNumber: baseline?.lineNumber || comparison?.lineNumber || 0,
      baselineValue,
      comparisonValue,
      delta,
      deltaPercent,
      selfBaselineValue: baseline?.selfValue || 0,
      selfComparisonValue: comparison?.selfValue || 0,
      selfDelta: (comparison?.selfValue || 0) - (baseline?.selfValue || 0),
      children: [],
      frameType: baseline?.frameType || comparison?.frameType || "",
    };

    // Merge children by matching on functionName + fileName + lineNumber
    const baselineChildren: Map<string, ProfileFlamegraphNode> = new Map();
    const comparisonChildren: Map<string, ProfileFlamegraphNode> = new Map();

    if (baseline) {
      for (const child of baseline.children) {
        const key: string = `${child.functionName}@${child.fileName}:${child.lineNumber}`;
        baselineChildren.set(key, child);
      }
    }

    if (comparison) {
      for (const child of comparison.children) {
        const key: string = `${child.functionName}@${child.fileName}:${child.lineNumber}`;
        comparisonChildren.set(key, child);
      }
    }

    // All unique child keys
    const allKeys: Set<string> = new Set([
      ...baselineChildren.keys(),
      ...comparisonChildren.keys(),
    ]);

    for (const key of allKeys) {
      const baselineChild: ProfileFlamegraphNode | null =
        baselineChildren.get(key) || null;
      const comparisonChild: ProfileFlamegraphNode | null =
        comparisonChildren.get(key) || null;

      node.children.push(
        ProfileAggregationService.mergeDiffTrees(
          baselineChild,
          comparisonChild,
        ),
      );
    }

    // Sort children by comparison value descending
    node.children.sort((a: DiffFlamegraphNode, b: DiffFlamegraphNode) => {
      return b.comparisonValue - a.comparisonValue;
    });

    return node;
  }

  /**
   * Aggregate sample / profile counts per primaryEntityId for a time window.
   * Drives the "loudest services first" sort on the Profiles dashboard
   * so a developer opening the page lands on the workloads that are
   * actually doing work rather than scrolling past kernel-thread noise.
   *
   * Reads the small Profile table (one row per ingested profile, with a
   * denormalized sampleCount) instead of scanning every row of the huge
   * ProfileSample table for what is just a per-service ranking.
   */
  @CaptureSpan()
  public static async getServiceActivity(
    request: ServiceActivityRequest,
  ): Promise<Array<ServiceActivityItem>> {
    const statement: Statement =
      ProfileAggregationService.buildServiceActivityQuery(request);

    const dbResult: Results =
      await ProfileDatabaseService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];
    const out: Array<ServiceActivityItem> = [];
    for (const row of rows) {
      const primaryEntityId: string = String(row["primaryEntityId"] || "");
      if (!primaryEntityId) {
        continue;
      }
      out.push({
        primaryEntityId,
        sampleCount: Number(row["totalSampleCount"] || 0),
        profileCount: Number(row["profileCount"] || 0),
        /*
         * Profile rows do not carry a summed sample value, and no client
         * reads this field — it is kept at 0 purely so the response shape
         * stays stable for existing consumers.
         */
        totalValue: 0,
      });
    }
    return out;
  }

  // --- Query builders ---

  /**
   * Fetch samples pre-aggregated by stack identity. Collapsing identical
   * (stacktrace, frameTypes) pairs in ClickHouse shrinks tens of thousands
   * of raw sample rows to a few hundred unique stacks before they cross
   * the wire, and the ORDER BY makes the LIMIT drop the smallest stacks
   * first instead of an arbitrary subset.
   *
   * `value` is stored as Int128 in ClickHouse, so the sum is wrapped in
   * toFloat64 to keep the JSON output numeric (toFloat64OrZero would fail
   * with "Illegal type Int128").
   */
  private static buildGroupedStackQuery(request: FlamegraphRequest): Statement {
    const statement: Statement = SQL`
      SELECT
        stacktrace,
        frameTypes,
        toFloat64(sum(value)) AS totalValue,
        count() AS sampleCount
      FROM ${ProfileAggregationService.TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
    `;

    ProfileAggregationService.appendSampleFilters(statement, request);

    statement.append(
      SQL` GROUP BY stacktrace, frameTypes
           ORDER BY totalValue DESC
           LIMIT ${{
             type: TableColumnType.Number,
             value: ProfileAggregationService.MAX_STACK_FETCH,
           }}`,
    );

    /*
     * Cap runtime below the client's 58s request_timeout; 'break' yields
     * a partial (top stacks) result rather than holding a pool connection.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
      }),
    );

    return statement;
  }

  /**
   * Total of `value` across every sample row matching the filters — no
   * GROUP BY and no LIMIT, so it stays correct even when the grouped
   * stack query truncates.
   */
  private static buildWindowTotalQuery(request: FlamegraphRequest): Statement {
    const statement: Statement = SQL`
      SELECT
        toFloat64(sum(value)) AS windowTotal
      FROM ${ProfileAggregationService.TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
    `;

    ProfileAggregationService.appendSampleFilters(statement, request);

    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
      }),
    );

    return statement;
  }

  private static buildServiceActivityQuery(
    request: ServiceActivityRequest,
  ): Statement {
    /*
     * One Profile row per ingested profile with a denormalized sampleCount,
     * so the per-service ranking never has to touch the (orders of
     * magnitude larger) ProfileSample table. uniqExact tolerates duplicate
     * rows for the same profileId from re-ingestion.
     */
    const statement: Statement = SQL`
      SELECT
        toString(primaryEntityId) AS primaryEntityId,
        toFloat64(sum(sampleCount)) AS totalSampleCount,
        uniqExact(profileId) AS profileCount
      FROM ${ProfileAggregationService.PROFILE_TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
        AND startTime >= ${{
          type: TableColumnType.Date,
          value: request.startTime,
        }}
        AND startTime <= ${{
          type: TableColumnType.Date,
          value: request.endTime,
        }}
    `;

    statement.append(" AND retentionDate >= now()");

    /*
     * profileTypes (array) wins over profileType (single) so the UI
     * can OR together every raw type string in a category.
     */
    if (request.profileTypes && request.profileTypes.length > 0) {
      statement.append(
        SQL` AND profileType IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.profileTypes),
        }})`,
      );
    } else if (request.profileType) {
      statement.append(
        SQL` AND profileType = ${{
          type: TableColumnType.Text,
          value: request.profileType,
        }}`,
      );
    }

    statement.append(
      SQL` GROUP BY primaryEntityId
           ORDER BY totalSampleCount DESC
           LIMIT 10000`,
    );

    /*
     * Cap runtime below the client's 58s request_timeout; 'break' yields
     * partial service activity rather than holding a pool connection.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
      }),
    );

    return statement;
  }

  /**
   * Shared WHERE-clause tail for ProfileSample reads: optional profileId /
   * time-window filters, the read-side retention filter, and the common
   * service / profile-type filters.
   */
  private static appendSampleFilters(
    statement: Statement,
    request: FlamegraphRequest,
  ): void {
    if (request.profileId) {
      statement.append(
        SQL` AND profileId = ${{
          type: TableColumnType.Text,
          value: request.profileId,
        }}`,
      );
    }

    if (request.startTime) {
      statement.append(
        SQL` AND time >= ${{
          type: TableColumnType.Date,
          value: request.startTime,
        }}`,
      );
    }

    if (request.endTime) {
      statement.append(
        SQL` AND time <= ${{
          type: TableColumnType.Date,
          value: request.endTime,
        }}`,
      );
    }

    /*
     * Read-side retention filter: rows past their per-service retention
     * stay in their part until the whole part drops (ttl_only_drop_parts).
     */
    statement.append(" AND retentionDate >= now()");

    ProfileAggregationService.appendCommonFilters(statement, request);
  }

  private static appendCommonFilters(
    statement: Statement,
    request: Pick<
      FlamegraphRequest,
      "serviceIds" | "profileType" | "profileTypes"
    >,
  ): void {
    if (request.serviceIds && request.serviceIds.length > 0) {
      statement.append(
        SQL` AND primaryEntityId IN (${{
          type: TableColumnType.ObjectID,
          value: new Includes(
            request.serviceIds.map((id: ObjectID) => {
              return id.toString();
            }),
          ),
        }})`,
      );
    }

    /*
     * profileTypes (array) wins over profileType (single) so the UI can
     * OR together every raw type string in a category.
     */
    if (request.profileTypes && request.profileTypes.length > 0) {
      statement.append(
        SQL` AND profileType IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.profileTypes),
        }})`,
      );
    } else if (request.profileType) {
      statement.append(
        SQL` AND profileType = ${{
          type: TableColumnType.Text,
          value: request.profileType,
        }}`,
      );
    }
  }

  /**
   * Parse a frame string in the format "functionName@fileName:lineNumber".
   * Falls back gracefully if the format is unexpected.
   */
  private static parseFrame(frame: string): ParsedFrame {
    // Expected format: "functionName@fileName:lineNumber"
    const atIndex: number = frame.indexOf("@");

    if (atIndex === -1) {
      return {
        functionName: frame,
        fileName: "",
        lineNumber: 0,
      };
    }

    const functionName: string = frame.substring(0, atIndex);
    const rest: string = frame.substring(atIndex + 1);

    const lastColonIndex: number = rest.lastIndexOf(":");

    if (lastColonIndex === -1) {
      return {
        functionName,
        fileName: rest,
        lineNumber: 0,
      };
    }

    const fileName: string = rest.substring(0, lastColonIndex);
    const lineNumberStr: string = rest.substring(lastColonIndex + 1);
    const lineNumber: number = parseInt(lineNumberStr, 10) || 0;

    return {
      functionName,
      fileName,
      lineNumber,
    };
  }
}

export default ProfileAggregationService;
