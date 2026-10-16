/**
 * AIAgentTaskPullRequest.pullRequestId column contract.
 *
 * The column holds the hosting platform's ID of a pull request the agent
 * opened. It was a Postgres integer, and GitHub's pull request IDs passed
 * 2^31 long ago, so every pull request the agent opened failed to record:
 * the run reported "Failed to record pull request" while the pull request
 * sat open on GitHub, untracked by the open-PR cap, the state sync and the CI
 * check. 4885508095 is the ID of the pull request that found it.
 */

import AIAgentTaskPullRequest from "../../Models/DatabaseModels/AIAgentTaskPullRequest";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumnType from "../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";
import fs from "fs";
import path from "path";

const GITHUB_PULL_REQUEST_ID: number = 4885508095;

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

function typeOrmColumn(): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find((candidate: ColumnMetadataArgs) => {
      return (
        candidate.target === AIAgentTaskPullRequest &&
        candidate.propertyName === "pullRequestId"
      );
    });

  expect(column).toBeDefined();

  return column!;
}

describe("AIAgentTaskPullRequest.pullRequestId", () => {
  test("is a bigint, so a GitHub pull request ID fits", () => {
    expect(GITHUB_PULL_REQUEST_ID).toBeGreaterThan(2 ** 31 - 1);
    expect(typeOrmColumn().options.type).toBe(ColumnType.BigPositiveNumber);
    expect(ColumnType.BigPositiveNumber).toBe("bigint");
  });

  test("is described as a big number to the API", () => {
    expect(
      new AIAgentTaskPullRequest().getTableColumnMetadata("pullRequestId").type,
    ).toBe(TableColumnType.BigPositiveNumber);
  });

  test("round-trips a GitHub pull request ID as a number", () => {
    const transformer: ValueTransformer = typeOrmColumn().options
      .transformer as ValueTransformer;

    expect(transformer).toBeDefined();
    // node-postgres binds and returns bigint as text.
    expect(transformer.to(GITHUB_PULL_REQUEST_ID)).toBe("4885508095");
    expect(transformer.from("4885508095")).toBe(GITHUB_PULL_REQUEST_ID);
    // Unset stays unset, so a pull request recorded without one is still recorded.
    expect(transformer.to(undefined)).toBeUndefined();
    expect(transformer.from(null)).toBeNull();
  });

  test("stays optional", () => {
    expect(typeOrmColumn().options.nullable).toBe(true);
  });

  test("a registered migration widens it, and the index is rebuilt online", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    const widen: string = fs.readFileSync(
      path.join(
        MIGRATIONS_DIR,
        "1802850000000-WidenAIAgentTaskPullRequestId.ts",
      ),
      "utf8",
    );

    const rebuildIndex: string = fs.readFileSync(
      path.join(
        MIGRATIONS_DIR,
        "1802900000000-AddAIAgentTaskPullRequestIdIndex.ts",
      ),
      "utf8",
    );

    expect(index).toContain("  WidenAIAgentTaskPullRequestId1802850000000,");
    expect(index).toContain("  AddAIAgentTaskPullRequestIdIndex1802900000000,");
    expect(widen).toContain(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "pullRequestId" bigint`,
    );
    expect(rebuildIndex).toContain("public transaction: boolean = false;");
    expect(rebuildIndex).toContain("OnlineDdl.createIndex(");
    expect(rebuildIndex).toContain(
      `ON "AIAgentTaskPullRequest" ("pullRequestId")`,
    );
  });
});
