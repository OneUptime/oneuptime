import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/MetricType";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnDelete } from "../Types/Database/Hooks";
import ObjectID from "../../Types/ObjectID";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * How long a confirmed (projectId, metricName) shape is trusted without
 * re-reading Postgres. The catalog is effectively static in steady state —
 * a metric's description/unit/temporality only change when the emitting
 * instrumentation changes — so this can be generous.
 */
const FINGERPRINT_TTL_MS: number = 5 * 60 * 1000;

export class Service extends DatabaseService<Model> {
  /*
   * Maps `${projectId}:${metricName}` to the last shape we confirmed is
   * already persisted. TelemetryUtil.indexMetricNameServiceNameMap ran one
   * joined SELECT per distinct metric name on every OTLP batch — 100-500 for
   * a kubelet scrape, 9-29 per probe result — against a catalog that almost
   * never changes. A fingerprint hit skips the read entirely.
   *
   * Only invalidated on delete: an update is either ours (we re-mark it
   * immediately afterwards) or an out-of-band dashboard edit, which the next
   * diverging batch would overwrite anyway.
   */
  private fingerprintCache: InMemoryTTLCache<string> = new InMemoryTTLCache(
    50_000,
  );

  public constructor() {
    super(Model);
  }

  private getFingerprintCacheKey(
    projectId: ObjectID,
    metricName: string,
  ): string {
    return `${projectId.toString()}:${metricName}`;
  }

  /**
   * True when this exact shape has already been confirmed present in Postgres
   * and no MetricType has been deleted since.
   */
  public isShapeKnownCurrent(
    projectId: ObjectID,
    metricName: string,
    fingerprint: string,
  ): boolean {
    return (
      this.fingerprintCache.get(
        this.getFingerprintCacheKey(projectId, metricName),
      ) === fingerprint
    );
  }

  /**
   * Record that this shape is now persisted. Call only after the row has been
   * read or written, never before.
   */
  public markShapeCurrent(
    projectId: ObjectID,
    metricName: string,
    fingerprint: string,
  ): void {
    this.fingerprintCache.set(
      this.getFingerprintCacheKey(projectId, metricName),
      fingerprint,
      FINGERPRINT_TTL_MS,
    );
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * A deleted MetricType must be recreated by the next batch that sees it.
     * Without this the fingerprint would keep saying "already persisted" for
     * the remaining TTL and the row would silently stay missing. We don't know
     * which names are affected without an extra query; deletes are rare, so
     * clear the whole cache.
     */
    this.fingerprintCache.clear();
    return { deleteBy, carryForward: null };
  }
}

export default new Service();
