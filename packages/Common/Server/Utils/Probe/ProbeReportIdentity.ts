import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * WHAT A PROBE REPORTS IS ITS OWN.
 *
 * A probe authenticates every request with its id and key (ProbeAuthorization,
 * in the App's probe ingest), and from then on the request is that probe's:
 * a check result it sends is recorded as its own, under its own row of a
 * monitor it checks (MonitorProbe), and a monitor test's result only on a
 * test that was handed to it. Every probe repeats its own id inside each
 * result it sends, and that id is only ever read against the probe that
 * sent it: a result that names another probe is refused, and one that names
 * none is the sending probe's.
 *
 * Asked in three places, all through here: by the probe ingest routes before
 * a result is queued (so the probe is told), by the queue worker when it runs
 * the job (which also holds jobs queued before the routes asked), and by
 * MonitorResource for a result it is told a probe reported.
 */

export const PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE: string =
  "A probe can only report its own results. This result names a different probe.";

export const REPORTING_PROBE_NOT_KNOWN_MESSAGE: string =
  "This probe result does not say which probe sent it.";

// How a result names the probe it is from.
export type NamedProbe =
  | { kind: "none" }
  | { kind: "probe"; probeId: string }
  // Something is there, but no id can be read from it.
  | { kind: "unreadable" };

export default class ProbeReportIdentity {
  /*
   * How `value` names a probe: an ObjectID, a string, or an ObjectID as JSON
   * writes it ({ _type: "ObjectID", value }) - which is how a probe puts the
   * id on the wire. Ids are compared lower-cased, as Postgres compares uuids.
   */
  public static readNamedProbe(value: unknown): NamedProbe {
    if (value === undefined || value === null || value === "") {
      return { kind: "none" };
    }

    if (value instanceof ObjectID) {
      return ProbeReportIdentity.namedById(value.toString());
    }

    if (typeof value === "string") {
      return ProbeReportIdentity.namedById(value);
    }

    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as JSONObject)["_type"] === ObjectType.ObjectID &&
      typeof (value as JSONObject)["value"] === "string"
    ) {
      return ProbeReportIdentity.namedById(
        (value as JSONObject)["value"] as string,
      );
    }

    return { kind: "unreadable" };
  }

  // The probe a result (its own `probeId`) names.
  public static readProbeNamedByResult(result: unknown): NamedProbe {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return { kind: "none" };
    }

    return ProbeReportIdentity.readNamedProbe(
      (result as { probeId?: unknown }).probeId,
    );
  }

  /*
   * Whether `result` may be recorded as `senderProbeId`'s: it names that
   * probe, or no probe at all.
   */
  public static isResultOf(result: unknown, senderProbeId: ObjectID): boolean {
    const named: NamedProbe = ProbeReportIdentity.readProbeNamedByResult(result);

    if (named.kind === "none") {
      return true;
    }

    if (named.kind === "unreadable") {
      return false;
    }

    return named.probeId === ProbeReportIdentity.toKey(senderProbeId);
  }

  /*
   * Holds a result to the probe that sent it: refuses one that names another
   * probe, and writes the sender's id into the result, so everything
   * downstream - the MonitorProbe row it is stored under, probe agreement,
   * the stored test result - reads the sender and nobody else. Works on a
   * result as the probe put it on the wire and on a deserialized one alike:
   * an ObjectID is written back as JSON writes it.
   */
  public static bindResultToSender<TResult extends object>(
    result: TResult,
    senderProbeId: ObjectID,
  ): TResult {
    if (!ProbeReportIdentity.isResultOf(result, senderProbeId)) {
      throw new BadDataException(PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE);
    }

    (result as { probeId?: ObjectID }).probeId =
      ProbeReportIdentity.normalize(senderProbeId);

    return result;
  }

  /*
   * The probe that sent a queued job, as the probe ingest route wrote it
   * down: the probe that authenticated. A job that does not say is refused,
   * never guessed.
   */
  public static readSender(value: unknown): ObjectID {
    const named: NamedProbe = ProbeReportIdentity.readNamedProbe(value);

    if (named.kind !== "probe" || !ObjectID.isValidUUID(named.probeId)) {
      throw new BadDataException(REPORTING_PROBE_NOT_KNOWN_MESSAGE);
    }

    return new ObjectID(named.probeId);
  }

  // A probe id the way ids are compared and stored here: lower-cased.
  public static normalize(probeId: ObjectID): ObjectID {
    return new ObjectID(ProbeReportIdentity.toKey(probeId));
  }

  private static toKey(probeId: ObjectID): string {
    return probeId.toString().trim().toLowerCase();
  }

  private static namedById(id: string): NamedProbe {
    const probeId: string = id.trim().toLowerCase();

    if (!probeId) {
      return { kind: "none" };
    }

    return { kind: "probe", probeId: probeId };
  }
}
