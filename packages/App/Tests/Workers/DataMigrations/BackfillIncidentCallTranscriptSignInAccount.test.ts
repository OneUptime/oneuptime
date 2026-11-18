import IncidentVideoCallService from "Common/Server/Services/IncidentVideoCallService";
import logger from "Common/Server/Utils/Logger";
import { ZOOM_SIGN_IN_REMOVED_MESSAGE } from "Common/Server/Utils/VideoCall/OAuth/ZoomOAuthEvents";
import IncidentCallTranscriptSignInBackfill, {
  MARK_TRANSCRIPTS_OF_REMOVED_SIGN_INS_STATEMENT,
  NAME_TRANSCRIPTS_AFTER_SIGN_INS_STATEMENT,
  REMOVED_SIGN_IN_ACCOUNT_PREFIX,
} from "Common/Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptSignInBackfill";
import VideoCallAuthMethod from "Common/Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider from "Common/Types/VideoCall/VideoCallProvider";
import { VideoCallTranscriptSource } from "Common/Types/VideoCall/VideoCallTranscript";
import BackfillIncidentCallTranscriptSignInAccount from "../../../FeatureSet/Workers/DataMigrations/BackfillIncidentCallTranscriptSignInAccount";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * BackfillIncidentCallTranscriptSignInAccount names the account whose
 * sign-in read each incident call transcript an earlier release read
 * (IncidentVideoCall.transcriptSignInAccountId, #9289), so that account
 * removing OneUptime from Zoom deletes it, and marks for deletion the
 * transcripts of a sign-in Zoom already removed - which an earlier release
 * left behind. Its statements run against a real Postgres in
 * IncidentCallTranscriptRemovalPostgres (Common); here:
 *
 *   1. it is registered once, before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   2. it runs both statements, each with the values it names;
 *   3. a failure fails the run, so the runner tries it again on the next
 *      boot; rollback changes nothing.
 */

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

let queries: Array<{ sql: string; parameters: Array<string> }>;
let answers: Array<Array<{ count: string }>>;

beforeEach(() => {
  queries = [];
  answers = [[{ count: "4" }], [{ count: "1" }]];

  jest.spyOn(IncidentVideoCallService, "getRepository").mockReturnValue({
    manager: {
      query: async (
        sql: string,
        parameters: Array<string>,
      ): Promise<Array<{ count: string }>> => {
        queries.push({ sql, parameters });
        return answers.shift() || [{ count: "0" }];
      },
    },
  } as never);
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("BackfillIncidentCallTranscriptSignInAccount", () => {
  test("is registered once, before the slot AddAuditLogMcpClientColumns keeps last", () => {
    const index: string = fs
      .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === "BackfillIncidentCallTranscriptSignInAccount";
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(
      registered.indexOf("BackfillIncidentCallTranscriptSignInAccount"),
    ).toBe(registered.length - 2);
  });

  test("names the transcripts read through a sign-in, then marks those of a sign-in Zoom removed", async () => {
    await new BackfillIncidentCallTranscriptSignInAccount().migrate();

    expect(queries).toEqual([
      {
        sql: NAME_TRANSCRIPTS_AFTER_SIGN_INS_STATEMENT,
        parameters: [
          VideoCallAuthMethod.OAuth,
          VideoCallTranscriptSource.Provider,
        ],
      },
      {
        sql: MARK_TRANSCRIPTS_OF_REMOVED_SIGN_INS_STATEMENT,
        parameters: [
          REMOVED_SIGN_IN_ACCOUNT_PREFIX,
          VideoCallProvider.Zoom,
          VideoCallAuthMethod.OAuth,
          ZOOM_SIGN_IN_REMOVED_MESSAGE,
          VideoCallTranscriptSource.Provider,
        ],
      },
    ]);
  });

  test("says how many it named and marked", async () => {
    await expect(IncidentCallTranscriptSignInBackfill.run()).resolves.toEqual({
      named: 4,
      marked: 1,
    });
  });

  test("each statement names only calls it has not named, so a second run, or two at once, change nothing twice", () => {
    for (const statement of [
      NAME_TRANSCRIPTS_AFTER_SIGN_INS_STATEMENT,
      MARK_TRANSCRIPTS_OF_REMOVED_SIGN_INS_STATEMENT,
    ]) {
      expect(statement).toContain(
        `"call"."transcriptSignInAccountId" IS NULL`,
      );
      expect(statement).toContain(`"call"."deletedAt" IS NULL`);
      expect(statement).toContain(`"call"."transcriptSource" = `);
    }

    // Only a connection Zoom signed out is read as one whose sign-in it removed.
    expect(MARK_TRANSCRIPTS_OF_REMOVED_SIGN_INS_STATEMENT).toContain(
      `"connection"."connectedAccountId" IS NULL`,
    );
    expect(MARK_TRANSCRIPTS_OF_REMOVED_SIGN_INS_STATEMENT).toContain(
      `"connection"."lastError" = $4`,
    );
  });

  test("a failure fails the run: the runner tries it again", async () => {
    jest.spyOn(IncidentVideoCallService, "getRepository").mockReturnValue({
      manager: {
        query: async (): Promise<never> => {
          throw new Error("Database not connected");
        },
      },
    } as never);

    await expect(
      new BackfillIncidentCallTranscriptSignInAccount().migrate(),
    ).rejects.toThrow("Database not connected");
  });

  test("rollback changes nothing: the column goes with its schema migration", async () => {
    await new BackfillIncidentCallTranscriptSignInAccount().rollback();

    expect(queries).toEqual([]);
  });
});
