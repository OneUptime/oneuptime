import ObjectID from "../../../../Types/ObjectID";
import {
  SESSION_REPLAY_MAX_USER_REF_LENGTH,
  SESSION_REPLAY_TARGET_TTL_SECONDS,
} from "../../../../Types/Rum/SessionReplay";

/*
 * The one-shot "record this user's next session" Redis key. Two properties
 * carry all the weight and get most of the assertions: the key must never
 * contain the raw end-user reference (references are routinely emails, and
 * a Redis KEYS listing must not be a directory of the customer's users),
 * and the hot-path consume must be un-crashable - a Redis blip degrades to
 * "not targeted", never to a config error.
 */

const setMock: jest.Mock = jest.fn();
const delMock: jest.Mock = jest.fn();
const existsMock: jest.Mock = jest.fn();

let isConnectedValue: boolean = true;
let clientValue: unknown = {
  set: setMock,
  del: delMock,
  exists: existsMock,
};

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return clientValue;
      },
      isConnected: (): boolean => {
        return isConnectedValue;
      },
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

import SessionReplayTargeting, {
  SessionReplayTargetRef,
} from "../../../../Server/Utils/SessionReplay/SessionReplayTargeting";

const PROJECT_ID: ObjectID = ObjectID.generate();

function ref(
  overrides?: Partial<SessionReplayTargetRef>,
): SessionReplayTargetRef {
  return {
    projectId: PROJECT_ID,
    appIdentifier: "checkout-web",
    userRef: "jane@example.com",
    ...overrides,
  };
}

