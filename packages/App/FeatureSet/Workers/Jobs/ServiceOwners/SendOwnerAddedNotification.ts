import Service from "Common/Models/DatabaseModels/Service";
import ServiceOwnerTeamService from "Common/Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "Common/Server/Services/ServiceOwnerUserService";
import ServiceService from "Common/Server/Services/ServiceService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a service owner rule, or a person on its Owners page,
 * made owners of a service (#9700), as every other record's new owners are
 * told (ResourceOwnersAdded). It waits while Services is switched off on the
 * server.
 */
runResourceOwnerAddedJob<Service>({
  jobName: "ServiceOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.ServiceOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "ServiceOwnerUser",
  recordIdColumn: "serviceId",
  teamService: ServiceOwnerTeamService,
  userService: ServiceOwnerUserService,
  recordService: ServiceService,
  noun: "service",
  title: "Service",
  getLink: (projectId: ObjectID, service: Service): Promise<URL> => {
    return ServiceService.getServiceLinkInDashboard(projectId, service.id!);
  },
});
