import { describe, expect, test } from "@jest/globals";
import {
  MAX_SSH_HOST_KEYS,
  MAX_SSH_HOST_KEY_TEXT_LENGTH,
  ParsedSshHostKeys,
  SSH_HOST_KEY_TYPES,
  decodeSshBase64,
  getSshHostKeyProblem,
  hasSshHostKeys,
  parseSshHostKeys,
  readSshKeyBlobType,
} from "../../../Types/Runbook/SshHostKey";
import {
  SshPinnedHostKey,
  describeSshHostKey,
  getPinnedSshHostKeys,
  getSshHostKeyAlgorithms,
  getSshHostKeyFingerprint,
} from "../../../Utils/Runbook/SshHostKeyFingerprint";

/*
 * AN SSH STEP'S HOST KEYS (Types/Runbook/SshHostKey, and the Node half that
 * works out fingerprints, Utils/Runbook/SshHostKeyFingerprint).
 *
 * The keys below are throwaway host keys made with ssh-keygen, and each
 * fingerprint is the one `ssh-keygen -l -E sha256` printed for it - so the
 * fingerprints worked out here are held to OpenSSH's own.
 */

const ED25519_KEY: string =
  "AAAAC3NzaC1lZDI1NTE5AAAAIFtux8m1u+wimvaBoFQoXsFnlH+H+VfhMAHNjDNrl2Q0";
const ED25519_FINGERPRINT: string =
  "SHA256:gwsSZuUZNvG/8pOZ2G715I2GTVbDlhL4EKu6z7WLKNM";

const ECDSA_KEY: string =
  "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBD2RIgDdhgPvM6gXsqG5hM3TmjKHrAal9RN7KP34eSs4O1Y5H8cHvIzddlIAeSKJqzQLJfZAnNCQ09Wah2/bS0A=";
const ECDSA_FINGERPRINT: string =
  "SHA256:bR0QiiwsNAfU3pttv8Rf/vgkA0sbbgPrbSZB2VPKiL8";

const RSA_KEY: string =
  "AAAAB3NzaC1yc2EAAAADAQABAAABAQC2E9Slu6PeV0Li4fRB9aqweOD5/7551ZFBW6ETvkOYpuUqdTghUO/CIAdQubWEqSBhp3AOMCqiziI5SxWqorfDh8WvhraHASO6ZLei4fmdDt6Ls3mXfgMIVMnNQe4FP4M/yex6v9LmMJfL4+zmui6Jx0V8fKMMdVCoUTjk6I4bk4ZHeTI5LnseRcZMSpcHNhQciKvmGTmMuYI7SQrhnjWShHjukIZtv9K6jamuEIFO7U5ii7hlIX90n5j0DE1OPJdIMaGC/eSdQeQWBX/wc6SBghMOtvLkRq72mvj17k7ct9vaerSVM+9NRyT4V6wQkVEO0tT0BgTGhtwHpj/dPoEn";
const RSA_FINGERPRINT: string =
  "SHA256:RbcFlZhe2wka/JUlPW5q7w6NacLcWWpI8xpwc4rkGgw";

