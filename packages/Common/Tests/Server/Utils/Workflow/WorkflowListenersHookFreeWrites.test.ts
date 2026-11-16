import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";
import {
  HookFreeWrite,
  HookFreeWriteScanner,
} from "../../../Helpers/HookFreeWriteScan";

/*
 * NO WRITE ROUND THE HOOKS CHANGES WHICH TRIGGERS A WORKFLOW LISTENS TO
 * (issue #8861).
 *
 * A write of a model a workflow can watch posts its trigger only when a
 * workflow of its project listens to it (WorkflowListeners). Which triggers
 * those are is kept in Redis, and every create, update and delete of a
 * workflow through DatabaseService - with its hooks or without - says the
 * project's workflows changed. A write round DatabaseService - a
 * *WithoutHooks statement, raw SQL - says nothing: should it turn a
 * workflow on, archive one, move one or give it another trigger, its
 * project's writes would go on being told what was kept until it ran out.
 *
 * So no such write of the Workflow table may write the columns the triggers
 * are read by. One that must would say so itself
 * (WorkflowListeners.changed), and be listed here.
 */

// packages/Common/Tests/Server/Utils/Workflow -> packages/Common.
const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");
const REPOSITORY_ROOT: string = path.resolve(COMMON_ROOT, "..", "..");

const SCAN_ROOTS: Array<string> = [
  path.join(COMMON_ROOT, "Server"),
  path.join(REPOSITORY_ROOT, "packages", "App", "FeatureSet"),
  path.join(REPOSITORY_ROOT, "ee", "Server"),
].filter((directory: string): boolean => {
  return fs.existsSync(directory);
});

// The columns WorkflowListeners reads a project's triggers by.
const LISTENER_COLUMNS: ReadonlyArray<string> = [
  "projectId",
  "triggerId",
  "isEnabled",
  "isArchived",
  "deletedAt",
];

// Writes round the hooks that say the change themselves. None today.
const SAYS_THE_CHANGE_ITSELF: ReadonlyArray<string> = [];

// DatabaseService's public *WithoutHooks methods that write.
function hookFreeWriteMethods(): Set<string> {
  const file: string = path.join(
    COMMON_ROOT,
    "Server/Services/DatabaseService.ts",
  );
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const methods: Set<string> = new Set<string>();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.endsWith("WithoutHooks") &&
      node.name.text !== "hasRowWithIdWithoutHooks" &&
      !node.modifiers?.some((modifier: ts.ModifierLike): boolean => {
        return (
          modifier.kind === ts.SyntaxKind.PrivateKeyword ||
          modifier.kind === ts.SyntaxKind.ProtectedKeyword
        );
      })
    ) {
      methods.add(node.name.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return methods;
}

function workflowWrites(): Array<HookFreeWrite> {
  const scanner: HookFreeWriteScanner = new HookFreeWriteScanner({
    repoRoot: REPOSITORY_ROOT,
    commonRoot: COMMON_ROOT,
    writeMethods: hookFreeWriteMethods(),
  });

  return scanner.scan(SCAN_ROOTS).filter((write: HookFreeWrite): boolean => {
    return write.modelFile === "Workflow" || write.tableName === "Workflow";
  });
}

function describeWrite(write: HookFreeWrite): string {
  return `${write.file}:${write.line} ${write.inFunction} ${write.call}`;
}

describe("the writes of workflows round DatabaseService's hooks", () => {
  const writes: Array<HookFreeWrite> = workflowWrites();

  test("are found: the scan reads the workflow writes it must hold", () => {
    // The incoming email key a workflow is given, and what Huntress last did.
    expect(
      writes.some((write: HookFreeWrite): boolean => {
        return write.inFunction.endsWith("ensureIncomingEmailSecretKey");
      }),
    ).toBe(true);
    expect(writes.length).toBeGreaterThanOrEqual(3);
  });

  test("say which columns they write, so this can hold them", () => {
    expect(
      writes
        .filter((write: HookFreeWrite): boolean => {
          return (
            write.columns === null &&
            !SAYS_THE_CHANGE_ITSELF.includes(describeWrite(write))
          );
        })
        .map(describeWrite),
    ).toEqual([]);
  });

  test("never write what a project's listening triggers are read by", () => {
    expect(
      writes
        .filter((write: HookFreeWrite): boolean => {
          return (
            !SAYS_THE_CHANGE_ITSELF.includes(describeWrite(write)) &&
            (write.columns || []).some((column: string): boolean => {
              return LISTENER_COLUMNS.includes(column);
            })
          );
        })
        .map((write: HookFreeWrite): string => {
          return `${describeWrite(write)} writes ${(write.columns || []).join(", ")}`;
        }),
    ).toEqual([]);
  });

  test("every exemption still names a write", () => {
    for (const exemption of SAYS_THE_CHANGE_ITSELF) {
      expect(writes.map(describeWrite)).toContain(exemption);
    }
  });
});
