import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CodeHostHttp, {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
  CodeHostHttpRequest,
  CodeHostHttpResponse,
  CodeHostTransport,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import GitSmartHttp, {
  GIT_UPLOAD_PACK_ADVERTISEMENT,
  GitRefAdvertisement,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/GitSmartHttp";
import {
  LocalGitHttpServer,
  canRunLocalGitHttpServer,
  startLocalGitHttpServer,
} from "./LocalGitHttpServer";

/*
 * A plain Git repository is read with Git's own protocol: the refs a clone
 * starts from, which check the address and the credentials when it is
 * connected and list its branches for Code's branch picker. Against a real
 * Git server (git http-backend, behind Basic authentication) and against
 * the answers servers give that are not a Git repository's.
 */

/*
 * Common's suites run under jsdom, where jest resolves axios to its browser
 * build - whose `http` adapter is a placeholder. The transport names the
 * Node adapter (production runs in Node), so give it the Node build.
 */
jest.mock("axios", () => {
  return jest.requireActual("axios/dist/node/axios.cjs");
});

const describeWithGit: typeof describe.skip = canRunLocalGitHttpServer()
  ? describe
  : describe.skip;

describeWithGit("against a real Git server", () => {
  let server: LocalGitHttpServer;

  beforeAll(async () => {
    server = await startLocalGitHttpServer();
  });

  afterAll(async () => {
    await server.close();
  });

  const reader: (password?: string) => GitSmartHttp = (
    password?: string,
  ): GitSmartHttp => {
    return new GitSmartHttp({
      cloneUrl: server.cloneUrl,
      username: server.username,
      password: password ?? server.password,
      transport: CodeHostHttp.createUnguardedTransportForTests(),
      backOff: async (): Promise<void> => {
        // No waiting in tests.
      },
    });
  };

  test("reads every branch, with its head, and the one HEAD points at", async () => {
    const refs: GitRefAdvertisement = await reader().getRefs();
    const onDisk: Record<string, string> = server.readRefs();

    expect(refs.defaultBranch).toBe("main");
    expect(
      refs.branches
        .map((branch: { name: string }): string => {
          return branch.name;
        })
        .sort(),
    ).toEqual(["feature/login", "main"]);

    for (const branch of refs.branches) {
      expect(branch.sha).toBe(onDisk[`refs/heads/${branch.name}`]);
    }

    // One request, the one every clone starts with.
    expect(server.requests[server.requests.length - 1]).toBe(
      "GET /team/app.git/info/refs?service=git-upload-pack",
    );
  });

  test("lists branch names for the picker, a search narrowing them by their start", async () => {
    const all: { names: Array<string>; isComplete: boolean } =
      await reader().listBranchNames({ limit: 50 });

    expect(all.names.sort()).toEqual(["feature/login", "main"]);
    expect(all.isComplete).toBe(true);

    const found: { names: Array<string>; isComplete: boolean } =
      await reader().listBranchNames({ search: "feat", limit: 50 });

    expect(found.names).toEqual(["feature/login"]);

    const capped: { names: Array<string>; isComplete: boolean } =
      await reader().listBranchNames({ limit: 1 });

    expect(capped.names).toHaveLength(1);
    expect(capped.isComplete).toBe(false);
  });

  test("reads one branch's head, and none for a branch it does not have", async () => {
    const branch: { name: string; headSha: string } | null =
      await reader().getBranch("main");

    expect(branch?.headSha).toBe(server.readRefs()["refs/heads/main"]);
    expect(await reader().getBranch("nope")).toBeNull();
  });

  test("a refused password is a credential refusal that never says the password", async () => {
    let caught: unknown = null;

    try {
      await reader("wrong-password-1234").getRefs();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CodeHostHttpError);
    expect((caught as CodeHostHttpError).kind).toBe(
      CodeHostHttpErrorKind.Unauthorized,
    );
    expect((caught as CodeHostHttpError).isCredentialRefusal()).toBe(true);
    expect((caught as Error).message).toContain("127.0.0.1");
    expect((caught as Error).message).not.toContain("wrong-password-1234");
    expect((caught as Error).message).not.toContain(server.password);
  });

  test("a repository the address does not name is NotFound, in plain words", async () => {
    const missing: GitSmartHttp = new GitSmartHttp({
      cloneUrl: `${server.origin}/team/nope.git`,
      username: server.username,
      password: server.password,
      transport: CodeHostHttp.createUnguardedTransportForTests(),
      backOff: async (): Promise<void> => {
        // No waiting in tests.
      },
    });

    await expect(missing.getRefs()).rejects.toMatchObject({
      kind: CodeHostHttpErrorKind.NotFound,
    });
  });

  test("the production transport never reaches it: 127.0.0.1 is loopback, refused on every installation", async () => {
    const guarded: GitSmartHttp = new GitSmartHttp({
      cloneUrl: server.cloneUrl,
      username: server.username,
      password: server.password,
      transport: CodeHostHttp.createTransport({ allowHttp: true }),
      backOff: async (): Promise<void> => {
        // No waiting in tests.
      },
    });
    const before: number = server.requests.length;

    await expect(guarded.getRefs()).rejects.toMatchObject({
      kind: CodeHostHttpErrorKind.NotAllowed,
    });
    // Nothing was sent.
    expect(server.requests.length).toBe(before);
  });
});

describe("answers that are not a Git repository's", () => {
  const answering: (
    response: Partial<CodeHostHttpResponse>,
    seen?: Array<CodeHostHttpRequest>,
  ) => CodeHostTransport = (
    response: Partial<CodeHostHttpResponse>,
    seen?: Array<CodeHostHttpRequest>,
  ): CodeHostTransport => {
    return async (
      request: CodeHostHttpRequest,
    ): Promise<CodeHostHttpResponse> => {
      seen?.push(request);

      return {
        statusCode: 200,
        bodyText: "",
        bodyJson: undefined,
        headers: {},
        ...response,
      };
    };
  };

  const reading: (transport: CodeHostTransport) => GitSmartHttp = (
    transport: CodeHostTransport,
  ): GitSmartHttp => {
    return new GitSmartHttp({
      cloneUrl: "https://git.example.com/team/app.git",
      username: "deploy",
      password: "token-abcdef",
      transport,
      backOff: async (): Promise<void> => {
        // No waiting in tests.
      },
    });
  };

  test("asks as git does, signed in with Basic authentication", async () => {
    const seen: Array<CodeHostHttpRequest> = [];

    await reading(
      answering(
        {
          headers: { "content-type": GIT_UPLOAD_PACK_ADVERTISEMENT },
          bodyText: "001e# service=git-upload-pack\n0000",
        },
        seen,
      ),
    ).getRefs();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("GET");
    expect(seen[0]!.url).toBe(
      "https://git.example.com/team/app.git/info/refs?service=git-upload-pack",
    );
    expect(seen[0]!.headers["Authorization"]).toBe(
      `Basic ${Buffer.from("deploy:token-abcdef").toString("base64")}`,
    );
    expect(seen[0]!.headers["User-Agent"]).toMatch(/^git\//);
  });

  test("a redirect is not followed, and says to use the clone address", async () => {
    await expect(
      reading(
        answering({ statusCode: 302, headers: { location: "https://x" } }),
      ).getRefs(),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Rejected });
  });

  test("a web page is not a repository", async () => {
    await expect(
      reading(
        answering({
          headers: { "content-type": "text/html" },
          bodyText: "<html>Sign in</html>",
        }),
      ).getRefs(),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.BadResponse });
  });

  test("a dumb server's info/refs is read too, with no HEAD", async () => {
    const sha: string = "a".repeat(40);
    const refs: GitRefAdvertisement = await reading(
      answering({
        headers: { "content-type": "text/plain" },
        bodyText: `${sha}\trefs/heads/main\n${sha}\trefs/tags/v1\n`,
      }),
    ).getRefs();

    expect(refs).toEqual({
      defaultBranch: null,
      branches: [{ name: "main", sha }],
    });
  });

  test("a smart advertisement is read by its lengths, its capabilities after the NUL", () => {
    const sha: string = "b".repeat(40);
    const pkt: (text: string) => string = (text: string): string => {
      return `${(Buffer.byteLength(text) + 4).toString(16).padStart(4, "0")}${text}`;
    };
    const body: string = [
      pkt("# service=git-upload-pack\n"),
      "0000",
      pkt(`${sha} HEAD\0multi_ack symref=HEAD:refs/heads/trunk agent=git/2\n`),
      pkt(`${sha} refs/heads/trunk\n`),
      pkt(`${sha} refs/heads/ünïcode\n`),
      pkt(`${sha} refs/tags/v1\n`),
      "0000",
    ].join("");

    expect(GitSmartHttp.parseSmartAdvertisement(body)).toEqual({
      defaultBranch: "trunk",
      branches: [
        { name: "trunk", sha },
        { name: "ünïcode", sha },
      ],
    });

    // A cut-off or garbled body ends the read, keeping what came before.
    expect(
      GitSmartHttp.parseSmartAdvertisement(`${pkt(`${sha} refs/heads/a\n`)}zz`)
        .branches,
    ).toEqual([{ name: "a", sha }]);
  });
});
