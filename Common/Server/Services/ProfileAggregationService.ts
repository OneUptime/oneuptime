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
import { getClickhouseTelemetryDistributedTableName } from "../../Utils/Telemetry/Sharding";

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

export interface DiffFlamegraphResult {
  diffFlamegraph: DiffFlamegraphNode;
  /**
   * True when EITHER window's unique-stack LIMIT was hit. A truncated
   * side undercounts its totals, which would otherwise masquerade as a
   * regression/improvement in the delta — the UI must caveat the diff.
   */
  truncated: boolean;
}

export interface FunctionFocusRequest {
  projectId: ObjectID;
  functionName: string;
  /**
   * May be the empty string: bare frames (folded/collapsed uploads and
   * address-only frames) carry no file information, and the empty
   * fileName is part of the function's identity for matching.
   */
  fileName: string;
  profileId?: string;
  startTime?: Date;
  endTime?: Date;
  serviceIds?: Array<ObjectID>;
  profileType?: string;
  profileTypes?: Array<string>;
}

export interface FunctionFocusResult {
  functionName: string;
  fileName: string;
  /**
   * Sum of `value` over every matching stack, counted once per stack
   * even when the function recurses. Equals callers.totalValue and
   * callees.totalValue (both trees are rooted at the focused function).
   */
  totalValue: number;
  /** Sum of `value` over stacks where the focused function is the leaf. */
  selfValue: number;
  sampleCount: number;
  /**
   * Sum of `value` over ALL rows matching the non-function filters, so
   * the UI can show "% of window" figures for the focused function.
   */
  windowTotal: number;
  /**
   * Root = the focused function; children = DIRECT callers, grandchildren
   * = callers-of-callers. Node weights are the value flowing through that
   * caller chain into the function.
   */
  callers: ProfileFlamegraphNode;
  /**
   * Root = the focused function; children = direct callees (frames toward
   * the leaf), and so on.
   */
  callees: ProfileFlamegraphNode;
  truncated: boolean;
}

export interface BreakdownRequest {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  /**
   * "service" groups by primaryEntityId; any other value is treated as a
   * Profile attribute key and groups by that attribute's value.
   */
  breakdownBy: string;
  serviceIds?: Array<ObjectID>;
  profileType?: string;
  profileTypes?: Array<string>;
  limit?: number;
}

export interface BreakdownItem {
  /**
   * The group value: a primaryEntityId string for breakdownBy="service"
   * (the UI resolves display names), otherwise the raw attribute value.
   */
  value: string;
  sampleCount: number;
  profileCount: number;
  /** 0-100 percentage of totalSampleCount. */
  share: number;
}

export interface BreakdownResult {
  items: Array<BreakdownItem>;
  /**
   * Sum of sampleCount across ALL groups (computed pre-limit), so shares
   * stay accurate even when only the top-N items are returned.
   */
  totalSampleCount: number;
}

interface ParsedFrame {
  functionName: string;
  fileName: string;
  lineNumber: number;
}

// --- Service ---

