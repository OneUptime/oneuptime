import BadDataException from "../../../../Types/Exception/BadDataException";
import path from "path";

/*
 * Pure guards for the in-house code agent's workspace tools (B4 Tier 0,
 * Internal/Roadmap/CodeFixSandboxDesign.md): every file-system tool call is
 * path-guarded to the run's ephemeral workspace (the same escape posture as
 * WorkspaceManager.deleteWorkspace's base-directory check), and every tool
 * output is truncated before it re-enters the model context. Kept pure —
 * no IO — so the worker's safety edges are directly unit-testable.
 */

// Max characters a single tool result may feed back into the model.
export const MAX_TOOL_OUTPUT_CHARS: number = 20_000;

export default class CodeAgentWorkspaceGuard {
  /*
   * Resolve a model-supplied path against the workspace root, refusing any
   * escape: `..` traversal, absolute paths outside the workspace, and
   * sibling-prefix tricks (`/workspace-evil` vs `/workspace`) all throw.
   * Absolute paths INSIDE the workspace are allowed — models frequently
   * echo back the absolute paths they were shown.
   */
  public static resolveWorkspacePath(
    workspaceRoot: string,
    requestedPath: string,
  ): string {
    if (!requestedPath || typeof requestedPath !== "string") {
      throw new BadDataException("A file path is required");
    }

    const root: string = path.resolve(workspaceRoot);
    const resolved: string = path.resolve(root, requestedPath);

    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new BadDataException(
        `Path escapes the workspace: ${requestedPath}`,
      );
    }

    return resolved;
  }

  // The workspace-relative form of an already-guarded absolute path.
  public static toWorkspaceRelativePath(
    workspaceRoot: string,
    absolutePath: string,
  ): string {
    const relative: string = path.relative(
      path.resolve(workspaceRoot),
      absolutePath,
    );

    return relative === "" ? "." : relative;
  }

  /*
   * Truncate a tool output to the model-context cap, appending an explicit
   * marker so the model knows the output is partial rather than complete.
   */
  public static truncateToolOutput(
    output: string,
    maxChars: number = MAX_TOOL_OUTPUT_CHARS,
  ): string {
    if (output.length <= maxChars) {
      return output;
    }

    return `${output.substring(0, maxChars)}\n... [output truncated to ${maxChars.toLocaleString()} characters]`;
  }
}
