import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import ProfileSampleDatabaseService from "./ProfileSampleService";
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
  profileType?: string;
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
  startTime: Date;
  endTime: Date;
  serviceIds?: Array<ObjectID>;
  profileType?: string;
  limit?: number;
  sortBy?: "selfValue" | "totalValue" | "sampleCount";
}

export interface DiffFlamegraphRequest {
  projectId: ObjectID;
  baselineStartTime: Date;
  baselineEndTime: Date;
  comparisonStartTime: Date;
  comparisonEndTime: Date;
  serviceIds?: Array<ObjectID>;
  profileType?: string;
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
  private static readonly DEFAULT_FUNCTION_LIST_LIMIT: number = 50;
  private static readonly MAX_SAMPLE_FETCH: number = 50000;

  /**
   * Build a flamegraph tree from ProfileSample records.
   *
   * Each sample has a `stacktrace` array where each element follows the
   * format "functionName@fileName:lineNumber".  The array is ordered
   * bottom-up (index 0 = root, last index = leaf).
   *
   * We aggregate samples that share common stack prefixes into a tree of
   * ProfileFlamegraphNode objects.
   */
  @CaptureSpan()
  public static async getFlamegraph(
    request: FlamegraphRequest,
  ): Promise<ProfileFlamegraphNode> {
    const statement: Statement =
      ProfileAggregationService.buildFlamegraphQuery(request);

    const dbResult: Results =
      await ProfileSampleDatabaseService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    // Build the tree from samples
    const root: ProfileFlamegraphNode = {
      functionName: "(root)",
      fileName: "",
      lineNumber: 0,
      selfValue: 0,
      totalValue: 0,
      children: [],
      frameType: "",
    };

    for (const row of rows) {
      const stacktrace: Array<string> =
        (row["stacktrace"] as Array<string>) || [];
      const frameTypes: Array<string> =
        (row["frameTypes"] as Array<string>) || [];
      const value: number = Number(row["value"] || 0);

      if (stacktrace.length === 0) {
        continue;
      }

      // Walk down the tree, creating nodes as needed
      let currentNode: ProfileFlamegraphNode = root;
      currentNode.totalValue += value;

      for (let i: number = 0; i < stacktrace.length; i++) {
        const frame: ParsedFrame = ProfileAggregationService.parseFrame(
          stacktrace[i]!,
        );
        const frameType: string = frameTypes[i] || "";

        // Find or create child
        let childNode: ProfileFlamegraphNode | undefined =
          currentNode.children.find((child: ProfileFlamegraphNode): boolean => {
            return (
              child.functionName === frame.functionName &&
              child.fileName === frame.fileName &&
              child.lineNumber === frame.lineNumber
            );
          });

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
        }

        childNode.totalValue += value;

        // If this is the leaf frame, add to selfValue
        if (i === stacktrace.length - 1) {
          childNode.selfValue += value;
        }

        currentNode = childNode;
      }
    }

    return root;
  }

  /**
   * Return the top functions aggregated across samples, sorted by the
   * requested metric (selfValue, totalValue, or sampleCount).
   */
  @CaptureSpan()
  public static async getFunctionList(
    request: FunctionListRequest,
  ): Promise<Array<FunctionListItem>> {
    const statement: Statement =
      ProfileAggregationService.buildFunctionListQuery(request);

    const dbResult: Results =
      await ProfileSampleDatabaseService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    // Aggregate per-function stats in-memory from the raw samples
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
      const value: number = Number(row["value"] || 0);

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
        const isLeaf: boolean = i === stacktrace.length - 1;

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

        // totalValue: count the value once per unique function per sample
        if (!seenInThisSample.has(key)) {
          entry.totalValue += value;
          entry.sampleCount += 1;
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

    return items.slice(0, limit);
  }

  /**
   * Build a diff flamegraph comparing two time ranges.
   * Returns a tree where each node has baseline/comparison values and deltas.
   */
  @CaptureSpan()
  public static async getDiffFlamegraph(
    request: DiffFlamegraphRequest,
  ): Promise<DiffFlamegraphNode> {
    const baselineTree: ProfileFlamegraphNode =
      await ProfileAggregationService.getFlamegraph({
        projectId: request.projectId,
        startTime: request.baselineStartTime,
        endTime: request.baselineEndTime,
        serviceIds: request.serviceIds,
        profileType: request.profileType,
      });

    const comparisonTree: ProfileFlamegraphNode =
      await ProfileAggregationService.getFlamegraph({
        projectId: request.projectId,
        startTime: request.comparisonStartTime,
        endTime: request.comparisonEndTime,
        serviceIds: request.serviceIds,
        profileType: request.profileType,
      });

    return ProfileAggregationService.mergeDiffTrees(
      baselineTree,
      comparisonTree,
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

  // --- Query builders ---

  private static buildFlamegraphQuery(request: FlamegraphRequest): Statement {
    const statement: Statement = SQL`
      SELECT
        stacktrace,
        frameTypes,
        value
      FROM ${ProfileAggregationService.TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
    `;

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

    ProfileAggregationService.appendCommonFilters(statement, request);

    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: ProfileAggregationService.MAX_SAMPLE_FETCH,
      }}`,
    );

    return statement;
  }

  private static buildFunctionListQuery(
    request: FunctionListRequest,
  ): Statement {
    const statement: Statement = SQL`
      SELECT
        stacktrace,
        frameTypes,
        value
      FROM ${ProfileAggregationService.TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
        AND time >= ${{
          type: TableColumnType.Date,
          value: request.startTime,
        }}
        AND time <= ${{
          type: TableColumnType.Date,
          value: request.endTime,
        }}
    `;

    ProfileAggregationService.appendCommonFilters(statement, request);

    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: ProfileAggregationService.MAX_SAMPLE_FETCH,
      }}`,
    );

    return statement;
  }

  private static appendCommonFilters(
    statement: Statement,
    request: Pick<FlamegraphRequest, "serviceIds" | "profileType">,
  ): void {
    if (request.serviceIds && request.serviceIds.length > 0) {
      statement.append(
        SQL` AND serviceId IN (${{
          type: TableColumnType.ObjectID,
          value: new Includes(
            request.serviceIds.map((id: ObjectID) => {
              return id.toString();
            }),
          ),
        }})`,
      );
    }

    if (request.profileType) {
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
