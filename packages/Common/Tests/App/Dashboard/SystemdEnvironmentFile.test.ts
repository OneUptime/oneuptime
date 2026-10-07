import { describe, expect, test } from "@jest/globals";
import { parseSystemdEnvironmentFile } from "./SystemdEnvironmentFile";

/*
 * The port of systemd's EnvironmentFile= parser the VMware guide's tests
 * read the agent's .env with (the install without Docker). It is only worth
 * anything if it reads a line exactly as systemd does, so it is pinned here
 * to what systemd 255 (Ubuntu 24.04) itself produced for the same lines:
 * each file below was loaded with
 *
 *   systemd-run --wait --pipe -p EnvironmentFile=<file> /usr/bin/env
 *
 * and the values are what env printed.
 */

describe("parseSystemdEnvironmentFile", () => {
  test("reads quoting the way systemd 255 did", () => {
    const file: string = [
      "A=DOMAIN\\user",
      "B='DOMAIN\\user'",
      "C=p@ss$word #not a comment",
      "D='Sp3c$ial #pass \"q\" \\ end'",
      'E="it\'s \\"q\\" \\\\ $HOME \\$x"',
      "F='x' #trailing",
      "G=  spaced value  ",
    ].join("\n");

    expect(Object.fromEntries(parseSystemdEnvironmentFile(file))).toEqual({
      // Outside quotes a backslash escapes the next character.
      A: "DOMAINuser",
      B: "DOMAIN\\user",
      // Nothing after the = starts a comment, and $ is never expanded.
      C: "p@ss$word #not a comment",
      D: 'Sp3c$ial #pass "q" \\ end',
      E: 'it\'s "q" \\ $HOME $x',
      // After a closing quote the line goes on as a value.
      F: "x#trailing",
      G: "spaced value",
    });
  });

  test("reads a shell's quoted single quote as systemd 255 did, which is not the shell's value", () => {
    const file: string = [
      "SHELLQ='it'\\''s'",
      'SYSQ="it\'s \\"lab\\" \\\\ $x"',
    ].join("\n");

    expect(Object.fromEntries(parseSystemdEnvironmentFile(file))).toEqual({
      SHELLQ: "it''s'",
      SYSQ: 'it\'s "lab" \\ $x',
    });
  });

  test("skips comments, blank lines and lines without an =, and the last assignment wins", () => {
    const file: string = [
      "# a comment",
      "; another",
      "",
      "   ",
      "NOT_AN_ASSIGNMENT",
      "  KEY = first",
      "KEY=second",
      "EMPTY=",
      "QUOTED_EMPTY=''",
    ].join("\n");

    expect(Object.fromEntries(parseSystemdEnvironmentFile(file))).toEqual({
      KEY: "second",
      EMPTY: "",
      QUOTED_EMPTY: "",
    });
  });

  test("a value can end the file without a newline, quoted or not", () => {
    expect(
      Object.fromEntries(parseSystemdEnvironmentFile("A='x y'\nB=z  ")),
    ).toEqual({ A: "x y", B: "z" });
  });
});
