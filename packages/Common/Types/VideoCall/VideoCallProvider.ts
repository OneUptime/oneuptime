/*
 * Where an incident or alert call is held. The value is stored on
 * VideoCallConnection.provider (a provider a project connects once) and on
 * IncidentVideoCall.provider / AlertVideoCall.provider (every call, however
 * it was started).
 *
 * SlackHuddle needs no connection of its own. Slack has no API that starts a
 * huddle, but every channel has a huddle link that starts the channel's
 * huddle when someone opens it, so the call of a Slack incident channel is
 * that link, built from the channel the workspace rule created.
 *
 * CustomLink is a meeting link a person provided: a standing bridge a
 * project connects once (a permanent Zoom room, a Webex space) or a link a
 * responder pastes on one incident.
 */
enum VideoCallProvider {
  Zoom = "Zoom",
  GoogleMeet = "GoogleMeet",
  MicrosoftTeams = "MicrosoftTeams",
  SlackHuddle = "SlackHuddle",
  CustomLink = "CustomLink",
}

export default VideoCallProvider;

export const AllVideoCallProviders: Array<VideoCallProvider> = [
  VideoCallProvider.Zoom,
  VideoCallProvider.GoogleMeet,
  VideoCallProvider.MicrosoftTeams,
  VideoCallProvider.SlackHuddle,
  VideoCallProvider.CustomLink,
];

export function isVideoCallProvider(
  value: unknown,
): value is VideoCallProvider {
  return (
    typeof value === "string" &&
    (AllVideoCallProviders as Array<string>).includes(value)
  );
}

// A product name is a brand: never translated.
export function getVideoCallProviderDisplayName(
  provider: VideoCallProvider | string | undefined,
): string {
  switch (provider) {
    case VideoCallProvider.Zoom:
      return "Zoom";
    case VideoCallProvider.GoogleMeet:
      return "Google Meet";
    case VideoCallProvider.MicrosoftTeams:
      return "Microsoft Teams";
    case VideoCallProvider.SlackHuddle:
      return "Slack huddle";
    case VideoCallProvider.CustomLink:
      return "Meeting link";
    default:
      return provider || "";
  }
}

/*
 * What one call of the provider is called in a sentence: "A Zoom meeting was
 * started", "Join the Slack huddle".
 */
export function getVideoCallNoun(
  provider: VideoCallProvider | string | undefined,
): string {
  switch (provider) {
    case VideoCallProvider.Zoom:
      return "Zoom meeting";
    case VideoCallProvider.GoogleMeet:
      return "Google Meet call";
    case VideoCallProvider.MicrosoftTeams:
      return "Microsoft Teams meeting";
    case VideoCallProvider.SlackHuddle:
      return "Slack huddle";
    default:
      return "video call";
  }
}

function hostIs(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/*
 * The product a meeting link opens, read from its host, so a pasted link or
 * a standing bridge shows the right brand. Anything unrecognised - Webex,
 * Jitsi, a phone bridge's web page - is a CustomLink, which is still a
 * perfectly good call. Never throws: a value that is not a URL is a
 * CustomLink too, and validation is the caller's job.
 */
export function detectVideoCallProviderFromUrl(
  url: string | undefined,
): VideoCallProvider {
  if (!url) {
    return VideoCallProvider.CustomLink;
  }

  let parsed: URL;

  try {
    parsed = new URL(url.trim());
  } catch {
    return VideoCallProvider.CustomLink;
  }

  const hostname: string = parsed.hostname.toLowerCase();

  if (hostIs(hostname, "zoom.us") || hostIs(hostname, "zoomgov.com")) {
    return VideoCallProvider.Zoom;
  }

  if (hostname === "meet.google.com") {
    return VideoCallProvider.GoogleMeet;
  }

  if (
    hostname === "teams.microsoft.com" ||
    hostname === "teams.live.com" ||
    hostname === "teams.cloud.microsoft"
  ) {
    return VideoCallProvider.MicrosoftTeams;
  }

  if (
    hostname === "app.slack.com" &&
    parsed.pathname.toLowerCase().startsWith("/huddle/")
  ) {
    return VideoCallProvider.SlackHuddle;
  }

  return VideoCallProvider.CustomLink;
}
