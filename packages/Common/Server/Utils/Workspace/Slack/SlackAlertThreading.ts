import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import ProjectService from "../../../Services/ProjectService";
import logger from "../../Logger";

export default class SlackAlertThreading {
  public static async isEnabled(projectId: ObjectID): Promise<boolean> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { productSettings: true },
      props: { isRoot: true },
    });
    return project?.productSettings?.["slackAlertThreading"] === true;
  }

  public static async forDelivery(
    projectId: ObjectID | undefined,
  ): Promise<boolean> {
    if (!projectId) {
      return false;
    }
    try {
      return await this.isEnabled(projectId);
    } catch (error) {
      logger.error(error as Error, { projectId: projectId.toString() });
      return false;
    }
  }

  public static async save(
    projectId: ObjectID,
    enabled: boolean,
  ): Promise<void> {
    await ProjectService.getRepository().manager.query(
      `UPDATE "Project"
       SET "productSettings" = COALESCE("productSettings", '{}'::jsonb)
         || jsonb_build_object('slackAlertThreading', $1::boolean)
       WHERE "_id" = $2 AND "deletedAt" IS NULL`,
      [enabled, projectId.toString()],
    );
  }
}
