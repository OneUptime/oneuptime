import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ProjectService from "Common/Server/Services/ProjectService";
import Project from "Common/Models/DatabaseModels/Project";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageService from "Common/Server/Services/StatusPageService";

export default class AddSubscriberFooterTextToStatusPage extends DataMigrationBase {
  public constructor() {
    super("AddSubscriberFooterTextToStatusPage");
  }

  public override async migrate(): Promise<void> {
    const projects: Array<Project> = await ProjectService.findBy({
      query: {},
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      const statusPages: Array<StatusPage> = await StatusPageService.findBy({
        query: {
          projectId: project.id!,
        },
        select: {
          _id: true,
          name: true,
          pageTitle: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

      for (const statusPage of statusPages) {
        // add subscriberEmailNotificationFooterText
        await StatusPageService.updateOneBy({
          query: {
            _id: statusPage._id,
          },
          data: {
            subscriberEmailNotificationFooterText:
              "This is an automated email sent to you because you are subscribed to " +
              (statusPage.pageTitle || statusPage.name) +
              ".",
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
