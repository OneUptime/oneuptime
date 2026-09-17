import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetrySourceMap";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import PositiveNumber from "../../Types/PositiveNumber";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import SourceMapResolver, {
  MAX_FRAMES_TO_RESOLVE,
  MAX_SOURCE_MAP_SIZE_IN_BYTES,
  SourceMapBundle,
} from "../Utils/Telemetry/SourceMapResolver";
import {
  SourceMapMaxBytesPerResolve,
  SourceMapMaxMapsPerRelease,
  SourceMapRetentionInDays,
} from "../EnvironmentConfig";
import {
  MinifiedStackFrame,
  ResolvedStackFrame,
  ResolveStackTraceResult,
} from "../../Types/Telemetry/SourceMap";

export { MAX_SOURCE_MAP_SIZE_IN_BYTES };

/*
 * How long uploaded maps are kept. Old releases age out automatically —
 * a map is only useful while exceptions from its release are still within
 * telemetry retention, and the default comfortably exceeds it.
 * SOURCE_MAP_RETENTION_DAYS overrides it.
 */
export const SOURCE_MAP_RETENTION_DAYS: number = SourceMapRetentionInDays;

/*
 * How many distinct bundles one (service, release) pair may hold, from
 * SOURCE_MAP_MAX_MAPS_PER_RELEASE.
 *
 * This is a WRITE gate and nothing else: the upload endpoint checks that
 * existing bundles + new bundles fit, and rejects with a 400 naming the
 * limit. It used to double as the resolver's read limit, which coupled two
 * different quantities — distinct bundle paths on the write side, rows on
 * the read side — and made raising it dangerous. resolveFramesForService now
 * bounds itself by BYTES loaded (SourceMapMaxBytesPerResolve), so a release
 * that fits this ceiling always resolves in full.
 */
