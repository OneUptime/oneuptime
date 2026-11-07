import { describe, expect, test } from "@jest/globals";
import AzureDevOpsApi, {
  AZURE_DEVOPS_API_VERSION,
  AZURE_DEVOPS_MAX_TREE_LISTINGS,
  AZURE_DEVOPS_MAX_TREE_PATHS,
  AZURE_DEVOPS_TOKEN_SCOPE_HINT,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/AzureDevOpsApi";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
  CodeHostHttpRequest,
  CodeHostHttpResponse,
  CodeHostTransport,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import { CodeHostFileContent } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import {
  AzureDevOpsRepositoryAddress,
  CodeHostUrl,
} from "../../../../../Types/CodeRepository/CodeHost";
import { noWait } from "./FakeCodeHost";

/*
 * AzureDevOpsApi against Azure DevOps' Git REST API (Items - List and Items
 * - Get, api-version 5.0) as Azure DevOps Services and Azure DevOps Server
 * answer it, faked at the transport: a listing scoped to a folder and as
 * deep as recursionLevel says, an answer refused as too large past a cap
 * the way OneUptime's transport refuses one (CodeHostHttpErrorKind.
 * TooLarge), one file with its content and metadata, and the refusals and
 * failures a server sends.
 */

const TOKEN: string = "azdo4kq2m7x9p1w8c3v5b6n0z2l4j6h8g0f2d4s6a8q1w3e5r7t9";
const USERNAME: string = "oneuptime-bot";
const BASIC: string = Buffer.from(`${USERNAME}:${TOKEN}`).toString("base64");

const SERVICES_REPOSITORY: string =
  "https://dev.azure.com/acme/Shop/_git/checkout";
const SERVER_REPOSITORY: string =
  "https://tfs.example.com/tfs/DefaultCollection/Shop/_git/checkout";

const COMMIT: string = "23d0bc5b128a10056dc68afece360d8a0fabb014";

// A repository's entries as Azure DevOps writes their paths: "/src/app.ts".
type FakeEntryType = "blob" | "tree" | "commit";

interface FakeEntry {
  path: string;
  type: FakeEntryType;
}

interface FakeAnswer {
  status?: number | undefined;
  json?: unknown;
  text?: string | undefined;
  headers?: Record<string, string> | undefined;
}

interface FakeAzureDevOps {
  api: AzureDevOpsApi;
  repository: AzureDevOpsRepositoryAddress;
  requests: Array<CodeHostHttpRequest>;
  urls: () => Array<URL>;
  // Each listing asked for, as "<scopePath> <recursionLevel>".
  listings: () => Array<string>;
}

/*
 * An Azure DevOps server holding one repository. `answer` answers each
 * request to Items; an answer whose JSON is longer than `maxAnswerBytes`
 * is refused as too large, as the transport refuses one past its cap.
 */
function fakeAzureDevOps(data: {
  cloneUrl?: string | undefined;
  answer: (url: URL) => FakeAnswer;
  maxAnswerBytes?: number | undefined;
}): FakeAzureDevOps {
  const repository: AzureDevOpsRepositoryAddress =
    CodeHostUrl.readAzureDevOpsRepository(
      data.cloneUrl || SERVICES_REPOSITORY,
    )!;
  const requests: Array<CodeHostHttpRequest> = [];

  const transport: CodeHostTransport = async (
    request: CodeHostHttpRequest,
  ): Promise<CodeHostHttpResponse> => {
    requests.push(request);

    const url: URL = new URL(request.url);

    if (url.toString().split("?")[0] !== `${repository.apiUrl}/items`) {
      return {
        statusCode: 404,
        bodyText: '{"message":"Not found"}',
        bodyJson: { message: "Not found" },
        headers: {},
      };
    }

    const answer: FakeAnswer = data.answer(url);
    const text: string =
      answer.text !== undefined
        ? answer.text
        : answer.json !== undefined
          ? JSON.stringify(answer.json)
          : "";

    if (data.maxAnswerBytes && text.length > data.maxAnswerBytes) {
      throw new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.TooLarge,
        message: `${url.host} answered with more than OneUptime reads at once.`,
      });
    }

    return {
      statusCode: answer.status ?? 200,
      bodyText: text,
      bodyJson: answer.json,
      headers: answer.headers || {},
    };
  };

  return {
    api: new AzureDevOpsApi({
      repository,
      username: USERNAME,
      password: TOKEN,
      transport,
      backOff: noWait,
    }),
    repository,
    requests,
    urls: (): Array<URL> => {
      return requests.map((request: CodeHostHttpRequest): URL => {
        return new URL(request.url);
      });
    },
    listings: (): Array<string> => {
      return requests
        .map((request: CodeHostHttpRequest): URL => {
          return new URL(request.url);
        })
        .filter((url: URL): boolean => {
          return url.searchParams.has("scopePath");
        })
        .map((url: URL): string => {
          return `${url.searchParams.get("scopePath")} ${url.searchParams.get("recursionLevel")}`;
        });
    },
  };
}