describe("the lines a step's Host key reads", () => {
  test.each([
    ["a fingerprint as ssh prints it", ED25519_FINGERPRINT],
    [
      "a whole ssh-keygen -l line",
      `256 ${ED25519_FINGERPRINT} root@db-1 (ED25519)`,
    ],
    ["a fingerprint with its padding", `${ED25519_FINGERPRINT}=`],
  ])("%s: the fingerprint", (_label: string, line: string) => {
    expect(parseSshHostKeys(line)).toEqual({
      entries: [{ kind: "fingerprint", fingerprint: ED25519_FINGERPRINT }],
      invalidLines: [],
      isTooLong: false,
    });
  });

  test.each([
    ["a .pub file", `ssh-ed25519 ${ED25519_KEY} root@db-1`],
    ["ssh-keyscan's line", `10.0.4.21 ssh-ed25519 ${ED25519_KEY}`],
    [
      "a known_hosts line of several names",
      `db-1,10.0.4.21 ssh-ed25519 ${ED25519_KEY}`,
    ],
    [
      "a hashed known_hosts line",
      `|1|F1E1KeoE/eEWhi10WpGv4OdiO6Y=|3988QV0VE8wmZL7suNrYQLITLCg= ssh-ed25519 ${ED25519_KEY}`,
    ],
    ["the key alone", `ssh-ed25519 ${ED25519_KEY}`],
  ])("%s: the public key", (_label: string, line: string) => {
    expect(parseSshHostKeys(line).entries).toEqual([
      { kind: "publicKey", keyType: "ssh-ed25519", keyBase64: ED25519_KEY },
    ]);
  });

  test("ECDSA and RSA keys read as theirs, padding left out", () => {
    expect(
      parseSshHostKeys(
        [
          `ecdsa-sha2-nistp256 ${ECDSA_KEY} root@db-1`,
          `ssh-rsa ${RSA_KEY} root@db-1`,
        ].join("\n"),
      ).entries,
    ).toEqual([
      {
        kind: "publicKey",
        keyType: "ecdsa-sha2-nistp256",
        keyBase64: ECDSA_KEY.slice(0, -1),
      },
      { kind: "publicKey", keyType: "ssh-rsa", keyBase64: RSA_KEY },
    ]);
  });

  test("ssh-keyscan's comment lines, blank lines and Windows line ends are skipped", () => {
    const parsed: ParsedSshHostKeys = parseSshHostKeys(
      [
        "# 10.0.4.21:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13",
        "",
        `10.0.4.21 ssh-ed25519 ${ED25519_KEY}`,
        "   ",
        `${RSA_FINGERPRINT}`,
      ].join("\r\n"),
    );

    expect(parsed.entries).toHaveLength(2);
    expect(parsed.invalidLines).toEqual([]);
  });

  test.each([
    [
      "an MD5 fingerprint",
      "MD5:6e:39:52:cc:29:3d:dd:a3:6b:4f:5c:0e:3a:6c:85:20",
    ],
    [
      "a bare MD5 fingerprint",
      "6e:39:52:cc:29:3d:dd:a3:6b:4f:5c:0e:3a:6c:85:20",
    ],
    ["a fingerprint one character short", ED25519_FINGERPRINT.slice(0, -1)],
    ["a fingerprint one character long", `${ED25519_FINGERPRINT}A`],
    [
      "a fingerprint whose last character cannot end one",
      `${ED25519_FINGERPRINT.slice(0, -1)}N`,
    ],
    ["a key type with no key", "ssh-ed25519"],
    ["a key that is not base64", "ssh-ed25519 not*base64"],
    ["an Ed25519 line holding an RSA key", `ssh-ed25519 ${RSA_KEY}`],
    ["a key type OneUptime does not read", `ssh-dss ${ED25519_KEY}`],
    [
      "a certificate authority line",
      `@cert-authority *.example.com ssh-ed25519 ${ED25519_KEY}`,
    ],
    ["a runbook variable", "{{global.variables.DB_HOST_KEY}}"],
    ["words", "the usual one"],
  ])("%s: a line that is not a key", (_label: string, line: string) => {
    expect(parseSshHostKeys(line)).toEqual({
      entries: [],
      invalidLines: [line],
      isTooLong: false,
    });
  });

  test("nothing at all names no key, and no problem", () => {
    for (const text of [undefined, "", "  \n  "]) {
      expect(parseSshHostKeys(text)).toEqual({
        entries: [],
        invalidLines: [],
        isTooLong: false,
      });
      expect(getSshHostKeyProblem(text)).toBe(null);
    }

    expect(hasSshHostKeys(undefined)).toBe(false);
    expect(hasSshHostKeys(" \n ")).toBe(false);
    expect(hasSshHostKeys("words")).toBe(true);
  });

  test("more keys than a step may name, or more text than the field holds, is too long", () => {
    const many: string = Array.from(
      { length: MAX_SSH_HOST_KEYS + 1 },
      (): string => {
        return ED25519_FINGERPRINT;
      },
    ).join("\n");

    expect(parseSshHostKeys(many).isTooLong).toBe(true);
    expect(
      parseSshHostKeys("A".repeat(MAX_SSH_HOST_KEY_TEXT_LENGTH + 1)).isTooLong,
    ).toBe(true);
    expect(getSshHostKeyProblem(many)).toBe(
      `This SSH step's Host key names more than ${MAX_SSH_HOST_KEYS} keys, so it was not run. A machine has one key of each type: name those.`,
    );
  });

  test("a line that is not a key is a problem the server says, in English", () => {
    expect(getSshHostKeyProblem(`${ED25519_FINGERPRINT}\nthe usual one`)).toBe(
      "This SSH step's Host key has a line that is neither a SHA256 fingerprint nor a public key, so it was not run. Open the step and put the machine's SHA256 fingerprint, or its public key as ssh-keyscan prints it, one a line.",
    );
  });

  test("a long run of padding or spaces reads at once: nothing backtracks", () => {
    const started: number = Date.now();

    parseSshHostKeys(`ssh-ed25519 ${"=".repeat(40000)}x`);
    parseSshHostKeys(`${" ".repeat(40000)}x`);

    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("base64 and the key's own type", () => {
  test("base64 decodes as Node decodes it, with or without padding", () => {
    for (const key of [ED25519_KEY, ECDSA_KEY, RSA_KEY]) {
      expect(Buffer.from(decodeSshBase64(key)!)).toEqual(
        Buffer.from(key, "base64"),
      );
    }

    expect(decodeSshBase64("")).toBe(null);
    expect(decodeSshBase64("A")).toBe(null);
    expect(decodeSshBase64("AA*A")).toBe(null);
  });

  test("a key says its own type first", () => {
    expect(readSshKeyBlobType(decodeSshBase64(ED25519_KEY)!)).toBe(
      "ssh-ed25519",
    );
    expect(readSshKeyBlobType(decodeSshBase64(RSA_KEY)!)).toBe("ssh-rsa");
    expect(readSshKeyBlobType(Uint8Array.from([0, 0, 0]))).toBe(null);
    // A length longer than what follows.
    expect(readSshKeyBlobType(Uint8Array.from([0, 0, 0, 9, 115, 115]))).toBe(
      null,
    );
  });

  test("the types read are the host key types OpenSSH writes", () => {
    expect([...SSH_HOST_KEY_TYPES]).toEqual([
      "ssh-ed25519",
      "ecdsa-sha2-nistp256",
      "ecdsa-sha2-nistp384",
      "ecdsa-sha2-nistp521",
      "ssh-rsa",
    ]);
  });
});

describe("fingerprints, as OpenSSH prints them", () => {
  test.each([
    ["Ed25519", ED25519_KEY, ED25519_FINGERPRINT],
    ["ECDSA", ECDSA_KEY, ECDSA_FINGERPRINT],
    ["RSA", RSA_KEY, RSA_FINGERPRINT],
  ])(
    "%s: the fingerprint ssh-keygen gives",
    (_label: string, key: string, fingerprint: string) => {
      expect(getSshHostKeyFingerprint(Buffer.from(key, "base64"))).toBe(
        fingerprint,
      );
    },
  );

  test("a presented key: its fingerprint and its type", () => {
    expect(describeSshHostKey(Buffer.from(ECDSA_KEY, "base64"))).toEqual({
      fingerprint: ECDSA_FINGERPRINT,
      keyType: "ecdsa-sha2-nistp256",
    });
  });

  test("what a step names, as the Runner checks it: fingerprints, each once, with the type of each key written out", () => {
    const keys: Array<SshPinnedHostKey> = getPinnedSshHostKeys(
      [
        `10.0.4.21 ssh-ed25519 ${ED25519_KEY}`,
        ED25519_FINGERPRINT,
        RSA_FINGERPRINT,
        "the usual one",
      ].join("\n"),
    );

    expect(keys).toEqual([
      { fingerprint: ED25519_FINGERPRINT, keyType: "ssh-ed25519" },
      { fingerprint: RSA_FINGERPRINT },
    ]);
  });
});

describe("the key types the Runner asks the machine for", () => {
  test("every key written out: those types, RSA with SHA-2 first", () => {
    expect(
      getSshHostKeyAlgorithms([
        { fingerprint: RSA_FINGERPRINT, keyType: "ssh-rsa" },
        { fingerprint: ED25519_FINGERPRINT, keyType: "ssh-ed25519" },
      ]),
    ).toEqual(["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa", "ssh-ed25519"]);
  });

  test("a key named by its fingerprint alone: the machine presents the one it prefers", () => {
    expect(
      getSshHostKeyAlgorithms([
        { fingerprint: ED25519_FINGERPRINT, keyType: "ssh-ed25519" },
        { fingerprint: RSA_FINGERPRINT },
      ]),
    ).toBe(null);
    expect(getSshHostKeyAlgorithms([])).toBe(null);
  });
});
