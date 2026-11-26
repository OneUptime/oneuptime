import {
  CodeOwnersFile,
  getCodeOwnersOfPath,
  GITHUB_CODE_OWNERS_PATHS,
  GITLAB_CODE_OWNERS_PATHS,
  isCodeOwner,
  isCodeOwnerTeam,
  matchesCodeOwnersPattern,
  matchesPatternPart,
  MAX_CODE_OWNERS_RULES,
  parseCodeOwners,
} from "../../../Utils/CodeRepository/CodeOwners";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO OWNS A FILE, AS A REPOSITORY'S CODE OWNERS FILE SAYS (#10374): the
 * evidence that names a store's owners from the file that declares it.
 * GitHub's and GitLab's syntax, read as the hosts read it - the last rule
 * that matches decides, GitLab's sections each decide apart - with a glob
 * matcher that builds no regular expression from the file.
 */

describe("where each host looks for its code owners", () => {
  test("GitHub looks in .github/, the root, then docs/", () => {
    expect(GITHUB_CODE_OWNERS_PATHS).toEqual([
      ".github/CODEOWNERS",
      "CODEOWNERS",
      "docs/CODEOWNERS",
    ]);
  });

  test("GitLab looks in the root, docs/, then .gitlab/", () => {
    expect(GITLAB_CODE_OWNERS_PATHS).toEqual([
      "CODEOWNERS",
      "docs/CODEOWNERS",
      ".gitlab/CODEOWNERS",
    ]);
  });
});

describe("an owner, as a code owners file writes one", () => {
  test.each([
    ["@alice", true],
    ["@acme/payments", true],
    ["@acme/payments-team", true],
    ["@acme/group/subgroup", true],
    ["alice@acme.com", true],
    ["payments", false],
    ["@", false],
    ["@/payments", false],
    ["#comment", false],
    ["not-an-email@", false],
  ])("%s is an owner: %s", (token: string, isOwner: boolean) => {
    expect(isCodeOwner(token)).toBe(isOwner);
  });

  test("a token far longer than any handle or address is never read further", () => {
    expect(isCodeOwner(`${"a".repeat(5000)}@${"b".repeat(5000)}`)).toBe(false);
  });

  test("a team is an organization's handle, a person is a bare one", () => {
    expect(isCodeOwnerTeam("@acme/payments")).toBe(true);
    expect(isCodeOwnerTeam("@alice")).toBe(false);
    expect(isCodeOwnerTeam("alice@acme.com")).toBe(false);
  });
});

describe("reading a code owners file", () => {
  test("one rule a line, its pattern then its owners", () => {
    const file: CodeOwnersFile = parseCodeOwners(
      [
        "# Who owns what",
        "",
        "*       @acme/platform",
        "/infra/payments/  @acme/payments alice@acme.com",
        "docs/*.md         @acme/docs   # the docs team",
      ].join("\n"),
    );

    expect(file.rules).toEqual([
      { pattern: "*", owners: ["@acme/platform"], section: "", line: 3 },
      {
        pattern: "/infra/payments/",
        owners: ["@acme/payments", "alice@acme.com"],
        section: "",
        line: 4,
      },
      { pattern: "docs/*.md", owners: ["@acme/docs"], section: "", line: 5 },
    ]);
  });

  test("an escaped # and an escaped space belong to the pattern", () => {
    const file: CodeOwnersFile = parseCodeOwners(
      "/my\\ folder/\\#stack.tf @acme/infra",
    );

    expect(file.rules[0]!.pattern).toBe("/my folder/#stack.tf");
    expect(file.rules[0]!.owners).toEqual(["@acme/infra"]);
  });

  test("a pattern with no owners leaves its files unowned", () => {
    const file: CodeOwnersFile = parseCodeOwners(
      ["* @acme/platform", "/generated/"].join("\n"),
    );

    expect(getCodeOwnersOfPath(file, "generated/schema.tf")).toEqual([]);
    expect(getCodeOwnersOfPath(file, "infra/main.tf")).toEqual([
      "@acme/platform",
    ]);
  });

  test("words after the pattern that are no owner are not read as owners", () => {
    const file: CodeOwnersFile = parseCodeOwners(
      "/infra/ @acme/infra please-review",
    );

    expect(file.rules[0]!.owners).toEqual(["@acme/infra"]);
  });

  test("GitLab's sections give their owners to rules with none of their own", () => {
    const file: CodeOwnersFile = parseCodeOwners(
      [
        "[Infrastructure] @acme/platform",
        "/terraform/",
        "/terraform/payments/ @acme/payments",
        "^[Optional][2] @acme/security",
        "*.tf",
      ].join("\n"),
    );

    expect(file.rules).toEqual([
      {
        pattern: "/terraform/",
        owners: ["@acme/platform"],
        section: "infrastructure",
        line: 2,
      },
      {
        pattern: "/terraform/payments/",
        owners: ["@acme/payments"],
        section: "infrastructure",
        line: 3,
      },
      {
        pattern: "*.tf",
        owners: ["@acme/security"],
        section: "optional",
        line: 5,
      },
    ]);
  });

  test("a file is read only as far as its rules may go", () => {
    const lines: Array<string> = [];

    for (let index: number = 0; index < MAX_CODE_OWNERS_RULES + 50; index++) {
      lines.push(`/folder${index}/ @acme/team${index}`);
    }

    expect(parseCodeOwners(lines.join("\n")).rules).toHaveLength(
      MAX_CODE_OWNERS_RULES,
    );
  });
});

