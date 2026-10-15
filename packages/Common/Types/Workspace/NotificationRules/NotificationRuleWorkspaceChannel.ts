import { WorkspaceChannel } from "../../../Server/Utils/Workspace/WorkspaceBase";

export default interface NotificationRuleWorkspaceChannel
  extends WorkspaceChannel {
  // The first rule that asked for the channel.
  notificationRuleId: string;
  /*
   * Every rule that asked for the channel, the first one first. Rules whose
   * templates give the same name share one channel, and each of them counts
   * for who is invited to it. Channels stored before this was recorded have
   * only notificationRuleId.
   */
  notificationRuleIds?: Array<string> | undefined;
}

export class NotificationRuleWorkspaceChannelUtil {
  /*
   * Whether the rule asked for the channel: as its first rule, or as one of
   * the rules that share it. A record's channels are stored JSON, so
   * notificationRuleIds is read only when it is a list.
   */
  public static isChannelOfRule(data: {
    channel: Partial<
      Pick<
        NotificationRuleWorkspaceChannel,
        "notificationRuleId" | "notificationRuleIds"
      >
    >;
    notificationRuleId: string | undefined;
  }): boolean {
    if (!data.notificationRuleId) {
      return false;
    }

    if (data.channel.notificationRuleId === data.notificationRuleId) {
      return true;
    }

    return (
      Array.isArray(data.channel.notificationRuleIds) &&
      data.channel.notificationRuleIds.includes(data.notificationRuleId)
    );
  }
}
