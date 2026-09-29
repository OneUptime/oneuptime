import fs from "fs";
import path from "path";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseServerModule, {
  EnterpriseServerModuleShape,
} from "Common/Server/Enterprise/EnterpriseServerModule";
import { EnterpriseLicenseSnapshot } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import {
  AllowBillingWithoutEnterprise,
  IsBillingEnabled,
  IsEnterpriseEditionRequested,
  ONEUPTIME_EDITION_SETTINGS,
  OneUptimeEdition,
  OneUptimeEditionSetting,
  OneUptimeEnterpriseDirectory,
} from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";
import JobDictionary from "../FeatureSet/Workers/Utils/JobDictionary";

/*
 * Boot-time loader for the OneUptime Enterprise Edition module (ee/).
 *
 * Core never imports ee. This loader finds ee/Server/Index.ts (or .js) on
 * disk, requires it, checks it against the EnterpriseServerModule contract and
 * registers it with EnterpriseEdition; every edition-dependent behaviour in
 * core then asks EnterpriseEdition. No ee on disk (the Community image) means
 * the Community Edition.
 *
 * Failure policy:
 *   - fail fast (throw, the process exits) for a broken build: ee present but
 *     its require() fails or it does not match the contract, an unrecognised
 *     ONEUPTIME_EDITION, ONEUPTIME_EDITION=enterprise with no ee, and billing
 *     (the hosted oneuptime.com) without ee;
 *   - fail fast when the Enterprise Edition is requested
 *     (IS_ENTERPRISE_EDITION=true) but ee is not loaded, unless
 *     ONEUPTIME_EDITION=community explicitly chooses the Community Edition
 *     (then only a warning). Starting anyway would silently stop enforcing
 *     "Require SSO", SSO/SCIM and audit logging: a fail-open upgrade;
 *   - log and continue for anything at runtime: init() throwing or hanging,
 *     the first license load failing. Core monitoring must never be taken
 *     down by the enterprise module.
 *
 * Migrate.ts deliberately does not run this loader: migrations run with
 * Community defaults and record no audit rows.
 */

/*
 * Cron jobs the enterprise module owns. Earlier releases registered all five
 * from core, so their repeatable definitions can still be in Redis on any
 * install; a Community process (or an Enterprise process that registers only
 * some of them - the license-server jobs run only with billing) would then
 * fail every run with "No job found". Core registers a no-op handler for each
 * name still missing after ee had its turn. Nothing is removed from Redis: the
 * migrate job never loads ee and would delete live Enterprise crons.
 */
export const ENTERPRISE_OWNED_JOB_NAMES: ReadonlyArray<string> = [
  "EnterpriseLicense:ReportUserCount",
  "EnterpriseLicense:SendLicenseNotificationEmails",
  "EnterpriseLicense:ReconcileInstanceUsage",
  "InstanceHealth:EvaluatePostgresHealth",
  "InstanceHealth:EvaluateRedisHealth",
];

export const DEFAULT_ENTERPRISE_INIT_TIMEOUT_IN_MS: number = 30 * 1000;

export const DEFAULT_ENTERPRISE_LICENSE_LOAD_TIMEOUT_IN_MS: number = 15 * 1000;

const ENTRY_FILE_CANDIDATES: ReadonlyArray<string> = [
  path.join("Server", "Index.ts"),
  path.join("Server", "Index.js"),
];

export interface EnterpriseLoaderOptions {
  // Defaults to ONEUPTIME_EDITION (null = unrecognised value).
  edition?: OneUptimeEditionSetting | null | undefined;
  // Defaults to ONEUPTIME_EE_DIR. When set, it is the only place searched.
  enterpriseDirectory?: string | undefined;
  // Defaults to packages/App (repo) or /usr/src/app (container).
  appRoot?: string | undefined;
  initTimeoutInMs?: number | undefined;
  licenseLoadTimeoutInMs?: number | undefined;
  // Defaults to BILLING_ENABLED.
  isBillingEnabled?: boolean | undefined;
  // Defaults to ALLOW_BILLING_WITHOUT_ENTERPRISE.
  allowBillingWithoutEnterprise?: boolean | undefined;
  /*
   * Defaults to EnvironmentConfig's IsEnterpriseEditionRequested:
   * IS_ENTERPRISE_EDITION=true, unless ONEUPTIME_EDITION=community.
   */
  isEnterpriseEditionRequested?: boolean | undefined;
}

