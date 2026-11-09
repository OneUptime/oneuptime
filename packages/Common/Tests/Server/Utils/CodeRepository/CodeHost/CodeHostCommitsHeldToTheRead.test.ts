import { describe, expect, test } from "@jest/globals";
import GitLabApi from "../../../../../Server/Utils/CodeRepository/CodeHost/GitLabApi";
import ForgejoApi from "../../../../../Server/Utils/CodeRepository/CodeHost/ForgejoApi";
import CodeHostFilesMovedError from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostFilesMovedError";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import { CodeHostFileVersion } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import { FakeCodeHost, FakeRoute, fakeCodeHost, noWait } from "./FakeCodeHost";

/*
 * ISSUE #6331: A COMMIT HELD TO THE FILES AS THEY WERE READ, ON GITLAB AND
 * ON FORGEJO AND GITEA - against their APIs as they answer.
 *
 *   GitLab          each update names the file's last commit as read
 *                   (last_commit_id), a file read as not there is created,
 *                   and a held file is not looked for again;
 *   Forgejo, Gitea  each update names the blob as read (sha), a file read
 *                   as not there is created, and a held file is not read
 *                   again;
 *
 * and each host's refusal of a file that moved since - changed, made, or
 * deleted - is said as one (CodeHostFilesMovedError), naming the files the
 * commit was held to, while any other refusal is thrown as it always was.
 * A file the commit is not held to is read and written as it always was.
 */

const BLOB: string = "ce013625030ba8dba906f756967f9e9ca394464a";
const LAST_COMMIT: string = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";
const COMMIT: string = "2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c";

function bodyOf(host: FakeCodeHost, path: string): Record<string, unknown> {
  const request: { url: string; body?: string | undefined } | undefined =
    host.requests.find((candidate: { url: string; method: string }) => {
      return candidate.method === "POST" && candidate.url.endsWith(path);
    });

  return JSON.parse(request?.body || "{}") as Record<string, unknown>;
}

