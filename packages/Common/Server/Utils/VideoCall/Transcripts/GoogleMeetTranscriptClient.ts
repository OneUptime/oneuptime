import APIException from "../../../../Types/Exception/ApiException";
import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";
import { VideoCallTranscriptUnavailableReason } from "../../../../Types/VideoCall/VideoCallTranscript";
import {
  TranscriptLine,
  TranscriptSourceFormat,
} from "../../../../Utils/VideoCall/TranscriptText";
import VideoCallHttpClient, {
  VideoCallHttpResponse,
} from "../VideoCallHttpClient";
import {
  VideoCallTranscriptRead,
  transcriptFound,
  transcriptUnavailable,
} from "./VideoCallTranscriptRead";

/*
 * Reads the transcript of a Google Meet space OneUptime created, through
 * the Meet REST API.
 *
 * A space is a room: every time people meet in it is a conference, and
 * every time someone turns transcription on in a conference is a
 * transcript, whose entries are what was said, by whom and when. So the
 * call's transcript is the entries of every finished transcript of every
 * conference in the space, in order, with each speaker's name from the
 * conference's participants.
 * https://developers.google.com/workspace/meet/api/guides/artifacts
 *
 * The meetings.space.created scope OneUptime already holds for creating
 * spaces lets it read their conferences, transcripts, entries and
 * participants too: nothing more to grant, for a sign-in or a service
 * account with domain-wide delegation.
 * https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.transcripts.entries/list
 *
 * Google deletes the entries 30 days after the conference ends.
 */

export interface GoogleMeetTranscriptRequest {
  http: VideoCallHttpClient;
  accessToken: string;
  // The space's resource name, "spaces/abc123", as OneUptime stored it.
  spaceName: string;
  // A person's sign-in to this server's Google app, rather than a service account.
  isSignIn: boolean;
  // Who the space belongs to, for a message.
  ownerLabel?: string | undefined;
  now?: Date | undefined;
}

export const GOOGLE_MEET_API_BASE_URL: string = "https://meet.googleapis.com/v2";

// How long Google keeps a conference's transcript entries.
export const GOOGLE_MEET_ENTRY_RETENTION_IN_DAYS: number = 30;

// Pages of each list read at most: far past any one incident's call.
const MAX_PAGES: number = 50;
const MAX_ENTRIES: number = 20_000;

const ENTRIES_PAGE_SIZE: number = 100;
const PARTICIPANTS_PAGE_SIZE: number = 250;
const LIST_PAGE_SIZE: number = 100;

// A space's resource name, as the Meet API wrote it when it was created.
const SPACE_NAME_PATTERN: RegExp = /^spaces\/[A-Za-z0-9_-]{1,128}$/;
const SERVICE_DISABLED_PATTERN: RegExp = /SERVICE_DISABLED/;

interface ConferenceRecord {
  name: string;
  startTime?: number | undefined;
  endTime?: number | undefined;
}

interface TranscriptRecord {
  name: string;
  state: string;
}

