import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import ModelPermission from "../../Types/Database/Permissions/Index";
import Query from "../../Types/Database/Query";
import { CheckReadPermissionType } from "../../Types/Database/Permissions/ReadPermission";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { UserPermission } from "../../../Types/Permission";
import { createHash } from "crypto";

/*
 * THE NETWORK OVERVIEW AND THE SUMMARY STRIPS, KEPT FOR HALF A MINUTE.
 *
 * The Network Overview counts the whole fleet - a scan of every device of
 * the project - and makes a handful of bounded reads besides, and the
 * Devices and Sites pages each count the fleet again for their strips. On
 * an estate of 100,000 devices, every view of any of them read the fleet
 * once more, however often it had just been read; a few people with the
 * Overview open held a good part of the connection pool between them.
 *
 * Each process now keeps what it built for TTL_MS (30 seconds), per
 * project and per what the viewer may read (getViewerScope), and builds it
 * once for requests that arrive together: they share the one build. A
 * failed build is never kept; the next request builds again. A device that
 * goes down shows within the TTL - its own poll interval is minutes.
 *
 * Who may read is checked on every request, before anything is served: the
 * scope is worked out by the read-permission pipeline itself, which refuses
 * a caller who may not read these records at all. Two callers share an
 * entry only when that pipeline narrows neither's read of any of the
 * records the view counts - each reads the whole project, so each would be
 * shown the same numbers. A caller whose read it narrows (a grant limited
 * to labels, to owned records, a block) is kept apart: their own entry,
 * under their user (or API key) and their exact permissions, so a change to
 * those takes effect at once. A caller who is neither is not kept at all.
 */

export const NETWORK_SUMMARY_CACHE_TTL_MS: number = 30_000;

// The scope of a caller who reads every record of the project.
export const PROJECT_WIDE_SCOPE: string = "project";

export default class NetworkSummaryCache {
  public static readonly TTL_MS: number = NETWORK_SUMMARY_CACHE_TTL_MS;

  /*
   * What was built, by view, project and scope. An overview is a few
   * kilobytes and a fleet scan a few hundred buckets; entries last half a
   * minute, so this bounds a process that serves many projects at once.
   */
  private static built: InMemoryTTLCache<unknown> =
    new InMemoryTTLCache<unknown>(2_000);

  /*
   * Builds under way, by the same key: requests that miss together share
   * one build instead of each reading the database.
   */
  private static inFlight: Map<string, Promise<unknown>> = new Map();

  /*
   * The view kept for this project and scope, else the one being built for
   * it (shared), else one built now by `build` and kept for TTL_MS. A null
   * scope is not kept: built for this request alone. What it answers is
   * shared between requests and must not be changed.
   */
  public static async getOrBuild<T>(data: {
    // What is built: "overview", "fleet-scan", "site-summary".
    view: string;
    projectId: ObjectID;
    scope: string | null;
    build: () => Promise<T>;
  }): Promise<T> {
    if (data.scope === null) {
      return await data.build();
    }

    const key: string = NetworkSummaryCache.getKey({
      view: data.view,
      projectId: data.projectId,
      scope: data.scope,
    });

    const kept: unknown = NetworkSummaryCache.built.get(key);

    if (kept !== undefined) {
      return kept as T;
    }

    let building: Promise<unknown> | undefined =
      NetworkSummaryCache.inFlight.get(key);

    if (!building) {
      const thisBuild: Promise<T> = data.build();
      building = thisBuild;
      NetworkSummaryCache.inFlight.set(key, thisBuild);

      thisBuild
        .then((value: T) => {
          NetworkSummaryCache.built.set(key, value, NetworkSummaryCache.TTL_MS);
        })
        .catch(() => {
          // A failed build is never kept; the next request builds again.
        })
        .finally(() => {
          if (NetworkSummaryCache.inFlight.get(key) === thisBuild) {
            NetworkSummaryCache.inFlight.delete(key);
          }
        });
    }

    return (await building) as T;
  }

  public static getKey(data: {
    view: string;
    projectId: ObjectID;
    scope: string;
  }): string {
    return `${data.view}:${data.projectId.toString()}:${data.scope}`;
  }

  /*
   * What the caller may read of the records a view counts, as a cache
   * scope: PROJECT_WIDE_SCOPE when the read-permission pipeline narrows
   * none of their reads of these models in this project - the same records
   * as anyone else it does not narrow - else a scope of their own (their
   * user or API key, and a fingerprint of their permissions), else null
   * (not kept). Throws what the pipeline throws for a caller who may not
   * read one of them at all, before anything is served.
   */
  public static async getViewerScope(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    modelTypes: Array<{ new (): BaseModel }>;
  }): Promise<string | null> {
    let isProjectWide: boolean = true;

    for (const modelType of data.modelTypes) {
      const checked: CheckReadPermissionType<BaseModel> =
        await ModelPermission.checkReadQueryPermission(
          modelType,
          { projectId: data.projectId } as Query<BaseModel>,
          null,
          data.props,
        );

      if (!NetworkSummaryCache.isProjectWideRead(checked.query)) {
        isProjectWide = false;
      }
    }

    if (isProjectWide) {
      return PROJECT_WIDE_SCOPE;
    }

    const viewer: string | undefined =
      data.props.userId?.toString() || data.props.apiKeyId?.toString();

    if (!viewer) {
      return null;
    }

    return `viewer:${viewer}:${NetworkSummaryCache.getPermissionsFingerprint(
      data.props,
      data.projectId,
    )}`;
  }

  /*
   * Whether a read the permission pipeline narrowed is the project's whole
   * read: one condition, on the project, and nothing it added.
   */
  public static isProjectWideRead(query: unknown): boolean {
    if (!query || typeof query !== "object" || Array.isArray(query)) {
      return false;
    }

    const keys: Array<string> = Object.keys(query as Record<string, unknown>);

    return keys.length === 1 && keys[0] === "projectId";
  }

  /*
   * The caller's permissions in this project, as a short fingerprint: the
   * same permissions read the same records.
   */
  public static getPermissionsFingerprint(
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): string {
    const rows: Array<UserPermission> =
      (
        props.userTenantAccessPermission?.[projectId.toString()] as
          | { permissions?: Array<UserPermission> }
          | undefined
      )?.permissions || [];

    const canonical: Array<string> = rows
      .map((row: UserPermission): string => {
        return JSON.stringify([
          row.permission,
          row.scope || null,
          row.teamId?.toString() || null,
          Boolean(row.isBlockPermission),
          (row.labelIds || [])
            .map((labelId: ObjectID): string => {
              return labelId.toString();
            })
            .sort(),
        ]);
      })
      .sort();

    return createHash("sha256")
      .update(
        JSON.stringify({
          isRoot: Boolean(props.isRoot),
          isMasterAdmin: Boolean(props.isMasterAdmin),
          rows: canonical,
        }),
      )
      .digest("hex")
      .slice(0, 32);
  }

  // Forgets everything kept and every build under way (tests).
  public static clear(): void {
    NetworkSummaryCache.built.clear();
    NetworkSummaryCache.inFlight.clear();
  }
}
