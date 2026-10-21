import {
  VideoCallTranscriptUnavailable,
  VideoCallTranscriptUnavailableReason,
} from "../../../../Types/VideoCall/VideoCallTranscript";
import {
  TranscriptLine,
  TranscriptSourceFormat,
} from "../../../../Utils/VideoCall/TranscriptText";

/*
 * What asking a provider for a call's transcript comes back with: the
 * transcript, or why there is none to read - something the person can act
 * on, never an error of OneUptime's. A provider that fails to answer at all
 * (a timeout, a 5xx, a rate limit) throws instead, like every other
 * request to it (VideoCallHttpClient).
 */
export type VideoCallTranscriptRead =
  | {
      found: true;
      lines: Array<TranscriptLine>;
      format: TranscriptSourceFormat;
    }
  | {
      found: false;
      unavailable: VideoCallTranscriptUnavailable;
    };

export function transcriptFound(data: {
  lines: Array<TranscriptLine>;
  format: TranscriptSourceFormat;
}): VideoCallTranscriptRead {
  return { found: true, lines: data.lines, format: data.format };
}

export function transcriptUnavailable(
  reason: VideoCallTranscriptUnavailableReason,
  message: string,
): VideoCallTranscriptRead {
  return { found: false, unavailable: { reason, message } };
}