describe("a pattern against a file's path", () => {
  test.each([
    // A pattern with no slash matches at any depth.
    ["*.tf", "main.tf", true],
    ["*.tf", "infra/payments/main.tf", true],
    ["*.tf", "infra/payments/main.yaml", false],
    ["main.tf", "infra/main.tf", true],
    // A leading slash, or one before the end, reads from the root.
    ["/main.tf", "main.tf", true],
    ["/main.tf", "infra/main.tf", false],
    ["infra/main.tf", "infra/main.tf", true],
    ["infra/main.tf", "nested/infra/main.tf", false],
    // A folder owns everything in it.
    ["/infra/", "infra/payments/s3.tf", true],
    ["/infra", "infra/payments/s3.tf", true],
    ["infra", "nested/infra/s3.tf", true],
    ["/infra/", "infrastructure/s3.tf", false],
    // A pattern ending in a slash names only a folder.
    ["s3.tf/", "infra/s3.tf", false],
    // * stays in one folder, ** crosses them.
    ["/infra/*.tf", "infra/main.tf", true],
    ["/infra/*.tf", "infra/payments/main.tf", false],
    ["/infra/**/main.tf", "infra/payments/eu/main.tf", true],
    ["/infra/**/main.tf", "infra/main.tf", true],
    ["**/payments/**", "a/b/payments/c/d.tf", true],
    ["/infra/?3.tf", "infra/s3.tf", true],
    ["/infra/?3.tf", "infra/ss3.tf", false],
    // Everything.
    ["*", "any/file/at/all.tf", true],
    ["/", "any/file.tf", true],
  ])("%s against %s: %s", (pattern: string, path: string, matches: boolean) => {
    expect(matchesCodeOwnersPattern(pattern, path)).toBe(matches);
  });

  test("a path given with a leading slash reads as the same path", () => {
    expect(matchesCodeOwnersPattern("/infra/", "/infra/s3.tf")).toBe(true);
  });

  test("nothing matches an empty path or pattern", () => {
    expect(matchesCodeOwnersPattern("", "infra/s3.tf")).toBe(false);
    expect(matchesCodeOwnersPattern("*.tf", "")).toBe(false);
  });

  // Without remembering what it knows, this would try 2^60 ways.
  test("a part full of stars still answers, character by character", () => {
    expect(matchesPatternPart(`${"*a".repeat(60)}b`, "a".repeat(120))).toBe(
      false,
    );
    expect(matchesPatternPart(`${"*a".repeat(60)}`, "a".repeat(120))).toBe(
      true,
    );
  });
});

describe("the owners of a file", () => {
  test("the last rule that matches decides", () => {
    const file: CodeOwnersFile = parseCodeOwners(
      [
        "*                    @acme/platform",
        "/infra/              @acme/infra",
        "/infra/payments/     @acme/payments",
        "/infra/payments/*.md @acme/docs",
      ].join("\n"),
    );

    expect(getCodeOwnersOfPath(file, "infra/payments/s3.tf")).toEqual([
      "@acme/payments",
    ]);
    expect(getCodeOwnersOfPath(file, "infra/payments/README.md")).toEqual([
      "@acme/docs",
    ]);
    expect(getCodeOwnersOfPath(file, "infra/network/vpc.tf")).toEqual([
      "@acme/infra",
    ]);
    expect(getCodeOwnersOfPath(file, "app/main.ts")).toEqual([
      "@acme/platform",
    ]);
  });

  test("GitLab's sections each decide, and their owners are taken together", () => {
    const file: CodeOwnersFile = parseCodeOwners(
      [
        "[Infrastructure]",
        "/terraform/ @acme/platform",
        "/terraform/payments/ @acme/payments",
        "[Security]",
        "*.tf @acme/security",
      ].join("\n"),
    );

    expect(getCodeOwnersOfPath(file, "terraform/payments/s3.tf")).toEqual([
      "@acme/payments",
      "@acme/security",
    ]);
  });

  test("a file no rule matches has no owners", () => {
    const file: CodeOwnersFile = parseCodeOwners("/infra/ @acme/infra");

    expect(getCodeOwnersOfPath(file, "app/main.ts")).toEqual([]);
  });

  test("each owner once", () => {
    const file: CodeOwnersFile = parseCodeOwners(
      "/infra/ @acme/infra @acme/infra alice@acme.com",
    );

    expect(getCodeOwnersOfPath(file, "infra/s3.tf")).toEqual([
      "@acme/infra",
      "alice@acme.com",
    ]);
  });
});
