import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  MAX_CODE_REPOSITORIES_PER_RULE,
  NO_CODE_REPOSITORY,
  RULE_TOO_MANY_CODE_REPOSITORIES_MESSAGE,
  allowsAnyCodeRepository,
  fromStoredCodeRepositoryIds,
  getCodeRepositoryAllowance,
  getRuleCodeRepositoriesProblem,
  isCodeRepositoryAllowed,
  keepAllowedCodeRepositories,
  readCodeRepositoryIds,
  toStoredCodeRepositoryIds,
} from "../../../Types/CodeRepository/CodeRepositoryAllowance";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Which of the project's code repositories OneUptime AI may use for one
 * incident or alert - read while it investigates or fixes, and open a pull
 * request in. The maintainer: "if no code repo is selected - it should be
 * able to read and investigate all the repos that are connected".
 */

const API: string = "c1111111-1111-4111-8111-111111111111";
const WEB: string = "c2222222-2222-4222-8222-222222222222";
const INFRA: string = "c3333333-3333-4333-8333-333333333333";

describe("readCodeRepositoryIds", () => {
  test("reads ids written every way a rule holds them, each once, in lower case", () => {
    expect(
      readCodeRepositoryIds([
        API.toUpperCase(),
        { _id: WEB },
        { id: INFRA },
        new ObjectID(API),
        { value: WEB, label: "web" },
        "",
        "   ",
        null,
        7,
      ]),
    ).toEqual([API, WEB, INFRA]);
  });

  test("a single id is a list of one, and nothing is an empty list", () => {
    expect(readCodeRepositoryIds(API)).toEqual([API]);
    expect(readCodeRepositoryIds(undefined)).toEqual([]);
    expect(readCodeRepositoryIds(null)).toEqual([]);
    expect(readCodeRepositoryIds([])).toEqual([]);
  });
});

describe("getCodeRepositoryAllowance", () => {
  test("with no rule set up, every connected repository", () => {
    expect(
      getCodeRepositoryAllowance({ rulesSetUp: false, matchingRules: [] }),
    ).toEqual(EVERY_CODE_REPOSITORY);
  });

  test("with rules set up and none matching, none", () => {
    expect(
      getCodeRepositoryAllowance({ rulesSetUp: true, matchingRules: [] }),
    ).toEqual(NO_CODE_REPOSITORY);
  });

  test("a matching rule that names none allows every repository, whatever the others name", () => {
    for (const named of [undefined, null, []]) {
      expect(
        getCodeRepositoryAllowance({
          rulesSetUp: true,
          matchingRules: [
            { codeRepositories: [{ _id: API }] },
            { codeRepositories: named },
          ],
        }),
      ).toEqual(EVERY_CODE_REPOSITORY);
    }
  });

  test("matching rules that name some allow the ones any of them names, each once", () => {
    expect(
      getCodeRepositoryAllowance({
        rulesSetUp: true,
        matchingRules: [
          { codeRepositories: [{ _id: API }, { _id: WEB }] },
          { codeRepositories: [{ _id: WEB.toUpperCase() }, { _id: INFRA }] },
        ],
      }),
    ).toEqual({ isEveryRepository: false, repositoryIds: [API, WEB, INFRA] });
  });
});

describe("isCodeRepositoryAllowed and allowsAnyCodeRepository", () => {
  const someRepositories: CodeRepositoryAllowance = {
    isEveryRepository: false,
    repositoryIds: [API],
  };

  test("every repository allows any id; no allowance at all narrows nothing", () => {
    expect(isCodeRepositoryAllowed(EVERY_CODE_REPOSITORY, WEB)).toBe(true);
    expect(isCodeRepositoryAllowed(undefined, WEB)).toBe(true);
    expect(isCodeRepositoryAllowed(null, WEB)).toBe(true);
    expect(allowsAnyCodeRepository(EVERY_CODE_REPOSITORY)).toBe(true);
    expect(allowsAnyCodeRepository(undefined)).toBe(true);
  });

  test("named repositories allow those only, whatever the case or shape of the id", () => {
    expect(isCodeRepositoryAllowed(someRepositories, API)).toBe(true);
    expect(isCodeRepositoryAllowed(someRepositories, API.toUpperCase())).toBe(
      true,
    );
    expect(isCodeRepositoryAllowed(someRepositories, new ObjectID(API))).toBe(
      true,
    );
    expect(isCodeRepositoryAllowed(someRepositories, { _id: API })).toBe(true);
    expect(isCodeRepositoryAllowed(someRepositories, WEB)).toBe(false);
    expect(isCodeRepositoryAllowed(someRepositories, "")).toBe(false);
    expect(isCodeRepositoryAllowed(someRepositories, undefined)).toBe(false);
    expect(allowsAnyCodeRepository(someRepositories)).toBe(true);
  });

  test("none allows nothing", () => {
    expect(isCodeRepositoryAllowed(NO_CODE_REPOSITORY, API)).toBe(false);
    expect(allowsAnyCodeRepository(NO_CODE_REPOSITORY)).toBe(false);
  });
});

