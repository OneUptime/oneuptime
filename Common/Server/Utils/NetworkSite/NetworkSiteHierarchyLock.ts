import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import logger from "../../Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ServerException from "../../../Types/Exception/ServerException";
import ObjectID from "../../../Types/ObjectID";

export const NETWORK_SITE_HIERARCHY_LOCK_NAMESPACE: string =
  "NetworkSiteHierarchy";

export const NETWORK_SITE_HIERARCHY_LOCK_ERROR_MESSAGE: string =
  "Could not acquire the Network Site hierarchy lock. Please try again.";

export const NETWORK_SITE_HIERARCHY_ROOT_SCOPE_ERROR_MESSAGE: string =
  "Root Network Site hierarchy mutations must be scoped to a project or a closed set of row IDs.";

const LOCK_TIMEOUT_IN_MILLISECONDS: number = 30_000;
const ACQUIRE_TIMEOUT_IN_MILLISECONDS: number = 15_000;
const RETRY_INTERVAL_IN_MILLISECONDS: number = 100;

interface AcquiredMutex {
  projectId: string;
  mutex: SemaphoreMutex;
}

/*
 * NetworkSite and NetworkSiteType jointly define one invariant: concrete
 * parent-site edges must agree with the configured parent-type graph. Their
 * service hooks validate that invariant before DatabaseService persists the
 * write, so two concurrent requests must not validate the same old snapshot.
 *
 * This distributed, project-keyed critical section is intentionally owned by
 * the public service methods rather than a before hook. DatabaseService can
 * still fail after a before hook returns; a redis-semaphore mutex acquired in
 * the hook would then never reach a success hook and would keep refreshing
 * forever. runExclusive's finally releases every mutex on every write path.
 */
export default class NetworkSiteHierarchyLock {
  public static getExplicitProjectIds(
    query: Record<string, unknown>,
  ): Array<ObjectID | string> {
    for (const key of ["projectId", "project"]) {
      const value: unknown = query[key];

      if (this.isExactId(value)) {
        return [value];
      }
    }

    return [];
  }

  /*
   * Resolving an arbitrary root query and locking the projects it happens to
   * match is not safe: another create can enter that query's limit/skip window
   * before DatabaseService executes it. A permission-enforced tenant scope,
   * a literal project scope, and explicit ID sets are closed; no new row can
   * silently introduce an unlocked project.
   */
  public static assertSafeRootMutationScope(data: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
    tenantScopeIsClosed?: boolean;
  }): void {
    if (this.isSafeRootMutationScope(data)) {
      return;
    }

    throw new BadDataException(NETWORK_SITE_HIERARCHY_ROOT_SCOPE_ERROR_MESSAGE);
  }

  public static isSafeRootMutationScope(data: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
    tenantScopeIsClosed?: boolean;
  }): boolean {
    if (!data.props.isRoot && !data.props.isMasterAdmin) {
      return true;
    }

    /*
     * DeletePermission retains an explicit tenantId even for a root caller,
     * so it is a closed project scope for deletes. UpdatePermission does not:
     * a root update keeps the caller's raw query. Callers must opt in only
     * when their permission path actually applies the tenant predicate.
     */
    if (
      data.tenantScopeIsClosed &&
      data.props.tenantId &&
      !data.props.isMultiTenantRequest
    ) {
      return true;
    }

    const hasExactProjectScope: boolean = ["projectId", "project"].some(
      (key: string): boolean => {
        return this.isExactId(data.query[key]);
      },
    );
    const hasExplicitRowIdScope: boolean = this.isExplicitIdSet(
      data.query["_id"],
    );

    if (hasExactProjectScope || hasExplicitRowIdScope) {
      return true;
    }

    return false;
  }

  /*
   * QueryHelper predicates are TypeORM FindOperator objects. Even when one
   * happens to be backed by a fixed value today, accepting an arbitrary raw
   * predicate here would let a later row enter the pre-read/write window in
   * a project for which no mutex was acquired. Only literal UUIDs are a
   * stable project scope; literal row-ID arrays are a stable closed set.
   */
  private static isExactId(value: unknown): value is ObjectID | string {
    if (value instanceof ObjectID) {
      return ObjectID.isValidUUID(value.toString());
    }

    return typeof value === "string" && ObjectID.isValidUUID(value.trim());
  }

  private static isExplicitIdSet(value: unknown): boolean {
    if (this.isExactId(value)) {
      return true;
    }

    return (
      Array.isArray(value) &&
      value.every((candidate: unknown): boolean => {
        return this.isExactId(candidate);
      })
    );
  }

  public static async runExclusive<TResult>(data: {
    projectIds: Array<ObjectID | string>;
    operation: () => Promise<TResult>;
  }): Promise<TResult> {
    const projectIds: Array<string> = [
      ...new Set<string>(
        data.projectIds
          .map((projectId: ObjectID | string): string => {
            return projectId.toString().trim().toLowerCase();
          })
          .filter((projectId: string): boolean => {
            return Boolean(projectId);
          }),
      ),
    ].sort((left: string, right: string): number => {
      return left.localeCompare(right);
    });

    /*
     * A mutation that matched no rows has no project whose hierarchy it can
     * change. Let DatabaseService preserve its normal zero-row/permission
     * semantics without taking an unrelated global lock.
     */
    if (projectIds.length === 0) {
      return await data.operation();
    }

    const acquiredMutexes: Array<AcquiredMutex> = [];

    try {
      for (const projectId of projectIds) {
        const mutex: SemaphoreMutex = await Semaphore.lock({
          key: projectId,
          namespace: NETWORK_SITE_HIERARCHY_LOCK_NAMESPACE,
          lockTimeout: LOCK_TIMEOUT_IN_MILLISECONDS,
          acquireTimeout: ACQUIRE_TIMEOUT_IN_MILLISECONDS,
          retryInterval: RETRY_INTERVAL_IN_MILLISECONDS,
        });

        acquiredMutexes.push({ projectId, mutex });
      }
    } catch (error) {
      await this.releaseAll(acquiredMutexes);
      logger.error(error);
      throw new ServerException(NETWORK_SITE_HIERARCHY_LOCK_ERROR_MESSAGE);
    }

    try {
      return await data.operation();
    } finally {
      await this.releaseAll(acquiredMutexes);
    }
  }

  /*
   * Release in reverse acquisition order. This mirrors ordinary lock-stack
   * discipline and, together with sorted acquisition, prevents bulk writes
   * spanning the same projects from deadlocking each other.
   *
   * Semaphore.release stops the mutex refresh timer before talking to Redis.
   * A Redis failure is therefore logged but must not replace the mutation's
   * real result/error; the lock key will expire at lockTimeout.
   */
  private static async releaseAll(
    acquiredMutexes: Array<AcquiredMutex>,
  ): Promise<void> {
    for (const acquired of [...acquiredMutexes].reverse()) {
      try {
        await Semaphore.release(acquired.mutex);
      } catch (error) {
        logger.error(error, { projectId: acquired.projectId });
      }
    }
  }
}
