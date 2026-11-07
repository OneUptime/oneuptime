import { afterEach, describe, expect, test } from "@jest/globals";
import CodeHostAccess, {
  CodeHostReader,
  CodeHostUnavailableError,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import {
  CodeHostHttpErrorKind,
  CodeHostHttpRequest,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import OneUptimeURL from "../../../../../Types/API/URL";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import {
  CONNECTED_PROJECT_ID,
  CONNECTED_REPOSITORY_ID,
  CONNECTED_TOKEN,
  ConnectedRepository,
  connectRepository,
  disconnectRepository,
} from "./ConnectedRepository";
import { FakeAnswer, FakeRoute } from "./FakeCodeHost";

/*
 * A repository connected as Git, as OneUptime's server reads it
 * (CodeHostAccess): on Azure DevOps - Services, or a Server of the
 * project's own - its code is read through Azure DevOps' file API with
 * the credentials Git signs in with; on any other Git server it is not,
 * and the reader says so without asking the server anything. A refusal
 * of a file read marks nothing: whether the server takes the credentials
 * is for Git's own reads to say.
 */

const BASIC: string = Buffer.from(`oneuptime-bot:${CONNECTED_TOKEN}`).toString(
  "base64",
);

// Azure DevOps' Items API for the repository: its tree, or one file of it.
function items(files: Record<string, string>): FakeRoute {
  return {
    method: "GET",
    path: "/items",
    answer: (_request: CodeHostHttpRequest, url: URL): FakeAnswer => {
      const path: string | null = url.searchParams.get("path");

      if (path !== null) {
        return files[path] === undefined
          ? {
              status: 404,
              json: {
                message: `TF401174: The item '${path}' could not be found in the repository 'checkout'.`,
              },
            }
          : {
              json: {
                gitObjectType: "blob",
                path,
                content: files[path],
                contentMetadata: { isBinary: false },
              },
            };
      }

      return {
        json: {
          count: Object.keys(files).length + 1,
          value: [
            { gitObjectType: "tree", path: "/", isFolder: true },
            ...Object.keys(files).map((file: string) => {
              return { gitObjectType: "blob", path: file };
            }),
          ],
        },
      };
    },
  };
}

async function readerOf(): Promise<CodeHostReader> {
  const reader: CodeHostReader | null = await CodeHostAccess.getReader({
    projectId: CONNECTED_PROJECT_ID,
    repositoryId: CONNECTED_REPOSITORY_ID,
  });

  expect(reader).not.toBeNull();

  return reader!;
}

afterEach(() => {
  disconnectRepository();
});

describe("a Git repository on Azure DevOps Services", () => {
  test("its code is read: its tree at a branch and a file, with the credentials Git signs in with", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.Git,
      routes: [
        items({
          "/src/app.ts": "export const app = 1;\n",
          "/README.md": "# Checkout\n",
        }),
      ],
    });
    const reader: CodeHostReader = await readerOf();

    expect(reader.type).toBe(CodeRepositoryType.Git);
    expect(reader.canReadCode).toBe(true);
    expect(reader.canListBranches).toBe(true);
    // Still a Git repository: no pull request of OneUptime's to read.
    expect(reader.canTrackPullRequests).toBe(false);
    expect(reader.canCompareCommits).toBe(false);

    await expect(reader.getTreePaths("main")).resolves.toEqual([
      "src/app.ts",
      "README.md",
    ]);
    await expect(
      reader.getFileContent({ filePath: "src/app.ts", branchName: "main" }),
    ).resolves.toMatchObject({
      content: "export const app = 1;\n",
      totalLines: 1,
      htmlUrl:
        "https://dev.azure.com/acme/Shop/_git/checkout?path=%2Fsrc%2Fapp.ts&version=GBmain",
    });
    await expect(
      reader.getFileContent({ filePath: "src/gone.ts", branchName: "main" }),
    ).resolves.toBeNull();

    expect(connected.host.requests).toHaveLength(3);

    for (const request of connected.host.requests) {
      expect(new URL(request.url).pathname).toBe(
        "/acme/Shop/_apis/git/repositories/checkout/items",
      );
      expect(request.headers["Authorization"]).toBe(`Basic ${BASIC}`);
    }

    expect(connected.refused()).toBe(0);
  });

  test("a file's link is Azure DevOps' page for it, at its line", async () => {
    connectRepository({ provider: CodeRepositoryType.Git, routes: [] });
    const reader: CodeHostReader = await readerOf();

    expect(reader.getFileWebUrl({ path: "src/app.ts", lineNumber: 12 })).toBe(
      "https://dev.azure.com/acme/Shop/_git/checkout?path=%2Fsrc%2Fapp.ts&version=GBmain&line=12",
    );
  });
});

