import GitCredentials, {
  GitCredentialHandle,
} from "../../Utils/GitCredentials";
import fs from "fs/promises";
import path from "path";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The repository token is the most dangerous value the code-fix pipeline
 * handles: it can push to a customer's repository, and it spends up to half
 * an hour inside a workspace a language model is driving with `read_file` and
 * `run_command`.
 *
 * GitCredentials is what keeps it out of that model's reach, and none of it
 * was covered. The properties below are exactly the three leaks the askpass
 * approach exists to close - argv, .git/config, and the push - plus the
 * filesystem hygiene that keeps the helper itself unreadable.
 */

const TOKEN: string = "ghs_thisIsNotARealTokenButLooksLikeOne0123456789";

const handles: Array<GitCredentialHandle> = [];

async function makeHandle(token: string = TOKEN): Promise<GitCredentialHandle> {
  const handle: GitCredentialHandle = await GitCredentials.create(token);

  handles.push(handle);

  return handle;
}

afterEach(async () => {
  while (handles.length > 0) {
    await handles.pop()!.dispose();
  }
});

describe("GitCredentials.create - the environment handed to git", () => {
  test("the token travels in the child environment, never in the URL or argv", async () => {
    const handle: GitCredentialHandle = await makeHandle();

    expect(handle.env["ONEUPTIME_GIT_ACCESS_TOKEN"]).toBe(TOKEN);
    expect(handle.env["GIT_ASKPASS"]).toBeTruthy();
    /* The path git is given is a script path, not something bearing a secret. */
    expect(handle.env["GIT_ASKPASS"]).not.toContain(TOKEN);
  });

  test("it never writes the token into this process's own environment", async () => {
    await makeHandle();

    /*
     * The code agent's run_command inherits process.env. If the token were
     * ever set here, the whole askpass arrangement would be pointless.
     */
    expect(process.env["ONEUPTIME_GIT_ACCESS_TOKEN"]).toBeUndefined();
    expect(process.env["GIT_ASKPASS"]).toBeUndefined();
  });

  test("terminal prompting is off, so refused credentials fail fast", async () => {
    const handle: GitCredentialHandle = await makeHandle();

    expect(handle.env["GIT_TERMINAL_PROMPT"]).toBe("0");
  });

  test("system credential helpers are disabled, so nothing is cached across tenants", async () => {
    const handle: GitCredentialHandle = await makeHandle();

    expect(handle.env["GIT_CONFIG_NOSYSTEM"]).toBe("1");
  });

  test("two handles get their own script, so disposing one cannot disarm the other", async () => {
    const first: GitCredentialHandle = await makeHandle();
    const second: GitCredentialHandle = await makeHandle("ghs_second_token");

    expect(first.env["GIT_ASKPASS"]).not.toBe(second.env["GIT_ASKPASS"]);
    expect(second.env["ONEUPTIME_GIT_ACCESS_TOKEN"]).toBe("ghs_second_token");
  });
});

describe("GitCredentials.create - the askpass script on disk", () => {
  test("the script holds no secret: it echoes the environment variable", async () => {
    const handle: GitCredentialHandle = await makeHandle();
    const contents: string = await fs.readFile(
      handle.env["GIT_ASKPASS"]!,
      "utf8",
    );

    expect(contents).not.toContain(TOKEN);
    expect(contents).toContain("ONEUPTIME_GIT_ACCESS_TOKEN");
    expect(contents.startsWith("#!/bin/sh")).toBe(true);
  });

  test("the script is owner-only and executable", async () => {
    const handle: GitCredentialHandle = await makeHandle();
    const stat: Awaited<ReturnType<typeof fs.stat>> = await fs.stat(
      handle.env["GIT_ASKPASS"]!,
    );

    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o777).toBe(0o700);
  });

  test("the script lives outside any workspace, in the runner's own 0700 directory", async () => {
    const handle: GitCredentialHandle = await makeHandle();

    expect(path.dirname(handle.env["GIT_ASKPASS"]!)).toBe(
      GitCredentials.getBaseDir(),
    );

    const stat: Awaited<ReturnType<typeof fs.stat>> = await fs.stat(
      GitCredentials.getBaseDir(),
    );

    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o777).toBe(0o700);
  });

  test("dispose removes the script, and is safe to call twice", async () => {
    const handle: GitCredentialHandle = await GitCredentials.create(TOKEN);
    const scriptPath: string = handle.env["GIT_ASKPASS"]!;

    await handle.dispose();

    await expect(fs.stat(scriptPath)).rejects.toThrow();

    /* RepositoryManager disposes in a finally block; a double call is normal. */
    await expect(handle.dispose()).resolves.toBeUndefined();
  });
});

