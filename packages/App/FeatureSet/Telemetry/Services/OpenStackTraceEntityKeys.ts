import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_CLOUD_SPAN_ATTRIBUTE,
  OpenStackTraceResource,
  readOpenStackSpanResources,
} from "Common/Utils/OpenStack/OpenStackTraces";
import { keyForOpenStackResource } from "Common/Utils/Telemetry/EntityKey";

/*
 * The per-ROW half of how a part of an OpenStack cloud finds its traces: a span from
 * OSProfiler's driver whose request names an instance, a volume or a network gets that
 * part's key appended to its own `entityKeys`, so the part's page finds it with the same
 * `hasAny(entityKeys, keys)` predicate every other product uses, without scanning every
 * span's attributes.
 *
 * The rules of DatabaseCallEntityKeys keep this safe on the ingest hot path: it reads the
 * FINAL row, so what a scrub rule took out is no identity, and it never mutates the row's
 * array, which is shared with its sibling rows. The caller only hands it the driver's spans,
 * so it costs nothing for anyone else's.
 *
 * Nothing is looked up. An id that is no part of the cloud gets a key nobody ever asks for,
 * which is why a device_id that turns out to be a router's costs nothing. A span from a
 * machine whose collector stamps no cloud has nothing to join to, and gets no key.
 */

// Bound on one request's memo; past it, keys are worked out without memoizing.
const MAX_MEMO_ENTRIES: number = 10_000;

export default class OpenStackTraceEntityKeyResolver {
  private readonly projectId: string;
  private readonly memo: Map<string, string> = new Map<string, string>();

  public constructor(projectId: ObjectID | string) {
    this.projectId = projectId.toString();
  }

  // Returns how many keys it added.
  public appendToSpanRow(row: JSONObject): number {
    const attributes: JSONObject | undefined = row["attributes"] as
      | JSONObject
      | undefined;
    const cloudName: unknown = attributes?.[OPENSTACK_CLOUD_SPAN_ATTRIBUTE];

    if (typeof cloudName !== "string" || !cloudName) {
      return 0;
    }

    const resources: Array<OpenStackTraceResource> =
      readOpenStackSpanResources(attributes);

    if (resources.length === 0) {
      return 0;
    }

    const existing: Array<string> = Array.isArray(row["entityKeys"])
      ? (row["entityKeys"] as Array<string>)
      : [];
    const added: Array<string> = [];

    for (const resource of resources) {
      const key: string = this.getKey(cloudName, resource);

      if (!existing.includes(key) && !added.includes(key)) {
        added.push(key);
      }
    }

    if (added.length > 0) {
      // A NEW array: `existing` is shared with sibling rows.
      row["entityKeys"] = [...existing, ...added];
    }

    return added.length;
  }

  private getKey(cloudName: string, resource: OpenStackTraceResource): string {
    const memoKey: string = JSON.stringify([
      cloudName,
      resource.kind,
      resource.id,
    ]);
    const known: string | undefined = this.memo.get(memoKey);

    if (known) {
      return known;
    }

    const key: string = keyForOpenStackResource(this.projectId, {
      cloudName: cloudName,
      kind: resource.kind,
      id: resource.id,
    });

    if (this.memo.size < MAX_MEMO_ENTRIES) {
      this.memo.set(memoKey, key);
    }

    return key;
  }
}