describe("GitLab", () => {
  const HOST: string = "https://gitlab.example.com";

  const gitLab: (routes: Array<FakeRoute>) => {
    api: GitLabApi;
    host: FakeCodeHost;
  } = (
    routes: Array<FakeRoute>,
  ): { api: GitLabApi; host: FakeCodeHost } => {
    const host: FakeCodeHost = fakeCodeHost({
      apiBaseUrl: `${HOST}/api/v4`,
      routes,
    });

    return {
      api: new GitLabApi({
        hostUrl: HOST,
        token: "glpat-0123456789abcdefghij",
        transport: host.transport,
        backOff: noWait,
      }),
      host,
    };
  };

  const committed: FakeRoute = {
    method: "POST",
    path: "/projects/4217/repository/commits",
    answer: () => {
      return {
        status: 201,
        json: { id: COMMIT, web_url: `${HOST}/acme/checkout/-/commit/${COMMIT}` },
      };
    },
  };

  const refusing: (message: string, status?: number) => FakeRoute = (
    message: string,
    status: number = 400,
  ): FakeRoute => {
    return {
      method: "POST",
      path: "/projects/4217/repository/commits",
      answer: () => {
        return { status, json: { message } };
      },
    };
  };

  test("a held file is not looked for again: its update names its last commit, a file read as not there is created", async () => {
    const { api, host } = gitLab([committed]);

    await api.commitFiles({
      project: "4217",
      branchName: "fix/login",
      commitMessage: "fix: charge",
      files: [
        { filePath: "src/a.ts", content: "a\n" },
        { filePath: "src/new.ts", content: "n\n" },
      ],
      expected: [
        { filePath: "src/a.ts", blobSha: BLOB, lastCommitId: LAST_COMMIT },
        { filePath: "src/new.ts", blobSha: null },
      ],
    });

    expect(host.urlsTo("/repository/files/src%2Fa.ts")).toHaveLength(0);
    expect(host.urlsTo("/repository/files/src%2Fnew.ts")).toHaveLength(0);
    expect(bodyOf(host, "/repository/commits")).toEqual({
      branch: "fix/login",
      commit_message: "fix: charge",
      actions: [
        {
          action: "update",
          file_path: "src/a.ts",
          content: Buffer.from("a\n", "utf8").toString("base64"),
          encoding: "base64",
          last_commit_id: LAST_COMMIT,
        },
        {
          action: "create",
          file_path: "src/new.ts",
          content: Buffer.from("n\n", "utf8").toString("base64"),
          encoding: "base64",
        },
      ],
    });
  });

  test("a file it is not held to is looked for and written as it always was; one read with no last commit is updated as it always was", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/repository/files/src%2Fb.ts",
        answer: () => {
          return { json: { file_path: "src/b.ts", blob_id: BLOB } };
        },
      },
      committed,
    ]);

    await api.commitFiles({
      project: "4217",
      branchName: "fix/login",
      commitMessage: "m",
      files: [
        { filePath: "src/a.ts", content: "a\n" },
        { filePath: "src/b.ts", content: "b\n" },
      ],
      expected: [{ filePath: "src/a.ts", blobSha: BLOB }],
    });

    expect(host.urlsTo("/repository/files/src%2Fb.ts")).toHaveLength(1);
    expect(
      (bodyOf(host, "/repository/commits")["actions"] as Array<
        Record<string, unknown>
      >).map((action: Record<string, unknown>) => {
        return [action["action"], action["file_path"], action["last_commit_id"]];
      }),
    ).toEqual([
      ["update", "src/a.ts", undefined],
      ["update", "src/b.ts", undefined],
    ]);
  });

  test.each([
    "You are attempting to update a file that has changed since you started editing it.",
    "A file with this name already exists",
    "A file with this name doesn't exist",
  ])("GitLab's refusal %j is a file that moved: refused, naming the files it was held to", async (message: string) => {
    const { api } = gitLab([refusing(message)]);

    const error: unknown = await api
      .commitFiles({
        project: "4217",
        branchName: "fix/login",
        commitMessage: "m",
        files: [
          { filePath: "src/a.ts", content: "a\n" },
          { filePath: "src/new.ts", content: "n\n" },
        ],
        expected: [
          { filePath: "src/a.ts", blobSha: BLOB, lastCommitId: LAST_COMMIT },
          { filePath: "src/new.ts", blobSha: null },
        ],
      })
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(CodeHostFilesMovedError);
    expect((error as CodeHostFilesMovedError).filePaths).toEqual([
      "src/a.ts",
      "src/new.ts",
    ]);
  });

  test("any other refusal, or one of a commit held to nothing, is thrown as it always was", async () => {
    const { api: invalid } = gitLab([refusing("Invalid path")]);

    await expect(
      invalid.commitFiles({
        project: "4217",
        branchName: "b",
        commitMessage: "m",
        files: [{ filePath: "a.ts", content: "" }],
        expected: [{ filePath: "a.ts", blobSha: BLOB }],
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Rejected });

    const { api: unheld } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/repository/files/a.ts",
        answer: () => {
          return { status: 404, json: { message: "404 File Not Found" } };
        },
      },
      refusing("A file with this name already exists"),
    ]);

    const error: unknown = await unheld
      .commitFiles({
        project: "4217",
        branchName: "b",
        commitMessage: "m",
        files: [{ filePath: "a.ts", content: "" }],
      })
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(CodeHostHttpError);
    expect(error).not.toBeInstanceOf(CodeHostFilesMovedError);
  });

  test("a file's version: its blob and the last commit that changed it, from the one answer", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: /^\/projects\/4217\/repository\/files\/.+$/,
        answer: (_request: unknown, url: URL) => {
          if (url.pathname.endsWith("gone.ts")) {
            return { status: 404, json: { message: "404 File Not Found" } };
          }

          if (url.pathname.endsWith("odd.ts")) {
            return { json: { blob_id: BLOB, last_commit_id: "not-a-sha" } };
          }

          return { json: { blob_id: BLOB, last_commit_id: LAST_COMMIT } };
        },
      },
    ]);

    const read: (filePath: string) => Promise<CodeHostFileVersion | null> = (
      filePath: string,
    ): Promise<CodeHostFileVersion | null> => {
      return api.getFileVersion({ project: "4217", ref: "main", filePath });
    };

    expect(await read("src/a.ts")).toEqual({
      blobSha: BLOB,
      lastCommitId: LAST_COMMIT,
    });
    expect(await read("src/gone.ts")).toBeNull();
    expect(await read("src/odd.ts")).toEqual({ blobSha: BLOB });
    expect(
      await api.getFileBlobId({
        project: "4217",
        ref: "main",
        filePath: "src/a.ts",
      }),
    ).toBe(BLOB);
    // One answer each: never a second read for the last commit.
    expect(host.requests).toHaveLength(4);
  });
});

