import RunCron from "../../Utils/Cron";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import Select from "Common/Server/Types/Database/Select";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import ProductKey from "Common/Types/Product/ProductKey";
import URL from "Common/Types/API/URL";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DataStoreOwnerTeamService from "Common/Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "Common/Server/Services/DataStoreOwnerUserService";
import DataStoreService from "Common/Server/Services/DataStoreService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import ServerProducts from "Common/Server/Utils/ServerProducts/ServerProducts";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import { ownersToTell, tellOwnersAdded } from "../../Utils/OwnersAdded";
import {
  DataOwnerAdded,
  isDataOwnerWorkOff,
  tellDataOwnerAdded,
} from "../../Utils/DataOwnersAdded";

/*
 * Tells the people a data store owner rule, or a person on the store's
 * Owners page, made owners of a data store (#9681): a database Data
 * Observability watches, or a bucket, database or warehouse Data Security
 * found. The owner-added job every other record has (OwnersAdded), with
 * what the data owner jobs share (DataOwnersAdded): a data store is both
 * products', so it waits only while both are switched off on the server.
 */

const DATA_STORE_OWNER_ADDED_JOB_NAME: string =
  "DataStoreOwner:SendOwnerAddedNotification";

// What the data store the owners were added to is read with.
const DATA_STORE_SELECT: Select<DataStore> = {
  _id: true,
  name: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
};

RunCron(
  DATA_STORE_OWNER_ADDED_JOB_NAME,
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    if (await isDataOwnerWorkOff("DataStoreOwnerUser")) {
      return;
    }

    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the data store as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.DataStoreOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const dataStore: DataStore | null = await readDataStore(
          delivery.notification.resourceId,
        );

        if (!dataStore) {
          await delivery.giveUp("the data store is gone");
          return;
        }

        await notifyOwnersAdded({
          dataStore: dataStore,
          deliveries: [delivery],
        });
      },
    });

    /*
     * Every data store's new owner rows, a page at a time, oldest first: its
     * team rows and user rows told of together, each person once, each row
     * taken by one run alone; the run stops between stores at its deadline
     * and the next carries on (OwnersAdded, issue #8862).
     */
    await tellOwnersAdded<DataStore>({
      jobName: DATA_STORE_OWNER_ADDED_JOB_NAME,
      kind: OwnerNotificationKind.DataStoreOwnerAdded,
      recordIdColumn: "dataStoreId",
      teamService: DataStoreOwnerTeamService,
      userService: DataStoreOwnerUserService,
      recordService: DataStoreService,
      recordSelect: DATA_STORE_SELECT,
      deadline: deadline,
      tell: async (
        record: DataStore,
        deliveries: Array<OwnerNotificationDelivery>,
      ): Promise<void> => {
        await notifyOwnersAdded({
          dataStore: record,
          deliveries: deliveries,
        });
      },
    });
  },
);

async function readDataStore(dataStoreId: ObjectID): Promise<DataStore | null> {
  return await DataStoreService.findOneById({
    id: dataStoreId,
    props: {
      isRoot: true,
    },
    select: DATA_STORE_SELECT,
  });
}

/*
 * The store's page: Data Security's, where its owners are, or - while Data
 * Security is switched off on the server - the database's page in Data
 * Observability.
 */
async function getDataStoreViewLink(
  projectId: ObjectID,
  dataStoreId: ObjectID,
): Promise<URL> {
  if (await ServerProducts.getOffReasonOfServerWork(ProductKey.DataSecurity)) {
    return await DataStoreService.getDataObservabilityDatabaseLinkInDashboard(
      projectId,
      dataStoreId,
    );
  }

  return await DataStoreService.getDataStoreLinkInDashboard(
    projectId,
    dataStoreId,
  );
}

/*
 * Tells each delivery's owners that they were added as owners of the data
 * store, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  dataStore: DataStore;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const dataStore: DataStore = data.dataStore;
  const projectId: ObjectID | undefined = dataStore.projectId;

  if (!projectId || ownersToTell(data.deliveries).length === 0) {
    return;
  }

  const dataStoreName: string = dataStore.name || "data store";
  const dataStoreViewLink: string = (
    await getDataStoreViewLink(projectId, dataStore.id!)
  ).toString();

  const vars: Dictionary<string> = {
    dataStoreName: dataStoreName,
    dataStoreDescription: await Markdown.convertToHTML(
      dataStore.description || "",
      MarkdownContentType.Email,
    ),
    projectName: dataStore.project?.name || "",
    dataStoreViewLink: dataStoreViewLink,
  };

  const added: DataOwnerAdded = {
    noun: "data store",
    name: dataStoreName,
    link: dataStoreViewLink,
    emailTemplateType: EmailTemplateType.DataStoreOwnerAdded,
    emailVars: vars,
    pushTitle: "Added as Data Store Owner",
    pushTag: "data-store-owner-added",
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
            NotificationSettingEventType.SEND_DATA_STORE_OWNER_ADDED_NOTIFICATION,
          added: added,
        });
      });
    }
  }
}