export class ProfileAggregationService {
  private static readonly TABLE_NAME: string =
    getClickhouseTelemetryDistributedTableName(
      AnalyticsTableName.ProfileSample,
    );
  private static readonly PROFILE_TABLE_NAME: string =
    getClickhouseTelemetryDistributedTableName(AnalyticsTableName.Profile);
  private static readonly DEFAULT_FUNCTION_LIST_LIMIT: number = 50;
  private static readonly DEFAULT_BREAKDOWN_LIMIT: number = 10;
  /**
   * Cap on unique groups fetched by a breakdown query. Groups are ordered
   * by summed sampleCount, so hitting the cap drops the quietest groups
   * first — totals over the fetched groups stay representative even for
   * pathological high-cardinality attribute keys.
   */
  private static readonly MAX_BREAKDOWN_GROUP_FETCH: number = 10000;
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
   * "Sandwich" aggregation for one function: every matching stack is
   * split at the focused function, the frames toward the root become the
   * callers tree and the frames toward the leaf become the callees tree.
   * Both trees are rooted at the focused function itself so the UI can
   * render them stacked around a single center row.
   *
   * Frames match on functionName + fileName only — line numbers shift on
   * every deploy (and with inlining), so including them would split one
   * logical function into many.
   */
  @CaptureSpan()
  public static async getFunctionFocus(
    request: FunctionFocusRequest,
  ): Promise<FunctionFocusResult> {
    const filters: FlamegraphRequest = {
      projectId: request.projectId,
      ...(request.profileId !== undefined && { profileId: request.profileId }),
      ...(request.startTime !== undefined && { startTime: request.startTime }),
      ...(request.endTime !== undefined && { endTime: request.endTime }),
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
      ProfileAggregationService.buildFunctionStackQuery(
        filters,
        request.functionName,
        request.fileName,
      );
    const windowTotalStatement: Statement =
      ProfileAggregationService.buildWindowTotalQuery(filters);

    /*
     * windowTotal deliberately ignores the function prefilter — it is the
     * denominator for "% of window" figures, so it must cover every row
     * matching the non-function filters. Both reads are independent, so
     * run them concurrently.
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

    /*
     * Both trees are rooted at the focused function. lineNumber is 0
     * because the view aggregates across line numbers by design.
     */
    const callers: ProfileFlamegraphNode = {
      functionName: request.functionName,
      fileName: request.fileName,
      lineNumber: 0,
      selfValue: 0,
      totalValue: 0,
      children: [],
      frameType: "",
    };
    const callees: ProfileFlamegraphNode = {
      functionName: request.functionName,
      fileName: request.fileName,
      lineNumber: 0,
      selfValue: 0,
      totalValue: 0,
      children: [],
      frameType: "",
    };

    /*
     * Per-node child index for O(1) frame lookup, mirroring getFlamegraph.
     * One map serves both trees since it is keyed by parent node identity.
     */
    const childIndex: WeakMap<
      ProfileFlamegraphNode,
      Map<string, ProfileFlamegraphNode>
    > = new WeakMap();

    let totalValue: number = 0;
    let selfValue: number = 0;
    let sampleCount: number = 0;

    for (const row of rows) {
      const stacktrace: Array<string> =
        (row["stacktrace"] as Array<string>) || [];
      const frameTypes: Array<string> =
        (row["frameTypes"] as Array<string>) || [];
      const value: number = Number(row["totalValue"] || 0);
      const groupSampleCount: number = Number(row["sampleCount"] || 0);

      if (stacktrace.length === 0) {
        continue;
      }

      /*
       * Stacks are leaf-first, so scanning from the END finds the
       * occurrence CLOSEST TO THE ROOT first. For recursive functions
       * this attributes the whole recursive subtree (including nested
       * occurrences) to one split point, so each stack's value is
       * counted exactly once.
       */
      let occurrenceIndex: number = -1;

      for (let i: number = stacktrace.length - 1; i >= 0; i--) {
        const frame: ParsedFrame = ProfileAggregationService.parseFrame(
          stacktrace[i]!,
        );
        if (
          frame.functionName === request.functionName &&
          frame.fileName === request.fileName
        ) {
          occurrenceIndex = i;
          break;
        }
      }

      /*
       * The ClickHouse prefilter is a prefix match and can overmatch
       * when a fileName containing colons shares a prefix with another
       * (parseFrame splits on the LAST colon) — drop those rows here.
       */
      if (occurrenceIndex === -1) {
        continue;
      }

      totalValue += value;
      sampleCount += groupSampleCount;

      /*
       * Self time counts whenever the function is the EXECUTING (leaf)
       * frame — checked against index 0 directly rather than the split
       * point, because a recursive stack splits at the root-most
       * occurrence while the leaf may still be the same function
       * (standard sandwich-view semantics: self = "was on CPU").
       */
      const leafFrame: ParsedFrame = ProfileAggregationService.parseFrame(
        stacktrace[0]!,
      );
      if (
        leafFrame.functionName === request.functionName &&
        leafFrame.fileName === request.fileName
      ) {
        selfValue += value;
      }

      const occurrenceFrameType: string = frameTypes[occurrenceIndex] || "";

      if (!callers.frameType) {
        callers.frameType = occurrenceFrameType;
      }
      if (!callees.frameType) {
        callees.frameType = occurrenceFrameType;
      }

      callers.totalValue += value;
      callees.totalValue += value;

      /*
       * Caller chain: frames ABOVE the occurrence (toward the root),
       * direct caller first so depth in the tree equals caller distance.
       */
      const callerIndices: Array<number> = [];
      for (let i: number = occurrenceIndex + 1; i < stacktrace.length; i++) {
        callerIndices.push(i);
      }

      /*
       * Callee chain: frames BELOW the occurrence (toward the leaf),
       * direct callee first.
       */
      const calleeIndices: Array<number> = [];
      for (let i: number = occurrenceIndex - 1; i >= 0; i--) {
        calleeIndices.push(i);
      }

      ProfileAggregationService.appendFocusChain({
        root: callers,
        stacktrace,
        frameTypes,
        frameIndices: callerIndices,
        value,
        childIndex,
      });

      ProfileAggregationService.appendFocusChain({
        root: callees,
        stacktrace,
        frameTypes,
        frameIndices: calleeIndices,
        value,
        childIndex,
      });
    }

    return {
      functionName: request.functionName,
      fileName: request.fileName,
      totalValue,
      selfValue,
      sampleCount,
      windowTotal,
      callers,
      callees,
      truncated,
    };
  }

  /**
   * Walk one split half of a stack into a focus tree, merging frames on
   * functionName + fileName (line numbers aggregated away — same
   * deploy-stability rationale as the focused-function match itself).
   * The terminal node of the chain absorbs selfValue: in the callers
   * tree that is the stack root ("the chain starts here"), in the
   * callees tree the leaf ("the time bottoms out here"). An empty chain
   * terminates at the focused root itself.
   */
  private static appendFocusChain(data: {
    root: ProfileFlamegraphNode;
    stacktrace: Array<string>;
    frameTypes: Array<string>;
    frameIndices: Array<number>;
    value: number;
    childIndex: WeakMap<
      ProfileFlamegraphNode,
      Map<string, ProfileFlamegraphNode>
    >;
  }): void {
    let currentNode: ProfileFlamegraphNode = data.root;

    for (const frameIndex of data.frameIndices) {
      const frame: ParsedFrame = ProfileAggregationService.parseFrame(
        data.stacktrace[frameIndex]!,
      );
      const frameType: string = data.frameTypes[frameIndex] || "";
      const frameKey: string = `${frame.functionName}@${frame.fileName}`;

      let index: Map<string, ProfileFlamegraphNode> | undefined =
        data.childIndex.get(currentNode);

      if (!index) {
        index = new Map<string, ProfileFlamegraphNode>();
        data.childIndex.set(currentNode, index);
      }

      let childNode: ProfileFlamegraphNode | undefined = index.get(frameKey);

      if (!childNode) {
        childNode = {
          functionName: frame.functionName,
          fileName: frame.fileName,
          lineNumber: 0,
          selfValue: 0,
          totalValue: 0,
          children: [],
          frameType: frameType,
        };
        currentNode.children.push(childNode);
        index.set(frameKey, childNode);
      }

      childNode.totalValue += data.value;
      currentNode = childNode;
    }

    currentNode.selfValue += data.value;
  }

  /**
   * Build a diff flamegraph comparing two time ranges.
   * Returns a tree where each node has baseline/comparison values and
   * deltas, plus a truncation flag covering both source windows.
   */
  @CaptureSpan()
  public static async getDiffFlamegraph(
    request: DiffFlamegraphRequest,
  ): Promise<DiffFlamegraphResult> {
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

    return {
      diffFlamegraph: ProfileAggregationService.mergeDiffTrees(
        baselineResult.flamegraph,
        comparisonResult.flamegraph,
      ),
      truncated: baselineResult.truncated || comparisonResult.truncated,
    };
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

  /**
   * Group profiling volume by a dimension ("service" = primaryEntityId,
   * anything else = a Profile attribute key) over a time window.
   *
   * Reads the small Profile table (one row per ingested profile with a
   * denormalized sampleCount) — same reasoning as getServiceActivity: a
   * share-of-volume ranking never needs the huge ProfileSample table.
   *
   * totalSampleCount sums over ALL fetched groups before the limit is
   * applied, so item shares stay percentages of the real total rather
   * than of the visible top-N.
   */
  @CaptureSpan()
  public static async getBreakdown(
    request: BreakdownRequest,
  ): Promise<BreakdownResult> {
    const statement: Statement =
      ProfileAggregationService.buildBreakdownQuery(request);

    const dbResult: Results =
      await ProfileDatabaseService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    // Rows arrive sorted by summed sampleCount descending (query ORDER BY).
    const allItems: Array<BreakdownItem> = [];
    let totalSampleCount: number = 0;

    for (const row of rows) {
      const value: string = String(row["breakdownValue"] || "");
      if (!value) {
        continue;
      }

      const groupSampleCount: number = Number(row["totalSampleCount"] || 0);
      totalSampleCount += groupSampleCount;

      allItems.push({
        value,
        sampleCount: groupSampleCount,
        profileCount: Number(row["profileCount"] || 0),
        share: 0,
      });
    }

    const limit: number =
      request.limit ?? ProfileAggregationService.DEFAULT_BREAKDOWN_LIMIT;
    const items: Array<BreakdownItem> = allItems.slice(0, limit);

    for (const item of items) {
      item.share =
        totalSampleCount > 0 ? (item.sampleCount / totalSampleCount) * 100 : 0;
    }

    return { items, totalSampleCount };
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
   * Grouped-stack query restricted to stacks containing one function, so
   * a sandwich aggregation never pulls the full window's stacks over the
   * wire just to discard most of them.
   *
   * Stored frame strings are "functionName" + ("@fileName" when fileName
   * is non-empty) + (":lineNumber" when lineNumber > 0) — see
   * OtelProfilesIngestService.resolveStackFrames. Line numbers shift
   * across deploys, so the predicate matches the functionName+fileName
   * identity only:
   *   - non-empty fileName: exact "fn@file" (no line recorded) OR prefix
   *     "fn@file:" (line recorded);
   *   - empty fileName: the exact bare frame (folded uploads and
   *     address-only frames store just the name — parseFrame treats any
   *     '@'-less frame as all functionName, so equality is the full
   *     match).
   * The prefix form can overmatch when one colon-bearing fileName is a
   * prefix of another (parseFrame splits on the LAST colon), so callers
   * must re-check each frame in memory via parseFrame.
   */
  private static buildFunctionStackQuery(
    request: FlamegraphRequest,
    functionName: string,
    fileName: string,
  ): Statement {
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

    if (fileName) {
      statement.append(
        SQL` AND arrayExists(x -> (x = ${{
          type: TableColumnType.Text,
          value: `${functionName}@${fileName}`,
        }} OR startsWith(x, ${{
          type: TableColumnType.Text,
          value: `${functionName}@${fileName}:`,
        }})), stacktrace)`,
      );
    } else {
      statement.append(
        SQL` AND has(stacktrace, ${{
          type: TableColumnType.Text,
          value: functionName,
        }})`,
      );
    }

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
   * Per-group volume aggregate over the Profile table for getBreakdown.
   *
   * The "service" dimension groups by primaryEntityId (mirroring
   * buildServiceActivityQuery); any other dimension is a Profile
   * attribute key, read via the parameter-bound Map subscript
   * `attributes[key]` — the same O(1) fast path the analytics query
   * generator uses for map equality. The subscript yields '' for missing
   * keys, so the != '' guard drops profiles without the attribute.
   */
  private static buildBreakdownQuery(request: BreakdownRequest): Statement {
    let statement: Statement;

    if (request.breakdownBy === "service") {
      statement = SQL`
        SELECT
          toString(primaryEntityId) AS breakdownValue,
          toFloat64(sum(sampleCount)) AS totalSampleCount,
          uniqExact(profileId) AS profileCount
        FROM ${ProfileAggregationService.PROFILE_TABLE_NAME}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: request.projectId,
        }}
      `;
    } else {
      statement = SQL`
        SELECT
          attributes[${{
            type: TableColumnType.Text,
            value: request.breakdownBy,
          }}] AS breakdownValue,
          toFloat64(sum(sampleCount)) AS totalSampleCount,
          uniqExact(profileId) AS profileCount
        FROM ${ProfileAggregationService.PROFILE_TABLE_NAME}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: request.projectId,
        }}
          AND attributes[${{
            type: TableColumnType.Text,
            value: request.breakdownBy,
          }}] != ''
      `;
    }

    statement.append(
      SQL` AND startTime >= ${{
        type: TableColumnType.Date,
        value: request.startTime,
      }} AND startTime <= ${{
        type: TableColumnType.Date,
        value: request.endTime,
      }}`,
    );

    /*
     * Read-side retention filter: rows past their per-service retention
     * stay in their part until the whole part drops (ttl_only_drop_parts).
     */
    statement.append(" AND retentionDate >= now()");

    ProfileAggregationService.appendCommonFilters(statement, request);

    statement.append(
      SQL` GROUP BY breakdownValue
           ORDER BY totalSampleCount DESC
           LIMIT ${{
             type: TableColumnType.Number,
             value: ProfileAggregationService.MAX_BREAKDOWN_GROUP_FETCH,
           }}`,
    );

    /*
     * Cap runtime below the client's 58s request_timeout; 'break' yields
     * a partial (top groups) result rather than holding a pool connection.
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
