import RunCron from "../../Utils/Cron";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import Select from "Common/Server/Types/Database/Select";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DataPipelineOwnerTeamService from "Common/Server/Services/DataPipelineOwnerTeamService";
import DataPipelineOwnerUserService from "Common/Server/Services/DataPipelineOwnerUserService";
import DataPipelineService from "Common/Server/Services/DataPipelineService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import DataPipeline from "Common/Models/DatabaseModels/DataPipeline";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import { ownersToTell, tellOwnersAdded } from "../../Utils/OwnersAdded";
import { getDataPipelineName } from "../../Utils/DataOwnersAdded";
import {
  OwnerAddedMessage,
  isOwnerWorkOff,
  tellOwnerAdded,
} from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a pipeline owner rule (#9527), or a person on the
 * pipeline's Owners page, made owners of a Data Observability pipeline
 * (#9681): the owner-added job every other record has (OwnersAdded), with
 * what the owner-added jobs share (ResourceOwnersAdded) - it waits while Data
 * Observability is switched off on the server.
 */

const DATA_PIPELINE_OWNER_ADDED_JOB_NAME: string =
  "DataPipelineOwner:SendOwnerAddedNotification";

// What the pipeline the owners were added to is read with.
const DATA_PIPELINE_SELECT: Select<DataPipeline> = {
  _id: true,
  jobName: true,
  jobNamespace: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
};

RunCron(
  DATA_PIPELINE_OWNER_ADDED_JOB_NAME,
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    if (await isOwnerWorkOff("DataPipelineOwnerUser")) {
      return;
    }

    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the pipeline as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.DataPipelineOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const dataPipeline: DataPipeline | null = await readDataPipeline(
          delivery.notification.resourceId,
        );

        if (!dataPipeline) {
          await delivery.giveUp("the pipeline is gone");
          return;
        }

        await notifyOwnersAdded({
          dataPipeline: dataPipeline,
          deliveries: [delivery],
        });
      },
    });

    /*
     * Every pipeline's new owner rows, a page at a time, oldest first: its
     * team rows and user rows told of together, each person once, each row
     * taken by one run alone; the run stops between pipelines at its
     * deadline and the next carries on (OwnersAdded, issue #8862).
     */
    await tellOwnersAdded<DataPipeline>({
      jobName: DATA_PIPELINE_OWNER_ADDED_JOB_NAME,
      kind: OwnerNotificationKind.DataPipelineOwnerAdded,
      recordIdColumn: "dataPipelineId",
      teamService: DataPipelineOwnerTeamService,
      userService: DataPipelineOwnerUserService,
      recordService: DataPipelineService,
      recordSelect: DATA_PIPELINE_SELECT,
      deadline: deadline,
      tell: async (
        record: DataPipeline,
        deliveries: Array<OwnerNotificationDelivery>,
      ): Promise<void> => {
        await notifyOwnersAdded({
          dataPipeline: record,
          deliveries: deliveries,
        });
      },
    });
  },
);

async function readDataPipeline(
  dataPipelineId: ObjectID,
): Promise<DataPipeline | null> {
  return await DataPipelineService.findOneById({
    id: dataPipelineId,
    props: {
      isRoot: true,
    },
    select: DATA_PIPELINE_SELECT,
  });
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * pipeline, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  dataPipeline: DataPipeline;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const dataPipeline: DataPipeline = data.dataPipeline;
  const projectId: ObjectID | undefined = dataPipeline.projectId;

  if (!projectId || ownersToTell(data.deliveries).length === 0) {
    return;
  }

  const pipelineName: string = getDataPipelineName(dataPipeline);
  const pipelineViewLink: string = (
    await DataPipelineService.getDataPipelineLinkInDashboard(
      projectId,
      dataPipeline.id!,
    )
  ).toString();

  const vars: Dictionary<string> = {
    pipelineName: pipelineName,
    pipelineNamespace: dataPipeline.jobNamespace || "",
    pipelineDescription: await Markdown.convertToHTML(
      dataPipeline.description || "",
      MarkdownContentType.Email,
    ),
    projectName: dataPipeline.project?.name || "",
    pipelineViewLink: pipelineViewLink,
  };

  const added: OwnerAddedMessage = {
    noun: "pipeline",
    name: pipelineName,
    link: pipelineViewLink,
    emailTemplateType: EmailTemplateType.DataPipelineOwnerAdded,
    emailVars: vars,
    pushTitle: "Added as Pipeline Owner",
    pushTag: "data-pipeline-owner-added",
  };

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      /*
       * A send that fails is the owner's alone: tell() says so and goes on
       * to the next owner, who is told all the same.
       */
      await delivery.tell(user, async (): Promise<void> => {
        await tellOwnerAdded({
          user: user,
          projectId: projectId,
          eventType:
            NotificationSettingEventType.SEND_DATA_PIPELINE_OWNER_ADDED_NOTIFICATION,
          added: added,
        });
      });
    }
  }
}
