/*
 * WorkspaceFileAccess decides where the code agent's file tools may read and
 * write, by where a path REALLY leads (links resolved), not by its text.
 * These pin its edges on a real file system; the agent-level suite
 * (Tests/CodeAgents/CodeAgentFileToolsStayInRepository.test.ts) drives the
 * same rule through the real tool loop.
 */

import WorkspaceFileAccess, {
  WorkspaceTarget,
} from "../../Utils/WorkspaceFileAccess";
import fs from "fs";
import os from "os";
import path from "path";

const temporaryPaths: Array<string> = [];

function makeTemporaryDirectory(prefix: string): string {
  const dir: string = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  temporaryPaths.push(dir);
  return dir;
}

interface Layout {
  workspace: string;
  outside: string;
}

function makeLayout(): Layout {
  const outside: string = makeTemporaryDirectory("wfa-outside-");
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside\n");

  const workspace: string = makeTemporaryDirectory("wfa-workspace-");
  fs.mkdirSync(path.join(workspace, ".git", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".git", "config"), "[core]\n");
  fs.mkdirSync(path.join(workspace, "src", "lib"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "lib", "a.ts"), "a\n");
  fs.writeFileSync(path.join(workspace, "README.md"), "# app\n");

  return { workspace, outside };
}

afterAll(() => {
  for (const dir of temporaryPaths) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("WorkspaceFileAccess.resolveForRead", () => {
  test("resolves a plain path inside the workspace", async () => {
    const { workspace } = makeLayout();

    const target: WorkspaceTarget = await WorkspaceFileAccess.resolveForRead(
      workspace,
      "src/lib/a.ts",
    );

    expect(target).toEqual({
      absolutePath: path.join(workspace, "src", "lib", "a.ts"),
      relativePath: path.join("src", "lib", "a.ts"),
    });
  });

  test("the root itself is '.'", async () => {
    const { workspace } = makeLayout();

    await expect(
      WorkspaceFileAccess.resolveForRead(workspace, "."),
    ).resolves.toEqual({ absolutePath: workspace, relativePath: "." });
  });

  test("follows a chain of links that stays inside the workspace", async () => {
    const { workspace } = makeLayout();
    fs.symlinkSync("src", path.join(workspace, "code"));
    fs.symlinkSync("code/lib", path.join(workspace, "lib-alias"));

    const target: WorkspaceTarget = await WorkspaceFileAccess.resolveForRead(
      workspace,
      "lib-alias/a.ts",
    );

    expect(target.absolutePath).toBe(
      path.join(workspace, "src", "lib", "a.ts"),
    );
    expect(target.relativePath).toBe(path.join("src", "lib", "a.ts"));
  });

  test("refuses a link that leads outside, directly or through a chain", async () => {
    const { workspace, outside } = makeLayout();
    fs.symlinkSync(
      path.join(outside, "secret.txt"),
      path.join(workspace, "direct"),
    );
    fs.symlinkSync(outside, path.join(workspace, "dir-out"));
    fs.symlinkSync("dir-out", path.join(workspace, "chain"));
    // A relative link that climbs above the workspace root.
    fs.symlinkSync(path.join("..", ".."), path.join(workspace, "src", "up"));

    for (const requested of [
      "direct",
      "dir-out/secret.txt",
      "chain/secret.txt",
      "src/up",
      `src/up/${path.basename(outside)}/secret.txt`,
    ]) {
      await expect(
        WorkspaceFileAccess.resolveForRead(workspace, requested),
      ).rejects.toThrow(/outside the workspace|escapes the workspace/);
    }
  });

  test("a link to the workspace root's parent is refused, but one to the root itself is not", async () => {
    const { workspace } = makeLayout();
    fs.symlinkSync(
      path.dirname(workspace),
      path.join(workspace, "to-parent"),
    );
    fs.symlinkSync(workspace, path.join(workspace, "to-root"));

    await expect(
      WorkspaceFileAccess.resolveForRead(workspace, "to-parent"),
    ).rejects.toThrow("outside the workspace");

    await expect(
      WorkspaceFileAccess.resolveForRead(workspace, "to-root/README.md"),
    ).resolves.toEqual({
      absolutePath: path.join(workspace, "README.md"),
      relativePath: "README.md",
    });
  });

  test("refuses a dangling link", async () => {
    const { workspace } = makeLayout();
    fs.symlinkSync("missing-target", path.join(workspace, "dangling"));

    await expect(
      WorkspaceFileAccess.resolveForRead(workspace, "dangling"),
    ).rejects.toThrow("outside the workspace");
  });

  test("still refuses text-level escapes", async () => {
    const { workspace } = makeLayout();

    await expect(
      WorkspaceFileAccess.resolveForRead(workspace, "../outside.txt"),
    ).rejects.toThrow("escapes the workspace");
    await expect(
      WorkspaceFileAccess.resolveForRead(workspace, "/etc/hostname"),
    ).rejects.toThrow("escapes the workspace");
    await expect(
      WorkspaceFileAccess.resolveForRead(workspace, ""),
    ).rejects.toThrow("A file path is required");
  });

  test("works when the workspace root is itself reached through a link", async () => {
    const { workspace } = makeLayout();
    const holder: string = makeTemporaryDirectory("wfa-holder-");
    const linkedRoot: string = path.join(holder, "workspace-link");
    fs.symlinkSync(workspace, linkedRoot);

    const target: WorkspaceTarget = await WorkspaceFileAccess.resolveForRead(
      linkedRoot,
      "src/lib/a.ts",
    );

    expect(target.absolutePath).toBe(
      path.join(workspace, "src", "lib", "a.ts"),
    );
    expect(target.relativePath).toBe(path.join("src", "lib", "a.ts"));
  });
});

describe("WorkspaceFileAccess.resolveForWrite", () => {
  test("allows a new file in new directories of the working tree", async () => {
    const { workspace } = makeLayout();

    const target: WorkspaceTarget = await WorkspaceFileAccess.resolveForWrite(
      workspace,
      "src/new/deep/b.ts",
    );

    expect(target).toEqual({
      absolutePath: path.join(workspace, "src", "new", "deep", "b.ts"),
      relativePath: path.join("src", "new", "deep", "b.ts"),
    });
  });

  test("allows files whose names only start with .git", async () => {
    const { workspace } = makeLayout();

    for (const requested of [
      ".gitignore",
      ".github/workflows/ci.yml",
      "docs/.gitkeep",
      ".git-blame-ignore-revs",
    ]) {
      await expect(
        WorkspaceFileAccess.resolveForWrite(workspace, requested),
      ).resolves.toMatchObject({ relativePath: requested });
    }
  });

  test("refuses the git metadata at any depth and in any case", async () => {
    const { workspace } = makeLayout();
    fs.mkdirSync(path.join(workspace, "vendor", "lib", ".git"), {
      recursive: true,
    });

    for (const requested of [
      ".git/config",
      ".git/hooks/pre-push",
      ".git",
      ".GIT/config",
      ".Git/HEAD",
      "vendor/lib/.git/config",
      "src/../.git/config",
      path.join(workspace, ".git", "config"),
    ]) {
      await expect(
        WorkspaceFileAccess.resolveForWrite(workspace, requested),
      ).rejects.toThrow("git metadata");
    }
  });

  test("refuses the git metadata through a link", async () => {
    const { workspace } = makeLayout();
    fs.symlinkSync(".git", path.join(workspace, "meta"));
    fs.symlinkSync(".git/config", path.join(workspace, "settings.ini"));

    await expect(
      WorkspaceFileAccess.resolveForWrite(workspace, "meta/config"),
    ).rejects.toThrow("git metadata");
    await expect(
      WorkspaceFileAccess.resolveForWrite(workspace, "meta/hooks/post-commit"),
    ).rejects.toThrow("git metadata");
    await expect(
      WorkspaceFileAccess.resolveForWrite(workspace, "settings.ini"),
    ).rejects.toThrow("git metadata");
  });

  test("refuses writing the workspace root itself", async () => {
    const { workspace } = makeLayout();

    await expect(
      WorkspaceFileAccess.resolveForWrite(workspace, "."),
    ).rejects.toThrow("workspace root");
  });

  test("refuses a link that leads outside, and a dangling one", async () => {
    const { workspace, outside } = makeLayout();
    fs.symlinkSync(outside, path.join(workspace, "out"));
    fs.symlinkSync(
      path.join(outside, "not-yet.txt"),
      path.join(workspace, "dangling.txt"),
    );

    await expect(
      WorkspaceFileAccess.resolveForWrite(workspace, "out/new.txt"),
    ).rejects.toThrow("outside the workspace");
    await expect(
      WorkspaceFileAccess.resolveForWrite(workspace, "dangling.txt"),
    ).rejects.toThrow("outside the workspace");
  });
});

describe("WorkspaceFileAccess.writeFile", () => {
  test("creates parent directories and writes the content", async () => {
    const { workspace } = makeLayout();

    const target: WorkspaceTarget = await WorkspaceFileAccess.resolveForWrite(
      workspace,
      "src/new/c.ts",
    );
    await WorkspaceFileAccess.writeFile(target, "export const c = 1;\n");

    expect(
      fs.readFileSync(path.join(workspace, "src", "new", "c.ts"), "utf-8"),
    ).toBe("export const c = 1;\n");
  });

  test("overwrites an existing file entirely", async () => {
    const { workspace } = makeLayout();

    const target: WorkspaceTarget = await WorkspaceFileAccess.resolveForWrite(
      workspace,
      "src/lib/a.ts",
    );
    await WorkspaceFileAccess.writeFile(target, "b\n");

    expect(
      fs.readFileSync(path.join(workspace, "src", "lib", "a.ts"), "utf-8"),
    ).toBe("b\n");
  });

  test("never writes through a link that appears after the check", async () => {
    const { workspace, outside } = makeLayout();

    const target: WorkspaceTarget = await WorkspaceFileAccess.resolveForWrite(
      workspace,
      "late.txt",
    );

    // A link planted at the checked location between check and write.
    fs.symlinkSync(
      path.join(outside, "secret.txt"),
      path.join(workspace, "late.txt"),
    );

    await expect(
      WorkspaceFileAccess.writeFile(target, "overwritten\n"),
    ).rejects.toThrow();

    expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf-8")).toBe(
      "outside\n",
    );
  });
});

describe("WorkspaceFileAccess.isInGitMetadata", () => {
  test.each([
    [".git", true],
    [path.join(".git", "config"), true],
    [path.join("a", ".GIT", "b"), true],
    [".gitignore", false],
    [path.join(".github", "x.yml"), false],
    [path.join("a", "b.git"), false],
    ["git", false],
  ])("%s -> %s", (relativePath: string, expected: boolean) => {
    expect(WorkspaceFileAccess.isInGitMetadata(relativePath)).toBe(expected);
  });
});