// An entry of a listing, as Azure DevOps writes it (GitItem).
function item(entry: FakeEntry): Record<string, unknown> {
  return {
    objectId: "d1d5c2d49045d52bba6419652d6ecb2cd560dc29",
    gitObjectType: entry.type,
    commitId: COMMIT,
    path: entry.path,
    ...(entry.type === "tree" ? { isFolder: true } : {}),
    url: `https://dev.azure.com/acme/_apis/git/repositories/278d5cd2-584d-4b63-824a-2ba458937249/items${entry.path}?versionType=Branch&versionOptions=None`,
  };
}

function depthOf(path: string): number {
  return path === "/" ? 0 : path.split("/").length - 1;
}

/*
 * What Items - List answers for a tree: the scope's folder and everything
 * under it (Full), or what is directly in it (OneLevel).
 */
function listTree(entries: Array<FakeEntry>, url: URL): FakeAnswer {
  const scopePath: string = url.searchParams.get("scopePath") || "/";
  const recursion: string = url.searchParams.get("recursionLevel") || "None";

  const inScope: Array<FakeEntry> = entries.filter(
    (entry: FakeEntry): boolean => {
      return (
        entry.path === scopePath ||
        (scopePath === "/"
          ? entry.path !== "/"
          : entry.path.startsWith(`${scopePath}/`))
      );
    },
  );

  // In path order, the folder itself first, as Azure DevOps lists them.
  const listed: Array<FakeEntry> = (
    recursion === "OneLevel"
      ? inScope.filter((entry: FakeEntry): boolean => {
          return depthOf(entry.path) <= depthOf(scopePath) + 1;
        })
      : inScope
  ).sort((a: FakeEntry, b: FakeEntry): number => {
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });

  return {
    json: {
      count: listed.length,
      value: listed.map(item),
    },
  };
}

/*
 * A repository's entries, folders included, from its files' paths: every
 * folder a file is in is a tree.
 */
function treeOf(
  files: Array<string>,
  extra: Array<FakeEntry> = [],
): Array<FakeEntry> {
  const folders: Set<string> = new Set<string>(["/"]);

  for (const file of files) {
    const parts: Array<string> = file.split("/").filter(Boolean);

    for (let index: number = 1; index < parts.length; index++) {
      folders.add(`/${parts.slice(0, index).join("/")}`);
    }
  }

  return [
    ...Array.from(folders).map((path: string): FakeEntry => {
      return { path, type: "tree" };
    }),
    ...files.map((path: string): FakeEntry => {
      return { path, type: "blob" };
    }),
    ...extra,
  ];
}

// A file as Items - Get answers it with includeContent and its metadata.
function file(
  path: string,
  content: string,
  metadata: Record<string, unknown> = {},
): unknown {
  return {
    objectId: "61a86fdaa79e5c6f5fb6e4026508489feb6ed92c",
    gitObjectType: "blob",
    commitId: COMMIT,
    path,
    content,
    contentMetadata: {
      encoding: 65001,
      contentType: "text/plain",
      fileName: path.split("/").pop(),
      extension: `.${path.split(".").pop()}`,
      ...metadata,
    },
    url: `https://dev.azure.com/acme/_apis/git/repositories/278d5cd2/items${path}`,
  };
}

