import SourceLocator, {
  LocatableRepository,
  MAX_FRAMES_LOCATED,
  MAX_REPOSITORIES_PROBED,
  SourceLink,
} from "../../../../Server/Utils/CodeRepository/SourceLocator";
import { describe, expect, test } from "@jest/globals";

/*
 * Where a running function's file lives in the project's repositories: a
 * frame names its file as the process saw it ("/app/src/orders/parse.ts"),
 * a repository names it from its root ("src/orders/parse.ts"). A link is
 * given only when one repository holds the file for certain - a link that
 * might be the wrong file is worse than none - and never for a library's
 * file, which is nobody's own code.
 */

function repository(
  name: string,
  change: Partial<LocatableRepository> = {},
): LocatableRepository {
  return {
    id: `id-${name}`,
    name: `acme/${name}`,
    organizationName: "acme",
    repositoryName: name,
    mainBranchName: "main",
    ...change,
  };
}

const CHECKOUT: LocatableRepository = repository("checkout");
const PLATFORM: LocatableRepository = repository("platform");

const TREES: Record<string, Array<string>> = {
  [CHECKOUT.id]: [
    "src/orders/parse.ts",
    "src/orders/normalize.ts",
    "src/server.ts",
    "src/util/index.ts",
    "package.json",
  ],
  [PLATFORM.id]: [
    "services/platform/src/server.ts",
    "services/platform/src/util/index.ts",
    "README.md",
  ],
};

async function trees(repo: LocatableRepository): Promise<Array<string>> {
  return TREES[repo.id] || [];
}

async function locate(
  frames: Array<{ fileName: string; lineNumber?: number }>,
  repositories: Array<LocatableRepository> = [CHECKOUT, PLATFORM],
): Promise<Array<SourceLink>> {
  return SourceLocator.matchFrames({
    frames,
    repositories,
    getTreePaths: trees,
  });
}

describe("a frame's file in the repositories", () => {
  test("a container path is found by its longest suffix, with a link to its line", async () => {
    const links: Array<SourceLink> = await locate([
      { fileName: "/app/src/orders/parse.ts", lineNumber: 88 },
    ]);

    expect(links).toEqual([
      {
        fileName: "/app/src/orders/parse.ts",
        lineNumber: 88,
        repositoryId: CHECKOUT.id,
        repositoryName: "acme/checkout",
        path: "src/orders/parse.ts",
        url: "https://github.com/acme/checkout/blob/main/src/orders/parse.ts#L88",
      },
    ]);
  });

  test("a file both repositories hold equally well gets no link", async () => {
    // util/index.ts is in both; nothing longer tells them apart.
    expect(await locate([{ fileName: "/srv/util/index.ts" }])).toEqual([]);
  });

  test("the longer match wins when only one repository has it", async () => {
    const links: Array<SourceLink> = await locate([
      { fileName: "/build/services/platform/src/server.ts", lineNumber: 3 },
    ]);

    expect(links[0]!.repositoryId).toBe(PLATFORM.id);
    expect(links[0]!.path).toBe("services/platform/src/server.ts");
  });

  test("a library's file is nobody's own code: no link", async () => {
    expect(
      await locate([
        { fileName: "/app/node_modules/express/lib/router/index.js" },
        {
          fileName:
            "/usr/lib/python3.11/site-packages/reportlab/platypus/doctemplate.py",
        },
      ]),
    ).toEqual([]);
  });

  test("a file no repository holds gets no link; no frames or no repositories, none at all", async () => {
    expect(await locate([{ fileName: "/app/src/missing/file.ts" }])).toEqual(
      [],
    );
    expect(await locate([])).toEqual([]);
    expect(
      await locate([{ fileName: "/app/src/orders/parse.ts" }], []),
    ).toEqual([]);
  });

  test("a repository whose tree cannot be read is skipped; the rest still count", async () => {
    const links: Array<SourceLink> = await SourceLocator.matchFrames({
      frames: [{ fileName: "/app/src/orders/parse.ts", lineNumber: 1 }],
      repositories: [PLATFORM, CHECKOUT],
      getTreePaths: async (repo: LocatableRepository) => {
        if (repo.id === PLATFORM.id) {
          throw new Error("GitHub is down");
        }
        return trees(repo);
      },
    });

    expect(links).toHaveLength(1);
    expect(links[0]!.repositoryId).toBe(CHECKOUT.id);
  });

  test("reads at most so many repositories and frames per request", async () => {
    const read: Array<string> = [];
    const many: Array<LocatableRepository> = Array.from(
      { length: MAX_REPOSITORIES_PROBED + 5 },
      (_value: unknown, index: number): LocatableRepository => {
        return repository(`r${index}`);
      },
    );

    await SourceLocator.matchFrames({
      frames: Array.from(
        { length: MAX_FRAMES_LOCATED + 10 },
        (_value: unknown, index: number) => {
          return { fileName: `/app/src/f${index}.ts` };
        },
      ),
      repositories: many,
      getTreePaths: async (repo: LocatableRepository) => {
        read.push(repo.id);
        return [];
      },
    });

    expect(read).toHaveLength(MAX_REPOSITORIES_PROBED);
  });
});

describe("the link to a file", () => {
  test("is the repository's own address when it has one, on its main branch, at the line", () => {
    expect(
      SourceLocator.getFileUrl(
        repository("checkout", {
          repositoryUrl: "https://github.example.com/acme/checkout/",
          mainBranchName: "release/2.4",
        }),
        "src/orders/parse order.ts",
        12,
      ),
    ).toBe(
      "https://github.example.com/acme/checkout/blob/release%2F2.4/src/orders/parse%20order.ts#L12",
    );
  });

  test("names no line when the profile recorded none", () => {
    expect(SourceLocator.getFileUrl(CHECKOUT, "src/server.ts", 0)).toBe(
      "https://github.com/acme/checkout/blob/main/src/server.ts",
    );
  });
});