export const MAX_SOURCE_MAPS_PER_RELEASE: number = SourceMapMaxMapsPerRelease;

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

    await this.assertReleaseHasRoomFor(createBy);

    createBy.data.sizeInBytes = Buffer.byteLength(content, "utf8");

    return { createBy, carryForward: null };
  }

  /**
   * Enforce the per-release ceiling on the create path itself.
   *
   * The upload endpoint checks the whole batch up front, which is where the
   * useful error message lives — but TelemetrySourceMap is a full CRUD
   * resource, so POST /api/telemetry-source-map reaches create() without ever
   * passing that check. Without this the configured ceiling was advisory on
   * that path, and a release could quietly grow past what the operator set.
   *
   * Two steps, so the common case stays cheap: an indexed COUNT on every
   * insert, and the exact distinct-bundle answer only once that COUNT says
   * the release is at the boundary. A release is written once per CI run, and
   * on the upload path the batch check has already passed, so the second step
   * is effectively unreachable there.
   */
  @CaptureSpan()
  private async assertReleaseHasRoomFor(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId || undefined;
    const serviceId: ObjectID | undefined =
      createBy.data.serviceId || undefined;
    const serviceVersion: string | undefined = createBy.data.serviceVersion;

    /*
     * Not a silent pass: a create missing any of these cannot be scoped to a
     * release, and the tenant column / required-column checks reject it on
     * their own with a better message than a count could give.
     */
    if (!projectId || !serviceId || !serviceVersion) {
      return;
    }

    /*
     * Cheap check first, and it is the one that runs in practice: a COUNT of
     * ROWS on the (projectId, serviceId, serviceVersion) index. Below the
     * ceiling there is nothing to decide, whatever the rows contain.
     */
    const existingRowCount: PositiveNumber = await this.countBy({
      query: {
        projectId: projectId,
        serviceId: serviceId,
        serviceVersion: serviceVersion,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    if (existingRowCount.toNumber() < MAX_SOURCE_MAPS_PER_RELEASE) {
      return;
    }

    /*
     * At or above the ceiling on rows — but rows are not the unit the ceiling
     * is expressed in. The model deliberately allows more than one row per
     * bundle (a racing double upload must not fail CI), so rejecting on the
     * row count would fail a legitimate re-upload of a full release purely
     * because a duplicate row exists. Pay for the exact answer only here,
     * where the fast path has already established this is the boundary.
     */
    const storedBundlePaths: Array<string> =
      await this.getStoredBundlePathsForRelease({
        projectId: projectId,
        serviceId: serviceId,
        serviceVersion: serviceVersion,
      });

    const distinctBundlePaths: Set<string> = new Set(
      storedBundlePaths.map((bundlePath: string) => {
        return SourceMapResolver.normalizePath(bundlePath);
      }),
    );

    /*
     * Normalized, which makes this backstop slightly MORE permissive than the
     * upload endpoint's raw-path gate. That is the right direction for a
     * backstop: it must never be the thing that fails a request the primary
     * gate already approved.
     */
    const incomingBundlePath: string = SourceMapResolver.normalizePath(
      createBy.data.bundlePath || "",
    );

    /*
     * Adding a row for a bundle the release already holds does not grow the
     * release, so it stays allowed even at the ceiling. Only a NEW distinct
     * bundle is refused.
     */
    if (distinctBundlePaths.has(incomingBundlePath)) {
      return;
    }

    if (distinctBundlePaths.size >= MAX_SOURCE_MAPS_PER_RELEASE) {
      throw new BadDataException(
        `This release already holds ${distinctBundlePaths.size} source maps, which is the limit of ${MAX_SOURCE_MAPS_PER_RELEASE} per release. Delete unused maps, use a new serviceVersion, or raise SOURCE_MAP_MAX_MAPS_PER_RELEASE.`,
      );
    }
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
        sourceMapsSkippedForSize: 0,
      };
    }

    /*
     * Two-step fetch: list bundle paths first (cheap — no content), then pull
     * content only for the bundles a frame can match, and only as many of
     * those as the byte budget allows. Maps can be tens of megabytes each, so
     * loading a whole release for every exception view would be a memory
     * hazard for no benefit.
     *
     * The listing reads with LIMIT_MAX rather than the per-release ceiling.
     * The ceiling counts distinct bundle PATHS, while a read limit counts
     * ROWS, and duplicate rows for one bundle are deliberately allowed (see
     * the model: a racing double upload must not fail CI). With the two
     * numbers equal, one duplicate row was enough to push a distinct bundle
     * out of resolution — it stored fine, showed in the dashboard, and
     * silently never resolved. Reading everything and deduping afterwards
     * removes that coupling; memory is bounded below by bytes, not by how
     * many rows a content-free listing returns.
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
        sizeInBytes: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: LIMIT_MAX,
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

    /*
     * Only the frames resolveFrames will actually attempt can pull a map in.
     * Matching against every frame would let a caller-supplied array drive an
     * O(rows x frames) scan and select maps that could never be used anyway —
     * the frames array is parsed from client-supplied stack trace text, so it
     * is capped rather than trusted (the API rejects absurd lengths outright).
     */
    const framesForMatching: Array<MinifiedStackFrame> = data.frames.slice(
      0,
      MAX_FRAMES_TO_RESOLVE,
    );

    /*
     * Score every candidate against those frames. The score is how many
     * trailing path segments the frame and the bundle share, so a frame
     * "static/main.a8f1.js" prefers the bundle that agrees on "static/" over
     * one that only agrees on the file name. That ordering is what makes the
     * byte budget below defensible: when not everything fits, what gets
     * dropped is the weakest match, not an arbitrary row.
     */
    const scoredRows: Array<{
      row: Model;
      score: number;
      sizeInBytes: number;
    }> = [];

    for (const row of dedupedRows) {
      let bestScore: number = 0;

      for (const frame of framesForMatching) {
        const score: number = SourceMapResolver.getMatchScore(
          frame.fileName,
          row.bundlePath || "",
        );

        if (score > bestScore) {
          bestScore = score;
        }
      }

      if (bestScore > 0) {
        scoredRows.push({
          row: row,
          score: bestScore,
          /*
           * onBeforeCreate stamps sizeInBytes on every insert, so a missing
           * value means a row written straight to the database. Charge it the
           * per-map ceiling rather than nothing: an unknown size must not be
           * the way to slip past a budget meant to bound memory.
           */
          sizeInBytes:
            typeof row.sizeInBytes === "number" &&
            Number.isFinite(row.sizeInBytes) &&
            row.sizeInBytes > 0
              ? row.sizeInBytes
              : MAX_SOURCE_MAP_SIZE_IN_BYTES,
        });
      }
    }

    scoredRows.sort(
      (
        a: { row: Model; score: number; sizeInBytes: number },
        b: { row: Model; score: number; sizeInBytes: number },
      ) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }

        // Same match quality: prefer the newer upload, as the dedupe does.
        const aTime: number = a.row.createdAt
          ? new Date(a.row.createdAt).getTime()
          : 0;
        const bTime: number = b.row.createdAt
          ? new Date(b.row.createdAt).getTime()
          : 0;

        return bTime - aTime;
      },
    );

    /*
     * The byte budget. This is the bound that used to be implied by the
     * per-release count and is a far tighter one, because it measures the
     * thing that actually consumes memory. Lower-scoring maps that still fit
     * are kept (hence continue, not break) so a single oversized map does not
     * cost the rest of the stack trace its symbols.
     *
     * The best-scoring map is always attempted even if it alone exceeds the
     * budget: a budget configured below the per-map ceiling should degrade to
     * "one map at a time", not to "nothing ever resolves". Peak is therefore
     * max(SourceMapMaxBytesPerResolve, MAX_SOURCE_MAP_SIZE_IN_BYTES).
     */
    const matchedRows: Array<Model> = [];
    let budgetUsedInBytes: number = 0;
    let sourceMapsSkippedForSize: number = 0;

    for (const scored of scoredRows) {
      const wouldExceedBudget: boolean =
        budgetUsedInBytes + scored.sizeInBytes > SourceMapMaxBytesPerResolve;

      if (wouldExceedBudget && matchedRows.length > 0) {
        sourceMapsSkippedForSize++;
        continue;
      }

      budgetUsedInBytes += scored.sizeInBytes;
      matchedRows.push(scored.row);
    }

    if (sourceMapsSkippedForSize > 0) {
      logger.warn(
        `Source map resolution skipped ${sourceMapsSkippedForSize} matching map(s) for service ${data.serviceId.toString()} release ${data.serviceVersion}: loading them would exceed SOURCE_MAP_MAX_BYTES_PER_RESOLVE (${SourceMapMaxBytesPerResolve} bytes).`,
      );
    }

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
        limit: matchedRows.length,
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
      /*
       * Non-zero means symbols are missing because of the byte budget, not
       * because the maps were never uploaded — the one distinction a user
       * staring at a half-resolved stack trace cannot make for themselves.
       */
      sourceMapsSkippedForSize: sourceMapsSkippedForSize,
    };
  }
}

export default new Service();
