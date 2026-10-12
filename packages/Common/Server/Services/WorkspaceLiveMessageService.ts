import { IsBillingEnabled } from "../EnvironmentConfig";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/WorkspaceLiveMessage";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * How long OneUptime remembers a message it keeps up to date. An on-call
 * policy run is over in hours; a channel OneUptime created for an incident
 * lives as long as the incident. A row it forgets only means the next change
 * posts a new message instead of editing the old one.
 */
export const WORKSPACE_LIVE_MESSAGE_RETENTION_IN_DAYS: number = 90;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays(
        "createdAt",
        WORKSPACE_LIVE_MESSAGE_RETENTION_IN_DAYS,
      );
    }
  }

  // Every message of a project kept for one key, in every channel it is in.
  @CaptureSpan()
  public async findByMessageKey(data: {
    projectId: ObjectID;
    messageKey: string;
    channelId?: string | undefined;
  }): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        projectId: data.projectId,
        messageKey: data.messageKey,
        ...(data.channelId ? { channelId: data.channelId } : {}),
      },
      select: {
        _id: true,
        projectId: true,
        workspaceType: true,
        messageKey: true,
        destinationType: true,
        channelId: true,
        channelName: true,
        teamId: true,
        messageId: true,
        contentHash: true,
        messageData: true,
        createdAt: true,
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();
