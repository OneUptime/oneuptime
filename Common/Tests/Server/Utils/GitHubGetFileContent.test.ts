import GitHubUtil, {
  GitHubFileContent,
} from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * getFileContent reads one file over the GitHub Contents API with no clone —
 * the primitive that makes reading code viable from a request-scoped caller
 * (the chat toolbox has a 45s per-tool timeout a clone cannot fit).
 *
 * The subtle contract these lock in: GitHub returns `content: ""` for BOTH a
 * legitimately empty 0-byte file AND a blob it refuses to inline (>1MB). Only
 * the `encoding` field tells them apart ("base64" vs "none"). Keying off the
 * empty string alone reports every empty file as "too large".
 */

const ARGS: {
  installationId: string;
  organizationName: string;
  repositoryName: string;
  branchName: string;
  filePath: string;
} = {
  installationId: "12345",
  organizationName: "acme",
  repositoryName: "checkout",
  branchName: "main",
  filePath: "src/billing/charge.ts",
};

function mockContentsResponse(data: JSONObject): void {
  jest
    .spyOn(API, "get")
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, data, {}));
}

beforeEach(() => {
  // Token minting is exercised elsewhere; keep these tests to the read path.
  jest
    .spyOn(GitHubUtil, "getInstallationAccessToken")
    .mockResolvedValue({ token: "t", expiresAt: new Date() });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GitHubUtil.getFileContent", () => {
  test("decodes a base64 file and counts its lines", async () => {
    mockContentsResponse({
      type: "file",
      size: 12,
      encoding: "base64",
      content: Buffer.from("alpha\nbravo\n").toString("base64"),
      html_url: "https://github.com/acme/checkout/blob/main/x.ts",
    });

    const file: GitHubFileContent | null =
      await GitHubUtil.getFileContent(ARGS);

    expect(file).not.toBeNull();
    expect(file!.content).toBe("alpha\nbravo\n");
    // A trailing newline must not invent a phantom third line.
    expect(file!.totalLines).toBe(2);
  });

  test("strips the newlines GitHub embeds in the base64 payload", async () => {
    const encoded: string = Buffer.from("hello world").toString("base64");

    mockContentsResponse({
      type: "file",
      size: 11,
      encoding: "base64",
      // GitHub wraps base64 at 60 chars; a naive decode would corrupt it.
      content: `${encoded.slice(0, 4)}\n${encoded.slice(4)}\n`,
      html_url: "",
    });

    const file: GitHubFileContent | null =
      await GitHubUtil.getFileContent(ARGS);

    expect(file!.content).toBe("hello world");
  });

  test("an empty 0-byte file reads as empty, NOT as too large", async () => {
    mockContentsResponse({
      type: "file",
      size: 0,
      encoding: "base64",
      content: "",
      html_url: "",
    });

    const file: GitHubFileContent | null =
      await GitHubUtil.getFileContent(ARGS);

    expect(file).not.toBeNull();
    expect(file!.content).toBe("");
    expect(file!.totalLines).toBe(0);
  });

  test("a blob GitHub refuses to inline is reported as too large", async () => {
    mockContentsResponse({
      type: "file",
      size: 3151774,
      encoding: "none",
      content: "",
      html_url: "",
    });

    await expect(GitHubUtil.getFileContent(ARGS)).rejects.toThrow(
      /too large for GitHub to return inline/,
    );
  });

  test("a missing path returns null so the caller can self-correct", async () => {
    jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPErrorResponse(404, { message: "Not Found" }, {}),
      );

    await expect(GitHubUtil.getFileContent(ARGS)).resolves.toBeNull();
  });

  test("a directory returns null rather than mojibake", async () => {
    jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          [{ type: "file", name: "a.ts" }] as unknown as JSONObject,
          {},
        ),
      );

    await expect(GitHubUtil.getFileContent(ARGS)).resolves.toBeNull();
  });

  test("a binary file returns null rather than wasting context", async () => {
    mockContentsResponse({
      type: "file",
      size: 4,
      encoding: "base64",
      content: Buffer.from([0x89, 0x50, 0x00, 0x47]).toString("base64"),
      html_url: "",
    });

    await expect(GitHubUtil.getFileContent(ARGS)).resolves.toBeNull();
  });

  test("a submodule/symlink entry returns null", async () => {
    mockContentsResponse({
      type: "submodule",
      size: 0,
      content: "",
      html_url: "",
    });

    await expect(GitHubUtil.getFileContent(ARGS)).resolves.toBeNull();
  });

  test("path segments are encoded without destroying the separators", async () => {
    const spy: jest.SpiedFunction<typeof API.get> = jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          {
            type: "file",
            size: 1,
            encoding: "base64",
            content: Buffer.from("x").toString("base64"),
            html_url: "",
          },
          {},
        ),
      );

    await GitHubUtil.getFileContent({
      ...ARGS,
      filePath: "src/my folder/charge spec.ts",
    });

    const calledUrl: string = (
      spy.mock.calls[0]![0] as { url: { toString: () => string } }
    ).url.toString();

    // Slashes stay slashes; spaces get encoded.
    expect(calledUrl).toContain("/contents/src/my%20folder/charge%20spec.ts");
    expect(calledUrl).not.toContain("%2F");
  });
});
