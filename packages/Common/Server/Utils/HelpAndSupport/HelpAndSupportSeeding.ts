import HelpAndSupportServerSettings from "./HelpAndSupportServerSettings";
import GlobalConfigService from "../../Services/GlobalConfigService";
import logger from "../Logger";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  HelpItem,
  readHelpAndSupportSettings,
} from "../../../Types/HelpAndSupport/HelpAndSupport";
import {
  HELP_AND_SUPPORT_SEED_VARIABLES,
  HelpAndSupportSeed,
  HelpAndSupportSeedProblem,
  getUnappliedSeedItems,
  readHelpAndSupportSeed,
  toSeededHelpAndSupportJSON,
} from "../../../Types/HelpAndSupport/HelpAndSupportSeed";

/*
 * HELP AND SUPPORT FROM THE SERVER'S CONFIGURATION, ON THE SERVER (#10938).
 *
 * The rules are pure (Types/HelpAndSupport/HelpAndSupportSeed); this reads
 * the configuration (process.env: config.env, or the Helm chart's
 * helpAndSupport values) and seeds Admin Dashboard > Settings > Help and
 * Support from it while nothing is saved there yet.
 *
 * It runs on every start (Workers' startup migration
 * SeedHelpAndSupportFromConfiguration) and once on a new server, the moment
 * its settings row is made (the UpdateGlobalConfigFromEnv data migration):
 * the first start of a new server may run the startup migration before the
 * row exists. Several servers starting at once are safe: the write holds to
 * nothing being saved (GlobalConfigService.seedHelpAndSupport), so the
 * first one seeds and the rest find it seeded.
 *
 * What it says in the log, so an operator who set a value knows what
 * became of it:
 *
 *   - each value that would be refused, with why, and that it was left out;
 *   - what was seeded, by variable;
 *   - once the settings are saved, each configured value that differs from
 *     them: not applied, and where it changes instead.
 *
 * Never throws: a start is never held up by it.
 */

export enum HelpAndSupportSeedOutcome {
  // No value is set, or none moves a setting off its default.
  NothingConfigured = "nothing_configured",
  // Written: the settings now hold the configuration's values.
  Seeded = "seeded",
  // The settings were saved (or seeded) before: nothing was written.
  AlreadySaved = "already_saved",
  // The server's settings row is not there yet (a new server's first start).
  NotReadyYet = "not_ready_yet",
  // The settings could not be read or written; said in the log.
  Failed = "failed",
}

export class HelpAndSupportSeedingClass {
  // The configuration (tests replace it).
  public getEnvironment(): Readonly<Record<string, string | undefined>> {
    return process.env;
  }

  // What is saved, or null; undefined when there is no settings row (tests replace it).
  public async readStored(): Promise<unknown | null | undefined> {
    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: { helpAndSupport: true },
      props: { isRoot: true },
    });

    if (!config) {
      return undefined;
    }

    return config.helpAndSupport ?? null;
  }

  // Writes the seed while nothing is saved; whether it did (tests replace it).
  public async writeIfNothingSaved(settings: JSONObject): Promise<boolean> {
    return await GlobalConfigService.seedHelpAndSupport(settings);
  }

  // What the configuration seeds, each value checked.
  public getSeed(): HelpAndSupportSeed {
    return readHelpAndSupportSeed(this.getEnvironment());
  }

  // The configured values the page would refuse (Admin Dashboard says them too).
  public getProblems(): Array<HelpAndSupportSeedProblem> {
    return this.getSeed().problems;
  }

  public async seed(): Promise<HelpAndSupportSeedOutcome> {
    const seed: HelpAndSupportSeed = this.getSeed();

    for (const problem of seed.problems) {
      logger.warn(
        `${problem.variable} in this server's configuration was not used for Admin Dashboard > Settings > Help and Support: ${problem.problem}`,
      );
    }

    const settings: JSONObject | null = toSeededHelpAndSupportJSON(seed);

    if (!settings) {
      return HelpAndSupportSeedOutcome.NothingConfigured;
    }

    const variables: Array<string> = seed.changes.map(
      (change: { item: HelpItem }): string => {
        return HELP_AND_SUPPORT_SEED_VARIABLES[change.item];
      },
    );

    try {
      const stored: unknown | null | undefined = await this.readStored();

      if (stored === undefined) {
        logger.debug(
          "Help and Support is seeded from this server's configuration once its settings are made.",
        );
        return HelpAndSupportSeedOutcome.NotReadyYet;
      }

      if (stored === null && (await this.writeIfNothingSaved(settings))) {
        HelpAndSupportServerSettings.forget();
        logger.info(
          `Admin Dashboard > Settings > Help and Support was set from this server's configuration: ${variables.join(", ")}. Changes made on that page are kept from now on, and a restart never sets them back.`,
        );
        return HelpAndSupportSeedOutcome.Seeded;
      }

      this.sayWhatIsNotApplied(
        seed,
        stored === null ? await this.readStored() : stored,
      );

      return HelpAndSupportSeedOutcome.AlreadySaved;
    } catch (err) {
      logger.error(
        `Could not set Admin Dashboard > Settings > Help and Support from this server's configuration (${variables.join(", ")}); it is tried again when the server next starts.`,
      );
      logger.error(err);
      return HelpAndSupportSeedOutcome.Failed;
    }
  }

  /*
   * The configured values that differ from what the page holds, said once a
   * start: the page is the settings' one place once anything is saved.
   */
  private sayWhatIsNotApplied(seed: HelpAndSupportSeed, stored: unknown): void {
    const unapplied: Array<HelpItem> = getUnappliedSeedItems({
      seed: seed,
      settings: readHelpAndSupportSettings(stored),
    });

    if (unapplied.length === 0) {
      return;
    }

    logger.info(
      `${unapplied
        .map((item: HelpItem): string => {
          return HELP_AND_SUPPORT_SEED_VARIABLES[item];
        })
        .join(
          ", ",
        )} in this server's configuration differ from Admin Dashboard > Settings > Help and Support, which holds this server's settings since they were first saved, so they are not applied. Change them on that page.`,
    );
  }
}

export default new HelpAndSupportSeedingClass();
