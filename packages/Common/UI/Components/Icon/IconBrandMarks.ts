import ProviderLogo from "../../../Types/ProviderLogo/ProviderLogo";
import { ProviderLogoMarkShapes } from "../../../Types/ProviderLogo/ProviderLogoMark";
import AndroidMark from "../../../Types/ProviderLogo/Marks/android";
import CephMark from "../../../Types/ProviderLogo/Marks/ceph";
import CrossplaneMark from "../../../Types/ProviderLogo/Marks/crossplane";
import DiscordMark from "../../../Types/ProviderLogo/Marks/discord";
import DockerMark from "../../../Types/ProviderLogo/Marks/docker";
import GitHubMark from "../../../Types/ProviderLogo/Marks/github";
import KubernetesMark from "../../../Types/ProviderLogo/Marks/kubernetes";
import MattermostMark from "../../../Types/ProviderLogo/Marks/mattermost";
import MicrosoftTeamsMark from "../../../Types/ProviderLogo/Marks/microsoft-teams";
import ProxmoxMark from "../../../Types/ProviderLogo/Marks/proxmox";
import SlackMark from "../../../Types/ProviderLogo/Marks/slack";
import TelegramMark from "../../../Types/ProviderLogo/Marks/telegram";
import TerraformMark from "../../../Types/ProviderLogo/Marks/terraform";
import WhatsAppMark from "../../../Types/ProviderLogo/Marks/whatsapp";

// The marks the icon set draws as icons of its own.
export type IconBrandMark =
  | ProviderLogo.Android
  | ProviderLogo.Ceph
  | ProviderLogo.Crossplane
  | ProviderLogo.Discord
  | ProviderLogo.Docker
  | ProviderLogo.GitHub
  | ProviderLogo.Kubernetes
  | ProviderLogo.Mattermost
  | ProviderLogo.MicrosoftTeams
  | ProviderLogo.Proxmox
  | ProviderLogo.Slack
  | ProviderLogo.Telegram
  | ProviderLogo.Terraform
  | ProviderLogo.WhatsApp;

/*
 * THE MARKS THE ICON SET DRAWS, WITH THEIR SHAPES: Slack's, Microsoft
 * Teams', GitHub's, Kubernetes' and the others an icon of its own is drawn
 * by (Icon: IconProp.Slack and the rest). Every page draws with Icon, so
 * these are part of every first load.
 *
 * A logo tile of one of them takes its shapes from here, at once
 * (ProviderLogoMarkLoader), rather than loading them as a file of its own:
 * the bundler made a file of every mark a loader names, and a file of a mark
 * the first load holds already was one more file of it - 14 in all, about
 * 1 KiB gzipped of every page's first load
 * (packages/Common/Scripts/first-load-budgets.js).
 */
const ICON_BRAND_MARKS: Readonly<
  Record<IconBrandMark, ProviderLogoMarkShapes>
> = {
  [ProviderLogo.Android]: AndroidMark,
  [ProviderLogo.Ceph]: CephMark,
  [ProviderLogo.Crossplane]: CrossplaneMark,
  [ProviderLogo.Discord]: DiscordMark,
  [ProviderLogo.Docker]: DockerMark,
  [ProviderLogo.GitHub]: GitHubMark,
  [ProviderLogo.Kubernetes]: KubernetesMark,
  [ProviderLogo.Mattermost]: MattermostMark,
  [ProviderLogo.MicrosoftTeams]: MicrosoftTeamsMark,
  [ProviderLogo.Proxmox]: ProxmoxMark,
  [ProviderLogo.Slack]: SlackMark,
  [ProviderLogo.Telegram]: TelegramMark,
  [ProviderLogo.Terraform]: TerraformMark,
  [ProviderLogo.WhatsApp]: WhatsAppMark,
};

// The shapes of a mark the icon set draws, or none for any other.
export const getIconBrandMark: (
  mark: ProviderLogo,
) => ProviderLogoMarkShapes | undefined = (
  mark: ProviderLogo,
): ProviderLogoMarkShapes | undefined => {
  return Object.prototype.hasOwnProperty.call(ICON_BRAND_MARKS, mark)
    ? ICON_BRAND_MARKS[mark as IconBrandMark]
    : undefined;
};

export default ICON_BRAND_MARKS;
