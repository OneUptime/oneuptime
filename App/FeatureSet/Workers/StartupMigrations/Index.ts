import RemoveLegacyAIAgentTaskCrons from "./RemoveLegacyAIAgentTaskCrons";
import RemoveLegacySentinelInsightCron from "./RemoveLegacySentinelInsightCron";
import SeedGlobalLlmProviderFromEnv from "./SeedGlobalLlmProviderFromEnv";
import StartupMigrationBase from "./StartupMigrationBase";

/*
 * Startup migrations run on EVERY boot, in order (see
 * Utils/StartupMigration.ts). Keep them idempotent and fast.
 */
const StartupMigrations: Array<StartupMigrationBase> = [
  new SeedGlobalLlmProviderFromEnv(),
  new RemoveLegacySentinelInsightCron(),
  new RemoveLegacyAIAgentTaskCrons(),
];

export default StartupMigrations;