import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EnvironmentConfig computes the ENCRYPTION_SECRET boot warning but cannot
 * log it (Logger imports EnvironmentConfig), so the process entrypoint has
 * to. StartServer.init is that entrypoint for every HTTP-serving process.
 * A text-level test, in the style the repository uses for registration
 * checks: the wiring is a two-line `if`, and the failure mode -- the warning
 * silently never being said -- is invisible to any behavioural test that
 * does not boot a server.
 */
describe("StartServer emits the ENCRYPTION_SECRET boot warning", () => {
  const source: string = fs.readFileSync(
    path.join(__dirname, "../../../Server/Utils/StartServer.ts"),
    "utf8",
  );

  test("imports EncryptionSecretWarning from EnvironmentConfig", () => {
    const importBlock: RegExpMatchArray | null = source.match(
      /import\s*\{([^}]*)\}\s*from\s*"\.\.\/EnvironmentConfig";/,
    );

    expect(importBlock).not.toBeNull();
    expect(importBlock?.[1]).toContain("EncryptionSecretWarning");
  });

  test("logs it at warn level inside init, before the server launches", () => {
    const initStart: number = source.indexOf("const init: InitFunction");
    const launch: number = source.indexOf(
      "await Express.launchApplication(appName, port);",
      initStart,
    );

    expect(initStart).toBeGreaterThan(-1);
    expect(launch).toBeGreaterThan(initStart);

    const beforeLaunch: string = source.slice(initStart, launch);

    expect(beforeLaunch).toMatch(
      /if\s*\(EncryptionSecretWarning\)\s*\{\s*logger\.warn\(EncryptionSecretWarning\);\s*\}/,
    );
  });

  test("does not refuse to boot over it", () => {
    /*
     * A throw here would take down every existing install that never set
     * the secret, on upgrade, with no way to recover the encrypted columns
     * afterwards anyway. The warning is loud; it is not fatal.
     */
    const initStart: number = source.indexOf("const init: InitFunction");
    const initBody: string = source.slice(
      initStart,
      source.indexOf(
        "await Express.launchApplication(appName, port);",
        initStart,
      ),
    );

    expect(initBody).not.toMatch(/throw[^;]*EncryptionSecret/);
    expect(initBody).not.toMatch(/process\.exit/);
  });
});
