import type { ExpressRouter } from "../Utils/Express";
import type {
  EnterpriseLicenseSnapshot,
  SeatUsage,
} from "./EnterpriseLicenseSnapshot";
import type BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import type DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import type { JSONObject } from "../../Types/JSON";
import type ObjectID from "../../Types/ObjectID";

/*
 * The contract between core (Apache-2.0, everything outside ee/) and the
 * enterprise module in ee/ (OneUptime Enterprise License).
 *
 * Core never imports ee. The App loader (packages/App/Utils/EnterpriseLoader.ts)
 * finds ee/Server/Index.ts at boot, requires it, checks it against this
 * interface and registers it with EnterpriseEdition. Everything in core that
 * behaves differently per edition asks EnterpriseEdition, never ee directly.
 */

export type EnterpriseServerModuleName = "oneuptime-enterprise";

export const ENTERPRISE_SERVER_MODULE_NAME: EnterpriseServerModuleName =
  "oneuptime-enterprise";

/*
 * The recording half of the audit log. Core's AuditLogService keeps these four
 * public methods as thin delegates, so DatabaseService, ProjectService and the
 * user-notification services call exactly what they call today; on the
 * Community Edition there is no recorder and nothing is recorded.
 *
 * The signatures mirror AuditLogService's public methods one for one.
 */
export interface AuditLogRecorder {
  recordCreate<TModel extends BaseModel>(data: {
    model: TModel;
    createdItem: TModel;
    props: DatabaseCommonInteractionProps;
  }): Promise<void>;

  recordUpdate<TModel extends BaseModel>(data: {
    model: TModel;
    before: TModel;
    updatedFields: JSONObject;
    itemId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void>;

  recordDelete<TModel extends BaseModel>(data: {
    model: TModel;
    deletedItem: TModel;
    itemId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void>;

  invalidateProjectSettings(projectId: ObjectID): void;
}

export interface EnterpriseLicensingProvider {
  /*
   * Recomputes the snapshot from the cached inputs (token + stored columns)
   * and the current time, so expiry and grace boundaries are exact. A failed
   * refresh keeps the last good inputs; it never drops to "missing".
   */
  getSnapshot(): Promise<EnterpriseLicenseSnapshot>;

  /*
   * The synchronous twin for synchronous permission checks. Null until the
   * first load finished; callers treat null as "not licensed" (fail closed).
   */
  getCachedSnapshot(): EnterpriseLicenseSnapshot | null;

  refresh(): Promise<void>;

  // Drops this process's cached inputs; the next read reloads them.
  invalidate(): void;

  getSeatUsage(): Promise<SeatUsage | null>;

  /*
   * Throws when adding one more user would exceed the license's seat limit.
   * A no-op when billing is enabled or the license is not valid/grace.
   */
  assertSeatAvailableForNewUser(): Promise<void>;
}

export default interface EnterpriseServerModule {
  name: typeof ENTERPRISE_SERVER_MODULE_NAME;
  version: string;

  /*
   * Bounded by the loader with a timeout. Must not throw on a database blip,
   * and must not make network calls the boot has to wait for.
   */
  init(): Promise<void>;

  licensing: EnterpriseLicensingProvider;

  /*
   * Mounted at ["/api/identity", "/"] right after core's identity routers.
   * RULE for every router below: no layer without a route (no router.use), because
   * a path-less middleware in a router mounted at "/" or ahead of a core router
   * runs for requests meant for core routes.
   */
  getIdentityRouters(): Array<ExpressRouter>;

  // Mounted at "/api".
  getApiRouters(): Array<ExpressRouter>;

  // Mounted at "/api/admin/health" BEFORE core's AdminHealth router.
  getAdminHealthRouter(): ExpressRouter | null;

  // Requires the ee cron modules (RunCron registers at import time).
  registerWorkerJobs(): Promise<void>;

  getAuditLogRecorder(): AuditLogRecorder | null;
}

const REQUIRED_MODULE_FUNCTIONS: ReadonlyArray<string> = [
  "init",
  "getIdentityRouters",
  "getApiRouters",
  "getAdminHealthRouter",
  "registerWorkerJobs",
  "getAuditLogRecorder",
];

const REQUIRED_LICENSING_FUNCTIONS: ReadonlyArray<string> = [
  "getSnapshot",
  "getCachedSnapshot",
  "refresh",
  "invalidate",
  "getSeatUsage",
  "assertSeatAvailableForNewUser",
];

type LooseRecord = Record<string, unknown>;

const isRecord: (value: unknown) => value is LooseRecord = (
  value: unknown,
): value is LooseRecord => {
  return typeof value === "object" && value !== null;
};

export class EnterpriseServerModuleShape {
  /*
   * Every way `candidate` falls short of EnterpriseServerModule, as readable
   * sentences. Empty means the shape is right. Used by the loader (a wrong
   * shape is a broken build: fail fast) and by ee's own shape test.
   */
  public static findProblems(candidate: unknown): Array<string> {
    const problems: Array<string> = [];

    if (!isRecord(candidate)) {
      problems.push(
        `the module must export an object, but it exported ${candidate === null ? "null" : typeof candidate}`,
      );
      return problems;
    }

    if (candidate["name"] !== ENTERPRISE_SERVER_MODULE_NAME) {
      problems.push(
        `"name" must be "${ENTERPRISE_SERVER_MODULE_NAME}", but it is ${JSON.stringify(candidate["name"]) ?? "undefined"}`,
      );
    }

    if (
      typeof candidate["version"] !== "string" ||
      candidate["version"].trim().length === 0
    ) {
      problems.push(`"version" must be a non-empty string`);
    }

    for (const functionName of REQUIRED_MODULE_FUNCTIONS) {
      if (typeof candidate[functionName] !== "function") {
        problems.push(`"${functionName}" must be a function`);
      }
    }

    const licensing: unknown = candidate["licensing"];

    if (!isRecord(licensing)) {
      problems.push(`"licensing" must be an object`);
      return problems;
    }

    for (const functionName of REQUIRED_LICENSING_FUNCTIONS) {
      if (typeof licensing[functionName] !== "function") {
        problems.push(`"licensing.${functionName}" must be a function`);
      }
    }

    return problems;
  }

  /*
   * The router-contract check: describes every layer of `router` that is not a
   * route (a router.use middleware or sub-router). Empty means the router
   * cannot shadow a core route.
   */
  public static findLayersWithoutRoute(router: ExpressRouter): Array<string> {
    const stack: unknown = (router as unknown as LooseRecord)["stack"];

    if (!Array.isArray(stack)) {
      return ["the router has no layer stack (is it an express Router?)"];
    }

    const problems: Array<string> = [];

    stack.forEach((layer: unknown, index: number): void => {
      if (isRecord(layer) && layer["route"]) {
        return;
      }

      const name: string =
        isRecord(layer) && typeof layer["name"] === "string"
          ? layer["name"]
          : "<unknown>";
      const pattern: string =
        isRecord(layer) && layer["regexp"] instanceof RegExp
          ? layer["regexp"].toString()
          : "<no pattern>";

      problems.push(
        `layer ${index} ("${name}", ${pattern}) is a router.use() layer, not a route`,
      );
    });

    return problems;
  }
}