describe("Forgejo and Gitea", () => {
  const HOST: string = "https://git.example.com";

  const forgejo: (routes: Array<FakeRoute>) => {
    api: ForgejoApi;
    host: FakeCodeHost;
  } = (
    routes: Array<FakeRoute>,
  ): { api: ForgejoApi; host: FakeCodeHost } => {
    const host: FakeCodeHost = fakeCodeHost({
      apiBaseUrl: `${HOST}/api/v1`,
      routes,
    });

    return {
      api: new ForgejoApi({
        hostUrl: HOST,
        token: "0123456789abcdef0123456789abcdef01234567",
        transport: host.transport,
        backOff: noWait,
        providerName: "Gitea",
      }),
      host,
    };
  };

  const committed: FakeRoute = {
    method: "POST",
    path: "/repos/acme/checkout/contents",
    answer: () => {
      return {
        status: 201,
        json: { commit: { sha: COMMIT, html_url: `${HOST}/c/${COMMIT}` } },
      };
    },
  };

  const refusing: (message: string, status: number) => FakeRoute = (
    message: string,
    status: number,
  ): FakeRoute => {
    return {
      method: "POST",
      path: "/repos/acme/checkout/contents",
      answer: () => {
        return { status, json: { message } };
      },
    };
  };

  test("a held file is not read again: its update names the blob as read, a file read as not there is created", async () => {
    const { api, host } = forgejo([committed]);

    await api.commitFiles({
      owner: "acme",
      name: "checkout",
      branchName: "fix/login",
      commitMessage: "fix: charge",
      files: [
        { filePath: "src/a.ts", content: "a\n" },
        { filePath: "src/new.ts", content: "n\n" },
      ],
      expected: [
        { filePath: "src/a.ts", blobSha: BLOB },
        { filePath: "src/new.ts", blobSha: null },
      ],
    });

    expect(host.urlsTo("/repos/acme/checkout/contents/src/a.ts")).toHaveLength(
      0,
    );
    expect(bodyOf(host, "/repos/acme/checkout/contents")).toEqual({
      branch: "fix/login",
      message: "fix: charge",
      files: [
        {
          operation: "update",
          path: "src/a.ts",
          content: Buffer.from("a\n", "utf8").toString("base64"),
          sha: BLOB,
        },
        {
          operation: "create",
          path: "src/new.ts",
          content: Buffer.from("n\n", "utf8").toString("base64"),
        },
      ],
    });
  });

  test("a file it is not held to is read for the sha it replaces, as it always was", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/contents/src/b.ts",
        answer: () => {
          return { json: { type: "file", path: "src/b.ts", sha: BLOB } };
        },
      },
      committed,
    ]);

    await api.commitFiles({
      owner: "acme",
      name: "checkout",
      branchName: "fix/login",
      commitMessage: "m",
      files: [{ filePath: "src/b.ts", content: "b\n" }],
    });

    expect(host.urlsTo("/repos/acme/checkout/contents/src/b.ts")).toHaveLength(
      1,
    );
    expect(
      (bodyOf(host, "/repos/acme/checkout/contents")["files"] as Array<
        Record<string, unknown>
      >)[0]!["sha"],
    ).toBe(BLOB);
  });

  test.each<[string, number]>([
    [`sha does not match [given: ${BLOB}, expected: ${COMMIT}]`, 422],
    ["repository file already exists [path: src/new.ts]", 422],
    ["object does not exist [id: , rel_path: src/a.ts]", 404],
    ["repository file already exists [path: src/new.ts]", 409],
  ])(
    "the server's refusal %j (%d) is a file that moved: refused, naming the files it was held to",
    async (message: string, status: number) => {
      const { api } = forgejo([refusing(message, status)]);

      const error: unknown = await api
        .commitFiles({
          owner: "acme",
          name: "checkout",
          branchName: "fix/login",
          commitMessage: "m",
          files: [
            { filePath: "src/a.ts", content: "a\n" },
            { filePath: "src/new.ts", content: "n\n" },
          ],
          expected: [
            { filePath: "src/a.ts", blobSha: BLOB },
            { filePath: "src/new.ts", blobSha: null },
          ],
        })
        .catch((caught: unknown) => {
          return caught;
        });

      expect(error).toBeInstanceOf(CodeHostFilesMovedError);
      expect((error as CodeHostFilesMovedError).filePaths).toEqual([
        "src/a.ts",
        "src/new.ts",
      ]);
      expect((error as Error).message).toMatch(/^Gitea refused the commit/);
    },
  );

  test("a server older than 1.20, which knows no such route, is still said as such - never as a file that moved", async () => {
    const { api } = forgejo([refusing("404 page not found", 404)]);

    await expect(
      api.commitFiles({
        owner: "acme",
        name: "checkout",
        branchName: "fix/login",
        commitMessage: "m",
        files: [{ filePath: "src/a.ts", content: "a\n" }],
        expected: [{ filePath: "src/a.ts", blobSha: BLOB }],
      }),
    ).rejects.toThrow(/needs Forgejo or Gitea 1\.20 or later/);
  });

  test("a refusal of a commit held to nothing is thrown as it always was", async () => {
    const { api } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/contents/src/a.ts",
        answer: () => {
          return { json: { type: "file", path: "src/a.ts", sha: BLOB } };
        },
      },
      refusing("sha does not match [given: x, expected: y]", 422),
    ]);

    const error: unknown = await api
      .commitFiles({
        owner: "acme",
        name: "checkout",
        branchName: "fix/login",
        commitMessage: "m",
        files: [{ filePath: "src/a.ts", content: "a\n" }],
      })
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(CodeHostHttpError);
    expect(error).not.toBeInstanceOf(CodeHostFilesMovedError);
  });
});
