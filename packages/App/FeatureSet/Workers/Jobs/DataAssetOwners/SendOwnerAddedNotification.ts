import RunCron from "../../Utils/Cron";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import Select from "Common/Server/Types/Database/Select";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DataAssetOwnerTeamService from "Common/Server/Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "Common/Server/Services/DataAssetOwnerUserService";
import DataAssetService from "Common/Server/Services/DataAssetService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import { ownersToTell, tellOwnersAdded } from "../../Utils/OwnersAdded";
import {
  DataOwnerAdded,
  getDataTableName,
  isDataOwnerWorkOff,
  tellDataOwnerAdded,
} from "../../Utils/DataOwnersAdded";

/*
 * Tells the people a table owner rule, or a person on the table's Owners
 * page, made owners of a Data Observability table (#9681): the owner-added
 * job every other record has (OwnersAdded), with what the data owner jobs
 * share (DataOwnersAdded) - it waits while Data Observability is switched
 * off on the server.
 */

const DATA_ASSET_OWNER_ADDED_JOB_NAME: string =
  "DataAssetOwner:SendOwnerAddedNotification";

// What the table the owners were added to is read with.
const DATA_ASSET_SELECT: Select<DataAsset> = {
  _id: true,
  name: true,
  schemaName: true,
  dataStoreName: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
};

RunCron(
  DATA_ASSET_OWNER_ADDED_JOB_NAME,
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    if (await isDataOwnerWorkOff("DataAssetOwnerUser")) {
      return;
    }

    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the table as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.DataAssetOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const dataAsset: DataAsset | null = await readDataAsset(
          delivery.notification.resourceId,
        );

        if (!dataAsset) {
          await delivery.giveUp("the table is gone");
          return;
        }

        await notifyOwnersAdded({
          dataAsset: dataAsset,
          deliveries: [delivery],
        });
      },
    });

    /*
     * Every table's new owner rows, a page at a time, oldest first: its team
     * rows and user rows told of together, each person once, each row taken
     * by one run alone; the run stops between tables at its deadline and the
     * next carries on (OwnersAdded, issue #8862).
     */
    await tellOwnersAdded<DataAsset>({
      jobName: DATA_ASSET_OWNER_ADDED_JOB_NAME,
      kind: OwnerNotificationKind.DataAssetOwnerAdded,
      recordIdColumn: "dataAssetId",
      teamService: DataAssetOwnerTeamService,
      userService: DataAssetOwnerUserService,
      recordService: DataAssetService,
      recordSelect: DATA_ASSET_SELECT,
      deadline: deadline,
      tell: async (
        record: DataAsset,
        deliveries: Array<OwnerNotificationDelivery>,
      ): Promise<void> => {
        await notifyOwnersAdded({
          dataAsset: record,
          deliveries: deliveries,
        });
      },
    });
  },
);

async function readDataAsset(dataAssetId: ObjectID): Promise<DataAsset | null> {
  return await DataAssetService.findOneById({
    id: dataAssetId,
    props: {
      isRoot: true,
    },
    select: DATA_ASSET_SELECT,
  });
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * table, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  dataAsset: DataAsset;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const dataAsset: DataAsset = data.dataAsset;
  const projectId: ObjectID | undefined = dataAsset.projectId;

  if (!projectId || ownersToTell(data.deliveries).length === 0) {
    return;
  }

  const tableName: string = getDataTableName(dataAsset);
  const tableViewLink: string = (
    await DataAssetService.getDataAssetLinkInDashboard(projectId, dataAsset.id!)
  ).toString();

  const vars: Dictionary<string> = {
    tableName: tableName,
    databaseName: dataAsset.dataStoreName || "",
    tableDescription: await Markdown.convertToHTML(
      dataAsset.description || "",
      MarkdownContentType.Email,
    ),
    projectName: dataAsset.project?.name || "",
    tableViewLink: tableViewLink,
  };

  const added: DataOwnerAdded = {
    noun: "table",
    name: tableName,
    link: tableViewLink,
    emailTemplateType: EmailTemplateType.DataAssetOwnerAdded,
    emailVars: vars,
    pushTitle: "Added as Table Owner",
    pushTag: "data-asset-owner-added",
  };

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      /*
       * A send that fails is the owner's alone: tell() says so and goes on
       * to the next owner, who is told all the same.
       */
      await delivery.tell(user, async (): Promise<void> => {
        await tellDataOwnerAdded({
          user: user,
          projectId: projectId,
          eventType:
            NotificationSettingEventType.SEND_DATA_ASSET_OWNER_ADDED_NOTIFICATION,
          added: added,
        });
      });
    }
  }
}