export type EnterpriseLoadOutcome =
  | "loaded"
  | "already-loaded"
  | "disabled"
  | "not-found";

export interface EnterpriseLoadResult {
  outcome: EnterpriseLoadOutcome;
  edition: OneUptimeEditionSetting;
  searchedDirectories: Array<string>;
  directory: string | null;
  entryFile: string | null;
  // True when init() resolved within the timeout.
  initCompleted: boolean;
  initError: string | null;
  // The first license snapshot, when it loaded within the timeout.
  licenseSnapshot: EnterpriseLicenseSnapshot | null;
}

export interface EnterpriseBootGuardInput {
  isLoaded: boolean;
  isBillingEnabled: boolean;
  allowBillingWithoutEnterprise: boolean;
  isEnterpriseEditionRequested: boolean;
  // The resolved ONEUPTIME_EDITION setting ("community" = chosen explicitly).
  edition: OneUptimeEditionSetting;
}

// A boot-stopping problem with the enterprise module or its configuration.
export class EnterpriseLoaderError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EnterpriseLoaderError";
  }
}

type SettledWithin<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; error: unknown }
  | { status: "timed-out" };

export default class EnterpriseLoader {
  // The App package root: packages/App in the repo, /usr/src/app in the image.
  public static getDefaultAppRoot(): string {
    return path.resolve(__dirname, "..");
  }

  /*
   * Where ee/ may live relative to the App root: the repo layout
   * (<root>/packages/App -> <root>/ee) and the container layout
   * (/usr/src/app -> /usr/src/ee). ONEUPTIME_EE_DIR replaces both.
   */
  public static getCandidateDirectories(
    appRoot: string,
    enterpriseDirectory?: string | undefined,
  ): Array<string> {
    if (enterpriseDirectory && enterpriseDirectory.trim()) {
      return [path.resolve(enterpriseDirectory.trim())];
    }

    return [
      path.resolve(appRoot, "..", "..", "ee"),
      path.resolve(appRoot, "..", "ee"),
    ];
  }

  /*
   * The module entry file inside an ee/ directory, or null. A FILE check: a
   * leftover ee/node_modules (git keeps untracked directories when switching
   * to an older branch) must not count as "Enterprise present".
   */
  public static findEntryFile(directory: string): string | null {
    for (const candidate of ENTRY_FILE_CANDIDATES) {
      const entryFile: string = path.join(directory, candidate);

      try {
        if (fs.statSync(entryFile).isFile()) {
          return entryFile;
        }
      } catch {
        // Not there; try the next candidate.
      }
    }

    return null;
  }

  /*
   * require()s the entry file, unwraps an ES-module default export and checks
   * the result against the contract. Throws EnterpriseLoaderError for both a
   * failed require and a wrong shape: either means a broken build.
   */
  public static requireModule(
    entryFile: string,
    directory: string,
  ): EnterpriseServerModule {
    let exported: unknown = undefined;

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      exported = require(entryFile);
    } catch (err) {
      throw new EnterpriseLoaderError(
        `The OneUptime Enterprise module at ${entryFile} could not be loaded: ${EnterpriseLoader.describeError(err)}. ` +
          `If its dependencies are missing, run "npm ci --ignore-scripts" in ${directory}. ` +
          `To run the Community Edition instead, set ONEUPTIME_EDITION=community.`,
      );
    }

    const candidate: unknown = EnterpriseLoader.unwrapDefaultExport(exported);
    const problems: Array<string> =
      EnterpriseServerModuleShape.findProblems(candidate);

    if (problems.length > 0) {
      throw new EnterpriseLoaderError(
        `The OneUptime Enterprise module at ${entryFile} does not match this build's enterprise contract: ` +
          `${problems.join("; ")}. ee/ and the rest of OneUptime are probably from different versions.`,
      );
    }

