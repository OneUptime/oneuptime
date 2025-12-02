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
    const normalizedPatch: string = this.normalizePatchFormat(
      args.patch,
      runtime,
    );
    AgentLogger.debug("Patch normalized", {
      originalLength: args.patch.length,
      normalizedLength: normalizedPatch.length,
    });

    if (!normalizedPatch.trim()) {
      return {
        content: "Patch payload was empty. Nothing was applied.",
        isError: true,
      };
    }

    const tempDir: string = await fs.mkdtemp(
      path.join(os.tmpdir(), "oneuptime-patch-"),
    );
    const patchFile: string = path.join(tempDir, "patch.diff");
    await fs.writeFile(patchFile, normalizedPatch, { encoding: "utf8" });

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
        content: `Patch applied successfully${args.note ? `: ${args.note}` : "."}`,
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

  /**
   * Converts the *** Begin/End Patch format into standard unified diffs so git
   * can apply the changes.
   */
  private normalizePatchFormat(input: string, runtime: ToolRuntime): string {
    if (input.includes("diff --git")) {
      AgentLogger.debug("Patch already in diff format", {
        length: input.length,
      });
      return input;
    }

    const matches: RegExpMatchArray[] = Array.from(
      input.matchAll(/\*\*\* Begin Patch([\s\S]*?)\*\*\* End Patch/g),
    );

    if (!matches.length) {
      AgentLogger.debug("No patch sections detected", {
        inputLength: input.length,
      });
      return input;
    }

    const sections: Array<string> = [];
    AgentLogger.debug("Processing patch sections", {
      sectionCount: matches.length,
    });

    for (const match of matches) {
      const body: string | undefined = match[1];
      if (!body) {
        continue;
      }
      const fileBlocks: RegExpMatchArray[] = Array.from(
        body.matchAll(
          /\*\*\* (Update|Add|Delete) File: (.+)\n([\s\S]*?)(?=\*\*\* (Update|Add|Delete) File: |$)/g,
        ),
      );

      for (const block of fileBlocks) {
        const action: string | undefined = block[1];
        const filePathRaw: string | undefined = block[2];
        const diffBodyRaw: string | undefined = block[3];

        if (!action || !filePathRaw || !diffBodyRaw) {
          continue;
        }

        const filePath: string = filePathRaw.trim();
        const diffBody: string = diffBodyRaw.trim();
        if (!diffBody) {
          AgentLogger.debug("Skipping empty patch block", {
            action,
            filePath,
          });
          continue;
        }

        const absolute: string = runtime.workspacePaths.resolve(filePath);
        const relative: string = runtime.workspacePaths.relative(absolute);
        AgentLogger.debug("Patch block resolved", {
          action,
          relative,
        });

        if (action === "Add") {
          sections.push(
            [
              `diff --git a/${relative} b/${relative}`,
              `--- /dev/null`,
              `+++ b/${relative}`,
              diffBody,
            ].join("\n"),
          );
        } else if (action === "Delete") {
          sections.push(
            [
              `diff --git a/${relative} b/${relative}`,
              `--- a/${relative}`,
              `+++ /dev/null`,
              diffBody,
            ].join("\n"),
          );
        } else {
          sections.push(
            [
              `diff --git a/${relative} b/${relative}`,
              `--- a/${relative}`,
              `+++ b/${relative}`,
              diffBody,
            ].join("\n"),
          );
        }
      }
    }

    const finalPatch: string = sections.join("\n");
    AgentLogger.debug("Patch sections assembled", {
      sectionCount: sections.length,
      finalLength: finalPatch.length,
    });
    return finalPatch;
  }
}
