import crypto from "crypto";
import { EncryptionSecret } from "../../../../Server/EnvironmentConfig";
import SessionReplayIdentity from "../../../../Server/Utils/SessionReplay/SessionReplayIdentity";
import ObjectID from "../../../../Types/ObjectID";
import { SESSION_REPLAY_MAX_USER_REF_LENGTH } from "../../../../Types/Rum/SessionReplay";
import { describe, expect, test } from "@jest/globals";

/*
 * SessionReplayIdentity turns the end-user reference a recorder sends into
 * the session header's two identity columns: a per-project keyed digest
 * (searchable and erasable) and the trimmed, capped label itself.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const PROJECT_B: ObjectID = new ObjectID(
  "9c1f2d3e-1111-4222-8333-444455556666",
);

describe("SessionReplayIdentity.isUsableUserRef", () => {
  test("accepts an ordinary reference", () => {
    expect(SessionReplayIdentity.isUsableUserRef("jane@example.com")).toBe(
      true,
    );
    expect(SessionReplayIdentity.isUsableUserRef("U-1000")).toBe(true);
  });

  test("accepts a reference padded with white space", () => {
    expect(SessionReplayIdentity.isUsableUserRef("  jane  ")).toBe(true);
  });

  test("refuses an empty or blank reference", () => {
    expect(SessionReplayIdentity.isUsableUserRef("")).toBe(false);
    expect(SessionReplayIdentity.isUsableUserRef("   ")).toBe(false);
    expect(SessionReplayIdentity.isUsableUserRef("\n\t ")).toBe(false);
  });

  test("refuses anything that is not a string", () => {
    expect(SessionReplayIdentity.isUsableUserRef(undefined)).toBe(false);
    expect(SessionReplayIdentity.isUsableUserRef(null)).toBe(false);
    expect(SessionReplayIdentity.isUsableUserRef(1000)).toBe(false);
    expect(SessionReplayIdentity.isUsableUserRef({ id: "jane" })).toBe(false);
    expect(SessionReplayIdentity.isUsableUserRef(["jane"])).toBe(false);
    expect(SessionReplayIdentity.isUsableUserRef(true)).toBe(false);
  });

  test("accepts a reference exactly at the shared cap", () => {
    expect(
      SessionReplayIdentity.isUsableUserRef(
        "a".repeat(SESSION_REPLAY_MAX_USER_REF_LENGTH),
      ),
    ).toBe(true);
  });

  test("refuses a reference one past the shared cap", () => {
    expect(
      SessionReplayIdentity.isUsableUserRef(
        "a".repeat(SESSION_REPLAY_MAX_USER_REF_LENGTH + 1),
      ),
    ).toBe(false);
  });

  test("measures the cap on the untrimmed reference", () => {
    // White space around the reference still counts toward the cap.
    const padded: string = ` ${"a".repeat(SESSION_REPLAY_MAX_USER_REF_LENGTH)}`;

    expect(SessionReplayIdentity.isUsableUserRef(padded)).toBe(false);
  });
});

describe("SessionReplayIdentity.buildUserKey", () => {
  test("is a 64-character lowercase hex SHA-256 HMAC", () => {
    const key: string = SessionReplayIdentity.buildUserKey({
      projectId: PROJECT_A,
      userRef: "jane@example.com",
    });

    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is keyed by the instance secret and the project, over the reference", () => {
    const expected: string = crypto
      .createHmac("sha256", `${EncryptionSecret.toString()}:${PROJECT_A}`)
      .update("jane@example.com")
      .digest("hex");

    expect(
      SessionReplayIdentity.buildUserKey({
        projectId: PROJECT_A,
        userRef: "jane@example.com",
      }),
    ).toBe(expected);
  });

  test("is deterministic, so a filter and a later erasure resolve the same digest", () => {
    const first: string = SessionReplayIdentity.buildUserKey({
      projectId: PROJECT_A,
      userRef: "jane",
    });
    const second: string = SessionReplayIdentity.buildUserKey({
      projectId: new ObjectID(PROJECT_A.toString()),
      userRef: "jane",
    });

    expect(first).toBe(second);
  });

  test("differs between projects for the same person", () => {
    expect(
      SessionReplayIdentity.buildUserKey({
        projectId: PROJECT_A,
        userRef: "jane",
      }),
    ).not.toBe(
      SessionReplayIdentity.buildUserKey({
        projectId: PROJECT_B,
        userRef: "jane",
      }),
    );
  });

  test("trims the reference before hashing it", () => {
    expect(
      SessionReplayIdentity.buildUserKey({
        projectId: PROJECT_A,
        userRef: "  jane \n",
      }),
    ).toBe(
      SessionReplayIdentity.buildUserKey({
        projectId: PROJECT_A,
        userRef: "jane",
      }),
    );
  });

  test("does not fold case: two references differing only in case are two people", () => {
    expect(
      SessionReplayIdentity.buildUserKey({
        projectId: PROJECT_A,
        userRef: "U-1000",
      }),
    ).not.toBe(
      SessionReplayIdentity.buildUserKey({
        projectId: PROJECT_A,
        userRef: "u-1000",
      }),
    );
  });

  test("puts the project in the key, not the message", () => {
    /*
     * Prefixing the message with the project would let "<project>:<ref>"
     * under the bare secret collide with the real digest; keying does not.
     */
    const messagePrefixed: string = crypto
      .createHmac("sha256", EncryptionSecret.toString())
      .update(`${PROJECT_A.toString()}:jane`)
      .digest("hex");

    expect(
      SessionReplayIdentity.buildUserKey({
        projectId: PROJECT_A,
        userRef: "jane",
      }),
    ).not.toBe(messagePrefixed);
  });
});

describe("SessionReplayIdentity.buildUserLabel", () => {
  test("keeps an ordinary reference as it is", () => {
    expect(SessionReplayIdentity.buildUserLabel("jane@example.com")).toBe(
      "jane@example.com",
    );
  });

  test("trims white space around the reference", () => {
    expect(SessionReplayIdentity.buildUserLabel("\t jane@example.com \n")).toBe(
      "jane@example.com",
    );
  });

  test("keeps the reference's case", () => {
    expect(SessionReplayIdentity.buildUserLabel("Jane.Doe")).toBe("Jane.Doe");
  });

  test("caps the label at the shared length", () => {
    const label: string = SessionReplayIdentity.buildUserLabel(
      "b".repeat(SESSION_REPLAY_MAX_USER_REF_LENGTH + 100),
    );

    expect(label).toHaveLength(SESSION_REPLAY_MAX_USER_REF_LENGTH);
  });

  test("trims before capping, so leading white space does not eat the cap", () => {
    const ref: string = `     ${"c".repeat(SESSION_REPLAY_MAX_USER_REF_LENGTH)}`;

    expect(SessionReplayIdentity.buildUserLabel(ref)).toBe(
      "c".repeat(SESSION_REPLAY_MAX_USER_REF_LENGTH),
    );
  });

  test("a blank reference makes an empty label", () => {
    expect(SessionReplayIdentity.buildUserLabel("   ")).toBe("");
  });
});