describe("SessionReplayTargeting", (): void => {
  beforeEach((): void => {
    jest.clearAllMocks();
    isConnectedValue = true;
    clientValue = { set: setMock, del: delMock, exists: existsMock };
  });

  describe("isUsableUserRef", (): void => {
    it("accepts a plain reference", (): void => {
      expect(SessionReplayTargeting.isUsableUserRef("user-42")).toBe(true);
    });

    it("rejects empty, whitespace-only and non-strings", (): void => {
      expect(SessionReplayTargeting.isUsableUserRef("")).toBe(false);
      expect(SessionReplayTargeting.isUsableUserRef("   ")).toBe(false);
      expect(SessionReplayTargeting.isUsableUserRef(42)).toBe(false);
      expect(SessionReplayTargeting.isUsableUserRef(null)).toBe(false);
      expect(SessionReplayTargeting.isUsableUserRef(undefined)).toBe(false);
      expect(SessionReplayTargeting.isUsableUserRef({})).toBe(false);
    });

    it("enforces the shared length cap exactly", (): void => {
      expect(
        SessionReplayTargeting.isUsableUserRef(
          "x".repeat(SESSION_REPLAY_MAX_USER_REF_LENGTH),
        ),
      ).toBe(true);
      expect(
        SessionReplayTargeting.isUsableUserRef(
          "x".repeat(SESSION_REPLAY_MAX_USER_REF_LENGTH + 1),
        ),
      ).toBe(false);
    });
  });

  describe("buildTargetKey", (): void => {
    it("is deterministic and scoped by project id", (): void => {
      const key: string = SessionReplayTargeting.buildTargetKey(ref());

      expect(SessionReplayTargeting.buildTargetKey(ref())).toBe(key);
      expect(key).toContain(PROJECT_ID.toString());
      expect(key.startsWith("session-replay:target:")).toBe(true);
    });

    /*
     * The privacy property the HMAC exists for: the raw reference (often
     * an email) must be unrecoverable from the key.
     */
    it("never embeds the raw user reference", (): void => {
      const key: string = SessionReplayTargeting.buildTargetKey(ref());

      expect(key).not.toContain("jane");
      expect(key).not.toContain("example.com");
    });

    it("differs across user, application and project", (): void => {
      const base: string = SessionReplayTargeting.buildTargetKey(ref());

      expect(
        SessionReplayTargeting.buildTargetKey(ref({ userRef: "other-user" })),
      ).not.toBe(base);
      expect(
        SessionReplayTargeting.buildTargetKey(
          ref({ appIdentifier: "other-app" }),
        ),
      ).not.toBe(base);
      expect(
        SessionReplayTargeting.buildTargetKey(
          ref({ projectId: ObjectID.generate() }),
        ),
      ).not.toBe(base);
    });

    /*
     * The dashboard sends the identifier as stored; the recorder's header
     * arrives however the customer typed it into their page. The two must
     * meet at one key.
     */
    it("normalises app identifier case and whitespace, and trims the userRef", (): void => {
      const base: string = SessionReplayTargeting.buildTargetKey(ref());

      expect(
        SessionReplayTargeting.buildTargetKey(
          ref({ appIdentifier: "  CHECKOUT-Web  " }),
        ),
      ).toBe(base);
      expect(
        SessionReplayTargeting.buildTargetKey(
          ref({ userRef: "  jane@example.com  " }),
        ),
      ).toBe(base);
    });
  });

  describe("setTarget", (): void => {
    it("writes the one-shot key with the 24h TTL", async (): Promise<void> => {
      await SessionReplayTargeting.setTarget(ref());

      expect(setMock).toHaveBeenCalledWith(
        SessionReplayTargeting.buildTargetKey(ref()),
        "1",
        "EX",
        SESSION_REPLAY_TARGET_TTL_SECONDS,
      );
    });

    it("throws when Redis is unavailable, so the dashboard hears the truth", async (): Promise<void> => {
      isConnectedValue = false;

      await expect(SessionReplayTargeting.setTarget(ref())).rejects.toThrow();
      expect(setMock).not.toHaveBeenCalled();
    });
  });

  describe("clearTarget / isTargetPending", (): void => {
    it("clears by deleting the derived key", async (): Promise<void> => {
      await SessionReplayTargeting.clearTarget(ref());

      expect(delMock).toHaveBeenCalledWith(
        SessionReplayTargeting.buildTargetKey(ref()),
      );
    });

    it("reports pending from EXISTS", async (): Promise<void> => {
      existsMock.mockResolvedValueOnce(1);
      expect(await SessionReplayTargeting.isTargetPending(ref())).toBe(true);

      existsMock.mockResolvedValueOnce(0);
      expect(await SessionReplayTargeting.isTargetPending(ref())).toBe(false);
    });
  });

  describe("consumeTarget", (): void => {
    it("answers true exactly when the atomic DEL removed the key", async (): Promise<void> => {
      delMock.mockResolvedValueOnce(1);
      expect(await SessionReplayTargeting.consumeTarget(ref())).toBe(true);

      /* Second take of the same key: someone else already consumed it. */
      delMock.mockResolvedValueOnce(0);
      expect(await SessionReplayTargeting.consumeTarget(ref())).toBe(false);
    });

    it("refuses an unusable reference before touching Redis", async (): Promise<void> => {
      expect(
        await SessionReplayTargeting.consumeTarget(ref({ userRef: "   " })),
      ).toBe(false);
      expect(
        await SessionReplayTargeting.consumeTarget(
          ref({
            userRef: "x".repeat(SESSION_REPLAY_MAX_USER_REF_LENGTH + 1),
          }),
        ),
      ).toBe(false);

      expect(delMock).not.toHaveBeenCalled();
    });

    /*
     * The hot-path guarantee: every failure shape answers "not targeted"
     * rather than throwing into the config endpoint.
     */
    it("degrades to false on a Redis error", async (): Promise<void> => {
      delMock.mockRejectedValueOnce(new Error("READONLY"));

      expect(await SessionReplayTargeting.consumeTarget(ref())).toBe(false);
    });

    it("degrades to false when Redis is disconnected or absent", async (): Promise<void> => {
      isConnectedValue = false;
      expect(await SessionReplayTargeting.consumeTarget(ref())).toBe(false);

      isConnectedValue = true;
      clientValue = null;
      expect(await SessionReplayTargeting.consumeTarget(ref())).toBe(false);
    });
  });
});
