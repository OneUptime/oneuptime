import MobilePasskeyEnrolmentService, {
  MOBILE_PASSKEY_ENROLMENT_TTL_SECONDS,
} from "../../../Server/Services/MobilePasskeyEnrolmentService";
import Redis from "../../../Server/Infrastructure/Redis";
import { JSONObject } from "../../../Types/JSON";
import { MOBILE_PASSKEY_ENROLMENT_EXPIRED_MESSAGE } from "../../../Types/Accounts/SecondStepEnrolment";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import { createHash } from "crypto";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * THE OPTIONS A MOBILE APP'S PASSKEY IS MADE WITH, KEPT FOR THE PHONE'S
 * BROWSER (#9817).
 *
 * The app asks for them with the email and password (the Identity API
 * checks those); this keeps them for the browser page under a random id,
 * for minutes, and gives them to that page once. What is pinned: the id is
 * 256 random bits, only its hash is a key in Redis (a Redis dump names no
 * working id), it expires with the challenge inside it, a second store
 * never overwrites a first, a read deletes in the same operation, and
 * anything that is not a live id - malformed, read, expired, garbage - is
 * refused alike, in words that say to start again in the app.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    HttpProtocol: "https://",
  };
});
jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});

const OPTIONS: JSONObject = {
  challenge: "c2lnbi1pbi1jaGFsbGVuZ2U",
  rp: { name: "OneUptime", id: "example.com" },
  user: { id: "dXNlcg", name: "responder@example.com" },
};

let client: { set: jest.Mock; eval: jest.Mock };

const hash: (value: string) => string = (value: string): string => {
  return createHash("sha256").update(value, "ascii").digest("base64url");
};

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  client = {
    set: jest.fn().mockResolvedValue("OK"),
    eval: jest.fn().mockResolvedValue(null),
  };
  getJestSpyOn(Redis, "getClient").mockReturnValue(client);
  getJestSpyOn(Redis, "isConnected").mockReturnValue(true);
});

describe("whether this server offers it", () => {
  it("only over HTTPS: no browser makes a passkey on an insecure page", () => {
    expect(MobilePasskeyEnrolmentService.isAvailable()).toBe(true);
  });
});

describe("keeping the options", () => {
  it("answers a fresh random id, and keeps the options under its hash, never the id", async () => {
    const id: string =
      await MobilePasskeyEnrolmentService.storeOptions(OPTIONS);

    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [key, value, expiry, ttl, onlyIfNew] = client.set.mock.calls[0]!;

    expect(key).toBe(`mobile-passkey-enrolment-${hash(id)}`);
    expect(key).not.toContain(id);
    expect(JSON.parse(value as string)).toEqual({ options: OPTIONS });
    expect(expiry).toBe("EX");
    expect(ttl).toBe(MOBILE_PASSKEY_ENROLMENT_TTL_SECONDS);
    expect(onlyIfNew).toBe("NX");
  });

  it("expires with the challenge it carries: minutes", () => {
    expect(MOBILE_PASSKEY_ENROLMENT_TTL_SECONDS).toBe(300);
  });

  it("never hands out the same id twice", async () => {
    const ids: Set<string> = new Set<string>();

    for (let index: number = 0; index < 50; index++) {
      ids.add(await MobilePasskeyEnrolmentService.storeOptions(OPTIONS));
    }

    expect(ids.size).toBe(50);
  });

  it("refuses rather than overwrite one that exists", async () => {
    client.set.mockResolvedValue(null);

    await expect(
      MobilePasskeyEnrolmentService.storeOptions(OPTIONS),
    ).rejects.toThrow(MOBILE_PASSKEY_ENROLMENT_EXPIRED_MESSAGE);
  });

  it("says plainly when Redis is not there, and keeps nothing", async () => {
    getJestSpyOn(Redis, "isConnected").mockReturnValue(false);

    await expect(
      MobilePasskeyEnrolmentService.storeOptions(OPTIONS),
    ).rejects.toThrow(DatabaseNotConnectedException);
    expect(client.set).not.toHaveBeenCalled();
  });
});

describe("handing them to the page", () => {
  const ID: string = "H".repeat(43);

  it("reads and deletes in one operation, by the id's hash", async () => {
    client.eval.mockResolvedValue(JSON.stringify({ options: OPTIONS }));

    await expect(
      MobilePasskeyEnrolmentService.takeOptions(ID),
    ).resolves.toEqual(OPTIONS);

    const [script, keyCount, key] = client.eval.mock.calls[0]!;

    expect(script).toContain("GET");
    expect(script).toContain("DEL");
    expect(keyCount).toBe(1);
    expect(key).toBe(`mobile-passkey-enrolment-${hash(ID)}`);
  });

  it("a second read finds nothing: read once", async () => {
    client.eval
      .mockResolvedValueOnce(JSON.stringify({ options: OPTIONS }))
      .mockResolvedValueOnce(null);

    await MobilePasskeyEnrolmentService.takeOptions(ID);

    await expect(MobilePasskeyEnrolmentService.takeOptions(ID)).rejects.toThrow(
      MOBILE_PASSKEY_ENROLMENT_EXPIRED_MESSAGE,
    );
  });

  it.each([
    undefined,
    null,
    1,
    {},
    "",
    "short",
    "H".repeat(42),
    "H".repeat(44),
    `${"H".repeat(42)}=`,
    `${"H".repeat(41)}\n1`,
  ])("refuses %p before asking Redis anything", async (value: unknown) => {
    await expect(
      MobilePasskeyEnrolmentService.takeOptions(value),
    ).rejects.toThrow(MOBILE_PASSKEY_ENROLMENT_EXPIRED_MESSAGE);
    expect(client.eval).not.toHaveBeenCalled();
  });

  it.each([
    ["nothing kept", null],
    ["not text", 42],
    ["not JSON", "not json"],
    ["no options", JSON.stringify({ other: true })],
    ["options that are a list", JSON.stringify({ options: [1, 2] })],
  ])("refuses %s alike", async (_name: string, stored: unknown) => {
    client.eval.mockResolvedValue(stored);

    await expect(MobilePasskeyEnrolmentService.takeOptions(ID)).rejects.toThrow(
      MOBILE_PASSKEY_ENROLMENT_EXPIRED_MESSAGE,
    );
  });
});
