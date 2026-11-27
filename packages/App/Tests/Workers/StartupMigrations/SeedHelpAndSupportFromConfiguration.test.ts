import { afterEach, describe, expect, jest, test } from "@jest/globals";
import HelpAndSupportSeeding, {
  HelpAndSupportSeedOutcome,
} from "Common/Server/Utils/HelpAndSupport/HelpAndSupportSeeding";
import SeedHelpAndSupportFromConfiguration from "../../../FeatureSet/Workers/StartupMigrations/SeedHelpAndSupportFromConfiguration";
import fs from "fs";
import path from "path";

/*
 * Admin Dashboard > Settings > Help and Support, seeded from the server's
 * configuration (#10938) - the Helm chart's helpAndSupport values, or the
 * HELP_AND_SUPPORT_* of config.env - at first boot only. What is pinned here:
 *
 *   - it is a startup migration, so it runs at every start: a server whose
 *     page was never saved is seeded by the start after a value is set;
 *   - a fresh install seeds as soon as its settings row is made (the data
 *     migration that makes it calls the same seeding), since the first start
 *     may run the startup migrations before that row exists;
 *   - both hand the work to HelpAndSupportSeeding, which writes only while
 *     nothing is saved: its own tests show the first boot, a restart keeping
 *     the admin's change, and a refused unsafe link.
 */

const WORKERS_DIR: string = path.join(__dirname, "../../../FeatureSet/Workers");

const MIGRATION_NAME: string = "SeedHelpAndSupportFromConfiguration";

const INSTANTIATION: RegExp = /new\s+(\w+)\(\)/g;

const sourceOf: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(WORKERS_DIR, file), "utf8");
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("registration", () => {
  const indexSource: string = sourceOf("StartupMigrations/Index.ts");

  test("is imported and instantiated once in StartupMigrations/Index.ts", () => {
    expect(indexSource).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const instantiated: Array<string> = Array.from(
      indexSource.matchAll(INSTANTIATION),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      instantiated.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
  });

  test("carries its own name, which the startup runner logs", () => {
    expect(new SeedHelpAndSupportFromConfiguration().name).toBe(MIGRATION_NAME);
  });

  test("a fresh install seeds once its settings row is made", () => {
    // AddDefaultGlobalConfig makes the row; UpdateGlobalConfigFromEnv runs next.
    const dataMigrations: string = sourceOf("DataMigrations/Index.ts");
    const madeAt: number = dataMigrations.indexOf(
      "new AddDefaultGlobalConfig()",
    );
    const fromEnvAt: number = dataMigrations.indexOf(
      "new UpdateGlobalConfigFromEnv()",
    );

    expect(madeAt).toBeGreaterThan(-1);
    expect(fromEnvAt).toBeGreaterThan(madeAt);

    // ...and seeds after it writes the rest of the configuration.
    const fromEnv: string = sourceOf(
      "DataMigrations/UpdateGlobalCongfigFromEnv.ts",
    );
    const writtenAt: number = fromEnv.indexOf(
      "GlobalConfigService.updateOneById(",
    );
    const seededAt: number = fromEnv.indexOf(
      "await HelpAndSupportSeeding.seed();",
    );

    expect(writtenAt).toBeGreaterThan(-1);
    expect(seededAt).toBeGreaterThan(writtenAt);
  });
});

describe("a start", () => {
  test("seeds through HelpAndSupportSeeding, once", async () => {
    const seed: ReturnType<typeof jest.spyOn> = jest
      .spyOn(HelpAndSupportSeeding, "seed")
      .mockResolvedValue(HelpAndSupportSeedOutcome.Seeded as never);

    await new SeedHelpAndSupportFromConfiguration().migrate();

    expect(seed).toHaveBeenCalledTimes(1);
  });

  test("never fails the start: a failed seed is the seeding's to say", async () => {
    jest
      .spyOn(HelpAndSupportSeeding, "seed")
      .mockResolvedValue(HelpAndSupportSeedOutcome.Failed as never);

    await expect(
      new SeedHelpAndSupportFromConfiguration().migrate(),
    ).resolves.toBeUndefined();
  });
});
