import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import logger from "Common/Server/Utils/Logger";
import PartialEntity from "Common/Types/Database/PartialEntity";
import ObjectID from "Common/Types/ObjectID";
import LicenseInputsUtil, {
  LICENSE_INPUTS_SELECT,
  LicenseInputs,
} from "./LicenseInputs";

/*
 * Every read and write the license client makes to GlobalConfig.
 *
 * All of them run as root - GlobalConfigService refuses non-root writes to the
 * license columns - and every write also skips the hooks, which is how the
 * license client has always written them (no audit row, no cache churn for a
 * value the server itself computed).
 */
export default class LicenseStore {
  public static async readLicenseConfig(): Promise<GlobalConfig | null> {
    return await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: LICENSE_INPUTS_SELECT,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Records the first time this installation ran the Enterprise Edition, once.
   * An unlicensed Enterprise install gets its grace period counted from here.
   *
   * Never creates the row: on a brand-new installation the AddDefaultGlobalConfig
   * data migration does that, and it would fail on a row that already exists.
   * The next load after the row appears stamps it instead.
   *
   * Returns the stamp now in effect (the existing one, or the new one), or null
   * when there is no row to stamp.
   */
  public static async stampFirstSeenIfMissing(
    config: GlobalConfig | null,
    now: Date,
  ): Promise<Date | null> {
    if (!config) {
      return null;
    }

    if (config.enterpriseEditionFirstSeenAt) {
      return config.enterpriseEditionFirstSeenAt;
    }

    await GlobalConfigService.updateOneById({
      id: ObjectID.getZeroObjectID(),
      data: {
        enterpriseEditionFirstSeenAt: now,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    logger.info(
      `OneUptime Enterprise Edition: first run on this installation recorded at ${now.toISOString()}. Without a license, enterprise features stay available for a grace period counted from now.`,
    );

    return now;
  }

  /*
   * Reads the license inputs, stamping the first-seen time on the way when it
   * is missing. A failed stamp does not fail the read: the license is still
   * readable, and the stamp is retried on the next load.
   */
  public static async loadLicenseInputs(now: Date): Promise<LicenseInputs> {
    const config: GlobalConfig | null = await LicenseStore.readLicenseConfig();

    if (config && !config.enterpriseEditionFirstSeenAt) {
      try {
        const firstSeenAt: Date | null =
          await LicenseStore.stampFirstSeenIfMissing(config, now);

        if (firstSeenAt) {
          config.enterpriseEditionFirstSeenAt = firstSeenAt;
        }
      } catch (err) {
        logger.warn(
          "OneUptime Enterprise Edition: could not record the first run of the Enterprise Edition; retrying on the next license read.",
        );
        logger.warn(err);
      }
    }

    return LicenseInputsUtil.fromGlobalConfig(config);
  }

  /*
   * Writes license columns to the singleton row, creating it only when it does
   * not exist yet (the activation flows can run before the default config is
   * seeded).
   */
  public static async writeLicenseColumns(data: {
    update: PartialEntity<GlobalConfig>;
    rowExists: boolean;
  }): Promise<void> {
    if (Object.keys(data.update).length === 0) {
      return;
    }

    if (data.rowExists) {
      await GlobalConfigService.updateOneById({
        id: ObjectID.getZeroObjectID(),
        data: data.update,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
      return;
    }

    const newConfig: GlobalConfig = new GlobalConfig();
    newConfig.id = ObjectID.getZeroObjectID();

    for (const [key, value] of Object.entries(data.update)) {
      if (value !== null && value !== undefined) {
        (newConfig as unknown as Record<string, unknown>)[key] = value;
      }
    }

    await GlobalConfigService.create({
      data: newConfig,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
  }
}