describe("keepAllowedCodeRepositories", () => {
  const rows: Array<{ id: string; name: string }> = [
    { id: API, name: "api" },
    { id: WEB.toUpperCase(), name: "web" },
    { id: INFRA, name: "infra" },
  ];

  test("keeps the allowed ones, in the list's order", () => {
    expect(
      keepAllowedCodeRepositories({
        allowance: {
          isEveryRepository: false,
          repositoryIds: [INFRA, WEB],
        },
        repositories: rows,
        getId: (row: { id: string }): string => {
          return row.id;
        },
      }).map((row: { name: string }): string => {
        return row.name;
      }),
    ).toEqual(["web", "infra"]);
  });

  test("every repository, or no allowance, keeps them all; none keeps none", () => {
    for (const allowance of [EVERY_CODE_REPOSITORY, undefined]) {
      expect(
        keepAllowedCodeRepositories({
          allowance,
          repositories: rows,
          getId: (row: { id: string }): string => {
            return row.id;
          },
        }),
      ).toHaveLength(3);
    }

    expect(
      keepAllowedCodeRepositories({
        allowance: NO_CODE_REPOSITORY,
        repositories: rows,
        getId: (row: { id: string }): string => {
          return row.id;
        },
      }),
    ).toEqual([]);
  });
});

describe("what a run stores", () => {
  test("every repository is stored as nothing, and nothing reads back as every repository", () => {
    expect(toStoredCodeRepositoryIds(EVERY_CODE_REPOSITORY)).toBeUndefined();
    expect(fromStoredCodeRepositoryIds(undefined)).toEqual(
      EVERY_CODE_REPOSITORY,
    );
    expect(fromStoredCodeRepositoryIds(null)).toEqual(EVERY_CODE_REPOSITORY);
  });

  test("named repositories round-trip; a stored list is never widened to every one", () => {
    const allowance: CodeRepositoryAllowance = {
      isEveryRepository: false,
      repositoryIds: [API, WEB],
    };

    expect(toStoredCodeRepositoryIds(allowance)).toEqual([API, WEB]);
    expect(
      fromStoredCodeRepositoryIds(toStoredCodeRepositoryIds(allowance)),
    ).toEqual(allowance);

    // An empty stored list allows nothing, rather than everything.
    expect(fromStoredCodeRepositoryIds([])).toEqual(NO_CODE_REPOSITORY);
    // A stored value that is not a list of ids reads what ids it holds.
    expect(fromStoredCodeRepositoryIds(API)).toEqual({
      isEveryRepository: false,
      repositoryIds: [API],
    });
  });

  test("the stored list is a copy: changing it never changes the allowance", () => {
    const allowance: CodeRepositoryAllowance = {
      isEveryRepository: false,
      repositoryIds: [API],
    };
    const stored: Array<string> | undefined =
      toStoredCodeRepositoryIds(allowance);

    stored!.push(WEB);

    expect(allowance.repositoryIds).toEqual([API]);
  });
});

describe("getRuleCodeRepositoriesProblem", () => {
  function ids(count: number): Array<string> {
    return Array.from({ length: count }, (_value: unknown, index: number) => {
      return `c0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    });
  }

  test("a rule may name up to the limit, or none", () => {
    expect(getRuleCodeRepositoriesProblem(undefined)).toBeNull();
    expect(getRuleCodeRepositoriesProblem([])).toBeNull();
    expect(
      getRuleCodeRepositoriesProblem(ids(MAX_CODE_REPOSITORIES_PER_RULE)),
    ).toBeNull();
  });

  test("one more is refused, saying what to do instead", () => {
    expect(
      getRuleCodeRepositoriesProblem(ids(MAX_CODE_REPOSITORIES_PER_RULE + 1)),
    ).toBe(RULE_TOO_MANY_CODE_REPOSITORIES_MESSAGE);
    expect(RULE_TOO_MANY_CODE_REPOSITORIES_MESSAGE).toContain(
      "Leave the list empty to let OneUptime AI use all of them.",
    );
  });

  test("the same repository named twice counts once", () => {
    const repeated: Array<string> = [
      ...ids(MAX_CODE_REPOSITORIES_PER_RULE),
      ...ids(MAX_CODE_REPOSITORIES_PER_RULE),
    ];

    expect(getRuleCodeRepositoriesProblem(repeated)).toBeNull();
  });
});
