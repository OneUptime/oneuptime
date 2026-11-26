import StartupMigrationBase from "./StartupMigrationBase";
import HelpAndSupportSeeding from "Common/Server/Utils/HelpAndSupport/HelpAndSupportSeeding";

/*
 * Seeds Admin Dashboard > Settings > Help and Support from the server's
 * configuration - the Helm chart's helpAndSupport values, or the
 * HELP_AND_SUPPORT_* variables of config.env - while nothing is saved there
 * yet (#10938). On every start, so a value set on a server whose page was
 * never saved seeds it the next time the server starts; once anything is
 * saved, it writes nothing, and a change an admin makes on the page is
 * never overwritten by a restart. Each value is checked as the page checks
 * it, and one that would be refused is said in the log and left out.
 *
 * Safe on every replica at once: the write holds to nothing being saved
 * (HelpAndSupportSeeding), so one seeds and the rest find it seeded.
 */
export default class SeedHelpAndSupportFromConfiguration extends StartupMigrationBase {
  public constructor() {
    super("SeedHelpAndSupportFromConfiguration");
  }

  public override async migrate(): Promise<void> {
    await HelpAndSupportSeeding.seed();
  }
}
