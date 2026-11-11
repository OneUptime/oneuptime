import DataMigrationBase from "./DataMigrationBase";
import ProjectMilestoneBackfill, {
  ProjectMilestoneBackfillResult,
} from "Common/Server/Utils/Activation/ProjectMilestoneBackfill";
import logger from "Common/Server/Utils/Logger";

/*
 * Fills the activation milestones (ProjectMilestone, issue #6830) of every
 * project that existed before they were kept, from the data each already
 * has - its first monitor, its first on-call page delivered, its second
 * member... (Common/Server/Utils/Activation/ProjectMilestoneBackfill says
 * where each comes from). Every row it writes says wasBackfilled, and no
 * analytics event is sent for any.
 *
 * Not in the schema migration that added the table
 * (1809110500000-AddProjectMilestones): that runs in one transaction, and
 * this reads every project's monitors, timelines and members. Here the
 * projects are walked a batch at a time.
 *
 * Idempotent, and safe to run twice at once: every write is INSERT ... ON
 * CONFLICT DO NOTHING, so a milestone kept live since the upgrade is kept
 * as it was.
 */
export default class BackfillProjectMilestones extends DataMigrationBase {
  public constructor() {
    super("BackfillProjectMilestones");
  }

  public override async migrate(): Promise<void> {
    const result: ProjectMilestoneBackfillResult =
      await ProjectMilestoneBackfill.backfill();

    const kept: string = Object.entries(result.keptByMilestone)
      .filter((entry: [string, number | undefined]): boolean => {
        return Boolean(entry[1]);
      })
      .map((entry: [string, number | undefined]): string => {
        return `${entry[1]} ${entry[0]}`;
      })
      .join(", ");

    logger.info(
      `BackfillProjectMilestones: read ${result.projects} project(s) and kept ${kept || "no milestones"}.`,
    );
  }

  public override async rollback(): Promise<void> {
    // Nothing to undo: a backfilled milestone is what the project reached.
    return;
  }
}
