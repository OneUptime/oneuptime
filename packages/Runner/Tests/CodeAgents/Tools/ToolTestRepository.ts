/*
 * A real git repository on disk for the code agent's tool suites, and the
 * context the tools work with - the tools run git and touch files, so they
 * are tested against the real thing.
 */

import {
  CodeAgentChangeSet,
  CodeAgentToolContext,
} from "../../../CodeAgents/Tools/CodeAgentToolTypes";
import ToolOutputStore from "../../../CodeAgents/Tools/ToolOutputStore";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const temporaryPaths: Array<string> = [];

// A new folder under the system's temporary folder, its real path (links resolved).
export function makeTemporaryDirectory(prefix: string): string {
  const dir: string = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  temporaryPaths.push(dir);
  return dir;
}

export function removeTemporaryDirectories(): void {
  for (const dir of temporaryPaths.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function git(root: string, args: Array<string>): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function writeFile(
  root: string,
  relativePath: string,
  content: string | Buffer,
): void {
  const absolutePath: string = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

export function readFile(root: string, relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf-8");
}

/*
 * A repository with these files, committed as its first commit: the
 * working tree is clean when a test starts.
 */
export function makeRepository(files: Record<string, string | Buffer>): string {
  const root: string = makeTemporaryDirectory("code-agent-tools-");

  git(root, ["init", "-q", "-b", "main", "."]);
  git(root, ["config", "user.email", "tests@oneuptime.com"]);
  git(root, ["config", "user.name", "Runner Tests"]);
  git(root, ["config", "commit.gpgsign", "false"]);

  for (const [relativePath, content] of Object.entries(files)) {
    writeFile(root, relativePath, content);
  }

  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", "baseline"]);

  return root;
}

// What a tool works with in a task: the repository, and a fresh task's state.
export function makeContext(root: string): CodeAgentToolContext {
  return {
    workspaceRoot: root,
    changes: new CodeAgentChangeSet(),
    outputs: new ToolOutputStore(),
  };
}

// The lines of a file as numbered text: "line 1", "line 2", ...
export function numberedLines(count: number, prefix: string = "line"): string {
  const lines: Array<string> = [];

  for (let index: number = 1; index <= count; index++) {
    lines.push(`${prefix} ${index}`);
  }

  return `${lines.join("\n")}\n`;
}

// Every file under .git, by path, with its bytes: to prove nothing wrote there.
export function snapshotGitMetadata(root: string): Map<string, string> {
  const snapshot: Map<string, string> = new Map<string, string>();
  const gitDir: string = path.join(root, ".git");

  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else {
        snapshot.set(
          path.relative(gitDir, full),
          fs.readFileSync(full).toString("base64"),
        );
      }
    }
  };

  walk(gitDir);
  return snapshot;
}
