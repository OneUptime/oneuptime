import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import Execute from "Common/Server/Utils/Execute";
import LocalFile from "Common/Server/Utils/LocalFile";
import { JSONObject } from "Common/Types/JSON";
import { StructuredTool, ToolResponse, ToolRuntime } from "./Tool";
import AgentLogger from "../Utils/AgentLogger";

/** Arguments accepted by the apply_patch tool. */
interface ApplyPatchArgs {
  patch: string;
  note?: string | undefined;
}

type PatchAction = "Update" | "Add" | "Delete";

interface PatchBlock {
  action: PatchAction;
  absolutePath: string;
  relativePath: string;
  diffBody: string;
}

/**
 * Applies unified diffs (or the custom *** Begin Patch format) via git apply so
 * the agent can make precise edits.
 */
export class ApplyPatchTool extends StructuredTool<ApplyPatchArgs> {
  public readonly name: string = "apply_patch";
  public readonly description: string =
    "Applies a unified diff (or the *** Begin Patch format) to modify existing files precisely.";
  public readonly parameters: JSONObject = {
    type: "object",
    required: ["patch"],
    properties: {
      patch: {
        type: "string",
        description:
          "Unified diff or *** Begin Patch instructions describing the edits to apply.",
      },
      note: {
        type: "string",
        description:
          "Optional short description of why this patch is being applied.",
      },
    },
  };

  protected schema = z
    .object({
      patch: z.string().min(10),
      note: z.string().max(2000).optional(),
    })
    .strict();

  /** Writes the diff to a temp file and feeds it to git apply. */
  public async execute(
    args: ApplyPatchArgs,
    runtime: ToolRuntime,
  ): Promise<ToolResponse> {
    AgentLogger.debug("ApplyPatchTool invoked", {
      note: args.note,
    });
    const payload: string = args.patch;
    if (!payload.trim()) {
      return {
        content: "Patch payload was empty. Nothing was applied.",
        isError: true,
      };
    }

    if (payload.includes("*** Begin Patch")) {
      return await this.applyStructuredPatch(payload, runtime, args.note);
    }

    return await this.applyGitPatch(payload, runtime, args.note);
  }

