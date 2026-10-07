import { describe, expect, test } from "@jest/globals";
import { parseSystemdEnvironmentFile } from "./SystemdEnvironmentFile";

/*
 * The port of systemd's EnvironmentFile= parser the VMware guide's tests
 * read the agent's .env with (the install without Docker). It is only worth
 * anything if it reads a line exactly as systemd does, so it is pinned here
 * to what systemd itself produced for the same lines — systemd 255 (Ubuntu
 * 24.04) and, with `legacy`, systemd 239 (Rocky Linux 8, as RHEL 8 ships
 * it). Each file below was loaded with
 *
 *   systemd-run --wait --pipe -p EnvironmentFile=<file> /usr/bin/env
 *
 * and the values are what env printed. systemd 249 (Ubuntu 22.04) and 252
 * (Debian 12) read the double-quoted file exactly as 255 does.
 */

const QUOTING: string = [
  "A=DOMAIN\\user",
  "B='DOMAIN\\user'",
  "C=p@ss$word #not a comment",
  "D='Sp3c$ial #pass \"q\" \\ end'",
  'E="it\'s \\"q\\" \\\\ $HOME \\$x"',
  "F='x' #trailing",
  "G=  spaced value  ",
  "SHELLQ='it'\\''s'",
  'SYSQ="it\'s \\"lab\\" \\\\ $x"',
].join("\n");

// The form systemdEnvQuote writes: double quotes, with \ and " escaped.
const DOUBLE_QUOTED: string = [
  'U="DOMAIN\\\\user"',
  'P="Sp3c$ial #pass \\"q\\" \\\\ end"',
  'Q="it\'s"',
  'R="a b"',
  'S="#x"',
  'T="${x} $y"',
  'V="a`b"',
  'W="end\\\\"',
  'X="oneuptime@vsphere.local"',
  "Y='DOMAIN\\user'",
  'Z=""',
].join("\n");

describe("parseSystemdEnvironmentFile", () => {
  test("reads quoting the way systemd 255 did", () => {
    expect(Object.fromEntries(parseSystemdEnvironmentFile(QUOTING))).toEqual({
      // Outside quotes a backslash escapes the next character.
      A: "DOMAINuser",
      // Single quotes are literal.
      B: "DOMAIN\\user",
      // Nothing after the = starts a comment, and $ is never expanded.
      C: "p@ss$word #not a comment",
      D: 'Sp3c$ial #pass "q" \\ end',
      E: 'it\'s "q" \\ $HOME $x',
      // After a closing quote the line goes on as a value.
      F: "x#trailing",
      G: "spaced value",
      // A shell's quoted single quote is not systemd's.
      SHELLQ: "it''s'",
      SYSQ: 'it\'s "lab" \\ $x',
    });
  });

  test("reads quoting the way systemd 239 did: a backslash escapes inside single quotes too", () => {
    expect(
      Object.fromEntries(
        parseSystemdEnvironmentFile(QUOTING, { legacy: true }),
      ),
    ).toEqual({
      A: "DOMAINuser",
      B: "DOMAINuser",
      C: "p@ss$word #not a comment",
      D: 'Sp3c$ial #pass "q"  end',
      E: 'it\'s "q" \\ $HOME $x',
      F: "x#trailing",
      G: "spaced value",
      SHELLQ: "it''s'",
      SYSQ: 'it\'s "lab" \\ $x',
    });
  });

  test('double quotes with \\ and " escaped read the same in systemd 255 and 239; single quotes do not', () => {
    const expected: Record<string, string> = {
      U: "DOMAIN\\user",
      P: 'Sp3c$ial #pass "q" \\ end',
      Q: "it's",
      R: "a b",
      S: "#x",
      T: "${x} $y",
      V: "a`b",
      W: "end\\",
      X: "oneuptime@vsphere.local",
      Z: "",
    };
    expect(
      Object.fromEntries(parseSystemdEnvironmentFile(DOUBLE_QUOTED)),
    ).toEqual({ ...expected, Y: "DOMAIN\\user" });
    expect(
      Object.fromEntries(
        parseSystemdEnvironmentFile(DOUBLE_QUOTED, { legacy: true }),
      ),
    ).toEqual({ ...expected, Y: "DOMAINuser" });
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

    for (const legacy of [false, true]) {
      expect(
        Object.fromEntries(parseSystemdEnvironmentFile(file, { legacy })),
      ).toEqual({
        KEY: "second",
        EMPTY: "",
        QUOTED_EMPTY: "",
      });
    }
  });

  test("a value can end the file without a newline, quoted or not", () => {
    expect(
      Object.fromEntries(parseSystemdEnvironmentFile("A='x y'\nB=z  ")),
    ).toEqual({ A: "x y", B: "z" });
  });
});
