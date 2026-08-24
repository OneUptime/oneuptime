/*
 * The erasure tombstone is the only thing that stops a session-replay chunk
 * staged in Redis before a GDPR/CCPA erasure from being written back into
 * ClickHouse after it. Its whole contract is "fail closed": a Redis blip must
 * never be read as "not erased", and an erasure must never proceed without a
 * tombstone the ingest path can later consult. These tests pin exactly that.
 */

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import Redis from "../../../../Server/Infrastructure/Redis";
import {
  ERASURE_TOMBSTONE_TTL_SECONDS,
  ErasureTombstoneUnavailableError,
  getErasedSessionsKey,
  isSessionErased,
  writeErasureTombstones,
} from "../../../../Server/Utils/SessionReplay/SessionReplayErasureTombstone";

const getClientMock: jest.Mock = Redis.getClient as unknown as jest.Mock;
const isConnectedMock: jest.Mock = Redis.isConnected as unknown as jest.Mock;

interface FakeClient {
  sadd: jest.Mock;
  expire: jest.Mock;
  sismember: jest.Mock;
}

function connectedClient(overrides?: Partial<FakeClient>): FakeClient {
  const client: FakeClient = {
    sadd: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    sismember: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
  getClientMock.mockReturnValue(client);
  isConnectedMock.mockReturnValue(true);
  return client;
}

function disconnected(): void {
  getClientMock.mockReturnValue(null);
  isConnectedMock.mockReturnValue(false);
}

describe("SessionReplayErasureTombstone", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getErasedSessionsKey", () => {
    test("is namespaced per project", () => {
      expect(getErasedSessionsKey("proj-1")).toBe("replay:erased:proj-1");
      expect(getErasedSessionsKey("proj-2")).toBe("replay:erased:proj-2");
      expect(getErasedSessionsKey("proj-1")).not.toBe(
        getErasedSessionsKey("proj-2"),
      );
    });
  });

  describe("ERASURE_TOMBSTONE_TTL_SECONDS", () => {
    test("is seven days", () => {
      expect(ERASURE_TOMBSTONE_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
    });
  });

  describe("writeErasureTombstones", () => {
    test("no-ops on an empty session list without touching Redis", async () => {
      const client: FakeClient = connectedClient();

      await writeErasureTombstones({ projectId: "p1", sessionIds: [] });

      expect(client.sadd).not.toHaveBeenCalled();
      expect(client.expire).not.toHaveBeenCalled();
    });

    test("adds the sessions to the per-project set and refreshes the TTL", async () => {
      const client: FakeClient = connectedClient();

      await writeErasureTombstones({
        projectId: "p1",
        sessionIds: ["s1", "s2"],
      });

      expect(client.sadd).toHaveBeenCalledWith("replay:erased:p1", [
        "s1",
        "s2",
      ]);
      expect(client.expire).toHaveBeenCalledWith(
        "replay:erased:p1",
        ERASURE_TOMBSTONE_TTL_SECONDS,
      );
    });

    test("throws when Redis is unavailable so the erasure batch aborts", async () => {
      disconnected();

      await expect(
        writeErasureTombstones({ projectId: "p1", sessionIds: ["s1"] }),
      ).rejects.toThrow(/Redis is not connected/);
    });

    test("does not swallow a non-empty write when the client exists but is not connected", async () => {
      getClientMock.mockReturnValue({
        sadd: jest.fn(),
        expire: jest.fn(),
      });
      isConnectedMock.mockReturnValue(false);

      await expect(
        writeErasureTombstones({ projectId: "p1", sessionIds: ["s1"] }),
      ).rejects.toThrow(/refusing to erase/);
    });
  });

  describe("isSessionErased", () => {
    test("returns false for an empty session id without hitting Redis", async () => {
      const client: FakeClient = connectedClient();

      await expect(
        isSessionErased({ projectId: "p1", sessionId: "" }),
      ).resolves.toBe(false);
      expect(client.sismember).not.toHaveBeenCalled();
    });

    test("returns true when the session is a member of the tombstone set", async () => {
      const client: FakeClient = connectedClient({
        sismember: jest.fn().mockResolvedValue(1),
      });

      await expect(
        isSessionErased({ projectId: "p1", sessionId: "s1" }),
      ).resolves.toBe(true);
      expect(client.sismember).toHaveBeenCalledWith("replay:erased:p1", "s1");
    });

    test("returns false when the session is not in the tombstone set", async () => {
      connectedClient({ sismember: jest.fn().mockResolvedValue(0) });

      await expect(
        isSessionErased({ projectId: "p1", sessionId: "s1" }),
      ).resolves.toBe(false);
    });

    test("throws ErasureTombstoneUnavailableError when Redis is unavailable (never returns a boolean)", async () => {
      disconnected();

      await expect(
        isSessionErased({ projectId: "p1", sessionId: "s1" }),
      ).rejects.toBeInstanceOf(ErasureTombstoneUnavailableError);
    });

    test("throws ErasureTombstoneUnavailableError (not the raw error) when the lookup fails", async () => {
      connectedClient({
        sismember: jest.fn().mockRejectedValue(new Error("connection reset")),
      });

      const promise: Promise<boolean> = isSessionErased({
        projectId: "p1",
        sessionId: "s1",
      });

      await expect(promise).rejects.toBeInstanceOf(
        ErasureTombstoneUnavailableError,
      );
      await expect(promise).rejects.toThrow(/connection reset/);
    });
  });
});
