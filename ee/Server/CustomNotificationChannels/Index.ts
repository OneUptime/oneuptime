import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "../Types/EnterpriseArea";
import CustomChannelSendAPI from "./API/CustomChannelSendAPI";

/*
 * Custom notification channels (EnterpriseFeature.CustomNotificationChannels):
 * the sender core hands every request for a channel to (CustomChannelSendAPI,
 * CustomChannelSender), and the job that adds a channel paging everyone to
 * everybody's on-call rules. The table, its CRUD service, the payload and
 * every place a channel is read stay in core, which asks
 * CustomChannelEdition before anything reaches a channel.
 */
const CustomNotificationChannelsArea: EnterpriseArea = {
  name: "CustomNotificationChannels",
  getApiRouters: (): Array<ExpressRouter> => {
    return [CustomChannelSendAPI];
  },
  registerWorkerJobs: async (): Promise<void> => {
    await import("./Jobs/AddCustomChannelToEveryonesRules");
  },
};

export default CustomNotificationChannelsArea;
