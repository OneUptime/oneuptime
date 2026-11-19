import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import IncidentVideoCallService, {
  TakenTranscript,
} from "../../../Server/Services/IncidentVideoCallService";
import logger from "../../../Server/Utils/Logger";
import { ZOOM_SIGN_IN_REMOVED_MESSAGE } from "../../../Server/Utils/VideoCall/OAuth/ZoomOAuthEvents";
import IncidentCallTranscriptSignInBackfill, {
  REMOVED_SIGN_IN_ACCOUNT_PREFIX,
  TranscriptSignInBackfillSummary,
} from "../../../Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptSignInBackfill";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { CallSummaryStatus } from "../../../Types/VideoCall/CallSummary";
import CallSummaryPosts, {
  CallSummaryPost,
} from "../../../Types/VideoCall/CallSummaryPosts";
import VideoCallAuthMethod from "../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import { VideoCallTranscriptSource } from "../../../Types/VideoCall/VideoCallTranscript";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { DataSource, QueryRunner } from "typeorm";

/*
 * A CALL'S TRANSCRIPT, AND WHAT ONEUPTIME AI READ IN IT, TAKEN BACK - ON A
 * REAL POSTGRES (issues #9289 and #9290).
 *
 * The unit suites check what is asked of the database; this runs the
 * statements themselves, which only a database can answer for:
 *
 *   - a reading's write lands only while its run id is still the call's
 *     (one UPDATE, conditional on the JSON column);
 *   - a reading's post is appended to the call's record, from nothing and
 *     after others, only while the transcript it read is still the call's -
 *     and a post kept while a removal holds the call's row waits for it,
 *     then finds the transcript gone, so nothing is kept on a call that no
 *     longer has the transcript;
 *   - a removal takes the transcript and its posts in one locked
 *     transaction: everything for a person, only what a sign-in read for an
 *     account that removed OneUptime;
 *   - an account removing OneUptime marks its calls once, and a second
 *     event keeps when the first came;
 *   - the data migration names the transcripts an earlier release read
 *     through a sign-in, and marks those of a sign-in Zoom already removed.
 *
 * Opt in with RUN_POSTGRES_INCIDENT_CALL_TRANSCRIPT_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The IncidentVideoCall
 * and VideoCallConnection tables' STRUCTURE is cloned into a unique schema
 * (search_path holds only that schema), and dropped afterwards. Credentials
 * from DATABASE_USERNAME / DATABASE_PASSWORD, the database from
 * INCIDENT_CALL_TRANSCRIPT_TEST_DATABASE_NAME or DATABASE_NAME, the
 * endpoint from INCIDENT_CALL_TRANSCRIPT_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_INCIDENT_CALL_TRANSCRIPT_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["VideoCallConnection", "IncidentVideoCall"];
const DASHES: RegExp = /-/g;
// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 10000;

const PROJECT: ObjectID = ObjectID.generate();
const INCIDENT: ObjectID = ObjectID.generate();
const ACCOUNT: string = "KdYKjnimT4KPd8FFgQt9FQ";
const ADDED_AT: Date = new Date("2026-10-17T15:00:00.123Z");

function postOf(feedId: string, signInAccountId?: string): CallSummaryPost {
  return {
    feedId,
    postedAt: "2026-10-17T15:05:00.000Z",
    ...(signInAccountId ? { signInAccountId } : {}),
    messages: [
      {
        workspaceType: WorkspaceType.Slack,
        channelId: "C0INC42",
        channelName: "inc-42",
        messageId: `${feedId}-ts`,
      },
    ],
  };
}

describePostgres("Taking back a call's transcript, against Postgres", () => {
  const schema: string = `call_transcript_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;

  async function insertCall(data: {
    id?: ObjectID;
    provider?: VideoCallProvider;
    connectionId?: ObjectID;
    transcript?: string | null;
    transcriptSource?: VideoCallTranscriptSource | null;
    transcriptAddedAt?: Date | null;
    callSummary?: JSONObject | null;
    callSummaryStatus?: CallSummaryStatus | null;
    callSummaryPosts?: JSONObject | null;
    transcriptSignInAccountId?: string | null;
    deletedAt?: Date | null;
  }): Promise<ObjectID> {
    const id: ObjectID = data.id || ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."IncidentVideoCall" ("_id", "version", "projectId", "incidentId", "provider", "joinUrl", "videoCallConnectionId", "transcript", "transcriptSource", "transcriptAddedAt", "callSummary", "callSummaryStatus", "callSummaryPosts", "transcriptSignInAccountId", "deletedAt")
       VALUES ($1, 1, $2, $3, $4, 'https://zoom.us/j/1', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id.toString(),
        PROJECT.toString(),
        INCIDENT.toString(),
        data.provider || VideoCallProvider.Zoom,
        data.connectionId?.toString() || null,
        data.transcript === undefined
          ? "00:00:01\tPriya\tHi."
          : data.transcript,
        data.transcriptSource === undefined
          ? VideoCallTranscriptSource.Provider
          : data.transcriptSource,
        data.transcriptAddedAt === undefined
          ? ADDED_AT
          : data.transcriptAddedAt,
        data.callSummary ? JSON.stringify(data.callSummary) : null,
        data.callSummaryStatus || null,
        data.callSummaryPosts ? JSON.stringify(data.callSummaryPosts) : null,
        data.transcriptSignInAccountId || null,
        data.deletedAt || null,
      ],
    );

    return id;
  }

  async function insertConnection(data: {
    provider: VideoCallProvider;
    authMethod: VideoCallAuthMethod;
    connectedAccountId: string | null;
    lastError?: string | null;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."VideoCallConnection" ("_id", "version", "projectId", "name", "provider", "authMethod", "connectedAccountId", "lastError")
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
      [
        id.toString(),
        PROJECT.toString(),
        `Zoom ${id.toString().substring(0, 8)}`,
        data.provider,
        data.authMethod,
        data.connectedAccountId,
        data.lastError || null,
      ],
    );

    return id;
  }

  async function readCall(id: ObjectID): Promise<JSONObject> {
    const rows: Array<JSONObject> = await database.query(
      `SELECT * FROM "${schema}"."IncidentVideoCall" WHERE "_id" = $1`,
      [id.toString()],
    );

    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["INCIDENT_CALL_TRANSCRIPT_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["INCIDENT_CALL_TRANSCRIPT_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["INCIDENT_CALL_TRANSCRIPT_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // A fixture names only what a statement reads; ids stay NOT NULL.
    const columns: Array<{ table_name: string; column_name: string }> =
      await database.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = $1 AND is_nullable = 'NO' AND column_name NOT IN ('_id', 'version')`,
        [schema],
      );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest
      .spyOn(PostgresAppInstance, "getDataSource")
      .mockReturnValue(database as never);

    for (const table of [...TABLES].reverse()) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }
  });

  describe("a reading writes what it found only while it is the call's", () => {
    test("its run: written", async () => {
      const id: ObjectID = await insertCall({
        callSummary: { runId: "run-1" },
        callSummaryStatus: CallSummaryStatus.Pending,
      });

      await expect(
        IncidentVideoCallService.writeReadingIfCurrent({
          callId: id,
          runId: "run-1",
          columns: {
            callSummary: { runId: "run-1", version: 1 },
            callSummaryStatus: CallSummaryStatus.Ready,
            rootCauseSuggestionReviewedByUserId: null,
          },
        }),
      ).resolves.toBe(true);

      const row: JSONObject = await readCall(id);

      expect(row["callSummaryStatus"]).toBe(CallSummaryStatus.Ready);
      expect(row["callSummary"]).toEqual({ runId: "run-1", version: 1 });
    });

    test("a newer run, or a transcript removed (no run at all): nothing written", async () => {
      const replaced: ObjectID = await insertCall({
        callSummary: { runId: "run-2" },
        callSummaryStatus: CallSummaryStatus.Pending,
      });
      const removed: ObjectID = await insertCall({
        transcript: null,
        transcriptAddedAt: null,
      });

      for (const id of [replaced, removed]) {
        await expect(
          IncidentVideoCallService.writeReadingIfCurrent({
            callId: id,
            runId: "run-1",
            columns: { callSummaryStatus: CallSummaryStatus.Ready },
          }),
        ).resolves.toBe(false);
      }

      expect((await readCall(replaced))["callSummaryStatus"]).toBe(
        CallSummaryStatus.Pending,
      );
      expect((await readCall(removed))["callSummaryStatus"]).toBeNull();
    });
  });

  describe("a reading's post is kept only while its transcript is the call's", () => {
    test("appended to nothing, then after the others, ids kept whole", async () => {
      const id: ObjectID = await insertCall({});
      const longChat: CallSummaryPost = {
        ...postOf("feed-2"),
        messages: [
          {
            workspaceType: WorkspaceType.MicrosoftTeams,
            channelId: `a:${"1".repeat(140)}`,
            isChat: true,
            messageId: "1760713500123",
          },
        ],
      };

      await expect(
        IncidentVideoCallService.keepCallSummaryPost({
          callId: id,
          transcriptAddedAt: ADDED_AT,
          post: postOf("feed-1", ACCOUNT),
        }),
      ).resolves.toBe(true);
      await expect(
        IncidentVideoCallService.keepCallSummaryPost({
          callId: id,
          transcriptAddedAt: ADDED_AT,
          post: longChat,
        }),
      ).resolves.toBe(true);

      expect(
        CallSummaryPosts.read((await readCall(id))["callSummaryPosts"]),
      ).toEqual([postOf("feed-1", ACCOUNT), longChat]);
    });

    test("a transcript replaced or removed meanwhile keeps nothing, and the caller deletes the post", async () => {
      const replaced: ObjectID = await insertCall({
        transcriptAddedAt: new Date("2026-10-17T15:10:00.000Z"),
      });
      const removed: ObjectID = await insertCall({
        transcript: null,
        transcriptAddedAt: null,
      });
      const deleted: ObjectID = await insertCall({ deletedAt: new Date() });

      for (const id of [replaced, removed, deleted]) {
        await expect(
          IncidentVideoCallService.keepCallSummaryPost({
            callId: id,
            transcriptAddedAt: ADDED_AT,
            post: postOf("feed-1"),
          }),
        ).resolves.toBe(false);
        expect((await readCall(id))["callSummaryPosts"]).toBeNull();
      }
    });

    test("a post kept while a removal holds the call waits for it, then finds the transcript gone", async () => {
      const id: ObjectID = await insertCall({});
      const removal: QueryRunner = database.createQueryRunner();

      await removal.connect();
      await removal.startTransaction();
      await removal.query(
        `SELECT "_id" FROM "${schema}"."IncidentVideoCall" WHERE "_id" = $1 FOR UPDATE`,
        [id.toString()],
      );

      const keeping: Promise<boolean> =
        IncidentVideoCallService.keepCallSummaryPost({
          callId: id,
          transcriptAddedAt: ADDED_AT,
          post: postOf("feed-1"),
        });

      // The keep waits on the removal's lock...
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 300);
      });

      await removal.query(
        `UPDATE "${schema}"."IncidentVideoCall" SET "transcript" = NULL, "transcriptAddedAt" = NULL WHERE "_id" = $1`,
        [id.toString()],
      );
      await removal.commitTransaction();
      await removal.release();

      // ...then reads the row the removal left, and keeps nothing.
      await expect(keeping).resolves.toBe(false);
      expect((await readCall(id))["callSummaryPosts"]).toBeNull();
    });
  });

  describe("a removal takes the transcript and its posts in one locked transaction", () => {
    test("a person: everything - the transcript, the reading, every post, the sign-in's mark", async () => {
      const id: ObjectID = await insertCall({
        callSummary: { runId: "run-1" },
        callSummaryStatus: CallSummaryStatus.Ready,
        callSummaryPosts: CallSummaryPosts.toValue([
          postOf("feed-1", ACCOUNT),
          postOf("feed-2"),
        ]),
        transcriptSignInAccountId: ACCOUNT,
      });

      const taken: TakenTranscript | null =
        await IncidentVideoCallService.takeTranscriptForRemoval({ callId: id });

      expect(taken).not.toBeNull();
      expect(taken!.removedTranscript).toBe(true);
      expect(taken!.untrackedReading).toBe(false);
      expect(taken!.posts).toEqual([
        postOf("feed-1", ACCOUNT),
        postOf("feed-2"),
      ]);
      expect(taken!.call.incidentId?.toString()).toBe(INCIDENT.toString());

      const row: JSONObject = await readCall(id);

      expect(row["transcript"]).toBeNull();
      expect(row["transcriptSource"]).toBeNull();
      expect(row["transcriptAddedAt"]).toBeNull();
      expect(row["callSummary"]).toBeNull();
      expect(row["callSummaryStatus"]).toBeNull();
      expect(row["callSummaryPosts"]).toBeNull();
      expect(row["transcriptSignInAccountId"]).toBeNull();
      expect(row["transcriptSignInRemovedAt"]).toBeNull();
    });

    test("a reading posted before posts were kept is said to be one, to be found by its text", async () => {
      const id: ObjectID = await insertCall({
        callSummary: { runId: "run-1" },
        callSummaryStatus: CallSummaryStatus.Ready,
      });

      const taken: TakenTranscript | null =
        await IncidentVideoCallService.takeTranscriptForRemoval({ callId: id });

      expect(taken!.untrackedReading).toBe(true);
      expect(taken!.posts).toEqual([]);
    });

    test("removed twice: the second takes nothing", async () => {
      const id: ObjectID = await insertCall({
        callSummaryPosts: CallSummaryPosts.toValue([postOf("feed-1")]),
      });

      await IncidentVideoCallService.takeTranscriptForRemoval({ callId: id });

      const again: TakenTranscript | null =
        await IncidentVideoCallService.takeTranscriptForRemoval({ callId: id });

      expect(again!.removedTranscript).toBe(false);
      expect(again!.posts).toEqual([]);
    });

    test("an account that removed OneUptime: what its sign-in read, and only that", async () => {
      const id: ObjectID = await insertCall({
        callSummaryPosts: CallSummaryPosts.toValue([
          postOf("feed-1", ACCOUNT),
          postOf("feed-2"),
        ]),
        transcriptSignInAccountId: ACCOUNT,
      });
      await database.query(
        `UPDATE "${schema}"."IncidentVideoCall" SET "transcriptSignInRemovedAt" = now() WHERE "_id" = $1`,
        [id.toString()],
      );

      const taken: TakenTranscript | null =
        await IncidentVideoCallService.takeTranscriptForRemoval({
          callId: id,
          signInAccountId: ACCOUNT,
        });

      expect(taken!.removedTranscript).toBe(true);
      expect(taken!.posts).toEqual([postOf("feed-1", ACCOUNT)]);

      const row: JSONObject = await readCall(id);

      expect(row["transcript"]).toBeNull();
      expect(CallSummaryPosts.read(row["callSummaryPosts"])).toEqual([
        postOf("feed-2"),
      ]);
      expect(row["transcriptSignInAccountId"]).toBeNull();
      expect(row["transcriptSignInRemovedAt"]).toBeNull();
    });

    test("a transcript a person added since stays, with its reading; what was read through the sign-in goes", async () => {
      const id: ObjectID = await insertCall({
        transcriptSource: VideoCallTranscriptSource.Upload,
        callSummary: { runId: "run-3" },
        callSummaryStatus: CallSummaryStatus.Ready,
        callSummaryPosts: CallSummaryPosts.toValue([
          postOf("feed-1", ACCOUNT),
          postOf("feed-3"),
        ]),
        transcriptSignInAccountId: ACCOUNT,
      });

      const taken: TakenTranscript | null =
        await IncidentVideoCallService.takeTranscriptForRemoval({
          callId: id,
          signInAccountId: ACCOUNT,
        });

      expect(taken!.removedTranscript).toBe(false);
      expect(taken!.posts).toEqual([postOf("feed-1", ACCOUNT)]);

      const row: JSONObject = await readCall(id);

      expect(row["transcript"]).not.toBeNull();
      expect(row["transcriptSource"]).toBe(VideoCallTranscriptSource.Upload);
      expect(row["callSummaryStatus"]).toBe(CallSummaryStatus.Ready);
      expect(CallSummaryPosts.read(row["callSummaryPosts"])).toEqual([
        postOf("feed-3"),
      ]);
      expect(row["transcriptSignInAccountId"]).toBeNull();
    });

    test("a call that is gone takes nothing", async () => {
      const id: ObjectID = await insertCall({ deletedAt: new Date() });

      await expect(
        IncidentVideoCallService.takeTranscriptForRemoval({ callId: id }),
      ).resolves.toBeNull();
    });
  });

  describe("an account that removes OneUptime marks its calls once", () => {
    test("every call whose transcript its sign-in read, of that provider, and no other", async () => {
      const readThrough: ObjectID = await insertCall({
        transcriptSignInAccountId: ACCOUNT,
      });
      const otherAccount: ObjectID = await insertCall({
        transcriptSignInAccountId: "SomeoneElse12345",
      });
      const otherProvider: ObjectID = await insertCall({
        provider: VideoCallProvider.GoogleMeet,
        transcriptSignInAccountId: ACCOUNT,
      });

      await expect(
        IncidentVideoCallService.markTranscriptsOfRemovedSignIn({
          provider: VideoCallProvider.Zoom,
          accountId: ACCOUNT,
        }),
      ).resolves.toBe(1);

      expect(
        (await readCall(readThrough))["transcriptSignInRemovedAt"],
      ).not.toBeNull();
      expect(
        (await readCall(otherAccount))["transcriptSignInRemovedAt"],
      ).toBeNull();
      expect(
        (await readCall(otherProvider))["transcriptSignInRemovedAt"],
      ).toBeNull();

      const waiting: Array<IncidentVideoCall> =
        await IncidentVideoCallService.getCallsOfRemovedSignIns(100);

      expect(
        waiting.map((call: IncidentVideoCall): string => {
          return call.id!.toString();
        }),
      ).toEqual([readThrough.toString()]);
      expect(waiting[0]!.transcriptSignInAccountId).toBe(ACCOUNT);
    });

    test("an event sent twice keeps when the first came", async () => {
      const id: ObjectID = await insertCall({
        transcriptSignInAccountId: ACCOUNT,
      });

      await IncidentVideoCallService.markTranscriptsOfRemovedSignIn({
        provider: VideoCallProvider.Zoom,
        accountId: ACCOUNT,
      });
      const first: Date = (await readCall(id))[
        "transcriptSignInRemovedAt"
      ] as unknown as Date;

      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 20);
      });
      await IncidentVideoCallService.markTranscriptsOfRemovedSignIn({
        provider: VideoCallProvider.Zoom,
        accountId: ACCOUNT,
      });

      expect(
        (
          (await readCall(id))["transcriptSignInRemovedAt"] as unknown as Date
        ).getTime(),
      ).toBe(first.getTime());
    });
  });

  describe("the transcripts an earlier release read through a sign-in", () => {
    test("are named after the account their connection is signed in as, and those of a sign-in Zoom removed are marked", async () => {
      const signedIn: ObjectID = await insertConnection({
        provider: VideoCallProvider.Zoom,
        authMethod: VideoCallAuthMethod.OAuth,
        connectedAccountId: ACCOUNT,
      });
      const removedByZoom: ObjectID = await insertConnection({
        provider: VideoCallProvider.Zoom,
        authMethod: VideoCallAuthMethod.OAuth,
        connectedAccountId: null,
        lastError: ZOOM_SIGN_IN_REMOVED_MESSAGE,
      });
      const ownApp: ObjectID = await insertConnection({
        provider: VideoCallProvider.Zoom,
        authMethod: VideoCallAuthMethod.AppCredentials,
        connectedAccountId: null,
      });

      const named: ObjectID = await insertCall({ connectionId: signedIn });
      const added: ObjectID = await insertCall({
        connectionId: signedIn,
        transcriptSource: VideoCallTranscriptSource.Upload,
      });
      const marked: ObjectID = await insertCall({
        connectionId: removedByZoom,
      });
      const ownAppCall: ObjectID = await insertCall({ connectionId: ownApp });
      const alreadyNamed: ObjectID = await insertCall({
        connectionId: signedIn,
        transcriptSignInAccountId: "NamedSince1234",
      });

      const summary: TranscriptSignInBackfillSummary =
        await IncidentCallTranscriptSignInBackfill.run();

      expect(summary).toEqual({ named: 1, marked: 1 });
      expect((await readCall(named))["transcriptSignInAccountId"]).toBe(
        ACCOUNT,
      );
      expect((await readCall(named))["transcriptSignInRemovedAt"]).toBeNull();
      expect((await readCall(added))["transcriptSignInAccountId"]).toBeNull();
      expect((await readCall(marked))["transcriptSignInAccountId"]).toBe(
        `${REMOVED_SIGN_IN_ACCOUNT_PREFIX}${removedByZoom.toString()}`,
      );
      expect(
        (await readCall(marked))["transcriptSignInRemovedAt"],
      ).not.toBeNull();
      expect(
        (await readCall(ownAppCall))["transcriptSignInAccountId"],
      ).toBeNull();
      expect((await readCall(alreadyNamed))["transcriptSignInAccountId"]).toBe(
        "NamedSince1234",
      );

      // Run again: nothing more to name or mark.
      await expect(IncidentCallTranscriptSignInBackfill.run()).resolves.toEqual(
        { named: 0, marked: 0 },
      );
    });

    test("a call marked by the data migration is taken on by the job like any other: its transcript goes", async () => {
      const removedByZoom: ObjectID = await insertConnection({
        provider: VideoCallProvider.Zoom,
        authMethod: VideoCallAuthMethod.OAuth,
        connectedAccountId: null,
        lastError: ZOOM_SIGN_IN_REMOVED_MESSAGE,
      });
      const id: ObjectID = await insertCall({ connectionId: removedByZoom });

      await IncidentCallTranscriptSignInBackfill.run();

      const [waiting] =
        await IncidentVideoCallService.getCallsOfRemovedSignIns(10);
      const taken: TakenTranscript | null =
        await IncidentVideoCallService.takeTranscriptForRemoval({
          callId: id,
          signInAccountId: waiting!.transcriptSignInAccountId!,
        });

      expect(taken!.removedTranscript).toBe(true);
      expect((await readCall(id))["transcript"]).toBeNull();
      expect(
        await IncidentVideoCallService.getCallsOfRemovedSignIns(10),
      ).toEqual([]);
    });
  });
});
