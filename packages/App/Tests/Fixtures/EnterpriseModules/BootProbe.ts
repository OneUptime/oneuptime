import EnterpriseLoader, {
  EnterpriseLoadResult,
} from "../../../Utils/EnterpriseLoader";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";

/*
 * Spawned by Tests/Utils/EnterpriseLoaderNodeBoot.test.ts under real node and
 * ts-node, exactly as the App boots in production - not through jest's module
 * system. Everything comes from the environment (ONEUPTIME_EDITION,
 * ONEUPTIME_EE_DIR, BILLING_ENABLED, ...), like App/Index.ts. Prints one
 * marked JSON line on success, or the boot error and exit code 3.
 */
const BOOT_PROBE_RESULT_MARKER: string = "ENTERPRISE_BOOT_PROBE_RESULT ";
const BOOT_PROBE_FAILURE_MARKER: string = "ENTERPRISE_BOOT_PROBE_FAILED ";

const run: () => Promise<void> = async (): Promise<void> => {
  const result: EnterpriseLoadResult = await EnterpriseLoader.load({
    initTimeoutInMs: 10000,
    licenseLoadTimeoutInMs: 10000,
  });
  const placeholders: Array<string> =
    await EnterpriseLoader.registerWorkerJobs();

  process.stdout.write(
    `${BOOT_PROBE_RESULT_MARKER}${JSON.stringify({
      outcome: result.outcome,
      edition: result.edition,
      entryFile: result.entryFile,
      initCompleted: result.initCompleted,
      licenseStatus: result.licenseSnapshot?.status || null,
      isLoaded: EnterpriseEdition.isLoaded(),
      version: EnterpriseEdition.getModule()?.version || null,
      placeholders,
    })}\n`,
  );
};

run().then(
  () => {
    process.exit(0);
  },
  (err: unknown) => {
    process.stdout.write(
      `${BOOT_PROBE_FAILURE_MARKER}${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(3);
  },
);
