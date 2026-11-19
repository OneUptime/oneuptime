import VideoCallAuthMethod from "../../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import { VideoCallTranscriptSource } from "../../../../Types/VideoCall/VideoCallTranscript";
import IncidentVideoCallService from "../../../Services/IncidentVideoCallService";
import logger from "../../Logger";
import { ZOOM_SIGN_IN_REMOVED_MESSAGE } from "../OAuth/ZoomOAuthEvents";

/*
 * THE CALL TRANSCRIPTS AN EARLIER RELEASE READ THROUGH SOMEONE'S SIGN-IN,
 * NAMED (issue #9289).
 *
 * From this release on, a transcript OneUptime reads from Zoom, Google Meet
 * or Microsoft Teams through a connection made by signing in names the
 * account whose sign-in read it (IncidentVideoCall.transcriptSignInAccountId),
 * so that the account removing OneUptime deletes it. A transcript an
 * earlier release read did not, and is named here, once, by the data
 * migration BackfillIncidentCallTranscriptSignInAccount:
 *
 *   - one whose connection is still signed in is named after the account
 *     it is signed in as: a call's transcript is read through the
 *     connection that started it, and only the account that hosts a
 *     meeting can read its transcript;
 *   - one whose connection's sign-in Zoom already removed (app_deauthorized
 *     before this release, which deleted the sign-in and left the
 *     transcripts) is marked for deletion now, as the event would mark it
 *     today: nothing can have been read through that connection since, as
 *     it has had no sign-in. Its account is gone with the sign-in, so the
 *     call is named after the connection instead, which nothing else uses.
 *
 * Postgres only. Idempotent: a call named once is never named again.
 */

// What a call whose connection's sign-in was removed is named after.
export const REMOVED_SIGN_IN_ACCOUNT_PREFIX: string = "removed-sign-in:";

export const NAME_TRANSCRIPTS_AFTER_SIGN_INS_STATEMENT: string = `WITH "named" AS (
  UPDATE "IncidentVideoCall" AS "call"
  SET "transcriptSignInAccountId" = "connection"."connectedAccountId", "version" = "call"."version" + 1, "updatedAt" = now()
  FROM "VideoCallConnection" AS "connection"
  WHERE "call"."videoCallConnectionId" = "connection"."_id"
    AND "connection"."authMethod" = $1
    AND "connection"."connectedAccountId" IS NOT NULL
    AND "call"."transcriptSource" = $2
    AND "call"."transcriptSignInAccountId" IS NULL
    AND "call"."deletedAt" IS NULL
  RETURNING "call"."_id"
)
SELECT COUNT(*) AS "count" FROM "named"`;

export const MARK_TRANSCRIPTS_OF_REMOVED_SIGN_INS_STATEMENT: string = `WITH "marked" AS (
  UPDATE "IncidentVideoCall" AS "call"
  SET "transcriptSignInAccountId" = $1 || "connection"."_id"::text, "transcriptSignInRemovedAt" = now(), "version" = "call"."version" + 1, "updatedAt" = now()
  FROM "VideoCallConnection" AS "connection"
  WHERE "call"."videoCallConnectionId" = "connection"."_id"
    AND "connection"."provider" = $2
    AND "connection"."authMethod" = $3
    AND "connection"."connectedAccountId" IS NULL
    AND "connection"."lastError" = $4
    AND "call"."transcriptSource" = $5
    AND "call"."transcriptSignInAccountId" IS NULL
    AND "call"."deletedAt" IS NULL
  RETURNING "call"."_id"
)
SELECT COUNT(*) AS "count" FROM "marked"`;

export interface TranscriptSignInBackfillSummary {
  // Transcripts named after the account their connection is signed in as.
  named: number;
  // Transcripts of a sign-in Zoom removed before, marked for deletion.
  marked: number;
}

export default class IncidentCallTranscriptSignInBackfill {
  public static async run(): Promise<TranscriptSignInBackfillSummary> {
    const query: (
      sql: string,
      parameters: Array<string>,
    ) => Promise<Array<{ count?: string | number }>> = async (
      sql: string,
      parameters: Array<string>,
    ): Promise<Array<{ count?: string | number }>> => {
      return (await IncidentVideoCallService.getRepository().manager.query(
        sql,
        parameters,
      )) as Array<{ count?: string | number }>;
    };

    const named: Array<{ count?: string | number }> = await query(
      NAME_TRANSCRIPTS_AFTER_SIGN_INS_STATEMENT,
      [VideoCallAuthMethod.OAuth, VideoCallTranscriptSource.Provider],
    );

    const marked: Array<{ count?: string | number }> = await query(
      MARK_TRANSCRIPTS_OF_REMOVED_SIGN_INS_STATEMENT,
      [
        REMOVED_SIGN_IN_ACCOUNT_PREFIX,
        VideoCallProvider.Zoom,
        VideoCallAuthMethod.OAuth,
        ZOOM_SIGN_IN_REMOVED_MESSAGE,
        VideoCallTranscriptSource.Provider,
      ],
    );

    const summary: TranscriptSignInBackfillSummary = {
      named: Number(named[0]?.count || 0),
      marked: Number(marked[0]?.count || 0),
    };

    logger.info(
      `IncidentCallTranscriptSignInBackfill: ${summary.named} call transcript(s) named after the sign-in that read them, ${summary.marked} of a sign-in Zoom removed before marked for deletion.`,
    );

    return summary;
  }
}