// Azure DevOps' answer to what it refuses or cannot find.
function azureError(status: number, message: string): FakeAnswer {
  return {
    status,
    json: {
      $id: "1",
      innerException: null,
      message,
      typeName:
        "Microsoft.TeamFoundation.Git.Server.GitItemNotFoundException, Microsoft.TeamFoundation.Git.Server",
      typeKey: "GitItemNotFoundException",
      errorCode: 0,
      eventId: 3000,
    },
  };
}

async function failure(work: Promise<unknown>): Promise<CodeHostHttpError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof CodeHostHttpError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the read to fail.");
}

describe("AzureDevOpsApi: who it signs in as, and where", () => {
  test("signs in as Git does - HTTP Basic, the username and the token - and never puts either in an address", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (url: URL): FakeAnswer => {
        return listTree(treeOf(["/README.md"]), url);
      },
    });

    await azure.api.getTreePaths({ ref: "main" });

    expect(azure.requests).toHaveLength(1);
    expect(azure.requests[0]!.method).toBe("GET");
    expect(azure.requests[0]!.headers["Authorization"]).toBe(`Basic ${BASIC}`);
    expect(azure.requests[0]!.headers["Accept"]).toBe("application/json");
    expect(azure.requests[0]!.url).not.toContain(TOKEN);
    expect(azure.requests[0]!.url).not.toContain(BASIC);
    expect(azure.requests[0]!.url).not.toContain(USERNAME);
  });

  test("asks Azure DevOps Services for the repository in its project, in api-version 5.0", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (url: URL): FakeAnswer => {
        return listTree(treeOf(["/README.md"]), url);
      },
    });

    await azure.api.getTreePaths({ ref: "main" });

    const url: URL = azure.urls()[0]!;

    expect(AZURE_DEVOPS_API_VERSION).toBe("5.0");
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://dev.azure.com/acme/Shop/_apis/git/repositories/checkout/items",
    );
    expect(url.searchParams.get("api-version")).toBe("5.0");
  });

  test("asks an Azure DevOps Server under its collection - with its /tfs virtual directory, or without", async () => {
    for (const [cloneUrl, items] of [
      [
        SERVER_REPOSITORY,
        "https://tfs.example.com/tfs/DefaultCollection/Shop/_apis/git/repositories/checkout/items",
      ],
      [
        "https://tfs.example.com/DefaultCollection/Shop/_git/checkout",
        "https://tfs.example.com/DefaultCollection/Shop/_apis/git/repositories/checkout/items",
      ],
      [
        "http://tfs.example.com:8080/tfs/Fabrikam/Shop/_git/checkout",
        "http://tfs.example.com:8080/tfs/Fabrikam/Shop/_apis/git/repositories/checkout/items",
      ],
    ] as Array<[string, string]>) {
      const azure: FakeAzureDevOps = fakeAzureDevOps({
        cloneUrl,
        answer: (url: URL): FakeAnswer => {
          return listTree(treeOf(["/src/Program.cs"]), url);
        },
      });

      await expect(azure.api.getTreePaths({ ref: "main" })).resolves.toEqual([
        "src/Program.cs",
      ]);

      const url: URL = azure.urls()[0]!;

      expect(`${url.origin}${url.pathname}`).toBe(items);
      expect(url.searchParams.get("api-version")).toBe("5.0");
    }
  });

  test("a repository whose address leaves its project out is read in the project named as it is", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      cloneUrl: "https://tfs.example.com/tfs/DefaultCollection/_git/Shop",
      answer: (url: URL): FakeAnswer => {
        return listTree(treeOf(["/Shop.sln"]), url);
      },
    });

    await expect(azure.api.getTreePaths({ ref: "main" })).resolves.toEqual([
      "Shop.sln",
    ]);
    expect(azure.urls()[0]!.pathname).toBe(
      "/tfs/DefaultCollection/Shop/_apis/git/repositories/Shop/items",
    );
  });

  test("reads only an address on Azure DevOps", () => {
    const transport: CodeHostTransport = async (): Promise<never> => {
      throw new Error("No request is made.");
    };

    expect(
      AzureDevOpsApi.forCloneUrl({
        cloneUrl: "https://git.example.com/team/app.git",
        username: USERNAME,
        password: TOKEN,
        transport,
      }),
    ).toBeNull();
    expect(
      AzureDevOpsApi.forCloneUrl({
        cloneUrl: null,
        username: USERNAME,
        password: TOKEN,
        transport,
      }),
    ).toBeNull();
    expect(
      AzureDevOpsApi.forCloneUrl({
        cloneUrl: SERVER_REPOSITORY,
        username: USERNAME,
        password: TOKEN,
        transport,
      })?.getRepository().apiUrl,
    ).toBe(
      "https://tfs.example.com/tfs/DefaultCollection/Shop/_apis/git/repositories/checkout",
    );
  });
});

