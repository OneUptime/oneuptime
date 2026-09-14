import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import Execute from "../../../Server/Utils/Execute";

/*
 * The one place in the app that starts a child process.
 *
 * Three entry points with deliberately different shapes, and the differences
 * are the whole point:
 *
 *  - executeCommand() goes through a SHELL, so pipes and redirection work and
 *    interpolated input is dangerous. It exists for fixed, developer-authored
 *    command lines.
 *  - executeCommandFile() does NOT use a shell: argv is passed as an array, so
 *    a repository name containing `;` is an argument and not a second command.
 *    It also carries the three guards the code-repository integrations depend
 *    on -- maxBuffer for large `git log` output, a hard timeout so a wedged
 *    child cannot hang the caller, and a REPLACEMENT env so a git askpass
 *    token reaches exactly one child instead of sitting in process.env where
 *    every later child (including an AI agent's shell) would inherit it.
 *  - executeCommandInheritStdio() streams to the parent's stdio and resolves
 *    on exit code rather than capturing output.
 *
 * Every one of those guards fails silently when it regresses: the token leak
 * is invisible until something else reads process.env, and a missing timeout
 * looks like a slow request rather than an error. So they are pinned by
 * running real children.
 */

jest.mock("../../../Server/Utils/Logger", () => {
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

const NODE: string = process.execPath;
const TEMP_DIR: string = os.tmpdir();

describe("Execute", () => {
  describe("executeCommand", () => {
    test("resolves with the child's stdout", async () => {
      const output: string = await Execute.executeCommand(
        `"${NODE}" -e "process.stdout.write('hello from the child')"`,
      );

      expect(output).toBe("hello from the child");
    });

    test("stderr alone is not a failure -- only a non-zero exit is", async () => {
      const output: string = await Execute.executeCommand(
        `"${NODE}" -e "process.stderr.write('warning: deprecated'); process.stdout.write('done')"`,
      );

      expect(output).toBe("done");
    });

    test("rejects when the child exits non-zero", async () => {
      await expect(
        Execute.executeCommand(`"${NODE}" -e "process.exit(3)"`),
      ).rejects.toMatchObject({ code: 3 });
    });

    test("honours the cwd it is given", async () => {
      const output: string = await Execute.executeCommand(
        `"${NODE}" -e "process.stdout.write(process.cwd())"`,
        { cwd: TEMP_DIR },
      );

      /*
       * macOS reports os.tmpdir() as /var/... but a process that chdir's there
       * reports the /private/var it really resolves to, so compare realpaths.
       */
      expect(fs.realpathSync(output)).toBe(fs.realpathSync(TEMP_DIR));
    });
  });

  describe("executeCommandFile", () => {
    test("resolves with the child's stdout", async () => {
      const output: string = await Execute.executeCommandFile({
        command: NODE,
        args: ["-e", "process.stdout.write('from argv')"],
        cwd: TEMP_DIR,
      });

      expect(output).toBe("from argv");
    });

    test("passes argv as data, so shell metacharacters cannot start a second command", async () => {
      /*
       * The injection this shape exists to prevent: through a shell,
       * `; echo pwned` would run. Through execFile it is just a string.
       */
      const hostile: string = "release-1.0; echo pwned";

      const output: string = await Execute.executeCommandFile({
        command: NODE,
        args: ["-e", "process.stdout.write(process.argv[1] || '')", hostile],
        cwd: TEMP_DIR,
      });

      expect(output).toBe(hostile);
      expect(output).not.toContain("pwned\n");
    });

    test("rejects when the child exits non-zero", async () => {
      await expect(
        Execute.executeCommandFile({
          command: NODE,
          args: ["-e", "process.exit(4)"],
          cwd: TEMP_DIR,
        }),
      ).rejects.toMatchObject({ code: 4 });
    });

    test("rejects rather than hanging when the command does not exist", async () => {
      await expect(
        Execute.executeCommandFile({
          command: path.join(TEMP_DIR, "no-such-binary-oneuptime-test"),
          args: [],
          cwd: TEMP_DIR,
        }),
      ).rejects.toBeDefined();
    });

    describe("maxBuffer", () => {
      const LARGE_OUTPUT_BYTES: number = 1_200_000; // Over the 1 MB default.

      const writeLargeOutput: string = `process.stdout.write('x'.repeat(${LARGE_OUTPUT_BYTES}))`;

      test("output over the 1 MB node default is truncated into a rejection when maxBuffer is not raised", async () => {
        await expect(
          Execute.executeCommandFile({
            command: NODE,
            args: ["-e", writeLargeOutput],
            cwd: TEMP_DIR,
          }),
        ).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
      });

      test("the same output comes back whole once maxBuffer is raised", async () => {
        const output: string = await Execute.executeCommandFile({
          command: NODE,
          args: ["-e", writeLargeOutput],
          cwd: TEMP_DIR,
          maxBuffer: 10 * 1024 * 1024,
        });

        expect(output.length).toBe(LARGE_OUTPUT_BYTES);
      });
    });

    describe("timeoutInMS", () => {
      test("a child that outlives the timeout is killed and the promise rejects", async () => {
        const startedAt: number = Date.now();

        await expect(
          Execute.executeCommandFile({
            command: NODE,
            // Would sit for 30s; the timeout has to be what ends it.
            args: ["-e", "setTimeout(() => {}, 30000)"],
            cwd: TEMP_DIR,
            timeoutInMS: 500,
          }),
        ).rejects.toMatchObject({ killed: true, signal: "SIGKILL" });

        // Proves the timeout fired rather than the child simply finishing.
        expect(Date.now() - startedAt).toBeLessThan(20_000);
      }, 30_000);

      test("a child that finishes inside the timeout is unaffected", async () => {
        const output: string = await Execute.executeCommandFile({
          command: NODE,
          args: ["-e", "process.stdout.write('quick')"],
          cwd: TEMP_DIR,
          timeoutInMS: 20_000,
        });

        expect(output).toBe("quick");
      });
    });

    describe("env", () => {
      const readEnv: string =
        "process.stdout.write(JSON.stringify({ secret: process.env.ONEUPTIME_TEST_SECRET || null, path: Boolean(process.env.PATH) }))";

      test("a given env REPLACES the parent's, so a secret does not leak through process.env", async () => {
        process.env["ONEUPTIME_TEST_PARENT_ONLY"] = "parent-value";

        try {
          const output: string = await Execute.executeCommandFile({
            command: NODE,
            args: [
              "-e",
              "process.stdout.write(process.env.ONEUPTIME_TEST_PARENT_ONLY || 'absent')",
            ],
            cwd: TEMP_DIR,
            env: { ONEUPTIME_TEST_SECRET: "askpass-token" },
          });

          /*
           * The parent's variable must NOT be visible: that is what makes this
           * a replacement rather than a merge, and it is the reason a token
           * handed to one child is not handed to every other child.
           */
          expect(output).toBe("absent");
        } finally {
          delete process.env["ONEUPTIME_TEST_PARENT_ONLY"];
        }
      });

      test("the variables that were handed over do reach the child", async () => {
        const output: string = await Execute.executeCommandFile({
          command: NODE,
          args: ["-e", readEnv],
          cwd: TEMP_DIR,
          env: { ONEUPTIME_TEST_SECRET: "askpass-token" },
        });

        expect(JSON.parse(output)).toEqual({
          secret: "askpass-token",
          path: false,
        });
      });

      test("without an env override the child inherits the parent's environment", async () => {
        /*
         * The contrast with the test above: PATH is absent from the child that
         * was handed a replacement env, and present in the one that was not.
         *
         * PATH rather than a variable this test sets, because Jest hands each
         * test file its own copy of process.env -- a variable assigned here
         * never reaches the real environment a child would inherit, so it
         * could not tell inheritance from a leak.
         */
        const output: string = await Execute.executeCommandFile({
          command: NODE,
          args: ["-e", readEnv],
          cwd: TEMP_DIR,
        });

        expect(JSON.parse(output).path).toBe(true);
      });
    });
  });

  describe("executeCommandInheritStdio", () => {
    test("resolves with nothing when the child exits 0", async () => {
      await expect(
        Execute.executeCommandInheritStdio({
          command: NODE,
          args: ["-e", "process.exit(0)"],
          options: { cwd: TEMP_DIR, stdio: "ignore" },
        }),
      ).resolves.toBeUndefined();
    });

    test("rejects with the exit code in the message when the child fails", async () => {
      await expect(
        Execute.executeCommandInheritStdio({
          command: NODE,
          args: ["-e", "process.exit(7)"],
          options: { cwd: TEMP_DIR, stdio: "ignore" },
        }),
      ).rejects.toThrow("exit code 7");
    });

    test("rejects when the command cannot be spawned at all", async () => {
      await expect(
        Execute.executeCommandInheritStdio({
          command: path.join(TEMP_DIR, "no-such-binary-oneuptime-test"),
          options: { cwd: TEMP_DIR, stdio: "ignore" },
        }),
      ).rejects.toBeDefined();
    });

    test("runs with no shell by default, so a metacharacter argument is not interpreted", async () => {
      /*
       * With shell: true this would be two commands and the file would appear.
       * Without one, `;` is part of the single argument the child prints.
       */
      const output: Promise<void> = Execute.executeCommandInheritStdio({
        command: NODE,
        args: [
          "-e",
          "process.exit(process.argv[1] === '; exit 9' ? 0 : 1)",
          "; exit 9",
        ],
        options: { cwd: TEMP_DIR, stdio: "ignore" },
      });

      await expect(output).resolves.toBeUndefined();
    });
  });
});
