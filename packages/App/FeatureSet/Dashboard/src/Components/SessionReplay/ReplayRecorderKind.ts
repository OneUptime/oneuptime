import type { SessionReplayRecorderKind } from "Common/Types/Rum/SessionReplay";

/*
 * recorderKind is additive on the manifest. An empty value therefore means
 * an older DOM recording, while an unknown non-empty value is kept visible
 * so a newer recorder never gets silently mislabelled as a browser.
 */

export const MOBILE_SESSION_REPLAY_RECORDER_KIND: SessionReplayRecorderKind =
  "rn-view-tree";

export function isMobileSessionReplay(recorderKind: string): boolean {
  return recorderKind === MOBILE_SESSION_REPLAY_RECORDER_KIND;
}

export function getReplayRecorderKindLabel(recorderKind: string): string {
  if (isMobileSessionReplay(recorderKind)) {
    return "React Native app";
  }

  if (!recorderKind || recorderKind === "dom") {
    return "Web browser";
  }

  return recorderKind;
}

export function getReplayClientLabel(
  recorderKind: string,
): "App" | "Browser" | "Client" {
  if (isMobileSessionReplay(recorderKind)) {
    return "App";
  }

  return !recorderKind || recorderKind === "dom" ? "Browser" : "Client";
}

export function getReplayEventFormatLabel(recorderKind: string): string {
  if (isMobileSessionReplay(recorderKind)) {
    return "Synthetic rrweb event format";
  }

  return !recorderKind || recorderKind === "dom"
    ? "rrweb version"
    : "Event format";
}
