import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import CodeHostWriters, {
  CodeHostWriter,
  CodeHostWriterResult,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostWriter";
import {
  CodeHostFileBlob,
  CodeHostFileContent,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import CodeHostAccess, {
  CodeHostReader,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import GitHubUtil, {
  GitHubFileBlob,
  GitHubFileContent,
} from "../../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import API, { APIRequestOptions } from "../../../../../Utils/API";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import {
  CONNECTED_PROJECT_ID,
  CONNECTED_REPOSITORY_ID,
  ConnectedRepository,
  connectRepository,
  disconnectRepository,
} from "./ConnectedRepository";
import { FakeRoute } from "./FakeCodeHost";

/*
 * ISSUE #6313: WHAT IS AT A PATH ON A BRANCH, AS A COMMIT THERE WOULD FIND
 * IT - on every host chat writes to.
 *
 * A commit Ask AI wrote from an older read of a file says so before it is
 * approved, so each host tells OneUptime the git blob SHA of the file at
 * each path the commit writes: GitHub's Contents API (one token for every
 * path), GitLab's file API (blob_id), Forgejo's and Gitea's contents API
 * (sha). No file there is null; anything else that stops the read is said,
 * per path, and never stops the others. A file read for the model carries
 * its blob too, from the same answer.
 */

const BLOB: string = "ce013625030ba8dba906f756967f9e9ca394464a";
const OTHER_BLOB: string = "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0";

type ApiGet = (options: APIRequestOptions) => ReturnType<typeof API.get>;

describe("GitHub", () => {
  let tokenSpy: SpyInstance<typeof GitHubUtil.getInstallationAccessToken>;
  let getSpy: SpyInstance<ApiGet>;
  // Each address GitHub was asked, and what it answers there.
  let answers: Map<string, HTTPResponse<JSONObject> | HTTPErrorResponse | Error>;

  beforeEach(() => {
    answers = new Map();
    tokenSpy = jest
      .spyOn(GitHubUtil, "getInstallationAccessToken")
      .mockResolvedValue({
        token: "ghs_token",
        expiresAt: new Date("2030-01-01T00:00:00Z"),
      } as never);
    getSpy = jest.spyOn(API, "get").mockImplementation((async (
      options: APIRequestOptions,
    ) => {
      const answer: HTTPResponse<JSONObject> | HTTPErrorResponse | Error | undefined =
        answers.get(options.url.toString());

      if (answer instanceof Error) {
        throw answer;
      }

      return answer || new HTTPErrorResponse(404, { message: "Not Found" }, {});
    }) as never) as never;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const contentsUrl: (path: string, ref: string) => string = (
    path: string,
    ref: string,
  ): string => {
    return `https://api.github.com/repos/acme/checkout/contents/${path}?ref=${ref}`;
  };

  test("each path's blob on the branch, read with one token, each path's pieces and the branch encoded", async () => {
    answers.set(
      contentsUrl("src/a.ts", "fix%2Flogin"),
      new HTTPResponse(200, { type: "file", sha: BLOB, content: "" }, {}),
    );
    answers.set(
      contentsUrl("docs/My%20File%20%23.md", "fix%2Flogin"),
      new HTTPResponse(200, { type: "file", sha: OTHER_BLOB }, {}),
    );

    const blobs: Array<GitHubFileBlob> = await GitHubUtil.getFileBlobShas({
      installationId: "4242",
      organizationName: "acme",
      repositoryName: "checkout",
      branchName: "fix/login",
      filePaths: ["src/a.ts", "docs/My File #.md", "src/new.ts"],
    });

    expect(blobs).toEqual([
      { filePath: "src/a.ts", blobSha: BLOB },
      { filePath: "docs/My File #.md", blobSha: OTHER_BLOB },
      { filePath: "src/new.ts", blobSha: null },
    ]);
    expect(tokenSpy).toHaveBeenCalledTimes(1);
    expect(tokenSpy.mock.calls[0]![1]).toEqual({
      permissions: { contents: "read", metadata: "read" },
    });
    expect(getSpy).toHaveBeenCalledTimes(3);
    expect(
      (getSpy.mock.calls[0]![0] as APIRequestOptions).headers?.["Authorization"],
    ).toBe("Bearer ghs_token");
  });

  test("a folder, an error answer, a thrown read, and an answer that names no version: each says why, and the others are read", async () => {
    answers.set(
      contentsUrl("src", "main"),
      new HTTPResponse(200, [{ name: "a.ts" }] as unknown as JSONObject, {}),
    );
    answers.set(
      contentsUrl("src/big.bin", "main"),
      new HTTPErrorResponse(403, { message: "too_large" }, {}),
    );
    answers.set(contentsUrl("src/down.ts", "main"), new Error("socket hang up"));
    answers.set(
      contentsUrl("src/odd.ts", "main"),
      new HTTPResponse(200, { type: "file" }, {}),
    );
    answers.set(
      contentsUrl("src/a.ts", "main"),
      new HTTPResponse(200, { type: "file", sha: BLOB }, {}),
    );

    const blobs: Array<GitHubFileBlob> = await GitHubUtil.getFileBlobShas({
      installationId: "4242",
      organizationName: "acme",
      repositoryName: "checkout",
      branchName: "main",
      filePaths: ["src", "src/big.bin", "src/down.ts", "src/odd.ts", "src/a.ts"],
    });

    expect(blobs).toEqual([
      { filePath: "src", failure: "It is a folder on GitHub." },
      { filePath: "src/big.bin", failure: "GitHub answered 403 for it." },
      { filePath: "src/down.ts", failure: "GitHub could not be reached." },
      { filePath: "src/odd.ts", failure: "GitHub did not say which version it is." },
      { filePath: "src/a.ts", blobSha: BLOB },
    ]);
    // Nothing of the failure's own words reaches the model.
    expect(JSON.stringify(blobs)).not.toContain("socket");
  });

  test("no paths: no token minted, nothing asked", async () => {
    expect(
      await GitHubUtil.getFileBlobShas({
        installationId: "4242",
        organizationName: "acme",
        repositoryName: "checkout",
        branchName: "main",
        filePaths: [],
      }),
    ).toEqual([]);
    expect(tokenSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
  });

  test("a file read for the model carries its blob, from the same answer", async () => {
    answers.set(
      contentsUrl("src/a.ts", "main"),
      new HTTPResponse(
        200,
        {
          type: "file",
          sha: BLOB,
          size: 6,
          encoding: "base64",
          content: Buffer.from("hello\n").toString("base64"),
          html_url: "https://github.com/acme/checkout/blob/main/src/a.ts",
        },
        {},
      ),
    );

    const file: GitHubFileContent | null = await GitHubUtil.getFileContent({
      installationId: "4242",
      organizationName: "acme",
      repositoryName: "checkout",
      branchName: "main",
      filePath: "src/a.ts",
    });

    expect(file).toEqual({
      content: "hello\n",
      filePath: "src/a.ts",
      sizeInBytes: 6,
      totalLines: 1,
      htmlUrl: "https://github.com/acme/checkout/blob/main/src/a.ts",
      blobSha: BLOB,
    });
  });

  test("an answer that names no blob reads as it always did", async () => {
    answers.set(
      contentsUrl("src/a.ts", "main"),
      new HTTPResponse(
        200,
        {
          type: "file",
          size: 6,
          encoding: "base64",
          content: Buffer.from("hello\n").toString("base64"),
        },
        {},
      ),
    );

    const file: GitHubFileContent | null = await GitHubUtil.getFileContent({
      installationId: "4242",
      organizationName: "acme",
      repositoryName: "checkout",
      branchName: "main",
      filePath: "src/a.ts",
    });

    expect(file).not.toHaveProperty("blobSha");
    expect(file!.content).toBe("hello\n");
  });

  test("the writer reads through the installation, for the branch it is asked", async () => {
    const shas: SpyInstance<typeof GitHubUtil.getFileBlobShas> = jest
      .spyOn(GitHubUtil, "getFileBlobShas")
      .mockResolvedValue([{ filePath: "a.ts", blobSha: BLOB }]);
    const writer: CodeHostWriter = CodeHostWriters.gitHub({
      installationId: "4242",
      organizationName: "acme",
      repositoryName: "checkout",
    });

    expect(
      await writer.getFileBlobShas({ branchName: "feature", filePaths: ["a.ts"] }),
    ).toEqual([{ filePath: "a.ts", blobSha: BLOB }]);
    expect(shas).toHaveBeenCalledWith({
      installationId: "4242",
      organizationName: "acme",
      repositoryName: "checkout",
      branchName: "feature",
      filePaths: ["a.ts"],
    });
  });
});

async function openConnected(): Promise<CodeHostWriter> {
  const opened: CodeHostWriterResult = await CodeHostWriters.openForRepository({
    projectId: CONNECTED_PROJECT_ID,
    repositoryId: CONNECTED_REPOSITORY_ID,
  });

  expect(opened.gap).toBeNull();

  return opened.writer!;
}

async function openReader(): Promise<CodeHostReader> {
  const reader: CodeHostReader | null = await CodeHostAccess.getReader({
    projectId: CONNECTED_PROJECT_ID,
    repositoryId: CONNECTED_REPOSITORY_ID,
  });

  expect(reader).not.toBeNull();

  return reader!;
}

describe("GitLab", () => {
  afterEach(() => {
    disconnectRepository();
  });

  const project: FakeRoute = {
    method: "GET",
    path: "/projects/4217",
    answer: () => {
      return {
        json: {
          id: 4217,
          path: "checkout",
          path_with_namespace: "acme/checkout",
          default_branch: "main",
        },
      };
    },
  };

  const files: FakeRoute = {
    method: "GET",
    path: /^\/projects\/4217\/repository\/files\/.+$/,
    answer: (_request: unknown, url: URL) => {
      const path: string = decodeURIComponent(
        url.pathname.replace(/^.*\/repository\/files\//, ""),
      );
      const ref: string | null = url.searchParams.get("ref");

      if (path === "src/a.ts" && ref === "fix/login") {
        return {
          json: {
            file_path: "src/a.ts",
            size: 6,
            encoding: "base64",
            content: Buffer.from("hello\n").toString("base64"),
            blob_id: BLOB,
            last_commit_id: "c".repeat(40),
          },
        };
      }

      if (path === "src/forbidden.ts") {
        return { status: 403, json: { message: "403 Forbidden" } };
      }

      if (path === "src/odd.ts") {
        return { json: { file_path: "src/odd.ts" } };
      }

      return { status: 404, json: { message: "404 File Not Found" } };
    },
  };

  test("each path's blob_id, null where there is no file, the path one piece of the address and the branch its ref", async () => {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: [project, files],
    });
    const writer: CodeHostWriter = await openConnected();

    const blobs: Array<CodeHostFileBlob> = await writer.getFileBlobShas({
      branchName: "fix/login",
      filePaths: ["src/a.ts", "src/new.ts"],
    });

    expect(blobs).toEqual([
      { filePath: "src/a.ts", blobSha: BLOB },
      { filePath: "src/new.ts", blobSha: null },
    ]);
    const asked: Array<string> = connected.host.requests
      .map((request: { url: string }): string => {
        return request.url;
      })
      .filter((url: string): boolean => {
        return url.includes("/repository/files/");
      });
    expect(asked).toEqual([
      "https://gitlab.example.com/api/v4/projects/4217/repository/files/src%2Fa.ts?ref=fix%2Flogin",
      "https://gitlab.example.com/api/v4/projects/4217/repository/files/src%2Fnew.ts?ref=fix%2Flogin",
    ]);
  });

  test("a refusal or an answer without a blob is said for its path, and the others still read", async () => {
    connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: [project, files],
    });
    const writer: CodeHostWriter = await openConnected();

    const blobs: Array<CodeHostFileBlob> = await writer.getFileBlobShas({
      branchName: "fix/login",
      filePaths: ["src/forbidden.ts", "src/odd.ts", "src/a.ts"],
    });

    expect(blobs[0]!.filePath).toBe("src/forbidden.ts");
    expect((blobs[0] as { failure: string }).failure).toMatch(
      /^GitLab did not let the access token do this/,
    );
    expect(blobs[1]!.filePath).toBe("src/odd.ts");
    expect((blobs[1] as { failure: string }).failure).toBeTruthy();
    expect(blobs[2]).toEqual({ filePath: "src/a.ts", blobSha: BLOB });
  });

  test("a file read for the model carries its blob_id", async () => {
    connectRepository({
      provider: CodeRepositoryType.GitLab,
      routes: [project, files],
    });
    const reader: CodeHostReader = await openReader();

    const file: CodeHostFileContent | null = await reader.getFileContent({
      filePath: "src/a.ts",
      branchName: "fix/login",
    });

    expect(file!.content).toBe("hello\n");
    expect(file!.blobSha).toBe(BLOB);
  });
});

describe("Forgejo and Gitea", () => {
  afterEach(() => {
    disconnectRepository();
  });

  const routes: Array<FakeRoute> = [
    {
      method: "GET",
      path: "/repos/acme/checkout",
      answer: () => {
        return {
          json: {
            id: 7,
            name: "checkout",
            full_name: "acme/checkout",
            default_branch: "main",
            owner: { login: "acme" },
          },
        };
      },
    },
    {
      method: "GET",
      path: /^\/repos\/acme\/checkout\/contents\/.+$/,
      answer: (_request: unknown, url: URL) => {
        const path: string = decodeURIComponent(
          url.pathname.replace(/^.*\/contents\//, ""),
        );

        if (path === "src/a.ts") {
          return {
            json: {
              type: "file",
              path: "src/a.ts",
              sha: BLOB,
              size: 6,
              content: Buffer.from("hello\n").toString("base64"),
              html_url: "https://git.example.com/acme/checkout/src/branch/main/src/a.ts",
            },
          };
        }

        if (path === "src") {
          return { json: [{ type: "file", path: "src/a.ts" }] };
        }

        return { status: 404, json: { message: "file does not exist" } };
      },
    },
  ];

  test("each path's sha, null where there is no file, and a folder said to be one", async () => {
    connectRepository({ provider: CodeRepositoryType.Forgejo, routes });
    const writer: CodeHostWriter = await openConnected();

    const blobs: Array<CodeHostFileBlob> = await writer.getFileBlobShas({
      branchName: "main",
      filePaths: ["src/a.ts", "src/new.ts", "src"],
    });

    expect(blobs[0]).toEqual({ filePath: "src/a.ts", blobSha: BLOB });
    expect(blobs[1]).toEqual({ filePath: "src/new.ts", blobSha: null });
    expect(blobs[2]).toEqual({
      filePath: "src",
      failure: "src is a folder in the repository, not a file.",
    });
  });

  test("a file read for the model carries its sha", async () => {
    connectRepository({ provider: CodeRepositoryType.Forgejo, routes });
    const reader: CodeHostReader = await openReader();

    const file: CodeHostFileContent | null = await reader.getFileContent({
      filePath: "src/a.ts",
      branchName: "main",
    });

    expect(file!.blobSha).toBe(BLOB);
    expect(file!.content).toBe("hello\n");
  });
});
