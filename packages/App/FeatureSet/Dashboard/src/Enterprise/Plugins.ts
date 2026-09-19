import EnterprisePlugins from "@oneuptime/ee-dashboard";
import { DashboardEnterprisePlugins } from "./EnterprisePlugins";

/*
 * The ONLY core file allowed to import the Enterprise UI (eslint's
 * no-restricted-imports and App/Tests/EnterpriseImportGuard.test.ts both
 * enforce it). "@oneuptime/ee-dashboard" is the Community stub
 * (./CommunityPlugins.ts) unless the Enterprise image build aliases it to
 * ee/Dashboard/Index.tsx - see Common/UI/esbuild-enterprise.js.
 *
 * Call getDashboardPlugins() ONLY inside a render or another function body,
 * never while a module is loading: not in a module-scope const, not in a
 * static class field, not in a top-level statement.
 * App/Tests/EnterpriseImportGuard.test.ts fails on any such call.
 *
 * In the Enterprise build the import graph has a cycle: a core shell such as
 * Components/AuditLogs/AuditLogsTable imports this file, this file imports the
 * ee plugin, and ee code imports core modules back through
 * "@oneuptime/dashboard/...". Whichever module the bundle evaluates first sees
 * the others half-initialised, so a top-level read gets `undefined` and the
 * whole Enterprise bundle fails to load - while the Community build, which has
 * no cycle, stays green. By the time anything renders, every module has
 * finished evaluating, so a read inside a function is always safe.
 */
export const getDashboardPlugins: () => DashboardEnterprisePlugins =
  (): DashboardEnterprisePlugins => {
    const plugins: DashboardEnterprisePlugins | undefined =
      EnterprisePlugins as DashboardEnterprisePlugins | undefined;

    if (!plugins) {
      throw new Error(
        "getDashboardPlugins() ran before the Enterprise plugin module finished loading. Call it inside a render or function body, never at module top level.",
      );
    }

    return plugins;
  };
