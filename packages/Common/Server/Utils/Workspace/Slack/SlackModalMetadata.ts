import { JSONObject } from "../../../../Types/JSON";

/*
 * WHERE A SLACK FORM WAS OPENED, CARRIED IN THE FORM ITSELF.
 *
 * A form (a modal view) is opened by a press in a channel - Add Note, Change
 * State - but its submission comes to OneUptime with no channel at all: Slack
 * sends only the view. So what the submission is answered with - a refusal,
 * say - had nowhere to go but a direct message.
 *
 * The view's private_metadata, which Slack hands back untouched with the
 * submission, now carries the channel and thread the form was opened from
 * along with the value it always carried (the record's id), so the
 * submission is answered there, like the press that opened it.
 *
 * A form opened before this was written carries the bare value: read as the
 * value, with nowhere known to answer.
 */

export interface SlackModalOrigin {
  channelId?: string | undefined;
  threadTs?: string | undefined;
  /*
   * The form was opened from a message only the person sees - the incident
   * `/oneuptime incident 42` answers with - where nobody else sees what it
   * does: its submission is answered with what it did.
   */
  isFromPrivateMessage?: boolean | undefined;
}

export interface SlackModalMetadataValue {
  value: string | undefined;
  origin: SlackModalOrigin;
}

// Marks the envelope, so a bare value that happens to be JSON is never read as one.
const ENVELOPE_MARK: string = "oneuptime";

// Slack takes at most 3000 characters of private_metadata.
const MAX_LENGTH: number = 3000;

export default class SlackModalMetadata {
  /*
   * The private_metadata for a form carrying `value`, opened at `origin`.
   * The bare value when there is no origin to carry, or when the envelope
   * would not fit.
   */
  public static write(
    value: string,
    origin: SlackModalOrigin | undefined,
  ): string {
    if (
      !origin ||
      (!origin.channelId && !origin.threadTs && !origin.isFromPrivateMessage)
    ) {
      return value;
    }

    const envelope: JSONObject = {
      [ENVELOPE_MARK]: 1,
      value: value,
    };

    if (origin.channelId) {
      envelope["channelId"] = origin.channelId;
    }

    if (origin.threadTs) {
      envelope["threadTs"] = origin.threadTs;
    }

    if (origin.isFromPrivateMessage) {
      envelope["private"] = 1;
    }

    const written: string = JSON.stringify(envelope);

    return written.length <= MAX_LENGTH ? written : value;
  }

  // What a submission's private_metadata carries.
  public static read(metadata: unknown): SlackModalMetadataValue {
    if (typeof metadata !== "string" || !metadata) {
      return { value: undefined, origin: {} };
    }

    if (metadata.startsWith("{")) {
      try {
        const envelope: unknown = JSON.parse(metadata);

        if (
          envelope &&
          typeof envelope === "object" &&
          !Array.isArray(envelope) &&
          (envelope as JSONObject)[ENVELOPE_MARK] === 1
        ) {
          const read: JSONObject = envelope as JSONObject;
          const origin: SlackModalOrigin = {};

          if (typeof read["channelId"] === "string" && read["channelId"]) {
            origin.channelId = read["channelId"];
          }

          if (typeof read["threadTs"] === "string" && read["threadTs"]) {
            origin.threadTs = read["threadTs"];
          }

          if (read["private"] === 1) {
            origin.isFromPrivateMessage = true;
          }

          return {
            value:
              typeof read["value"] === "string" ? read["value"] : undefined,
            origin: origin,
          };
        }
      } catch {
        // Not the envelope: the bare value, below.
      }
    }

    return { value: metadata, origin: {} };
  }
}
