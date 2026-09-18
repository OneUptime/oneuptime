import RumSessionReplayViewService, {
  SESSION_REPLAY_MAX_SECONDS_WATCHED,
  SESSION_REPLAY_WATCH_BUCKET_SECONDS,
  normalizeSecondsWatched,
} from "../../../Server/Services/RumSessionReplayViewService";
import RumSessionReplayView from "../../../Models/DatabaseModels/RumSessionReplayView";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The replay read audit. Two properties that the routes cannot pin
 * because they mock this service whole:
 *
 *  1. The audit write must not be failable by its own inputs. Every
 *     free-text field off the request is truncated to its column, the
 *     exception fingerprint included: DatabaseService.create throws on an
 *     over-long value, and an audit insert that throws fails the playback
 *     it exists to record.
 *  2. secondsWatched is time WATCHED, monotonic, floored to the heartbeat
 *     bucket, and advanced by a single guarded UPDATE rather than a
 *     read-then-write - so two heartbeats racing for the row cannot walk
 *     it backwards, and a heartbeat that does not advance writes nothing.
 */

describe("RumSessionReplayViewService", () => {
  const projectId: ObjectID = ObjectID.generate();
  const rumApplicationId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();

  let createSpy: jest.SpyInstance;
  let findOneBySpy: jest.SpyInstance;
  let updateOneBySpy: jest.SpyInstance;

  beforeEach(() => {
    createSpy = getJestSpyOn(RumSessionReplayViewService, "create");
    createSpy.mockImplementation(
      async (createBy: { data: RumSessionReplayView }) => {
        return createBy.data;
      },
    );
    findOneBySpy = getJestSpyOn(
      RumSessionReplayViewService,
      "findOneBy",
    ).mockResolvedValue(null);
    updateOneBySpy = getJestSpyOn(
      RumSessionReplayViewService,
      "updateOneBy",
    ).mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("recordView", () => {
    test("writes the row as root, names the human, and starts at zero seconds", async () => {
      const view: RumSessionReplayView =
        await RumSessionReplayViewService.recordView({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          sessionId: "s-1",
          viewedByUserId: userId,
          accessReason: "incident triage",
        });

      expect(createSpy).toHaveBeenCalledTimes(1);
      const createBy: JSONObject = createSpy.mock.calls[0]![0] as JSONObject;
      expect((createBy["props"] as JSONObject)["isRoot"]).toBe(true);

      expect(view.projectId?.toString()).toBe(projectId.toString());
      expect(view.rumApplicationId?.toString()).toBe(
        rumApplicationId.toString(),
      );
      expect(view.sessionId).toBe("s-1");
      expect(view.viewedByUserId?.toString()).toBe(userId.toString());
      expect(view.createdByUserId?.toString()).toBe(userId.toString());
      expect(view.secondsWatched).toBe(0);
      expect(view.viewedAt).toBeInstanceOf(Date);
      expect(view.accessReason).toBe("incident triage");
    });

    test("truncates every request-supplied string to its column, the fingerprint included", async () => {
      const view: RumSessionReplayView =
        await RumSessionReplayViewService.recordView({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          sessionId: "s-1",
          ipAddress: "1".repeat(1000),
          userAgent: "u".repeat(5000),
          accessReason: "r".repeat(5000),
          linkedExceptionFingerprint: "f".repeat(1000),
        });

      expect(view.ipAddress).toHaveLength(ColumnLength.ShortText);
      expect(view.userAgent).toHaveLength(ColumnLength.LongText);
      expect(view.accessReason).toHaveLength(ColumnLength.LongText);
      expect(view.linkedExceptionFingerprint).toHaveLength(
        ColumnLength.ShortText,
      );
    });
  });

  describe("findOwnView", () => {
    test("looks the row up as the caller's own, optionally pinned to a session, and carries the watched figure", async () => {
      const viewId: ObjectID = ObjectID.generate();

      await RumSessionReplayViewService.findOwnView({
        viewId: viewId,
        projectId: projectId,
        viewedByUserId: userId,
        sessionId: "s-1",
      });

      const args: JSONObject = findOneBySpy.mock.calls[0]![0] as JSONObject;
      const query: JSONObject = args["query"] as JSONObject;
      const select: JSONObject = args["select"] as JSONObject;

      expect(query["_id"]).toBe(viewId.toString());
      expect((query["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect((query["viewedByUserId"] as ObjectID).toString()).toBe(
        userId.toString(),
      );
      expect(query["sessionId"]).toBe("s-1");
      expect(select["secondsWatched"]).toBe(true);
      expect(select["rumApplicationId"]).toBe(true);
      expect((args["props"] as JSONObject)["isRoot"]).toBe(true);
    });

    test("omits the session predicate when no session is given", async () => {
      await RumSessionReplayViewService.findOwnView({
        viewId: ObjectID.generate(),
        projectId: projectId,
        viewedByUserId: userId,
      });

      const query: JSONObject = (findOneBySpy.mock.calls[0]![0] as JSONObject)[
        "query"
      ] as JSONObject;

      expect(query["sessionId"]).toBeUndefined();
    });
  });

  describe("normalizeSecondsWatched", () => {
    test("floors to the heartbeat bucket, clamps to the ceiling, and treats garbage as zero", () => {
      expect(normalizeSecondsWatched(44)).toBe(30);
      expect(normalizeSecondsWatched(SESSION_REPLAY_WATCH_BUCKET_SECONDS)).toBe(
        SESSION_REPLAY_WATCH_BUCKET_SECONDS,
      );
      expect(normalizeSecondsWatched(14.9)).toBe(0);
      expect(normalizeSecondsWatched(-5)).toBe(0);
      expect(normalizeSecondsWatched(Number.NaN)).toBe(0);
      expect(normalizeSecondsWatched(Number.POSITIVE_INFINITY)).toBe(0);
      expect(normalizeSecondsWatched(10 ** 12)).toBe(
        SESSION_REPLAY_MAX_SECONDS_WATCHED,
      );
    });
  });

  describe("recordSecondsWatched", () => {
    const viewId: ObjectID = ObjectID.generate();

    test("writes nothing for a figure that rounds to zero", async () => {
      await RumSessionReplayViewService.recordSecondsWatched({
        viewId: viewId,
        projectId: projectId,
        secondsWatched: 7,
      });

      expect(updateOneBySpy).not.toHaveBeenCalled();
      expect(findOneBySpy).not.toHaveBeenCalled();
    });

    test("writes nothing when the caller's known figure already covers it", async () => {
      await RumSessionReplayViewService.recordSecondsWatched({
        viewId: viewId,
        projectId: projectId,
        secondsWatched: 44,
        currentSecondsWatched: 30,
      });

      expect(updateOneBySpy).not.toHaveBeenCalled();
    });

    test("advances with a single guarded UPDATE scoped to the tenant", async () => {
      await RumSessionReplayViewService.recordSecondsWatched({
        viewId: viewId,
        projectId: projectId,
        secondsWatched: 44,
        currentSecondsWatched: 15,
      });

      expect(findOneBySpy).not.toHaveBeenCalled();
      expect(updateOneBySpy).toHaveBeenCalledTimes(1);

      const args: JSONObject = updateOneBySpy.mock.calls[0]![0] as JSONObject;
      const query: JSONObject = args["query"] as JSONObject;
      const data: JSONObject = args["data"] as JSONObject;

      expect(query["_id"]).toBe(viewId.toString());
      expect((query["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      /*
       * The monotonic guard is IN the predicate (a Raw "< :value OR IS
       * NULL"), not a plain number - a plain number would be an equality
       * match and the guard would be gone.
       */
      expect(query["secondsWatched"]).toBeDefined();
      expect(typeof query["secondsWatched"]).not.toBe("number");
      expect(data["secondsWatched"]).toBe(30);
      expect((args["props"] as JSONObject)["isRoot"]).toBe(true);
    });

    test("still guards in the predicate when the caller holds no current figure", async () => {
      await RumSessionReplayViewService.recordSecondsWatched({
        viewId: viewId,
        projectId: projectId,
        secondsWatched: 90,
      });

      expect(updateOneBySpy).toHaveBeenCalledTimes(1);
      const query: JSONObject = (
        updateOneBySpy.mock.calls[0]![0] as JSONObject
      )["query"] as JSONObject;
      expect(query["secondsWatched"]).toBeDefined();
    });
  });

  describe("getViewsForSession", () => {
    test("is pinned to the application and clamps the page size", async () => {
      const findBySpy: jest.SpyInstance = getJestSpyOn(
        RumSessionReplayViewService,
        "findBy",
      ).mockResolvedValue([]);

      await RumSessionReplayViewService.getViewsForSession({
        projectId: projectId,
        rumApplicationId: rumApplicationId,
        sessionId: "s-1",
        limit: 0,
      });

      const args: JSONObject = findBySpy.mock.calls[0]![0] as JSONObject;
      const query: JSONObject = args["query"] as JSONObject;

      expect((query["rumApplicationId"] as ObjectID).toString()).toBe(
        rumApplicationId.toString(),
      );
      expect(query["sessionId"]).toBe("s-1");
      expect(args["limit"]).toBe(1);
      expect((args["props"] as JSONObject)["isRoot"]).toBe(true);
    });
  });
});