  private async applyGitPatch(
    patch: string,
    runtime: ToolRuntime,
    note?: string,
  ): Promise<ToolResponse> {
    AgentLogger.debug("Applying git-compatible patch", {
      length: patch.length,
    });
    const tempDir: string = await fs.mkdtemp(
      path.join(os.tmpdir(), "oneuptime-patch-"),
    );
    const patchFile: string = path.join(tempDir, "patch.diff");
    await fs.writeFile(patchFile, patch, { encoding: "utf8" });

    try {
      await Execute.executeCommandFile({
        command: "git",
        args: [
          "apply",
          "--whitespace=nowarn",
          "--reject",
          "--unidiff-zero",
          patchFile,
        ],
        cwd: runtime.workspaceRoot,
      });

      return {
        content: `Patch applied successfully${note ? `: ${note}` : "."}`,
      };
    } catch (error) {
      AgentLogger.error("Patch application failed", error as Error);
      const filePreview: string = await LocalFile.read(patchFile);
      return {
        content: `Failed to apply patch. Please review the diff and adjust.\n${filePreview}`,
        isError: true,
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async applyStructuredPatch(
    input: string,
    runtime: ToolRuntime,
    note?: string,
  ): Promise<ToolResponse> {
    const blocks: Array<PatchBlock> = this.extractStructuredBlocks(
      input,
      runtime,
    );
    if (!blocks.length) {
      return {
        content:
          "Failed to parse the *** Begin Patch instructions. Please verify the format and try again.",
        isError: true,
      };
    }

    for (const block of blocks) {
      await this.applyPatchBlock(block);
    }

    return {
      content: `Patch applied successfully${note ? `: ${note}` : "."}`,
    };
  }

  private extractStructuredBlocks(
    input: string,
    runtime: ToolRuntime,
  ): Array<PatchBlock> {
    const blocks: Array<PatchBlock> = [];
    const sections: RegExpMatchArray[] = Array.from(
      input.matchAll(/\*\*\* Begin Patch([\s\S]*?)\*\*\* End Patch/g),
    );

    for (const section of sections) {
      const body: string | undefined = section[1];
      if (!body) {
        continue;
      }

      const fileBlocks: RegExpMatchArray[] = Array.from(
        body.matchAll(
          /\*\*\* (Update|Add|Delete) File: (.+)\n([\s\S]*?)(?=\*\*\* (Update|Add|Delete) File: |$)/g,
        ),
      );

      for (const block of fileBlocks) {
        const actionRaw: string | undefined = block[1];
        const filePathRaw: string | undefined = block[2];
        const diffBodyRaw: string | undefined = block[3];
        if (!actionRaw || !filePathRaw || diffBodyRaw === undefined) {
          continue;
        }

        const diffBody: string = diffBodyRaw.trim();
        if (!diffBody) {
          AgentLogger.debug("Skipping empty structured patch block", {
            action: actionRaw,
            file: filePathRaw,
          });
          continue;
        }

        const absolute: string = runtime.workspacePaths.resolve(
          filePathRaw.trim(),
        );
        const relative: string = runtime.workspacePaths.relative(absolute);

        blocks.push({
          action: actionRaw as PatchAction,
          absolutePath: absolute,
          relativePath: relative,
          diffBody,
        });
      }
    }

    return blocks;
  }

  private async applyPatchBlock(block: PatchBlock): Promise<void> {
    AgentLogger.debug("Applying structured patch block", {
      action: block.action,
      file: block.relativePath,
    });

    if (block.action === "Delete") {
      await fs.rm(block.absolutePath, { force: true });
      return;
    }

    const { content: existingContent, exists } = await this.readFileWithMeta(
      block.absolutePath,
    );

    if (block.action === "Update" && !exists) {
      throw new Error(
        `Cannot update missing file ${block.relativePath}. Did you mean to use an Add block?`,
      );
    }

    const patchedContent: string = this.applyHunksToContent(
      block.action === "Add" ? "" : existingContent,
      block.diffBody,
      block.relativePath,
    );

    await fs.mkdir(path.dirname(block.absolutePath), { recursive: true });
    await fs.writeFile(block.absolutePath, patchedContent, {
      encoding: "utf8",
    });
  }

  private async readFileWithMeta(filePath: string): Promise<{
    content: string;
    exists: boolean;
  }> {
    try {
      const content: string = await fs.readFile(filePath, { encoding: "utf8" });
      return { content, exists: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { content: "", exists: false };
      }
      throw error;
    }
  }

  private applyHunksToContent(
    originalContent: string,
    diffBody: string,
    relativePath: string,
  ): string {
    const normalizedOriginal: string = originalContent.replace(/\r\n/g, "\n");
    const originalHadTrailingNewline: boolean =
      normalizedOriginal.endsWith("\n");
    const originalLines: Array<string> = normalizedOriginal.length
      ? normalizedOriginal
          .slice(0, originalHadTrailingNewline ? -1 : undefined)
          .split("\n")
      : [];

    let cursor: number = 0;
    let resultShouldEndWithNewline: boolean = originalHadTrailingNewline;
    const outputLines: Array<string> = [];
    const hunks: Array<Array<string>> = this.parseHunks(diffBody);

    for (const hunk of hunks) {
      const matchSequence: Array<string> = hunk
        .filter((line: string) => {
          return line.startsWith(" ") || line.startsWith("-");
        })
        .map((line: string) => {
          return line.slice(1);
        });
      const startIndex: number = this.findMatchSequence(
        originalLines,
        cursor,
        matchSequence,
        relativePath,
      );

      outputLines.push(...originalLines.slice(cursor, startIndex));

      let localIndex: number = startIndex;
      let lastOp: string | null = null;
      for (const line of hunk) {
        if (!line) {
          continue;
        }

        if (line.startsWith("\\ No newline at end of file")) {
          if (lastOp === "+") {
            resultShouldEndWithNewline = false;
          }
          continue;
        }

        const op: string = line[0] ?? "";
        const value: string = line.length > 1 ? line.slice(1) : "";

        if (op === " ") {
          this.assertLineMatches(
            originalLines,
            localIndex,
            value,
            relativePath,
          );
          outputLines.push(value);
          localIndex += 1;
        } else if (op === "-") {
          this.assertLineMatches(
            originalLines,
            localIndex,
            value,
            relativePath,
          );
          localIndex += 1;
        } else if (op === "+") {
          outputLines.push(value);
          resultShouldEndWithNewline = true;
        } else {
          throw new Error(
            `Unsupported diff operation '${op}' in ${relativePath}.`,
          );
        }

        lastOp = op;
      }

      cursor = localIndex;
    }

    outputLines.push(...originalLines.slice(cursor));
    let result: string = outputLines.join("\n");
    if (result && resultShouldEndWithNewline) {
      result += "\n";
    }

    return result;
  }

  private parseHunks(diffBody: string): Array<Array<string>> {
    const normalizedBody: string = diffBody.replace(/\r\n/g, "\n");
    const lines: Array<string> = normalizedBody.split("\n");
    const hunks: Array<Array<string>> = [];
    let current: Array<string> | null = null;

    for (const rawLine of lines) {
      const line: string = rawLine;
      if (line.startsWith("---") || line.startsWith("+++")) {
        continue;
      }

      if (line.startsWith("@@")) {
        if (current && current.length) {
          hunks.push(current);
        }
        current = [];
        continue;
      }

      if (!current) {
        current = [];
      }
      current.push(line);
    }

    if (current && current.length) {
      hunks.push(current);
    }

    return hunks;
  }

  private findMatchSequence(
    originalLines: Array<string>,
    startIndex: number,
    sequence: Array<string>,
    relativePath: string,
  ): number {
    if (!sequence.length) {
      return startIndex;
    }

    for (
      let index: number = startIndex;
      index <= originalLines.length - sequence.length;
      index += 1
    ) {
      let matched: boolean = true;
      for (let offset: number = 0; offset < sequence.length; offset += 1) {
        if (originalLines[index + offset] !== sequence[offset]) {
          matched = false;
          break;
        }
      }

      if (matched) {
        return index;
      }
    }

    throw new Error(
      `Failed to locate patch context in ${relativePath}. Please ensure the file contents match the expected state before applying the patch.`,
    );
  }

  private assertLineMatches(
    originalLines: Array<string>,
    index: number,
    expected: string,
    relativePath: string,
  ): void {
    const actual: string | undefined = originalLines[index];
    if (actual !== expected) {
      throw new Error(
        `Patch mismatch in ${relativePath}: expected '${expected}' but found '${actual ?? "<eof>"}'.`,
      );
    }
  }
}
