import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import MessageQueueOwnerTeamService from "Common/Server/Services/MessageQueueOwnerTeamService";
import MessageQueueOwnerUserService from "Common/Server/Services/MessageQueueOwnerUserService";
import MessageQueueService from "Common/Server/Services/MessageQueueService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a queue owner rule, or a person on its Owners page, made
 * owners of a queue (#9700), as every other record's new owners are told
 * (ResourceOwnersAdded). It waits while Queues is switched off on the
 * server.
 */
runResourceOwnerAddedJob<MessageQueue>({
  jobName: "MessageQueueOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.MessageQueueOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "MessageQueueOwnerUser",
  recordIdColumn: "messageQueueId",
  teamService: MessageQueueOwnerTeamService,
  userService: MessageQueueOwnerUserService,
  recordService: MessageQueueService,
  noun: "queue",
  title: "Queue",
  getLink: (projectId: ObjectID, messageQueue: MessageQueue): Promise<URL> => {
    return MessageQueueService.getMessageQueueLinkInDashboard(
      projectId,
      messageQueue.id!,
    );
  },
});
