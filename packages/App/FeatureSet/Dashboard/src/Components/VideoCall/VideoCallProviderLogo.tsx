import IconProp from "Common/Types/Icon/IconProp";
import VideoCallProvider, {
  detectVideoCallProviderFromUrl,
  getVideoCallProviderDisplayName,
} from "Common/Types/VideoCall/VideoCallProvider";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The mark of the product a call is held in, so a responder sees at a glance
 * which app the Join button opens. A link a person pasted shows the brand of
 * the product it points at (a pasted Zoom link reads as Zoom); anything else
 * is a plain link mark.
 *
 * The marks are drawn here rather than loaded as images: they render at any
 * size, need no request, and stay in their brand colours in both themes on
 * the white tile they sit on.
 */

export type VideoCallLogoSize = "sm" | "md" | "lg";

const TILE_CLASS: Record<VideoCallLogoSize, string> = {
  sm: "h-6 w-6 rounded-md",
  md: "h-9 w-9 rounded-lg",
  lg: "h-11 w-11 rounded-xl",
};

const MARK_CLASS: Record<VideoCallLogoSize, string> = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-7 w-7",
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

const ZoomMark: FunctionComponent<{ className: string }> = (props: {
  className: string;
}): ReactElement => {
  return (
    <svg
      viewBox="0 0 32 32"
      className={props.className}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill="#0B5CFF" />
      <rect x="6" y="10" width="14" height="12" rx="3" fill="#FFFFFF" />
      <path
        d="M21.5 14.2 25 11.9c.6-.4 1.4 0 1.4.8v6.6c0 .8-.8 1.2-1.4.8l-3.5-2.3z"
        fill="#FFFFFF"
      />
    </svg>
  );
};

const GoogleMeetMark: FunctionComponent<{ className: string }> = (props: {
  className: string;
}): ReactElement => {
  return (
    <svg
      viewBox="0 0 87.5 72"
      className={props.className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#00832D"
        d="M49.5 36l8.53 9.75 11.47 7.33 2-17.02-2-16.64-11.69 6.44z"
      />
      <path
        fill="#0066DA"
        d="M0 51.5V66c0 3.315 2.685 6 6 6h14.5l3-10.96-3-9.54-9.95-3z"
      />
      <path fill="#E94235" d="M20.5 0L0 20.5l10.55 3 9.95-3 2.95-9.41z" />
      <path fill="#2684FC" d="M20.5 20.5H0v31h20.5z" />
      <path
        fill="#00AC47"
        d="M82.6 8.68L69.5 19.42v33.66l13.16 10.79c1.97 1.54 4.85.135 4.85-2.37V11c0-2.535-2.945-3.925-4.91-2.32zM49.5 36v15.5h-29V72h43c3.315 0 6-2.685 6-6V53.08z"
      />
      <path
        fill="#FFBA00"
        d="M63.5 0h-43v20.5h29V36l20-16.57V6c0-3.315-2.685-6-6-6z"
      />
    </svg>
  );
};

const MicrosoftTeamsMark: FunctionComponent<{ className: string }> = (props: {
  className: string;
}): ReactElement => {
  return (
    <svg
      viewBox="0 0 32 32"
      className={props.className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="24.5" cy="8.5" r="3.5" fill="#7B83EB" />
      <path
        d="M20 13.5h9.2c.7 0 1.3.6 1.3 1.3v6.4a5 5 0 0 1-5 5h-.3a5.2 5.2 0 0 1-5.2-5.2z"
        fill="#7B83EB"
      />
      <circle cx="16" cy="7" r="4.5" fill="#5059C9" />
      <rect x="9" y="12" width="16" height="16" rx="3" fill="#5059C9" />
      <rect x="1.5" y="8" width="16" height="16" rx="2.5" fill="#4B53BC" />
      <path d="M5.5 12.5h8v2h-3v6.5h-2v-6.5h-3z" fill="#FFFFFF" />
    </svg>
  );
};

const SlackMark: FunctionComponent<{ className: string }> = (props: {
  className: string;
}): ReactElement => {
  return (
    <svg
      viewBox="0 0 127 127"
      className={props.className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#E01E5A"
        d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z"
      />
      <path
        fill="#36C5F0"
        d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z"
      />
      <path
        fill="#2EB67D"
        d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z"
      />
      <path
        fill="#ECB22E"
        d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z"
      />
    </svg>
  );
};

const VideoCallProviderLogo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const size: VideoCallLogoSize = props.size || "md";
  const provider: VideoCallProvider = getDisplayedVideoCallProvider(
    props.provider,
    props.joinUrl,
  );
  const markClass: string = MARK_CLASS[size];

  let mark: ReactElement;

  switch (provider) {
    case VideoCallProvider.Zoom:
      // Zoom's mark is its own tile, so it fills the whole of ours.
      return (
        <span
          role="img"
          aria-label={getVideoCallProviderDisplayName(provider)}
          data-testid={`video-call-logo-${provider}`}
          className={`inline-flex flex-shrink-0 overflow-hidden ${TILE_CLASS[size]} ${props.className || ""}`}
        >
          <ZoomMark className="h-full w-full" />
        </span>
      );
    case VideoCallProvider.GoogleMeet:
      mark = <GoogleMeetMark className={markClass} />;
      break;
    case VideoCallProvider.MicrosoftTeams:
      mark = <MicrosoftTeamsMark className={markClass} />;
      break;
    case VideoCallProvider.SlackHuddle:
      mark = <SlackMark className={markClass} />;
      break;
    default:
      return (
        <span
          role="img"
          aria-label={getVideoCallProviderDisplayName(provider)}
          data-testid={`video-call-logo-${provider}`}
          className={`inline-flex flex-shrink-0 items-center justify-center bg-gray-100 text-gray-500 ring-1 ring-inset ring-gray-200 ${TILE_CLASS[size]} ${props.className || ""}`}
        >
          <Icon icon={IconProp.Link} className={markClass} />
        </span>
      );
  }

  return (
    <span
      role="img"
      aria-label={getVideoCallProviderDisplayName(provider)}
      data-testid={`video-call-logo-${provider}`}
      className={`inline-flex flex-shrink-0 items-center justify-center bg-white ring-1 ring-inset ring-gray-200 ${TILE_CLASS[size]} ${props.className || ""}`}
    >
      {mark}
    </span>
  );
};

export default VideoCallProviderLogo;
