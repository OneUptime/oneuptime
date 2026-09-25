/*
 * The attributes ReplayStage stamps on the replay document to turn text
 * selection on. They live here, React-free, so the frame capture
 * (ReplayFrameCapture) can leave the selection affordances out of a
 * screenshot - they are viewer chrome, not something the recorded page
 * drew - without importing the component, and so without pulling React
 * into the App tests that reach the capture.
 */
export const REPLAY_TEXT_SELECTION_ATTRIBUTE: string =
  "data-oneuptime-replay-text-selection";
export const REPLAY_TEXT_SELECTION_STYLE_ATTRIBUTE: string =
  "data-oneuptime-replay-text-selection-style";
export const REPLAY_SHADOW_TEXT_SELECTION_STYLE_ATTRIBUTE: string =
  "data-oneuptime-replay-shadow-text-selection-style";
