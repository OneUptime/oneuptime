import { MicrosoftTeamsCloudSetting } from "Common/UI/Config";
import MicrosoftTeamsCloudUtil from "Common/Types/Workspace/MicrosoftTeamsCloud";

/*
 * The OneUptime app in Microsoft Teams: its install dialog, or the app once
 * added. The app's id is the bot's (the manifest's `id`), on OneUptime
 * Cloud and on a self-hosted server alike - and the Teams is that of the
 * Microsoft cloud the server's Teams runs in (MICROSOFT_TEAMS_CLOUD):
 * gov.teams.microsoft.us for GCC High, dod.teams.microsoft.us for DoD,
 * teams.microsoft.com otherwise. A setting that names no cloud costs only a
 * link, so it opens the commercial cloud's Teams.
 */
export const getMicrosoftTeamsAppLink: (
  clientId: string,
  cloudSetting?: string | null,
) => string = (
  clientId: string,
  cloudSetting: string | null = MicrosoftTeamsCloudSetting,
): string => {
  return `${
    MicrosoftTeamsCloudUtil.getHostsOrCommercial(cloudSetting).teamsWebOrigin
  }/l/app/${encodeURIComponent(clientId)}`;
};
