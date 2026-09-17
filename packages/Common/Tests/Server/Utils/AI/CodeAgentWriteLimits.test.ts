/*
 * ---------------------------------------------------------------------------
 * The two size limits on the code agent's workspace tools, and the workspace
 * escape guard they sit next to.
 *
 * Both limits exist because the model on the other end of these tools is
 * untrusted in the specific sense that matters here: it is not malicious, but
 * its entire context is attacker-influenceable (a stack trace, an incident
 * summary, and the contents of the repository it is reading), and it can loop.
 *
 *   - MAX_TOOL_OUTPUT_CHARS bounds what comes BACK from a tool into the
 *     model's context. Without it, one `read_file` on a generated bundle
 *     spends the whole run's context on a single file — and the model has no
 *     way to know it saw only part of it, so it reasons confidently about a
 *     file it never fully read.
 *   - MAX_WRITE_FILE_CHARS bounds what goes OUT to disk. A model looping on a
 *     generation bug can otherwise fill the Runner's disk from inside a tool
 *     call, taking down every other capability on the host — runbooks
 *     included — for every project that Runner serves.
 *
 * The escape guard is tested in CodeAgentWorkspaceGuard.test.ts; what is
 * added here are the interactions between the guard and the paths a model
 * actually produces.
 * ---------------------------------------------------------------------------
 */

import CodeAgentWorkspaceGuard, {
  MAX_TOOL_OUTPUT_CHARS,
  MAX_WRITE_FILE_CHARS,
} from "../../../../Server/Utils/AI/CodeFix/CodeAgentWorkspaceGuard";
import path from "path";

const WORKSPACE: string = "/tmp/oneuptime-ai-agent/task-1/acme__checkout";

describe("MAX_WRITE_FILE_CHARS", () => {
  /*
   * The number itself is part of the contract: generous enough that no
   * legitimate source file a fix writes comes close, small enough that a
   * looping model cannot exhaust a disk before the run's other limits stop
   * it. A change to it should be a deliberate decision, not a drift.
   */
  test("is 2 MB — far above any real source file, far below a disk", () => {
    expect(MAX_WRITE_FILE_CHARS).toBe(2_000_000);
  });

  test("is much larger than the tool-output cap, because writing is not reading", () => {
    expect(MAX_WRITE_FILE_CHARS).toBeGreaterThan(MAX_TOOL_OUTPUT_CHARS * 10);
  });
});

describe("truncateToolOutput", () => {
  test("output within the cap is returned byte for byte", () => {
    const output: string = "export const a: number = 1;\n";

    expect(CodeAgentWorkspaceGuard.truncateToolOutput(output)).toBe(output);
  });

  test("output exactly at the cap is not touched", () => {
    const output: string = "x".repeat(MAX_TOOL_OUTPUT_CHARS);

    expect(CodeAgentWorkspaceGuard.truncateToolOutput(output)).toBe(output);
  });

  /*
   * The marker is not decoration. Without it the model cannot distinguish
   * "this file ends here" from "you were shown the first 20,000 characters",
   * and will happily rewrite a file based on a prefix of it.
   */
  test("oversized output is cut AND says so", () => {
    const truncated: string = CodeAgentWorkspaceGuard.truncateToolOutput(
      "y".repeat(MAX_TOOL_OUTPUT_CHARS + 5000),
    );

    expect(truncated).toContain("output truncated");
    expect(truncated.startsWith("y".repeat(100))).toBe(true);
  });

  test("the marker names the limit, so the model knows how much it missed", () => {
    const truncated: string = CodeAgentWorkspaceGuard.truncateToolOutput(
      "z".repeat(MAX_TOOL_OUTPUT_CHARS + 1),
    );

    expect(truncated).toContain(MAX_TOOL_OUTPUT_CHARS.toLocaleString());
  });

  test("a caller may tighten the limit for its own tool", () => {
    expect(CodeAgentWorkspaceGuard.truncateToolOutput("abcdef", 3)).toContain(
      "abc",
    );
    expect(CodeAgentWorkspaceGuard.truncateToolOutput("abcdef", 3)).toContain(
      "truncated",
    );
  });

  test("empty output stays empty rather than gaining a marker", () => {
    expect(CodeAgentWorkspaceGuard.truncateToolOutput("")).toBe("");
  });
});