describe("a Git repository on an Azure DevOps Server", () => {
  for (const repositoryUrl of [
    "https://tfs.example.com/tfs/DefaultCollection/Shop/_git/checkout",
    "https://tfs.example.com/DefaultCollection/Shop/_git/checkout",
  ]) {
    test(`is read from the server's own API, and linked to its pages: ${repositoryUrl}`, async () => {
      const connected: ConnectedRepository = connectRepository({
        provider: CodeRepositoryType.Git,
        repository: {
          organizationName: repositoryUrl
            .substring("https://tfs.example.com/".length)
            .replace("/checkout", ""),
          repositoryUrl: OneUptimeURL.fromString(repositoryUrl),
        },
        connection: { hostUrl: "https://tfs.example.com" },
        routes: [items({ "/src/Program.cs": "class Program {}\n" })],
      });
      const reader: CodeHostReader = await readerOf();

      expect(reader.canReadCode).toBe(true);
      await expect(reader.getTreePaths("main")).resolves.toEqual([
        "src/Program.cs",
      ]);
      expect(new URL(connected.host.requests[0]!.url).pathname).toBe(
        `${new URL(repositoryUrl).pathname.replace("/_git/checkout", "")}/_apis/git/repositories/checkout/items`,
      );
      expect(
        reader.getFileWebUrl({ path: "src/Program.cs", lineNumber: 7 }),
      ).toBe(`${repositoryUrl}?path=%2Fsrc%2FProgram.cs&version=GBmain&line=7`);
    });
  }
});

describe("a Git repository anywhere else", () => {
  test("is not read: the reader says why, and asks its server nothing", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.Git,
      repository: {
        organizationName: "team",
        repositoryUrl: OneUptimeURL.fromString(
          "https://git.example.com/team/checkout.git",
        ),
      },
      connection: { hostUrl: "https://git.example.com" },
      routes: [items({ "/src/app.ts": "export {};\n" })],
    });
    const reader: CodeHostReader = await readerOf();

    expect(reader.canReadCode).toBe(false);
    // Its branches are read with Git's own protocol.
    expect(reader.canListBranches).toBe(true);
    await expect(reader.getTreePaths("main")).rejects.toThrow(
      new CodeHostUnavailableError(
        "OneUptime cannot read the files in a Git repository.",
      ),
    );
    await expect(
      reader.getFileContent({ filePath: "src/app.ts", branchName: "main" }),
    ).rejects.toThrow("OneUptime cannot read the files in a Git repository.");
    expect(reader.getFileWebUrl({ path: "src/app.ts" })).toBeNull();
    expect(connected.host.requests).toHaveLength(0);
  });

  test("on Azure DevOps too, a server only a project Runner reaches is not read from OneUptime's server", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.Git,
      connection: { isReachableFromServer: false },
      routes: [items({ "/src/app.ts": "export {};\n" })],
    });
    const reader: CodeHostReader = await readerOf();

    expect(reader.canReadCode).toBe(false);
    expect(reader.canListBranches).toBe(false);
    await expect(reader.getTreePaths("main")).rejects.toThrow(
      "OneUptime does not reach this repository's server: only a Runner of the project's own on its network works in it.",
    );
    await expect(
      reader.getFileContent({ filePath: "src/app.ts", branchName: "main" }),
    ).rejects.toThrow(CodeHostUnavailableError);
    expect(connected.host.requests).toHaveLength(0);
  });
});

describe("a refusal", () => {
  test("of a file read by Azure DevOps fails that read and marks nothing: AI keeps working in the repository", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.Git,
      routes: [
        {
          method: "GET",
          path: "/items",
          answer: (): FakeAnswer => {
            return { status: 401, text: "" };
          },
        },
      ],
    });
    const reader: CodeHostReader = await readerOf();

    await expect(reader.getTreePaths("main")).rejects.toMatchObject({
      kind: CodeHostHttpErrorKind.Unauthorized,
    });
    await expect(
      reader.getFileContent({ filePath: "src/app.ts", branchName: "main" }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Unauthorized });
    expect(connected.refused()).toBe(0);
  });

  test("of Git itself still marks the connection refused, as it did", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.Git,
      routes: [
        {
          method: "GET",
          path: /\/info\/refs$/,
          answer: (): FakeAnswer => {
            return { status: 401, text: "" };
          },
        },
      ],
    });
    const reader: CodeHostReader = await readerOf();

    await expect(reader.listBranchNames({ limit: 10 })).rejects.toMatchObject({
      kind: CodeHostHttpErrorKind.Unauthorized,
    });
    expect(connected.refused()).toBe(1);
    expect(new URL(connected.host.requests[0]!.url).pathname).toBe(
      "/acme/Shop/_git/checkout/info/refs",
    );
  });
});