describe("AzureDevOpsApi: a repository's tree", () => {
  test("is listed in one answer at the branch: its files, without their leading slash - no folder, no submodule", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (url: URL): FakeAnswer => {
        return listTree(
          treeOf(
            [
              "/README.md",
              "/src/app.ts",
              "/src/billing/charge.ts",
              "/docs/a b.md",
            ],
            [{ path: "/vendor/payments", type: "commit" }],
          ),
          url,
        );
      },
    });

    const paths: Array<string> = await azure.api.getTreePaths({
      ref: "release/2.0",
    });

    expect(paths.sort()).toEqual([
      "README.md",
      "docs/a b.md",
      "src/app.ts",
      "src/billing/charge.ts",
    ]);

    const query: URLSearchParams = azure.urls()[0]!.searchParams;

    expect(azure.requests).toHaveLength(1);
    expect(query.get("scopePath")).toBe("/");
    expect(query.get("recursionLevel")).toBe("Full");
    expect(query.get("versionDescriptor.version")).toBe("release/2.0");
    expect(query.get("versionDescriptor.versionType")).toBe("branch");
    expect(query.get("api-version")).toBe("5.0");
  });

  test("a large tree that fits one answer is read whole, in that one listing", async () => {
    const files: Array<string> = [];

    for (let folder: number = 0; folder < 200; folder++) {
      for (let index: number = 0; index < 100; index++) {
        files.push(`/src/module${folder}/file${index}.ts`);
      }
    }

    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (url: URL): FakeAnswer => {
        return listTree(treeOf(files), url);
      },
    });

    const paths: Array<string> = await azure.api.getTreePaths({ ref: "main" });

    expect(paths).toHaveLength(20000);
    expect(paths).toContain("src/module199/file99.ts");
    expect(azure.listings()).toEqual(["/ Full"]);
  });

  test("a tree too large for one answer is read a folder at a time: each folder whole where it fits, one level of it where it does not", async () => {
    const files: Array<string> = ["/README.md", "/package.json"];

    // packages/ is too large for one answer; each package fits.
    for (let pkg: number = 0; pkg < 4; pkg++) {
      for (let index: number = 0; index < 60; index++) {
        files.push(`/packages/pkg${pkg}/src/file${index}.ts`);
      }
    }

    files.push("/docs/guide.md", "/docs/api/reference.md");

    const entries: Array<FakeEntry> = treeOf(files);
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      maxAnswerBytes: 30000,
      answer: (url: URL): FakeAnswer => {
        return listTree(entries, url);
      },
    });

    const paths: Array<string> = await azure.api.getTreePaths({ ref: "main" });

    // Every file, once - and only files.
    expect(paths.sort()).toEqual(
      files
        .map((path: string): string => {
          return path.substring(1);
        })
        .sort(),
    );

    // Too large is asked once, never again: the next listing asks for less.
    expect(azure.listings()).toEqual([
      "/ Full",
      "/ OneLevel",
      "/docs Full",
      "/packages Full",
      "/packages OneLevel",
      "/packages/pkg0 Full",
      "/packages/pkg1 Full",
      "/packages/pkg2 Full",
      "/packages/pkg3 Full",
    ]);
  });

  test("a folder with more directly in it than one answer holds is left out, and the rest of the tree is read", async () => {
    const files: Array<string> = ["/README.md", "/src/app.ts"];

    for (let index: number = 0; index < 400; index++) {
      files.push(`/assets/icon${index}.svg`);
    }

    const azure: FakeAzureDevOps = fakeAzureDevOps({
      maxAnswerBytes: 20000,
      answer: (url: URL): FakeAnswer => {
        return listTree(treeOf(files), url);
      },
    });

    const paths: Array<string> = await azure.api.getTreePaths({ ref: "main" });

    expect(paths.sort()).toEqual(["README.md", "src/app.ts"]);
    expect(azure.listings()).toEqual([
      "/ Full",
      "/ OneLevel",
      "/assets Full",
      "/assets OneLevel",
      "/src Full",
    ]);
  });

  test("a root with more directly in it than one answer holds leaves no tree, and says so", async () => {
    const files: Array<string> = [];

    for (let index: number = 0; index < 400; index++) {
      files.push(`/file${index}.txt`);
    }

    const azure: FakeAzureDevOps = fakeAzureDevOps({
      maxAnswerBytes: 20000,
      answer: (url: URL): FakeAnswer => {
        return listTree(treeOf(files), url);
      },
    });

    const error: CodeHostHttpError = await failure(
      azure.api.getTreePaths({ ref: "main" }),
    );

    expect(error.kind).toBe(CodeHostHttpErrorKind.TooLarge);
    expect(error.message).toBe(
      "dev.azure.com answered with more than OneUptime reads at once.",
    );
    expect(azure.listings()).toEqual(["/ Full", "/ OneLevel"]);
  });

  test("a tree past 100,000 paths is cut there", async () => {
    const value: Array<Record<string, unknown>> = [
      item({ path: "/", type: "tree" }),
    ];

    for (
      let index: number = 0;
      index < AZURE_DEVOPS_MAX_TREE_PATHS + 5;
      index++
    ) {
      value.push({
        gitObjectType: "blob",
        path: `/f${index}`,
      });
    }

    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (): FakeAnswer => {
        return { json: { count: value.length, value } };
      },
    });

    const paths: Array<string> = await azure.api.getTreePaths({ ref: "main" });

    expect(AZURE_DEVOPS_MAX_TREE_PATHS).toBe(100000);
    expect(paths).toHaveLength(AZURE_DEVOPS_MAX_TREE_PATHS);
    expect(paths[0]).toBe("f0");
  });

  test("a tree past 100 listings is cut there", async () => {
    const files: Array<string> = [];

    // Too large as a whole; each of 150 folders fits.
    for (let folder: number = 0; folder < 150; folder++) {
      for (let index: number = 0; index < 3; index++) {
        files.push(`/m${String(folder).padStart(3, "0")}/f${index}.ts`);
      }
    }

    const azure: FakeAzureDevOps = fakeAzureDevOps({
      maxAnswerBytes: 60000,
      answer: (url: URL): FakeAnswer => {
        return listTree(treeOf(files), url);
      },
    });

    const paths: Array<string> = await azure.api.getTreePaths({ ref: "main" });

    expect(AZURE_DEVOPS_MAX_TREE_LISTINGS).toBe(100);
    expect(azure.requests).toHaveLength(AZURE_DEVOPS_MAX_TREE_LISTINGS);
    // The root twice, then 98 folders whole.
    expect(paths).toHaveLength(98 * 3);
    expect(paths).toContain("m097/f2.ts");
    expect(paths).not.toContain("m098/f0.ts");
  });

  test("a branch or a repository Azure DevOps cannot find is an error, in its own words", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (): FakeAnswer => {
        return azureError(
          404,
          "TF401175: The version descriptor <Branch: nope > could not be resolved to a version in the repository checkout",
        );
      },
    });

    const error: CodeHostHttpError = await failure(
      azure.api.getTreePaths({ ref: "nope" }),
    );

    expect(error.kind).toBe(CodeHostHttpErrorKind.NotFound);
    expect(error.statusCode).toBe(404);
    expect(error.message).toContain("Azure DevOps found nothing there");
    expect(error.message).toContain("TF401175");
  });

  test("an answer that is not a listing is said to be one", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (): FakeAnswer => {
        return { json: { count: 1 } };
      },
    });

    const error: CodeHostHttpError = await failure(
      azure.api.getTreePaths({ ref: "main" }),
    );

    expect(error.kind).toBe(CodeHostHttpErrorKind.BadResponse);
    expect(error.message).toContain("Azure DevOps's API");
  });
});

