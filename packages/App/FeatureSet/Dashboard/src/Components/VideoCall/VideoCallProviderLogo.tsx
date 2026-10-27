import IconProp from "Common/Types/Icon/IconProp";
import ProviderLogo from "Common/Types/ProviderLogo/ProviderLogo";
import VideoCallProvider, {
  detectVideoCallProviderFromUrl,
  getVideoCallProviderDisplayName,
} from "Common/Types/VideoCall/VideoCallProvider";
import { ProviderLogoSize } from "Common/UI/Components/ProviderLogo/ProviderLogoImage";
import ProviderLogoOrIcon from "Common/UI/Components/ProviderLogo/ProviderLogoOrIcon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The official logo of the product a call is held in, so a responder sees
 * at a glance which app the Join button opens. A link a person pasted shows
 * the brand of the product it points at (a pasted Zoom link reads as Zoom);
 * anything else is a plain link mark on the same tile.
 *
 * The logos are the shared ones (Common/UI/Components/ProviderLogo): part of
 * the installation, never fetched from another address, and drawn in the
 * brand's own mark for dark backgrounds where it has one. A Slack huddle is
 * held in Slack, so it shows Slack's logo. The image is named after the call
 * ("Slack huddle"), not only the brand.
 */

export type VideoCallLogoSize = "sm" | "md" | "lg";

const TILE_SIZES: Readonly<Record<VideoCallLogoSize, ProviderLogoSize>> = {
  sm: 24,
  md: 36,
  lg: 44,
};

// The logo each provider's calls are drawn with; none for a meeting link.
export const VIDEO_CALL_PROVIDER_LOGOS: Readonly<
  Partial<Record<VideoCallProvider, ProviderLogo>>
> = {
  [VideoCallProvider.Zoom]: ProviderLogo.Zoom,
  [VideoCallProvider.GoogleMeet]: ProviderLogo.GoogleMeet,
  [VideoCallProvider.MicrosoftTeams]: ProviderLogo.MicrosoftTeams,
  [VideoCallProvider.SlackHuddle]: ProviderLogo.Slack,
};

export interface ComponentProps {
  provider: VideoCallProvider | undefined;
  // A link's own brand wins over CustomLink.
  joinUrl?: string | undefined;
  size?: VideoCallLogoSize | undefined;
  className?: string | undefined;
}

export function getDisplayedVideoCallProvider(
  provider: VideoCallProvider | undefined,
  joinUrl?: string | undefined,
): VideoCallProvider {
  if (!provider || provider === VideoCallProvider.CustomLink) {
    return detectVideoCallProviderFromUrl(joinUrl);
  }

  return provider;
}

const VideoCallProviderLogo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const provider: VideoCallProvider = getDisplayedVideoCallProvider(
    props.provider,
    props.joinUrl,
  );

  return (
    <span
      role="img"
      aria-label={getVideoCallProviderDisplayName(provider)}
      data-testid={`video-call-logo-${provider}`}
      className={`inline-flex flex-shrink-0 ${props.className || ""}`}
    >
      <ProviderLogoOrIcon
        logo={VIDEO_CALL_PROVIDER_LOGOS[provider]}
        icon={IconProp.Link}
        size={TILE_SIZES[props.size || "md"]}
        isDecorative={true}
      />
    </span>
  );
};

export default VideoCallProviderLogo;