describe("resolveWorkspacePath against the paths a model actually emits", () => {
  test("a plain relative path resolves inside the workspace", () => {
    expect(
      CodeAgentWorkspaceGuard.resolveWorkspacePath(
        WORKSPACE,
        "src/checkout.ts",
      ),
    ).toBe(path.join(WORKSPACE, "src/checkout.ts"));
  });

  /*
   * Models routinely echo back the absolute paths they were shown in an
   * earlier tool result. Refusing those would make the agent fight its own
   * transcript, so absolute paths INSIDE the workspace are allowed.
   */
  test("an absolute path inside the workspace is allowed", () => {
    const absolute: string = path.join(WORKSPACE, "src/checkout.ts");

    expect(
      CodeAgentWorkspaceGuard.resolveWorkspacePath(WORKSPACE, absolute),
    ).toBe(absolute);
  });

  test("a path with redundant segments still resolves inside", () => {
    expect(
      CodeAgentWorkspaceGuard.resolveWorkspacePath(
        WORKSPACE,
        "./src/../src/checkout.ts",
      ),
    ).toBe(path.join(WORKSPACE, "src/checkout.ts"));
  });

  test.each([
    ["parent traversal", "../escaped.ts"],
    ["deep traversal", "../../../../etc/passwd"],
    ["traversal hidden mid-path", "src/../../escaped.ts"],
    ["an absolute path elsewhere", "/etc/passwd"],
    ["the user's ssh keys", "/root/.ssh/id_rsa"],
  ])("refuses %s", (_label: string, requestedPath: string) => {
    expect(() => {
      return CodeAgentWorkspaceGuard.resolveWorkspacePath(
        WORKSPACE,
        requestedPath,
      );
    }).toThrow("escapes the workspace");
  });

  /*
   * The sibling-prefix case: `/…/acme__checkout-backup` starts with the
   * workspace path as a plain string but is a different directory. A
   * `startsWith` without the separator lets it through — the same defect
   * WorkspaceManager.deleteWorkspace had, where it would have meant
   * recursively deleting the wrong directory.
   */
  test("refuses a sibling directory whose name merely starts with the workspace's", () => {
    expect(() => {
      return CodeAgentWorkspaceGuard.resolveWorkspacePath(
        WORKSPACE,
        `${WORKSPACE}-backup/secrets.env`,
      );
    }).toThrow("escapes the workspace");
  });

  test("the workspace root itself is allowed — list_directory defaults to it", () => {
    expect(CodeAgentWorkspaceGuard.resolveWorkspacePath(WORKSPACE, ".")).toBe(
      path.resolve(WORKSPACE),
    );
  });

  test.each([
    ["an empty path", ""],
    ["a null path", null],
    ["a number", 42],
  ])("refuses %s with a clear message", (_label: string, value: unknown) => {
    expect(() => {
      return CodeAgentWorkspaceGuard.resolveWorkspacePath(
        WORKSPACE,
        value as string,
      );
    }).toThrow("A file path is required");
  });
});

describe("toWorkspaceRelativePath", () => {
  test("turns a guarded absolute path back into what the trail should show", () => {
    expect(
      CodeAgentWorkspaceGuard.toWorkspaceRelativePath(
        WORKSPACE,
        path.join(WORKSPACE, "src/checkout.ts"),
      ),
    ).toBe("src/checkout.ts");
  });

  test("the workspace root reads as '.' rather than as an empty string", () => {
    expect(
      CodeAgentWorkspaceGuard.toWorkspaceRelativePath(WORKSPACE, WORKSPACE),
    ).toBe(".");
  });

  /*
   * Every narration in the run's trail goes through this. A path that leaked
   * the Runner's temp directory into the customer-visible activity feed would
   * be noise at best and infrastructure detail at worst.
   */
  test("never leaks the absolute workspace location into the trail", () => {
    const relative: string = CodeAgentWorkspaceGuard.toWorkspaceRelativePath(
      WORKSPACE,
      path.join(WORKSPACE, "deep/nested/file.ts"),
    );

    expect(relative).toBe("deep/nested/file.ts");
    expect(relative).not.toContain("/tmp");
  });
});
