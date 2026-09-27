export default interface WorkspaceChannelInvitationPayload {
  workspaceUserIds: Array<string>;
  channelNames: Array<string>;
  /*
   * The same destinations by id, when the caller knows them. Discord thread
   * names are not unique (a recreated thread shares its predecessor's name),
   * so Discord invites by id and ignores channelNames when these are given.
   * Slack and Teams keep inviting by name.
   */
  channelIds?: Array<string>;
}
