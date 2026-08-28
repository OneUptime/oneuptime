import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetrySourceMap";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SourceMapResolver, {
  MAX_SOURCE_MAP_SIZE_IN_BYTES,
  SourceMapBundle,
} from "../Utils/Telemetry/SourceMapResolver";
import {
  MinifiedStackFrame,
  ResolvedStackFrame,
  ResolveStackTraceResult,
} from "../../Types/Telemetry/SourceMap";

export { MAX_SOURCE_MAP_SIZE_IN_BYTES };

/*
 * How long uploaded maps are kept. Old releases age out automatically —
 * a map is only useful while exceptions from its release are still within
 * telemetry retention, and 90 days comfortably exceeds the default.
 */
export const SOURCE_MAP_RETENTION_DAYS: number = 90;

/*
 * How many maps one (service, release) pair may hold. Enforced by the
 * upload endpoint (existing bundles + new bundles must fit) and used as
 * the resolver's read limit, so nothing stored is ever silently ignored.
 * A build rarely emits more than a few dozen chunks with maps.
 */
export const MAX_SOURCE_MAPS_PER_RELEASE: number = 100;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    /*
     * Age-based retention: the HardDelete:HardDeleteOlderItemsInDatabase
     * worker sweeps this daily (not gated on billing, so self-hosted
     * deployments get cleanup too).
     */
    this.hardDeleteItemsOlderThanInDays("createdAt", SOURCE_MAP_RETENTION_DAYS);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const content: string | undefined = createBy.data.content;

    if (!content) {
      throw new BadDataException("Source map content is required.");
    }

    if (Buffer.byteLength(content, "utf8") > MAX_SOURCE_MAP_SIZE_IN_BYTES) {
      throw new BadDataException(
        `Source map is too large. The maximum size is ${
          MAX_SOURCE_MAP_SIZE_IN_BYTES / (1024 * 1024)
        } MB.`,
      );
    }

    SourceMapResolver.validateSourceMapContent(content);

    if (!createBy.data.bundlePath || !createBy.data.bundlePath.trim()) {
      throw new BadDataException("Bundle path is required.");
    }

    if (!createBy.data.serviceVersion || !createBy.data.serviceVersion.trim()) {
      throw new BadDataException("Service version is required.");
    }

    createBy.data.sizeInBytes = Buffer.byteLength(content, "utf8");

    return { createBy, carryForward: null };
  }

  /**
   * Bundle paths currently stored for a (project, service, release) tuple.
   * Used by the upload endpoint to enforce the per-release ceiling without
   * pulling map content.
   */
  @CaptureSpan()
  public async getStoredBundlePathsForRelease(data: {
    projectId: ObjectID;
    serviceId: ObjectID;
    serviceVersion: string;
  }): Promise<Array<string>> {
    const rows: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        serviceId: data.serviceId,
        serviceVersion: data.serviceVersion,
      },
      select: {
        _id: true,
        bundlePath: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return rows
      .map((row: Model) => {
        return row.bundlePath || "";
      })
      .filter((bundlePath: string) => {
        return bundlePath.length > 0;
      });
  }

  /**
   * Store a source map for (project, service, release, bundle), replacing
   * any previous upload for the same bundle so CI re-runs converge on one
   * row. Used by the authenticated upload endpoint, hence isRoot.
   */
  @CaptureSpan()
  public async replaceSourceMap(data: {
    projectId: ObjectID;
    serviceId: ObjectID;
    serviceVersion: string;
    bundlePath: string;
    content: string;
  }): Promise<Model> {
    /*
     * Hard delete (not soft): a replaced map has no restore story, and
     * soft-deleted rows would hold megabytes until a billing-gated sweep
     * that self-hosted deployments never run.
     */
    await this.hardDeleteBy({
      query: {
        projectId: data.projectId,
        serviceId: data.serviceId,
        serviceVersion: data.serviceVersion,
        bundlePath: data.bundlePath,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const sourceMap: Model = new Model();
    sourceMap.projectId = data.projectId;
    sourceMap.serviceId = data.serviceId;
    sourceMap.serviceVersion = data.serviceVersion;
    sourceMap.bundlePath = data.bundlePath;
    sourceMap.content = data.content;

    return this.create({
      data: sourceMap,
      props: {
        isRoot: true,
      },
    });
  }

  /**
   * Resolve parsed exception stack frames for a service + release against
   * the maps uploaded for that pair. Reads with isRoot — callers must have
   * already authorized the (projectId, serviceId) pair.
   */
  @CaptureSpan()
  public async resolveFramesForService(data: {
    projectId: ObjectID;
    serviceId: ObjectID;
    serviceVersion: string;
    frames: Array<MinifiedStackFrame>;
  }): Promise<ResolveStackTraceResult> {
    if (!data.serviceVersion || data.frames.length === 0) {
      return {
        frames: data.frames.map((frame: MinifiedStackFrame) => {
          return { ...frame, resolved: false };
        }),
        resolvedCount: 0,
        sourceMapCount: 0,
      };
    }

    /*
     * Two-step fetch: list bundle paths first (cheap), then pull content
     * only for bundles that at least one frame can match. Maps can be tens
     * of megabytes each and a release may store up to
     * MAX_SOURCE_MAPS_PER_RELEASE of them — loading them all for every
     * exception view would be a memory hazard for no benefit.
     */
    const sourceMapRows: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        serviceId: data.serviceId,
        serviceVersion: data.serviceVersion,
      },
      select: {
        _id: true,
        bundlePath: true,
        createdAt: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: MAX_SOURCE_MAPS_PER_RELEASE,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    /*
     * Newest-first sort + first-wins dedupe: if a racing double upload left
     * two rows for one bundle, the newer one is used.
     */
    const dedupedRows: Array<Model> = [];
    const seenBundlePaths: Set<string> = new Set();

    for (const row of sourceMapRows) {
      if (!row.bundlePath) {
        continue;
      }

      const normalizedPath: string = SourceMapResolver.normalizePath(
        row.bundlePath,
      );

      if (seenBundlePaths.has(normalizedPath)) {
        continue;
      }

      seenBundlePaths.add(normalizedPath);
      dedupedRows.push(row);
    }

    const matchedRows: Array<Model> = dedupedRows.filter((row: Model) => {
      return data.frames.some((frame: MinifiedStackFrame) => {
        return (
          SourceMapResolver.getMatchScore(
            frame.fileName,
            row.bundlePath || "",
          ) > 0
        );
      });
    });

    const bundles: Array<SourceMapBundle> = [];

    if (matchedRows.length > 0) {
      const contentRows: Array<Model> = await this.findBy({
        query: {
          /*
           * Tenant scoping repeated here even though ids are already
           * tenant-scoped — defense in depth for a root query.
           */
          projectId: data.projectId,
          _id: QueryHelper.any(
            matchedRows.map((row: Model) => {
              return new ObjectID(row.id!.toString());
            }),
          ),
        },
        select: {
          _id: true,
          bundlePath: true,
          content: true,
        },
        limit: MAX_SOURCE_MAPS_PER_RELEASE,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const row of contentRows) {
        if (row.bundlePath && row.content) {
          bundles.push({
            bundlePath: row.bundlePath,
            content: row.content,
          });
        }
      }
    }

    const resolvedFrames: Array<ResolvedStackFrame> =
      SourceMapResolver.resolveFrames(data.frames, bundles);

    return {
      frames: resolvedFrames,
      resolvedCount: resolvedFrames.filter((frame: ResolvedStackFrame) => {
        return frame.resolved;
      }).length,
      /*
       * Stored (deduped) maps for the release — not just the ones a frame
       * matched — so "maps exist but none matched your bundles" is
       * distinguishable from "no maps uploaded".
       */
      sourceMapCount: dedupedRows.length,
    };
  }
}

export default new Service();
