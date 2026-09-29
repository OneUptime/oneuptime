import EnterprisePlugins from "@oneuptime/ee-admin-dashboard";
import { AdminDashboardEnterprisePlugins } from "./EnterprisePlugins";

/*
 * The ONLY core file allowed to import the Enterprise admin UI (eslint's
 * no-restricted-imports and App/Tests/EnterpriseImportGuard.test.ts both
 * enforce it). "@oneuptime/ee-admin-dashboard" is the Community stub
 * (./CommunityPlugins.ts) unless the Enterprise image build aliases it to
 * ee/AdminDashboard/Index.tsx - see Common/UI/esbuild-enterprise.js.
 *
 * Call getAdminDashboardPlugins() ONLY inside a render or another function
 * body, never while a module is loading: not in a module-scope const, not in
 * a static class field, not in a top-level statement.
 * App/Tests/EnterpriseImportGuard.test.ts fails on any such call.
 *
 * In the Enterprise build the import graph has a cycle: a core shell imports
 * this file, this file imports the ee plugin, and ee code imports core modules
 * back through "@oneuptime/admin-dashboard/...". Whichever module the bundle
 * evaluates first sees the others half-initialised, so a top-level read gets
 * `undefined` and the whole Enterprise bundle fails to load - while the
 * Community build, which has no cycle, stays green. By the time anything
 * renders, every module has finished evaluating, so a read inside a function
 * is always safe.
 */
export const getAdminDashboardPlugins: () => AdminDashboardEnterprisePlugins =
  (): AdminDashboardEnterprisePlugins => {
    const plugins: AdminDashboardEnterprisePlugins | undefined =
      EnterprisePlugins as AdminDashboardEnterprisePlugins | undefined;

    if (!plugins) {
      throw new Error(
        "getAdminDashboardPlugins() ran before the Enterprise plugin module finished loading. Call it inside a render or function body, never at module top level.",
      );
    }

    return plugins;
  };