describe("GitCredentials.buildRemoteUrl", () => {
  test("the default GitHub URL carries the username and no token", () => {
    const url: string = GitCredentials.buildRemoteUrl({
      organizationName: "acme",
      repositoryName: "checkout",
    });

    expect(url).toBe("https://x-access-token@github.com/acme/checkout.git");
    expect(url).not.toContain(TOKEN);
  });

  test("a supplied URL keeps its host and path but gets the username", () => {
    const url: string = GitCredentials.buildRemoteUrl({
      repositoryUrl: "https://github.enterprise.acme/team/service.git",
      organizationName: "ignored",
      repositoryName: "ignored",
    });

    expect(url).toContain("x-access-token@github.enterprise.acme");
    expect(url).toContain("/team/service.git");
  });

  test("a password the caller already embedded is stripped, not carried through", () => {
    /*
     * This is the value that ends up in .git/config, where the agent can
     * read it. A caller handing us an already-authenticated URL must not be
     * able to persist that secret by accident.
     */
    const url: string = GitCredentials.buildRemoteUrl({
      repositoryUrl: `https://x-access-token:${TOKEN}@github.com/acme/checkout.git`,
      organizationName: "acme",
      repositoryName: "checkout",
    });

    expect(url).not.toContain(TOKEN);
    expect(url).toContain("x-access-token@github.com");
  });

  test("a username the caller embedded is replaced with x-access-token", () => {
    const url: string = GitCredentials.buildRemoteUrl({
      repositoryUrl: "https://someone@github.com/acme/checkout.git",
      organizationName: "acme",
      repositoryName: "checkout",
    });

    expect(url).toContain("x-access-token@github.com");
    expect(url).not.toContain("someone@");
  });
});

describe("GitCredentials.cleanupOrphans", () => {
  test("it sweeps askpass scripts a killed runner left behind", async () => {
    const first: GitCredentialHandle = await GitCredentials.create(TOKEN);
    const second: GitCredentialHandle = await GitCredentials.create(TOKEN);

    const removed: number = await GitCredentials.cleanupOrphans();

    expect(removed).toBeGreaterThanOrEqual(2);
    await expect(fs.stat(first.env["GIT_ASKPASS"]!)).rejects.toThrow();
    await expect(fs.stat(second.env["GIT_ASKPASS"]!)).rejects.toThrow();
  });

  test("it leaves anything that is not an askpass script alone", async () => {
    await GitCredentials.create(TOKEN);

    const bystander: string = path.join(
      GitCredentials.getBaseDir(),
      "not-ours.txt",
    );

    await fs.writeFile(bystander, "keep me", { mode: 0o600 });

    try {
      await GitCredentials.cleanupOrphans();

      await expect(fs.stat(bystander)).resolves.toBeTruthy();
    } finally {
      await fs.rm(bystander, { force: true });
    }
  });

  test("a runner that has never created one sweeps nothing and does not throw", async () => {
    await GitCredentials.cleanupOrphans();

    await expect(GitCredentials.cleanupOrphans()).resolves.toBe(0);
  });
});
