import { createFixtureModule } from "../../FixtureModuleFactory";

/*
 * The shape ee/Server/Index.ts has: a TypeScript default export, which
 * require() returns as { default: module }. The loader must unwrap it.
 * registerWorkerJobs registers two of the five ee-owned cron names, so the
 * placeholder pass has to fill in exactly the other three.
 */
export default createFixtureModule("DefaultExport", {
  jobNames: [
    "EnterpriseLicense:ReportUserCount",
    "InstanceHealth:EvaluatePostgresHealth",
  ],
});
