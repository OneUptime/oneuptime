import type { ExpressRouter } from "Common/Server/Utils/Express";

/*
 * What one area of the enterprise module contributes to the assembled module
 * in ee/Server/Index.ts. Every hook is optional, so each area implements only
 * what it has, and each area is owned and edited on its own.
 *
 * Router RULE (enforced by Tests/Server/ModuleShape.test.ts): a router may
 * hold routes only, no router.use() layers. The routers are mounted at "/" and
 * ahead of core routers; a path-less middleware in them would run for requests
 * meant for core routes.
 */
export default interface EnterpriseArea {
  name: string;

  // Runs once at boot, in ENTERPRISE_AREAS order. Must not throw on a DB blip.
  init?: (() => Promise<void>) | undefined;

  // Mounted at ["/api/identity", "/"] after core's identity routers.
  getIdentityRouters?: (() => Array<ExpressRouter>) | undefined;

  // Mounted at "/api".
  getApiRouters?: (() => Array<ExpressRouter>) | undefined;

  // Requires the area's cron modules (RunCron registers at import time).
  registerWorkerJobs?: (() => Promise<void>) | undefined;
}
