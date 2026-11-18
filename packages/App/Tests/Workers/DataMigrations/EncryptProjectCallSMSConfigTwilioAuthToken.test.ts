import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import EncryptProjectCallSMSConfigTwilioAuthToken from "../../../FeatureSet/Workers/DataMigrations/EncryptProjectCallSMSConfigTwilioAuthToken";
import { encryptInPlaceADayLater } from "./Fixtures/CredentialsAtRestPass";
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
 * The Twilio auth tokens that were stored as plaintext before the column
 * became a secret. The upgrade's EncryptProjectCallSMSConfigTwilioAuthToken
 * leaves them as written (#9266), so a server of a release before 14.0.56
 * sends SMS and calls with them while an upgrade from it rolls out; a day
 * later the CredentialsAtRest:EncryptInPlace job reads each config's raw
 * token and, when it is not already our ciphertext, encrypts it and writes
 * it back - in raw SQL so the service's own encrypt/decrypt hooks never
 * touch it.
 *
 * Pinned here, with the repository stubbed so the real migrate() and the
 * job's real pass run without Postgres:
 *   1. it is registered in DataMigrations/Index.ts, once, before the slot
 *      AddAuditLogMcpClientColumns keeps last, and the upgrade's run of it
 *      changes nothing;
 *   2. the pass encrypts a plaintext token (and the stored value round-trips
 *      back to the token);
 *   3. it leaves an already-encrypted token, an empty token and a null token
 *      alone - so a second run rewrites nothing (idempotent);
 *   4. one config that cannot be written does not stop the others;
 *   5. rollback changes nothing.
 */

const MIGRATION_NAME: string = "EncryptProjectCallSMSConfigTwilioAuthToken";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const NEW_MIGRATION_CALL: RegExp = /new ([A-Za-z0-9]+)\(\)/g;
const SELECT_START: RegExp = /^\s*SELECT/i;
const UPDATE_START: RegExp = /^\s*UPDATE/i;

interface QueryCall {
  sql: string;
  params: Array<unknown> | undefined;
}

type SelectRow = { _id: string; twilioAuthToken: string | null };

interface StubState {
  calls: Array<QueryCall>;
  failOnUpdateForId?: string;
}

function stubRepository(rows: Array<SelectRow>): StubState {
  const state: StubState = {
    calls: [],
  };

  const repository: unknown = {
    metadata: { tableName: "ProjectCallSMSConfig" },
    manager: {
      query: async (sql: string, params?: Array<unknown>): Promise<unknown> => {
        state.calls.push({ sql, params });
        if (SELECT_START.test(sql)) {
          return rows;
        }
        if (
          UPDATE_START.test(sql) &&
          state.failOnUpdateForId &&
          params &&
          params[1] === state.failOnUpdateForId
        ) {
          throw new Error("write failed");
        }
        return [];
      },
    },
  };

  jest
    .spyOn(ProjectCallSMSConfigService, "getRepository")
    .mockReturnValue(repository as never);

  return state;
}

function updateCalls(calls: Array<QueryCall>): Array<QueryCall> {
  return calls.filter((call: QueryCall): boolean => {
    return UPDATE_START.test(call.sql);
  });
}

describe("EncryptProjectCallSMSConfigTwilioAuthToken", () => {
  beforeEach(() => {
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is registered once, before the last slot", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(NEW_MIGRATION_CALL),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
  });

  test("has the name it is recorded under", () => {
    expect(new EncryptProjectCallSMSConfigTwilioAuthToken().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("the upgrade's run changes nothing: a server of the release before sends with every token as written", async () => {
    const state: StubState = stubRepository([
      { _id: "config-1", twilioAuthToken: "0123456789abcdef0123456789abcdef" },
    ]);

    await new EncryptProjectCallSMSConfigTwilioAuthToken().migrate();

    expect(state.calls).toHaveLength(0);
  });

  test("encrypts a plaintext token and the stored value round-trips to the token", async () => {
    const token: string = "0123456789abcdef0123456789abcdef";
    const state: StubState = stubRepository([
      { _id: "config-1", twilioAuthToken: token },
    ]);

    await encryptInPlaceADayLater(MIGRATION_NAME);

    const updates: Array<QueryCall> = updateCalls(state.calls);
    expect(updates).toHaveLength(1);

    const [encrypted, id, previous] = updates[0]!.params as [
      string,
      string,
      string,
    ];
    expect(id).toBe("config-1");
    expect(previous).toBe(token);
    // Stored encrypted, never as typed, and decrypts back to the token.
    expect(encrypted).not.toBe(token);
    expect(Encryption.looksEncrypted(encrypted)).toBe(true);
    expect(await Encryption.decrypt(encrypted)).toBe(token);
  });

  test("leaves an already-encrypted, empty or null token alone (idempotent)", async () => {
    const alreadyEncrypted: string = await Encryption.encrypt("already");
    const state: StubState = stubRepository([
      { _id: "already", twilioAuthToken: alreadyEncrypted },
      { _id: "empty", twilioAuthToken: "" },
      { _id: "null", twilioAuthToken: null },
    ]);

    await encryptInPlaceADayLater(MIGRATION_NAME);

    expect(updateCalls(state.calls)).toHaveLength(0);
  });

  test("a second run over now-encrypted rows rewrites nothing", async () => {
    const token: string = "sk_twilio_plain";
    const first: StubState = stubRepository([
      { _id: "c1", twilioAuthToken: token },
    ]);
    await encryptInPlaceADayLater(MIGRATION_NAME);
    const encrypted: string = (
      updateCalls(first.calls)[0]!.params as Array<string>
    )[0]!;
    jest.restoreAllMocks();
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    // The row now holds the ciphertext the first run wrote.
    const second: StubState = stubRepository([
      { _id: "c1", twilioAuthToken: encrypted },
    ]);
    await encryptInPlaceADayLater(MIGRATION_NAME);
    expect(updateCalls(second.calls)).toHaveLength(0);
  });

  test("one config that cannot be written does not stop the others", async () => {
    const state: StubState = stubRepository([
      { _id: "bad", twilioAuthToken: "plain-a" },
      { _id: "good", twilioAuthToken: "plain-b" },
    ]);
    state.failOnUpdateForId = "bad";

    await encryptInPlaceADayLater(MIGRATION_NAME);

    const updates: Array<QueryCall> = updateCalls(state.calls);
    // Both were attempted; the good one still wrote.
    expect(updates).toHaveLength(2);
    const goodUpdate: QueryCall | undefined = updates.find(
      (call: QueryCall): boolean => {
        return (call.params as Array<string>)[1] === "good";
      },
    );
    expect(goodUpdate).toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });

  test("rollback changes nothing", async () => {
    const state: StubState = stubRepository([
      { _id: "c1", twilioAuthToken: "plain" },
    ]);
    await new EncryptProjectCallSMSConfigTwilioAuthToken().rollback();
    expect(state.calls).toHaveLength(0);
  });
});