    return candidate as EnterpriseServerModule;
  }

  public static unwrapDefaultExport(exported: unknown): unknown {
    if (
      typeof exported === "object" &&
      exported !== null &&
      "default" in exported &&
      (exported as Record<string, unknown>)["default"]
    ) {
      return (exported as Record<string, unknown>)["default"];
    }

    return exported;
  }

  /*
   * Finds, loads and initialises the enterprise module (see the file header
   * for what fails fast and what only logs), then applies the boot guards.
   * Must run before any router is mounted: the routers ask EnterpriseEdition
   * what to mount, and permission checks read the first license snapshot.
   */
  public static async load(
    options: EnterpriseLoaderOptions = {},
  ): Promise<EnterpriseLoadResult> {
    const edition: OneUptimeEditionSetting =
      EnterpriseLoader.resolveEdition(options);
    const appRoot: string =
      options.appRoot || EnterpriseLoader.getDefaultAppRoot();
    const enterpriseDirectory: string | undefined =
      options.enterpriseDirectory !== undefined
        ? options.enterpriseDirectory
        : OneUptimeEnterpriseDirectory;

    const result: EnterpriseLoadResult = {
      outcome: "not-found",
      edition,
      searchedDirectories: [],
      directory: null,
      entryFile: null,
      initCompleted: false,
      initError: null,
      licenseSnapshot: null,
    };

    if (EnterpriseEdition.isLoaded()) {
      result.outcome = "already-loaded";
    } else if (edition === "community") {
      result.outcome = "disabled";
      logger.info(
        "ONEUPTIME_EDITION=community: running the OneUptime Community Edition; the enterprise module is not loaded.",
      );
    } else {
      result.searchedDirectories = EnterpriseLoader.getCandidateDirectories(
        appRoot,
        enterpriseDirectory,
      );

      for (const directory of result.searchedDirectories) {
        const entryFile: string | null =
          EnterpriseLoader.findEntryFile(directory);

        if (entryFile) {
          result.directory = directory;
          result.entryFile = entryFile;
          break;
        }
      }

      if (!result.entryFile || !result.directory) {
        EnterpriseLoader.handleNotFound(
          edition,
          enterpriseDirectory,
          result.searchedDirectories,
        );
      } else {
        const enterpriseModule: EnterpriseServerModule =
          EnterpriseLoader.requireModule(result.entryFile, result.directory);

        EnterpriseEdition.register(enterpriseModule);
        result.outcome = "loaded";

        await EnterpriseLoader.initialise(enterpriseModule, options, result);
      }
    }

    EnterpriseLoader.enforceBootGuards({
      isLoaded: EnterpriseEdition.isLoaded(),
      isBillingEnabled:
        options.isBillingEnabled !== undefined
          ? options.isBillingEnabled
          : IsBillingEnabled,
      allowBillingWithoutEnterprise:
        options.allowBillingWithoutEnterprise !== undefined
          ? options.allowBillingWithoutEnterprise
          : AllowBillingWithoutEnterprise,
      isEnterpriseEditionRequested:
        options.isEnterpriseEditionRequested !== undefined
          ? options.isEnterpriseEditionRequested
          : IsEnterpriseEditionRequested,
      edition,
    });

    return result;
  }

  /*
   * - billing on (the hosted oneuptime.com) without ee: fatal, unless the
   *   ALLOW_BILLING_WITHOUT_ENTERPRISE development escape hatch is set. Paid
   *   SSO and audit logging would silently stop, and the license server that
   *   self-hosted customers activate against would be gone.
   * - the Enterprise Edition requested (IS_ENTERPRISE_EDITION=true) without
   *   ee: fatal. The variable no longer turns anything on; the image does.
   *   Before the edition split a Docker Compose Enterprise install was
   *   APP_TAG=release plus IS_ENTERPRISE_EDITION=true, and APP_TAG=release is
   *   now the Community image. Starting it would silently stop enforcing
   *   "Require SSO" (password sign-in accepted again), 404 the SSO and SCIM
   *   routes (identity provider deprovisioning stops) and stop audit logging,
   *   so the boot refuses and the error says exactly what to set.
   *   An explicit ONEUPTIME_EDITION=community is the operator choosing the
   *   Community Edition, so it only warns. isEnterpriseEditionRequested
   *   already excludes that case when both values come from the environment;
   *   the edition check keeps the guard right when a caller passes the
   *   edition and the request separately.
   */
  public static enforceBootGuards(input: EnterpriseBootGuardInput): void {
    if (input.isBillingEnabled && !input.isLoaded) {
      const message: string =
        "BILLING_ENABLED=true but the OneUptime Enterprise module is not loaded. " +
        "The hosted deployment must run the Enterprise image: on the Community image " +
        "SSO, SCIM and audit logging stop and the license server is not served.";

      if (!input.allowBillingWithoutEnterprise) {
        throw new EnterpriseLoaderError(
          `${message} Set ALLOW_BILLING_WITHOUT_ENTERPRISE=true only for local development.`,
        );
      }

      logger.error(
        `${message} Continuing because ALLOW_BILLING_WITHOUT_ENTERPRISE=true.`,
      );
    }

    if (!input.isEnterpriseEditionRequested || input.isLoaded) {
      return;
    }

    if (input.edition === "community") {
      logger.warn(
        "IS_ENTERPRISE_EDITION=true, but ONEUPTIME_EDITION=community: running the OneUptime Community " +
          'Edition as configured. It does not enforce "Require SSO", does not serve SSO or SCIM, and ' +
          "does not record audit logs; your SSO, SCIM and audit log settings are kept, not enforced. " +
          "Set IS_ENTERPRISE_EDITION=false to confirm the Community Edition, or unset " +
          "ONEUPTIME_EDITION on the Enterprise image to run the Enterprise Edition.",
      );
      return;
    }

    throw new EnterpriseLoaderError(
      "IS_ENTERPRISE_EDITION=true, but the OneUptime Enterprise module is not loaded, so this process " +
        "would run as the Community Edition (the Community image contains no enterprise code). Refusing " +
        'to start: the Community Edition does not enforce "Require SSO" (password sign-in would be ' +
        "accepted), does not serve SSO or SCIM (identity provider deprovisioning would stop) and does " +
        "not record audit logs, so starting would silently switch those off. " +
        "To keep the Enterprise Edition, run the Enterprise image: with Docker Compose set " +
        "APP_TAG=enterprise-<version> (for example APP_TAG=enterprise-release) in config.env and run " +
        '"npm run update"; with Helm set image.type: enterprise-edition. ' +
        "To run the Community Edition, which does not enforce SSO, SCIM or audit logging, set " +
        "IS_ENTERPRISE_EDITION=false (or ONEUPTIME_EDITION=community).",
    );
  }

  /*
   * Called by the Workers feature set before its queue consumers start: lets
   * ee register its cron jobs, then gives every ee-owned job name that is
   * still unregistered a no-op handler. Returns the names that got one.
   */
  public static async registerWorkerJobs(): Promise<Array<string>> {
    const enterpriseModule: EnterpriseServerModule | null =
      EnterpriseEdition.getModule();

    if (enterpriseModule) {
      try {
        await enterpriseModule.registerWorkerJobs();
      } catch (err) {
        logger.error(
          "The OneUptime Enterprise module failed to register its worker jobs; they will not run in this process.",
        );
        logger.error(err);
      }
    }

    return EnterpriseLoader.registerMissingJobPlaceholders();
  }

  public static registerMissingJobPlaceholders(): Array<string> {
    const registered: Array<string> = [];

    for (const jobName of ENTERPRISE_OWNED_JOB_NAMES) {
      if (JobDictionary.has(jobName)) {
        continue;
      }

      JobDictionary.setJobFunction(jobName, async (): Promise<void> => {
        logger.debug(
          `${jobName}: skipped. This job belongs to the OneUptime Enterprise module, which does not run it in this process.`,
        );
      });

      registered.push(jobName);
    }

    return registered;
  }

  private static resolveEdition(
    options: EnterpriseLoaderOptions,
  ): OneUptimeEditionSetting {
    const edition: OneUptimeEditionSetting | null =
      options.edition !== undefined ? options.edition : OneUptimeEdition;

    if (!edition) {
      throw new EnterpriseLoaderError(
        `ONEUPTIME_EDITION must be one of ${ONEUPTIME_EDITION_SETTINGS.join(", ")} ` +
          `(or unset for auto), but it is "${process.env["ONEUPTIME_EDITION"] || ""}".`,
      );
    }

    return edition;
  }

  private static handleNotFound(
    edition: OneUptimeEditionSetting,
    enterpriseDirectory: string | undefined,
    searchedDirectories: Array<string>,
  ): void {
    const searched: string = searchedDirectories
      .map((directory: string): string => {
        return path.join(directory, "Server", "Index.ts");
      })
      .join(", ");

    if (edition === "enterprise") {
      throw new EnterpriseLoaderError(
        `ONEUPTIME_EDITION=enterprise, but the OneUptime Enterprise module was not found (looked for ${searched}). ` +
          `This Enterprise image is broken; refusing to start as the Community Edition.`,
      );
    }

    if (enterpriseDirectory) {
      logger.warn(
        `ONEUPTIME_EE_DIR is set, but ${searched} does not exist. Running the OneUptime Community Edition.`,
      );
      return;
    }

    logger.info(
      "No OneUptime Enterprise module found: running the OneUptime Community Edition.",
    );
  }

  private static async initialise(
    enterpriseModule: EnterpriseServerModule,
    options: EnterpriseLoaderOptions,
    result: EnterpriseLoadResult,
  ): Promise<void> {
    const initTimeoutInMs: number =
      options.initTimeoutInMs || DEFAULT_ENTERPRISE_INIT_TIMEOUT_IN_MS;

    const initOutcome: SettledWithin<void> =
      await EnterpriseLoader.settleWithin<void>((): Promise<void> => {
        return enterpriseModule.init();
      }, initTimeoutInMs);

    if (initOutcome.status === "fulfilled") {
      result.initCompleted = true;
    } else if (initOutcome.status === "rejected") {
      result.initError = EnterpriseLoader.describeError(initOutcome.error);
      logger.error(
        `The OneUptime Enterprise module failed to initialise; continuing. Enterprise features may be degraded until the next restart: ${result.initError}`,
      );
    } else {
      result.initError = `init() did not finish within ${initTimeoutInMs} ms`;
      logger.error(
        `The OneUptime Enterprise module's init() did not finish within ${initTimeoutInMs} ms; continuing without waiting for it.`,
      );
    }

    const licenseLoadTimeoutInMs: number =
      options.licenseLoadTimeoutInMs ||
      DEFAULT_ENTERPRISE_LICENSE_LOAD_TIMEOUT_IN_MS;

    const snapshotOutcome: SettledWithin<EnterpriseLicenseSnapshot> =
      await EnterpriseLoader.settleWithin<EnterpriseLicenseSnapshot>(
        (): Promise<EnterpriseLicenseSnapshot> => {
          return enterpriseModule.licensing.getSnapshot();
        },
        licenseLoadTimeoutInMs,
      );

    if (snapshotOutcome.status === "fulfilled") {
      result.licenseSnapshot = snapshotOutcome.value;
      logger.info(
        `OneUptime Enterprise Edition ${enterpriseModule.version} loaded from ${result.directory}. License status: ${snapshotOutcome.value.status} (${snapshotOutcome.value.verification}).`,
      );
      return;
    }

    logger.error(
      snapshotOutcome.status === "rejected"
        ? `OneUptime Enterprise Edition ${enterpriseModule.version} loaded, but its license could not be read: ${EnterpriseLoader.describeError(snapshotOutcome.error)}. Enterprise configuration stays read-only until it can be.`
        : `OneUptime Enterprise Edition ${enterpriseModule.version} loaded, but reading its license took longer than ${licenseLoadTimeoutInMs} ms. Enterprise configuration stays read-only until it loads.`,
    );
  }

  /*
   * Runs `work` and settles with its outcome, or with "timed-out" once
   * `timeoutInMs` passes. Never rejects, including when `work` throws
   * synchronously. The timer is always cleared, so a finished boot leaves no
   * handle open.
   */
  private static async settleWithin<T>(
    work: () => Promise<T>,
    timeoutInMs: number,
  ): Promise<SettledWithin<T>> {
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const timeout: Promise<SettledWithin<T>> = new Promise<SettledWithin<T>>(
      (resolve: (value: SettledWithin<T>) => void): void => {
        timer = setTimeout((): void => {
          resolve({ status: "timed-out" });
        }, timeoutInMs);
      },
    );

    const run: Promise<SettledWithin<T>> = Promise.resolve()
      .then(work)
      .then(
        (value: T): SettledWithin<T> => {
          return { status: "fulfilled", value };
        },
        (error: unknown): SettledWithin<T> => {
          return { status: "rejected", error };
        },
      );

    try {
      return await Promise.race([run, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private static describeError(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    }

    return String(err);
  }
}