describe("AzureDevOpsApi: one file", () => {
  test("is its text at the branch, with its size, its lines and its page", async () => {
    const content: string =
      "export const charge = 1;\nexport const refund = 2;\n";
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (url: URL): FakeAnswer => {
        return { json: file(url.searchParams.get("path")!, content) };
      },
    });

    const read: CodeHostFileContent | null = await azure.api.getFileContent({
      ref: "main",
      filePath: "src/billing/charge.ts",
    });

    expect(read).toEqual({
      content,
      filePath: "src/billing/charge.ts",
      sizeInBytes: content.length,
      totalLines: 2,
      htmlUrl:
        "https://dev.azure.com/acme/Shop/_git/checkout?path=%2Fsrc%2Fbilling%2Fcharge.ts&version=GBmain",
    });

    const query: URLSearchParams = azure.urls()[0]!.searchParams;

    expect(query.get("path")).toBe("/src/billing/charge.ts");
    expect(query.get("includeContent")).toBe("true");
    expect(query.get("includeContentMetadata")).toBe("true");
    expect(query.get("versionDescriptor.version")).toBe("main");
    expect(query.get("versionDescriptor.versionType")).toBe("branch");
    expect(query.get("api-version")).toBe("5.0");
    expect(query.has("scopePath")).toBe(false);
  });

  test("on an Azure DevOps Server, its page is the server's", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      cloneUrl: SERVER_REPOSITORY,
      answer: (url: URL): FakeAnswer => {
        return {
          json: file(url.searchParams.get("path")!, "class Program {}\n"),
        };
      },
    });

    const read: CodeHostFileContent | null = await azure.api.getFileContent({
      ref: "develop",
      filePath: "src/Program.cs",
    });

    expect(read?.htmlUrl).toBe(
      `${SERVER_REPOSITORY}?path=%2Fsrc%2FProgram.cs&version=GBdevelop`,
    );
    expect(azure.urls()[0]!.pathname).toBe(
      "/tfs/DefaultCollection/Shop/_apis/git/repositories/checkout/items",
    );
  });

  test("a path is sent whole, whatever it holds, and a leading slash is not doubled", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (url: URL): FakeAnswer => {
        return { json: file(url.searchParams.get("path")!, "x\n") };
      },
    });

    await azure.api.getFileContent({
      ref: "feature/a&b",
      filePath: "src/Billing/Charge Card#1 & more?.cs",
    });
    await azure.api.getFileContent({ ref: "main", filePath: "/README.md" });

    expect(azure.urls()[0]!.searchParams.get("path")).toBe(
      "/src/Billing/Charge Card#1 & more?.cs",
    );
    expect(azure.urls()[0]!.searchParams.get("versionDescriptor.version")).toBe(
      "feature/a&b",
    );
    expect(azure.urls()[1]!.searchParams.get("path")).toBe("/README.md");
  });

  test("a missing file - or a file on a missing branch - is null", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (url: URL): FakeAnswer => {
        return azureError(
          404,
          `TF401174: The item '${url.searchParams.get("path")}' could not be found in the repository 'checkout' at the version specified by '<Branch: main >' (resolved to commit '${COMMIT}').`,
        );
      },
    });

    await expect(
      azure.api.getFileContent({ ref: "main", filePath: "src/missing.ts" }),
    ).resolves.toBeNull();
    // 404 is no reason to try again.
    expect(azure.requests).toHaveLength(1);
  });

  test("an empty path names no file, and nothing is asked", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (): FakeAnswer => {
        return { json: file("/", "") };
      },
    });

    await expect(
      azure.api.getFileContent({ ref: "main", filePath: "/" }),
    ).resolves.toBeNull();
    expect(azure.requests).toHaveLength(0);
  });

  test("a binary file is null: as Azure DevOps marks it, or by the NUL bytes in it", async () => {
    const marked: FakeAzureDevOps = fakeAzureDevOps({
      answer: (url: URL): FakeAnswer => {
        return {
          json: file(url.searchParams.get("path")!, "PNG...", {
            contentType: "image/png",
            isBinary: true,
            isImage: true,
          }),
        };
      },
    });

    await expect(
      marked.api.getFileContent({ ref: "main", filePath: "assets/logo.png" }),
    ).resolves.toBeNull();

    const unmarked: FakeAzureDevOps = fakeAzureDevOps({
      answer: (): FakeAnswer => {
        return {
          json: {
            gitObjectType: "blob",
            path: "/bin/tool",
            content: "\u007fELF\u0002\u0001\u0001\u0000\u0000\u0000",
          },
        };
      },
    });

    await expect(
      unmarked.api.getFileContent({ ref: "main", filePath: "bin/tool" }),
    ).resolves.toBeNull();
  });

  test("a folder or a submodule is no file", async () => {
    for (const json of [
      { gitObjectType: "tree", path: "/src", isFolder: true },
      { path: "/src", isFolder: true },
      { gitObjectType: "commit", path: "/vendor/payments" },
    ]) {
      const azure: FakeAzureDevOps = fakeAzureDevOps({
        answer: (): FakeAnswer => {
          return { json };
        },
      });

      await expect(
        azure.api.getFileContent({ ref: "main", filePath: json.path }),
      ).resolves.toBeNull();
    }
  });

  test("an empty file is empty text; an answer without the contents is an error, never an empty file", async () => {
    const empty: FakeAzureDevOps = fakeAzureDevOps({
      answer: (url: URL): FakeAnswer => {
        return { json: file(url.searchParams.get("path")!, "") };
      },
    });

    await expect(
      empty.api.getFileContent({ ref: "main", filePath: "src/.keep" }),
    ).resolves.toMatchObject({ content: "", totalLines: 0, sizeInBytes: 0 });

    const withoutContent: FakeAzureDevOps = fakeAzureDevOps({
      answer: (): FakeAnswer => {
        return { json: { gitObjectType: "blob", path: "/src/app.ts" } };
      },
    });

    const error: CodeHostHttpError = await failure(
      withoutContent.api.getFileContent({
        ref: "main",
        filePath: "src/app.ts",
      }),
    );

    expect(error.kind).toBe(CodeHostHttpErrorKind.BadResponse);
    expect(error.message).toBe(
      "Azure DevOps answered for src/app.ts without its contents.",
    );
  });
});

