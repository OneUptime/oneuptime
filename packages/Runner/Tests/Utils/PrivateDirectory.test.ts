jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import {
  PRIVATE_DIRECTORY_MODE,
  PrivateDirectoryRefusedError,
  ensurePrivateDirectory,
} from "../../Utils/PrivateDirectory";
import WorkspaceManager from "../../Utils/WorkspaceManager";
import GitCredentials from "../../Utils/GitCredentials";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * What the Runner keeps of a code fix - its workspace with a repository's
 * clone, its Git credentials helper - lives in directories only the
 * Runner's user may enter. A global Runner's JavaScript steps run as users
 * of their own beside them, so a directory that lets anyone in, or that
 * another user made first, is never used.
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "runner-private-dir-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function modeOf(directory: string): number {
  return fs.statSync(directory).mode & 0o777;
}

describe("ensurePrivateDirectory", () => {
  test("makes the directory, and its parents, private", async () => {
    const directory: string = path.join(root, "a", "b");

    await ensurePrivateDirectory(directory);

    expect(modeOf(directory)).toBe(PRIVATE_DIRECTORY_MODE);
  });

  test("makes one an older Runner left open private again", async () => {
    const directory: string = path.join(root, "open");
    fs.mkdirSync(directory, { mode: 0o755 });
    fs.chmodSync(directory, 0o777);

    await ensurePrivateDirectory(directory);

    expect(modeOf(directory)).toBe(PRIVATE_DIRECTORY_MODE);
  });

  test("leaves one that is already private, and what is in it, as it is", async () => {
    const directory: string = path.join(root, "kept");
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(path.join(directory, "file"), "kept");

    await ensurePrivateDirectory(directory);

    expect(fs.readFileSync(path.join(directory, "file"), "utf8")).toBe("kept");
  });

  test("refuses a symlink in its place, and never follows it", async () => {
    const target: string = path.join(root, "elsewhere");
    const directory: string = path.join(root, "link");
    fs.mkdirSync(target, { mode: 0o777 });
    fs.chmodSync(target, 0o777);
    fs.symlinkSync(target, directory);

    await expect(ensurePrivateDirectory(directory)).rejects.toThrow(
      PrivateDirectoryRefusedError,
    );
    await expect(ensurePrivateDirectory(directory)).rejects.toThrow(
      "is not a directory (a symlink or a file is in its place)",
    );
    expect(modeOf(target)).toBe(0o777);
  });

  test("refuses a file in its place", async () => {
    const directory: string = path.join(root, "file");
    fs.writeFileSync(directory, "");

    await expect(ensurePrivateDirectory(directory)).rejects.toThrow(
      "is not a directory",
    );
  });

  test("refuses a directory another user made, and leaves it as it is", async () => {
    const directory: string = path.join(root, "theirs");
    fs.mkdirSync(directory, { mode: 0o777 });
    fs.chmodSync(directory, 0o777);
    const otherUser: number = (process.getuid?.() ?? 0) + 1;

    await expect(ensurePrivateDirectory(directory, otherUser)).rejects.toThrow(
      `is owned by another user (uid ${fs.statSync(directory).uid})`,
    );
    expect(modeOf(directory)).toBe(0o777);
  });
});

describe("the code-fix lane's directories", () => {
  test("a fix's workspace is private, under a private base", async () => {
    const workspace: { workspacePath: string } =
      await WorkspaceManager.createWorkspace("task-1");

    try {
      expect(modeOf(workspace.workspacePath)).toBe(PRIVATE_DIRECTORY_MODE);
      expect(modeOf(WorkspaceManager.getBaseTempDir())).toBe(
        PRIVATE_DIRECTORY_MODE,
      );
    } finally {
      await WorkspaceManager.deleteWorkspace(workspace.workspacePath);
    }
  });

  test("the Git credentials helper's directory is private", async () => {
    await GitCredentials.initialize();

    expect(modeOf(GitCredentials.getBaseDir())).toBe(PRIVATE_DIRECTORY_MODE);
  });

  test("the Runner makes both before it starts taking steps", () => {
    const index: string = fs.readFileSync(
      path.join(__dirname, "../../Index.ts"),
      "utf8",
    );
    const runbookLoop: number = index.indexOf("    startRunbookPolling();");

    expect(runbookLoop).toBeGreaterThan(-1);
    expect(index.indexOf("await WorkspaceManager.initialize();")).toBeLessThan(
      runbookLoop,
    );
    expect(index.indexOf("await GitCredentials.initialize()")).toBeLessThan(
      runbookLoop,
    );
  });
});
