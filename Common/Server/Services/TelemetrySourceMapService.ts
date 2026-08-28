import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetrySourceMap";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SourceMapResolver, {
  SourceMapBundle,
} from "../Utils/Telemetry/SourceMapResolver";
import {
  MinifiedStackFrame,
  ResolvedStackFrame,
  ResolveStackTraceResult,
} from "../../Types/Telemetry/SourceMap";

/*
 * Hard ceiling on one stored map. Matches MAX_MULTIPART_FILE_BYTES on the
 * upload path, and protects the CRUD create path the same way.
 */
export const MAX_SOURCE_MAP_SIZE_IN_BYTES: number = 50 * 1024 * 1024;

/*
 * How long uploaded maps are kept. Old releases age out automatically —
 * a map is only useful while exceptions from its release are still within
 * telemetry retention, and 90 days comfortably exceeds the default.
 */
export const SOURCE_MAP_RETENTION_DAYS: number = 90;

/*
 * How many maps one (service, release) pair may hold / how many the
 * resolver will load for one resolution pass. A build rarely emits more
 * than a few dozen chunks with maps.
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

    Service.validateSourceMapContent(content);

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
   * Throws BadDataException unless content parses as a source map v3
   * (JSON object with version 3 and a string mappings field).
   */
  public static validateSourceMapContent(content: string): void {
    let json: {
      version?: unknown;
      mappings?: unknown;
      sections?: unknown;
    };

    try {
      json = JSON.parse(content);
    } catch {
      throw new BadDataException("Source map is not valid JSON.");
    }

    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new BadDataException("Source map must be a JSON object.");
    }

    if (json.version !== 3) {
      throw new BadDataException(
        "Source map must be version 3 (the version field must be the number 3).",
      );
    }

    // Indexed maps carry sections instead of a top-level mappings string.
    if (typeof json.mappings !== "string" && !Array.isArray(json.sections)) {
      throw new BadDataException(
        "Source map must have a mappings string or a sections array.",
      );
    }
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

    const sourceMaps: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        serviceId: data.serviceId,
        serviceVersion: data.serviceVersion,
      },
      select: {
        _id: true,
        bundlePath: true,
        content: true,
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
    const bundles: Array<SourceMapBundle> = [];
    const seenBundlePaths: Set<string> = new Set();

    for (const sourceMap of sourceMaps) {
      if (!sourceMap.bundlePath || !sourceMap.content) {
        continue;
      }

      const normalizedPath: string = SourceMapResolver.normalizePath(
        sourceMap.bundlePath,
      );

      if (seenBundlePaths.has(normalizedPath)) {
        continue;
      }

      seenBundlePaths.add(normalizedPath);
      bundles.push({
        bundlePath: sourceMap.bundlePath,
        content: sourceMap.content,
      });
    }

    const resolvedFrames: Array<ResolvedStackFrame> =
      SourceMapResolver.resolveFrames(data.frames, bundles);

    return {
      frames: resolvedFrames,
      resolvedCount: resolvedFrames.filter((frame: ResolvedStackFrame) => {
        return frame.resolved;
      }).length,
      sourceMapCount: bundles.length,
    };
  }
}

export default new Service();
