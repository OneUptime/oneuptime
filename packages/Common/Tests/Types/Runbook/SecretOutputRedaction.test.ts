import {
  MIN_REDACTED_SECRET_LENGTH,
  MIN_REDACTED_SECRET_PIECE_LENGTH,
  REDACTED_SECRET_TEXT,
  getSecretPieces,
  getSecretPiecesForRedaction,
  redactSecretValues,
} from "../../../Types/Runbook/SecretOutputRedaction";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * SECRET VARIABLES NEVER SHOW IN A STEP'S OUTPUT.
 *
 * What a step prints is kept with its run, where everyone who may read the
 * runbook's runs reads it. A secret runbook variable the step was handed -
 * a password, a token, a private key, a kubeconfig - is replaced with
 * [REDACTED] in it, whole, and by the pieces a program prints of a value of
 * several lines: one line of a key, a kubeconfig's token.
 */

const R: string = REDACTED_SECRET_TEXT;

const PRIVATE_KEY: string = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW",
  "QyNTUxOQAAACDx1Zf1i9a0mNbrSPx9J3iBK3H2bKqLe3xM6l4Ui7xD1wAAAJgAAAAAAAAA",
  "-----END OPENSSH PRIVATE KEY-----",
].join("\n");

const TOKEN: string =
  "eyJhbGciOiJSUzI1NiIsImtpZCI6Im9uZXVwdGltZSJ9.c2VydmljZS1hY2NvdW50.c2lnbmF0dXJl";

const KUBECONFIG: string = [
  "apiVersion: v1",
  "kind: Config",
  "clusters:",
  "- name: prod",
  "  cluster:",
  "    server: https://prod.example.com:6443",
  "    certificate-authority-data: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUM=",
  "users:",
  "- name: ci",
  "  user:",
  `    token: "${TOKEN}"`,
].join("\n");

describe("redactSecretValues", () => {
  test("hides a password wherever it is printed", () => {
    expect(
      redactSecretValues(
        "login with hunter2-hunter2 failed; retrying hunter2-hunter2",
        ["hunter2-hunter2"],
      ),
    ).toBe(`login with ${R} failed; retrying ${R}`);
  });

  test("hides a value as it is written, white space around it aside", () => {
    expect(redactSecretValues("token=abcd1234\n", ["  abcd1234\n"])).toBe(
      `token=${R}\n`,
    );
  });

  test("hides each line of a private key a program prints, not only the whole key", () => {
    const lines: Array<string> = PRIVATE_KEY.split("\n");
    const output: string = `debug: offering key\n${lines[1]}\nend`;

    expect(redactSecretValues(output, [PRIVATE_KEY])).toBe(
      `debug: offering key\n${R}\nend`,
    );
    expect(redactSecretValues(PRIVATE_KEY, [PRIVATE_KEY])).toBe(R);
  });

  test("hides a kubeconfig's token and keys, and leaves the API server's address readable", () => {
    const output: string = [
      `Using token ${TOKEN}`,
      "error: You must be logged in to the server (Unauthorized) at https://prod.example.com:6443",
      "ca: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUM=",
    ].join("\n");

    expect(redactSecretValues(output, [KUBECONFIG])).toBe(
      [
        `Using token ${R}`,
        "error: You must be logged in to the server (Unauthorized) at https://prod.example.com:6443",
        `ca: ${R}`,
      ].join("\n"),
    );
  });

  test("one secret that holds another is never left half shown", () => {
    expect(
      redactSecretValues("a=secret-value-long b=secret", [
        "secret",
        "secret-value-long",
      ]),
    ).toBe(`a=${R} b=${R}`);
  });

  test("a value shorter than the least it looks for is left alone: it would hide every word", () => {
    expect(MIN_REDACTED_SECRET_LENGTH).toBe(4);
    expect(redactSecretValues("abc is the answer", ["abc"])).toBe(
      "abc is the answer",
    );
    expect(redactSecretValues("abcd is the answer", ["abcd"])).toBe(
      `${R} is the answer`,
    );
  });

  test("text with no secret in it, and no secrets, come back as they were", () => {
    expect(redactSecretValues("all fine", ["hunter2-hunter2"])).toBe(
      "all fine",
    );
    expect(redactSecretValues("all fine", [])).toBe("all fine");
    expect(redactSecretValues("", ["hunter2"])).toBe("");
    expect(
      redactSecretValues("x hunter2x", [null, undefined, "hunter2x"]),
    ).toBe(`x ${R}`);
  });

  test("reads a long output in time in line with its length", () => {
    const output: string = `${"a".repeat(399_990)}hunter2-hunter2`;
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        const redacted: string = redactSecretValues(output, [
          "hunter2-hunter2",
          KUBECONFIG,
          PRIVATE_KEY,
        ]);

        expect(redacted.endsWith(R)).toBe(true);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("the pieces looked for", () => {
  test("a value of one line is looked for whole, and only whole", () => {
    expect(getSecretPieces("hunter2-hunter2")).toEqual(["hunter2-hunter2"]);
  });

  test("a value of several lines: whole, each long one-word line, and each long word after a ':' or '='", () => {
    const pieces: Array<string> = getSecretPieces(KUBECONFIG);

    expect(pieces[0]).toBe(KUBECONFIG.trim());
    expect(pieces).toContain(TOKEN);
    expect(pieces).toContain("LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUM=");
    // Short words and addresses are not.
    expect(pieces).not.toContain("v1");
    expect(pieces).not.toContain("Config");
    expect(pieces).not.toContain("https://prod.example.com:6443");
    for (const piece of pieces.slice(1)) {
      expect(piece.length).toBeGreaterThanOrEqual(
        MIN_REDACTED_SECRET_PIECE_LENGTH,
      );
    }
  });

  test("every secret's pieces, each once, longest first", () => {
    const pieces: Array<string> = getSecretPiecesForRedaction([
      "short-one",
      "a-much-longer-secret-value",
      "short-one",
    ]);

    expect(pieces).toEqual(["a-much-longer-secret-value", "short-one"]);
  });
});