export default class GoogleMeetTranscriptClient {
  public static async readTranscript(
    request: GoogleMeetTranscriptRequest,
  ): Promise<VideoCallTranscriptRead> {
    const spaceName: string = request.spaceName.trim();

    if (!SPACE_NAME_PATTERN.test(spaceName)) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NotSupported,
        "OneUptime has no Google Meet space for this call, so it cannot ask Google for its transcript. Add the transcript yourself.",
      );
    }

    const conferencesOrRefusal: Array<ConferenceRecord> | VideoCallTranscriptRead =
      await GoogleMeetTranscriptClient.listConferences(request, spaceName);

    if (!Array.isArray(conferencesOrRefusal)) {
      return conferencesOrRefusal;
    }

    const conferences: Array<ConferenceRecord> = conferencesOrRefusal;

    if (conferences.length === 0) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NoMeeting,
        "Nobody has met in this Google Meet yet, or the call ended moments ago. Try again after the call.",
      );
    }

    const lines: Array<TranscriptLine> = [];
    const firstStart: number | undefined = conferences[0]!.startTime;
    let transcriptCount: number = 0;
    let isStillTranscribing: boolean = false;

    for (const conference of conferences) {
      const transcriptsOrRefusal:
        | Array<TranscriptRecord>
        | VideoCallTranscriptRead = await GoogleMeetTranscriptClient.listAll<
        TranscriptRecord
      >({
        request,
        url: `${GOOGLE_MEET_API_BASE_URL}/${conference.name}/transcripts`,
        pageSize: LIST_PAGE_SIZE,
        listKey: "transcripts",
        stepLabel: "Google Meet transcripts request",
        read: GoogleMeetTranscriptClient.readTranscriptRecord,
      });

      if (!Array.isArray(transcriptsOrRefusal)) {
        return transcriptsOrRefusal;
      }

      transcriptCount += transcriptsOrRefusal.length;

      const finished: Array<TranscriptRecord> = [];

      for (const transcript of transcriptsOrRefusal) {
        if (transcript.state === "STARTED") {
          isStillTranscribing = true;
        } else if (
          transcript.state === "ENDED" ||
          transcript.state === "FILE_GENERATED"
        ) {
          finished.push(transcript);
        }
      }

      if (finished.length === 0) {
        continue;
      }

      const names: Map<string, string> | VideoCallTranscriptRead =
        await GoogleMeetTranscriptClient.readParticipantNames(
          request,
          conference,
        );

      if (!(names instanceof Map)) {
        return names;
      }

      for (const transcript of finished) {
        const entriesOrRefusal:
          | Array<TranscriptLine>
          | VideoCallTranscriptRead = await GoogleMeetTranscriptClient.listAll<
          TranscriptLine
        >({
          request,
          url: `${GOOGLE_MEET_API_BASE_URL}/${transcript.name}/entries`,
          pageSize: ENTRIES_PAGE_SIZE,
          listKey: "transcriptEntries",
          stepLabel: "Google Meet transcript entries request",
          read: (entry: JSONObject): TranscriptLine | null => {
            return GoogleMeetTranscriptClient.readEntry({
              entry,
              names,
              firstStart,
            });
          },
          maxItems: MAX_ENTRIES - lines.length,
        });

        if (!Array.isArray(entriesOrRefusal)) {
          return entriesOrRefusal;
        }

        lines.push(...entriesOrRefusal);

        if (lines.length >= MAX_ENTRIES) {
          break;
        }
      }
    }

    if (lines.length > 0) {
      lines.sort((left: TranscriptLine, right: TranscriptLine): number => {
        return (left.offsetInSeconds ?? 0) - (right.offsetInSeconds ?? 0);
      });

      return transcriptFound({ lines, format: TranscriptSourceFormat.Text });
    }

    if (isStillTranscribing) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NotReady,
        "Transcription is still running in this Google Meet call. Get the transcript after the call ends.",
      );
    }

    if (transcriptCount === 0) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NotTranscribed,
        "Nobody turned on transcription in this Google Meet call. Turn on Transcripts in the call (Activities > Transcripts), or ask your Google Workspace admin to transcribe meetings by default. You can add the transcript yourself.",
      );
    }

    const lastEnd: number | undefined = conferences
      .map((conference: ConferenceRecord): number => {
        return conference.endTime ?? 0;
      })
      .reduce((left: number, right: number): number => {
        return Math.max(left, right);
      }, 0);
    const now: number = (request.now || new Date()).getTime();

    if (
      lastEnd &&
      now - lastEnd >
        GOOGLE_MEET_ENTRY_RETENTION_IN_DAYS * 24 * 60 * 60 * 1000
    ) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.Expired,
        `Google keeps a call's transcript for apps to read for ${GOOGLE_MEET_ENTRY_RETENTION_IN_DAYS} days after it ends, and this call ended longer ago. The transcript document is still in the organizer's Google Drive: you can add it yourself.`,
      );
    }

    return transcriptUnavailable(
      VideoCallTranscriptUnavailableReason.NotReady,
      "Google is still preparing this call's transcript. Try again in a few minutes.",
    );
  }

  // Every conference held in the space, oldest first.
  private static async listConferences(
    request: GoogleMeetTranscriptRequest,
    spaceName: string,
  ): Promise<Array<ConferenceRecord> | VideoCallTranscriptRead> {
    // The name was checked to be "spaces/" and an id: nothing in it ends the quotes.
    const filter: string = `space.name = "${spaceName}"`;

    const conferences: Array<ConferenceRecord> | VideoCallTranscriptRead =
      await GoogleMeetTranscriptClient.listAll<ConferenceRecord>({
        request,
        url: `${GOOGLE_MEET_API_BASE_URL}/conferenceRecords`,
        pageSize: LIST_PAGE_SIZE,
        listKey: "conferenceRecords",
        stepLabel: "Google Meet conferences request",
        extraParams: { filter },
        read: (record: JSONObject): ConferenceRecord | null => {
          const name: JSONValue | undefined = record["name"];

          if (typeof name !== "string" || !name.startsWith("conferenceRecords/")) {
            return null;
          }

          return {
            name,
            startTime: GoogleMeetTranscriptClient.readTime(record["startTime"]),
            endTime: GoogleMeetTranscriptClient.readTime(record["endTime"]),
          };
        },
      });

    if (!Array.isArray(conferences)) {
      return conferences;
    }

    return conferences.sort(
      (left: ConferenceRecord, right: ConferenceRecord): number => {
        return (left.startTime ?? 0) - (right.startTime ?? 0);
      },
    );
  }

  // Each participant's name, by the participant's resource name.
  private static async readParticipantNames(
    request: GoogleMeetTranscriptRequest,
    conference: ConferenceRecord,
  ): Promise<Map<string, string> | VideoCallTranscriptRead> {
    const participants:
      | Array<{ name: string; displayName: string }>
      | VideoCallTranscriptRead = await GoogleMeetTranscriptClient.listAll<{
      name: string;
      displayName: string;
    }>({
      request,
      url: `${GOOGLE_MEET_API_BASE_URL}/${conference.name}/participants`,
      pageSize: PARTICIPANTS_PAGE_SIZE,
      listKey: "participants",
      stepLabel: "Google Meet participants request",
      read: (
        participant: JSONObject,
      ): { name: string; displayName: string } | null => {
        const name: JSONValue | undefined = participant["name"];

        if (typeof name !== "string") {
          return null;
        }

        for (const kind of ["signedinUser", "anonymousUser", "phoneUser"]) {
          const user: JSONValue | undefined = participant[kind];

          if (user && typeof user === "object" && !Array.isArray(user)) {
            const displayName: JSONValue | undefined = (user as JSONObject)[
              "displayName"
            ];

            if (typeof displayName === "string" && displayName.trim()) {
              return { name, displayName: displayName.trim() };
            }
          }
        }

        return null;
      },
    });

    if (!Array.isArray(participants)) {
      return participants;
    }

    const names: Map<string, string> = new Map<string, string>();

    for (const participant of participants) {
      names.set(participant.name, participant.displayName);
    }

    return names;
  }

  private static readTranscriptRecord(
    record: JSONObject,
  ): TranscriptRecord | null {
    const name: JSONValue | undefined = record["name"];
    const state: JSONValue | undefined = record["state"];

    if (typeof name !== "string" || !name) {
      return null;
    }

    return { name, state: typeof state === "string" ? state : "" };
  }

  private static readEntry(data: {
    entry: JSONObject;
    names: Map<string, string>;
    firstStart: number | undefined;
  }): TranscriptLine | null {
    const text: JSONValue | undefined = data.entry["text"];

    if (typeof text !== "string" || !text.trim()) {
      return null;
    }

    const line: TranscriptLine = { text: text.trim() };
    const participant: JSONValue | undefined = data.entry["participant"];

    if (typeof participant === "string") {
      const speaker: string | undefined = data.names.get(participant);

      if (speaker) {
        line.speaker = speaker;
      }
    }

    const startTime: number | undefined = GoogleMeetTranscriptClient.readTime(
      data.entry["startTime"],
    );

    if (startTime !== undefined && data.firstStart !== undefined) {
      line.offsetInSeconds = Math.max(0, (startTime - data.firstStart) / 1000);
    }

    return line;
  }

  private static readTime(value: JSONValue | undefined): number | undefined {
    if (typeof value !== "string" || !value) {
      return undefined;
    }

    const time: number = Date.parse(value);

    return Number.isFinite(time) ? time : undefined;
  }

  /*
   * Every item of a paged list, read with `read` (null leaves an item out),
   * or why the list could not be read.
   */
  private static async listAll<T>(data: {
    request: GoogleMeetTranscriptRequest;
    url: string;
    pageSize: number;
    listKey: string;
    stepLabel: string;
    read: (item: JSONObject) => T | null;
    extraParams?: Record<string, string> | undefined;
    maxItems?: number | undefined;
  }): Promise<Array<T> | VideoCallTranscriptRead> {
    const items: Array<T> = [];
    let pageToken: string = "";

    for (let page: number = 0; page < MAX_PAGES; page++) {
      const params: URLSearchParams = new URLSearchParams({
        pageSize: String(data.pageSize),
        ...(data.extraParams || {}),
      });

      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const response: VideoCallHttpResponse = await data.request.http.request({
        url: `${data.url}?${params.toString()}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${data.request.accessToken}`,
          Accept: "application/json",
        },
        stepLabel: data.stepLabel,
      });

      if (!response.ok) {
        return GoogleMeetTranscriptClient.readRefusal(response, data.request);
      }

      const list: JSONValue | undefined = response.json?.[data.listKey];

      for (const item of Array.isArray(list) ? (list as JSONArray) : []) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          continue;
        }

        const read: T | null = data.read(item as JSONObject);

        if (read !== null) {
          items.push(read);
        }

        if (data.maxItems !== undefined && items.length >= data.maxItems) {
          return items;
        }
      }

      const next: JSONValue | undefined = response.json?.["nextPageToken"];

      if (typeof next !== "string" || !next) {
        break;
      }

      pageToken = next;
    }

    return items;
  }

  // What a refused request means for the transcript, or a throw when Google did not answer.
  private static readRefusal(
    response: VideoCallHttpResponse,
    request: GoogleMeetTranscriptRequest,
  ): VideoCallTranscriptRead {
    const summary: string = VideoCallHttpClient.summarizeErrorBody(response);

    if (SERVICE_DISABLED_PATTERN.test(response.bodyText)) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.PermissionMissing,
        request.isSignIn
          ? `The Google Meet REST API is not enabled for the Google Cloud project of this OneUptime server's Google app. Ask your server administrator to enable it under APIs & Services. (${summary})`
          : `The Google Meet REST API is not enabled for the service account's Google Cloud project. Enable it in the Google Cloud console under APIs & Services. (${summary})`,
      );
    }

    if (response.status === 401) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.ConnectionProblem,
        request.isSignIn
          ? `Google no longer accepts OneUptime's sign-in${request.ownerLabel ? ` for ${request.ownerLabel}` : ""}. Reconnect Google Meet in Project Settings > Workspace > Video Calls. (${summary})`
          : `Google did not accept the service account's token. Check the connection in Project Settings > Workspace > Video Calls. (${summary})`,
      );
    }

    if (response.status === 403) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.PermissionMissing,
        `Google did not let OneUptime read this call's transcript${request.ownerLabel ? ` as ${request.ownerLabel}` : ""}. OneUptime can read the transcripts of the meetings it created, with the same permission it creates them with. (${summary})`,
      );
    }

    if (response.status === 404) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NoMeeting,
        `Google Meet no longer has this call's meeting space. (${summary})`,
      );
    }

    if (response.status === 429) {
      throw new APIException(
        `Google is limiting requests from this account right now. Try again in a minute. (${summary})`,
      );
    }

    if (response.status >= 400 && response.status < 500) {
      return transcriptUnavailable(
        VideoCallTranscriptUnavailableReason.NotSupported,
        `Google Meet could not answer for this call's transcript (HTTP ${response.status}): ${summary}`,
      );
    }

    throw new APIException(
      `Google Meet could not answer for this call's transcript (HTTP ${response.status}): ${summary}`,
    );
  }
}