describe("AzureDevOpsApi: what Azure DevOps refuses, and what fails", () => {
  test("a token it refuses (401) is said so, as a refusal of the credentials", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (): FakeAnswer => {
        return { status: 401, text: "" };
      },
    });

    const error: CodeHostHttpError = await failure(
      azure.api.getFileContent({ ref: "main", filePath: "src/app.ts" }),
    );

    expect(error.kind).toBe(CodeHostHttpErrorKind.Unauthorized);
    expect(error.isCredentialRefusal()).toBe(true);
    expect(error.message).toBe(
      "Azure DevOps refused the access token. It may have expired or been revoked: create a new token and use it instead.",
    );
    // A refusal is no reason to try again.
    expect(azure.requests).toHaveLength(1);
  });

  test("on an Azure DevOps Server, the refusal names the Server", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      cloneUrl: SERVER_REPOSITORY,
      answer: (): FakeAnswer => {
        return { status: 401, text: "" };
      },
    });

    const error: CodeHostHttpError = await failure(
      azure.api.getTreePaths({ ref: "main" }),
    );

    expect(error.message).toBe(
      "Azure DevOps Server refused the access token. It may have expired or been revoked: create a new token and use it instead.",
    );
  });

  test("a read the token may not make (403) says Azure DevOps' words and the scope it needs", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (): FakeAnswer => {
        return azureError(
          403,
          "TF401027: You need the Git 'Read' permission to perform this action.",
        );
      },
    });

    const error: CodeHostHttpError = await failure(
      azure.api.getTreePaths({ ref: "main" }),
    );

    expect(error.kind).toBe(CodeHostHttpErrorKind.Forbidden);
    expect(error.message).toBe(
      `Azure DevOps did not let the access token do this (TF401027: You need the Git 'Read' permission to perform this action.). ${AZURE_DEVOPS_TOKEN_SCOPE_HINT}`,
    );
  });

  test("a repository it cannot find (404) is an error for the tree, and null for a file", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (): FakeAnswer => {
        return azureError(
          404,
          "TF401019: The Git repository with name or identifier checkout does not exist or you do not have permissions for the operation you are attempting.",
        );
      },
    });

    const error: CodeHostHttpError = await failure(
      azure.api.getTreePaths({ ref: "main" }),
    );

    expect(error.kind).toBe(CodeHostHttpErrorKind.NotFound);
    expect(error.message).toContain("TF401019");
    await expect(
      azure.api.getFileContent({ ref: "main", filePath: "src/app.ts" }),
    ).resolves.toBeNull();
  });

  test("its sign-in page in place of an answer (203) is a refusal of the credentials, not a bad address", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (): FakeAnswer => {
        return {
          status: 203,
          text: "<!DOCTYPE html><html><head><title>Azure DevOps Services | Sign In</title></head></html>",
          headers: { "content-type": "text/html; charset=utf-8" },
        };
      },
    });

    const error: CodeHostHttpError = await failure(
      azure.api.getFileContent({ ref: "main", filePath: "src/app.ts" }),
    );

    expect(error.kind).toBe(CodeHostHttpErrorKind.Unauthorized);
    expect(error.statusCode).toBe(203);
    expect(error.message).toBe(
      "Azure DevOps answered with its sign-in page: it did not take the username and password or access token. Check them, and that the token has not expired.",
    );
  });

  test("an answer that is not its API's (a web page at 200) says to check the address", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      cloneUrl: SERVER_REPOSITORY,
      answer: (): FakeAnswer => {
        return { text: "<html>IIS Windows Server</html>" };
      },
    });

    const error: CodeHostHttpError = await failure(
      azure.api.getTreePaths({ ref: "main" }),
    );

    expect(error.kind).toBe(CodeHostHttpErrorKind.BadResponse);
    expect(error.message).toBe(
      "tfs.example.com did not answer as Azure DevOps Server's API does. Check the server's address.",
    );
  });

  test("a server error is tried twice more, and an answer then is read", async () => {
    let calls: number = 0;
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (url: URL): FakeAnswer => {
        calls++;

        return calls < 3
          ? { status: 503, text: "Service Unavailable" }
          : listTree(treeOf(["/README.md"]), url);
      },
    });

    await expect(azure.api.getTreePaths({ ref: "main" })).resolves.toEqual([
      "README.md",
    ]);
    expect(azure.requests).toHaveLength(3);
  });

  test("a server that keeps failing is said to, after three tries", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (): FakeAnswer => {
        return { status: 500, text: "" };
      },
    });

    const error: CodeHostHttpError = await failure(
      azure.api.getFileContent({ ref: "main", filePath: "src/app.ts" }),
    );

    expect(error.kind).toBe(CodeHostHttpErrorKind.Unavailable);
    expect(error.message).toBe(
      "Azure DevOps kept failing (HTTP 500). Try again later.",
    );
    expect(azure.requests).toHaveLength(3);
  });

  test("being asked to slow down (429) is said, not tried again", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (): FakeAnswer => {
        return { status: 429, text: "", headers: { "retry-after": "30" } };
      },
    });

    const error: CodeHostHttpError = await failure(
      azure.api.getTreePaths({ ref: "main" }),
    );

    expect(error.kind).toBe(CodeHostHttpErrorKind.RateLimited);
    expect(azure.requests).toHaveLength(1);
  });

  test("nothing it throws carries the token or the header it signs in with", async () => {
    const azure: FakeAzureDevOps = fakeAzureDevOps({
      answer: (): FakeAnswer => {
        return azureError(
          403,
          `Access denied for Basic ${BASIC} (token ${TOKEN}).`,
        );
      },
    });

    const error: CodeHostHttpError = await failure(
      azure.api.getTreePaths({ ref: "main" }),
    );

    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain(BASIC);
    expect(error.message).toContain("[REDACTED]");
  });
});
