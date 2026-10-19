import StartupMigrationBase from "./StartupMigrationBase";
import ObjectID from "Common/Types/ObjectID";
import {
  BUNDLED_GLOBAL_RUNNER_DESCRIPTION,
  BUNDLED_GLOBAL_RUNNER_ID,
  BUNDLED_GLOBAL_RUNNER_NAME,
  GLOBAL_RUNNER_KEY_ENV,
  GLOBAL_RUNNER_REPLICAS_ENV,
} from "Common/Types/Runner/BundledGlobalRunner";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerService from "Common/Server/Services/RunnerService";
import { isShippedSecretValue } from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";

/*
 * The bundled global Runner's row, kept from GLOBAL_RUNNER_KEY on every boot
 * (see Common/Types/Runner/BundledGlobalRunner): the Runner the Helm chart's
 * `globalRunner` deployment and the Docker Compose `global-runner` service
 * start with the same key and the fixed id below.
 *
 * - The key set: the row exists, global, with that key - created the first
 *   time, its key updated when it changed.
 * - The key unset, or GLOBAL_RUNNER_REPLICAS 0 (none runs): the row is
 *   removed. The bundled global Runner is turned off, and no project lists a
 *   global Runner nobody runs.
 * - A key the repository ships (a placeholder): the same as unset, and said
 *   once - a public value must never let anyone take every project's steps.
 *
 * Only the row with the fixed id is ever touched: global Runners a master
 * admin adds get ids of their own. Its name and description are written when
 * it is created and left alone afterwards, so a master admin may rename it.
 * Idempotent, and never fatal: a boot whose seed fails says so and carries
 * on, and the next boot tries again.
 */
export default class SeedBundledGlobalRunner extends StartupMigrationBase {
  public static readonly bundledGlobalRunnerId: ObjectID = new ObjectID(
    BUNDLED_GLOBAL_RUNNER_ID,
  );

  public static readonly SHIPPED_KEY_MESSAGE: string = `${GLOBAL_RUNNER_KEY_ENV} is a value the OneUptime repository ships, which is public, so the bundled global Runner is off. Set ${GLOBAL_RUNNER_KEY_ENV} to a long random value on the OneUptime server and on the global Runner: with Docker Compose, npm start and npm run update put one in config.env; the Helm chart generates one unless globalRunner.key is set.`;

  public static readonly NOT_GLOBAL_MESSAGE: string = `A Runner that is not a global Runner holds the bundled global Runner's id (${BUNDLED_GLOBAL_RUNNER_ID}), so the bundled global Runner was not set up. Delete that Runner, then restart OneUptime.`;

  public constructor() {
    super("SeedBundledGlobalRunner");
  }

  // The key the bundled global Runner runs with, or "" when it is off.
  public static getConfiguredKey(): string {
    return (process.env[GLOBAL_RUNNER_KEY_ENV] || "").trim();
  }

  /*
   * Whether the install runs no bundled global Runner at all: Docker
   * Compose's GLOBAL_RUNNER_REPLICAS=0, or the chart's
   * globalRunner.replicaCount 0. Unset, or anything but zero, reads as some.
   */
  public static runsNoReplica(): boolean {
    const replicas: string = (process.env[GLOBAL_RUNNER_REPLICAS_ENV] || "")
      .trim()
      .toLowerCase();

    return replicas !== "" && Number(replicas) === 0;
  }

  public override async migrate(): Promise<void> {
    const runnerId: ObjectID = SeedBundledGlobalRunner.bundledGlobalRunnerId;
    const key: string = SeedBundledGlobalRunner.getConfiguredKey();

    /*
     * A key that is set but shipped (a config.example.env placeholder, or
     * "secret") is said out loud: an operator who left it meant the bundled
     * global Runner to run, and it does not.
     */
    const isShippedKey: boolean = Boolean(key) && isShippedSecretValue(key);

    if (isShippedKey) {
      logger.warn(SeedBundledGlobalRunner.SHIPPED_KEY_MESSAGE);
    }

    const existing: Runner | null = await RunnerService.findOneById({
      id: runnerId,
      select: {
        _id: true,
        key: true,
        isGlobalRunner: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!key || isShippedKey || SeedBundledGlobalRunner.runsNoReplica()) {
      if (existing && existing.isGlobalRunner) {
        await RunnerService.deleteOneById({
          id: runnerId,
          props: {
            isRoot: true,
          },
        });

        logger.info(
          `The bundled global Runner is off (${GLOBAL_RUNNER_KEY_ENV} is not set, or ${GLOBAL_RUNNER_REPLICAS_ENV} is 0): removed it. Global Runners a master admin added keep running.`,
        );
      }

      return;
    }

    if (existing) {
      /*
       * Never a project's Runner made global, nor its key replaced: a row
       * under this id that is not global was not made by this seed.
       */
      if (!existing.isGlobalRunner || existing.projectId) {
        logger.error(SeedBundledGlobalRunner.NOT_GLOBAL_MESSAGE);
        return;
      }

      if (existing.key === key) {
        return;
      }

      await RunnerService.updateOneById({
        id: runnerId,
        data: {
          key: key,
        },
        props: {
          isRoot: true,
        },
      });

      logger.info(
        `The bundled global Runner's key changed with ${GLOBAL_RUNNER_KEY_ENV}: it connects with the new key from now on.`,
      );

      return;
    }

    const runner: Runner = new Runner();
    runner.id = runnerId;
    runner.isGlobalRunner = true;
    runner.name = BUNDLED_GLOBAL_RUNNER_NAME;
    runner.description = BUNDLED_GLOBAL_RUNNER_DESCRIPTION;
    runner.key = key;
    runner.canRunRunbooks = true;
    runner.canRunCodeFixTasks = false;
    runner.canRunAiCommands = false;

    await RunnerService.create({
      data: runner,
      props: {
        isRoot: true,
      },
    });

    logger.info(
      `Set up the bundled global Runner "${BUNDLED_GLOBAL_RUNNER_NAME}": it runs JavaScript steps for every project that uses global Runners.`,
    );
  }
}
