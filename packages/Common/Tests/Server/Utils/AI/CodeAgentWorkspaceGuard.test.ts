import CodeAgentWorkspaceGuard, {
  MAX_TOOL_OUTPUT_CHARS,
} from "../../../../Server/Utils/AI/CodeFix/CodeAgentWorkspaceGuard";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The in-house code agent's pure safety edges (B4 Tier 0): every workspace
 * tool path must resolve INSIDE the run's ephemeral workspace, and every
 * tool output must be truncated before it re-enters the model context.
 * These are the invariants the model itself is not trusted with.
 */

const workspaceRoot: string = path.join(path.sep, "tmp", "oneuptime-ws");

describe("CodeAgentWorkspaceGuard.resolveWorkspacePath", () => {
  test("resolves a relative path inside the workspace", () => {
    expect(
      CodeAgentWorkspaceGuard.resolveWorkspacePath(
        workspaceRoot,
        "src/billing/charge.ts",
      ),
    ).toBe(path.join(workspaceRoot, "src", "billing", "charge.ts"));
  });

  test("'.' resolves to the workspace root itself", () => {
    expect(
      CodeAgentWorkspaceGuard.resolveWorkspacePath(workspaceRoot, "."),
    ).toBe(workspaceRoot);
  });

  test("normalizes internal '..' segments that stay inside", () => {
    expect(
      CodeAgentWorkspaceGuard.resolveWorkspacePath(
        workspaceRoot,
        "src/../package.json",
      ),
    ).toBe(path.join(workspaceRoot, "package.json"));
  });

  test("refuses '..' traversal out of the workspace", () => {
    expect(() => {
      return CodeAgentWorkspaceGuard.resolveWorkspacePath(
        workspaceRoot,
        "../etc/passwd",
      );
    }).toThrow("escapes the workspace");
  });

  test("refuses deep traversal that leaves and re-enters elsewhere", () => {
    expect(() => {
      return CodeAgentWorkspaceGuard.resolveWorkspacePath(
        workspaceRoot,
        "src/../../other-workspace/file.ts",
      );
    }).toThrow("escapes the workspace");
  });

  test("allows an absolute path INSIDE the workspace (models echo them back)", () => {
    const inside: string = path.join(workspaceRoot, "README.md");
    expect(
      CodeAgentWorkspaceGuard.resolveWorkspacePath(workspaceRoot, inside),
    ).toBe(inside);
  });

  test("refuses an absolute path outside the workspace", () => {
    expect(() => {
      return CodeAgentWorkspaceGuard.resolveWorkspacePath(
        workspaceRoot,
        path.join(path.sep, "etc", "passwd"),
      );
    }).toThrow("escapes the workspace");
  });

  test("refuses the sibling-prefix trick (/ws-evil vs /ws)", () => {
    expect(() => {
      return CodeAgentWorkspaceGuard.resolveWorkspacePath(
        workspaceRoot,
        `${workspaceRoot}-evil/file.ts`,
      );
    }).toThrow("escapes the workspace");
  });

  test("refuses an empty path", () => {
    expect(() => {
      return CodeAgentWorkspaceGuard.resolveWorkspacePath(workspaceRoot, "");
    }).toThrow("file path is required");
  });
});

describe("CodeAgentWorkspaceGuard.toWorkspaceRelativePath", () => {
  test("the root maps to '.'", () => {
    expect(
      CodeAgentWorkspaceGuard.toWorkspaceRelativePath(
        workspaceRoot,
        workspaceRoot,
      ),
    ).toBe(".");
  });

  test("a nested path maps to its workspace-relative form", () => {
    expect(
      CodeAgentWorkspaceGuard.toWorkspaceRelativePath(
        workspaceRoot,
        path.join(workspaceRoot, "src", "index.ts"),
      ),
    ).toBe(path.join("src", "index.ts"));
  });
});

describe("CodeAgentWorkspaceGuard.truncateToolOutput", () => {
  test("output under the cap is returned unchanged", () => {
    expect(CodeAgentWorkspaceGuard.truncateToolOutput("short output")).toBe(
      "short output",
    );
  });

  test("output exactly at the cap is returned unchanged", () => {
    const exact: string = "a".repeat(MAX_TOOL_OUTPUT_CHARS);
    expect(CodeAgentWorkspaceGuard.truncateToolOutput(exact)).toBe(exact);
  });

  test("output over the cap is truncated with an explicit marker", () => {
    const over: string = "a".repeat(MAX_TOOL_OUTPUT_CHARS + 1);
    const truncated: string = CodeAgentWorkspaceGuard.truncateToolOutput(over);

    expect(truncated.startsWith("a".repeat(MAX_TOOL_OUTPUT_CHARS))).toBe(true);
    expect(truncated).toContain("[output truncated to");
    // The marker is bounded — the result cannot balloon past cap + marker.
    expect(truncated.length).toBeLessThan(MAX_TOOL_OUTPUT_CHARS + 100);
  });

  test("a custom cap is honored", () => {
    expect(CodeAgentWorkspaceGuard.truncateToolOutput("abcdef", 3)).toContain(
      "abc\n... [output truncated to 3 characters]",
    );
  });
});
