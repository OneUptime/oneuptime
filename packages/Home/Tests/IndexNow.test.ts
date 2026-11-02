import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_HOST,
  INDEXNOW_KEY,
  INDEXNOW_KEY_PATH,
  INDEXNOW_MAX_URLS_PER_REQUEST,
  INDEXNOW_TIMEOUT_IN_MS,
  IndexNowRequest,
  getIndexNowRequests,
  getPostPageUrls,
  getPostsInChangedFiles,
  notifyIndexNowOfChangedPosts,
  sendIndexNowRequest,
} from "../Utils/IndexNow";

/*
 * IndexNow notices of the blog's changed posts (Utils/IndexNow.ts): Bing -
 * whose index grounds Copilot's answers - and the other engines that take
 * part crawl a post soon after it changes, rather than whenever they next
 * come by. The UpdateBlog job sends them (UpdateBlogJob.test.ts).
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
  };
});

const urls: (count: number) => Array<string> = (
  count: number,
): Array<string> => {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return `https://oneuptime.com/blog/post/post-${index}/view`;
  });
};

const changedPostFiles: (count: number) => Array<string> = (
  count: number,
): Array<string> => {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return `posts/post-${index}/README.md`;
  });
};

// A stand-in for sendIndexNowRequest that answers every request with `status`.
const senderAnswering: (
  status: number,
) => jest.Mock<Promise<number>, [IndexNowRequest]> = (
  status: number,
): jest.Mock<Promise<number>, [IndexNowRequest]> => {
  return jest.fn(async (_request: IndexNowRequest): Promise<number> => {
    return status;
  });
};

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the key", () => {
  // IndexNow takes a key of 8 to 128 letters, digits and dashes.
  test("is one IndexNow takes", () => {
    expect(INDEXNOW_KEY).toMatch(/^[a-zA-Z0-9-]{8,128}$/);
  });

  test("is served at /<key>.txt, where the notices say it is", () => {
    expect(INDEXNOW_KEY_PATH).toBe(`/${INDEXNOW_KEY}.txt`);
    expect(getIndexNowRequests(INDEXNOW_HOST, urls(1))[0]?.keyLocation).toBe(
      `https://oneuptime.com/${INDEXNOW_KEY}.txt`,
    );
  });

  test("is the one the deployed site's E2E check asks for", () => {
    const spec: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "E2E",
        "Tests",
        "Home",
        "BlogForAgents.spec.ts",
      ),
      "utf-8",
    );

    expect(spec).toContain(`const INDEXNOW_KEY: string = "${INDEXNOW_KEY}";`);
  });
});

describe("getPostsInChangedFiles", () => {
  test("is each post a changed file belongs to, once, in the order they came", () => {
    expect(
      getPostsInChangedFiles([
        "posts/2026-09-29-b/README.md",
        "posts/2026-09-29-a/README.md",
        "posts/2026-09-29-b/validation.json",
        "posts/2026-09-29-a/social-media.png",
        "posts/2026-09-29-c/images/diagram.png",
      ]),
    ).toEqual(["2026-09-29-b", "2026-09-29-a", "2026-09-29-c"]);
  });

  test("leaves out what is no post's: the blog's own files, and other folders", () => {
    expect(
      getPostsInChangedFiles([
        "Blogs.json",
        "README.md",
        "posts/README.md",
        "posts/2026-09-29-a/",
        "src/scripts/validate-posts.ts",
        "drafts/2026-09-29-a/README.md",
      ]),
    ).toEqual([]);
  });

  test("is nothing when nothing changed", () => {
    expect(getPostsInChangedFiles([])).toEqual([]);
  });
});

describe("getPostPageUrls", () => {
  test("is each post's page on the host", () => {
    expect(
      getPostPageUrls("oneuptime.com", ["2026-09-29-train-shadow-commander"]),
    ).toEqual([
      "https://oneuptime.com/blog/post/2026-09-29-train-shadow-commander/view",
    ]);
  });

  test("percent-encodes a post's name that a URL path cannot carry as it is", () => {
    expect(getPostPageUrls("oneuptime.com", ["2026-09-29-日本語"])).toEqual([
      "https://oneuptime.com/blog/post/2026-09-29-%E6%97%A5%E6%9C%AC%E8%AA%9E/view",
    ]);
  });
});

describe("getIndexNowRequests", () => {
  test("is one request naming the host, the key and where the key is", () => {
    expect(getIndexNowRequests("oneuptime.com", urls(2))).toEqual([
      {
        host: "oneuptime.com",
        key: INDEXNOW_KEY,
        keyLocation: `https://oneuptime.com${INDEXNOW_KEY_PATH}`,
        urlList: urls(2),
      },
    ]);
  });

  test("splits more URLs than one request takes, keeping their order", () => {
    const all: Array<string> = urls(INDEXNOW_MAX_URLS_PER_REQUEST * 2 + 1);
    const requests: Array<IndexNowRequest> = getIndexNowRequests(
      "oneuptime.com",
      all,
    );

    expect(
      requests.map((request: IndexNowRequest): number => {
        return request.urlList.length;
      }),
    ).toEqual([
      INDEXNOW_MAX_URLS_PER_REQUEST,
      INDEXNOW_MAX_URLS_PER_REQUEST,
      1,
    ]);
    expect(
      requests.flatMap((request: IndexNowRequest): Array<string> => {
        return request.urlList;
      }),
    ).toEqual(all);
  });

  test("is no request for no URLs", () => {
    expect(getIndexNowRequests("oneuptime.com", [])).toEqual([]);
  });
});

describe("notifyIndexNowOfChangedPosts", () => {
  test("sends the changed posts' pages, once each, and counts what was accepted", async () => {
    const send: jest.Mock<Promise<number>, [IndexNowRequest]> = senderAnswering(
      202,
    );

    const accepted: number = await notifyIndexNowOfChangedPosts({
      host: "oneuptime.com",
      changedFiles: [
        "posts/2026-09-29-a/README.md",
        "posts/2026-09-29-a/validation.json",
        "posts/2026-09-29-b/README.md",
      ],
      send: send,
    });

    expect(accepted).toBe(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual({
      host: "oneuptime.com",
      key: INDEXNOW_KEY,
      keyLocation: `https://oneuptime.com${INDEXNOW_KEY_PATH}`,
      urlList: [
        "https://oneuptime.com/blog/post/2026-09-29-a/view",
        "https://oneuptime.com/blog/post/2026-09-29-b/view",
      ],
    });
  });

  test.each([200, 202])(
    "counts an answer of %p as accepted",
    async (status: number) => {
      await expect(
        notifyIndexNowOfChangedPosts({
          host: "oneuptime.com",
          changedFiles: changedPostFiles(3),
          send: async (): Promise<number> => {
            return status;
          },
        }),
      ).resolves.toBe(3);
    },
  );

  test.each([400, 403, 422, 429, 500])(
    "logs an answer of %p and does not throw",
    async (status: number) => {
      await expect(
        notifyIndexNowOfChangedPosts({
          host: "oneuptime.com",
          changedFiles: changedPostFiles(3),
          send: async (): Promise<number> => {
            return status;
          },
        }),
      ).resolves.toBe(0);
    },
  );

  test("a request that fails does not stop the rest, nor throw", async () => {
    let calls: number = 0;

    const accepted: number = await notifyIndexNowOfChangedPosts({
      host: "oneuptime.com",
      changedFiles: changedPostFiles(INDEXNOW_MAX_URLS_PER_REQUEST + 5),
      send: async (): Promise<number> => {
        calls++;

        if (calls === 1) {
          throw new Error("getaddrinfo ENOTFOUND api.indexnow.org");
        }

        return 200;
      },
    });

    expect(calls).toBe(2);
    expect(accepted).toBe(5);
  });

  test.each(["test.oneuptime.com", "status.example.com", "localhost", ""])(
    "sends nothing from %p: only oneuptime.com is indexed",
    async (host: string) => {
      const send: jest.Mock<
        Promise<number>,
        [IndexNowRequest]
      > = senderAnswering(200);

      await expect(
        notifyIndexNowOfChangedPosts({
          host: host,
          changedFiles: changedPostFiles(3),
          send: send,
        }),
      ).resolves.toBe(0);
      expect(send).not.toHaveBeenCalled();
    },
  );

  test("sends nothing when no post changed", async () => {
    const send: jest.Mock<Promise<number>, [IndexNowRequest]> = senderAnswering(
      200,
    );

    await expect(
      notifyIndexNowOfChangedPosts({
        host: "oneuptime.com",
        changedFiles: ["Blogs.json", "Tags.md"],
        send: send,
      }),
    ).resolves.toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("sendIndexNowRequest", () => {
  test("posts the request to IndexNow as JSON, and gives back its status", async () => {
    const fetchMock: jest.SpyInstance<
      Promise<Response>,
      Parameters<typeof fetch>
    > = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));

    const request: IndexNowRequest = getIndexNowRequests(
      "oneuptime.com",
      urls(2),
    )[0] as IndexNowRequest;

    await expect(sendIndexNowRequest(request)).resolves.toBe(202);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];

    expect(url).toBe(INDEXNOW_ENDPOINT);
    expect(INDEXNOW_ENDPOINT).toBe("https://api.indexnow.org/indexnow");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(JSON.parse(init.body as string)).toEqual(request);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("gives back a refusal's status rather than throwing", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Forbidden", { status: 403 }));

    await expect(
      sendIndexNowRequest(
        getIndexNowRequests("oneuptime.com", urls(1))[0] as IndexNowRequest,
      ),
    ).resolves.toBe(403);
  });

  test("gives up after INDEXNOW_TIMEOUT_IN_MS", async () => {
    // Node's own `performance` is read-only, so it is left as it is.
    jest.useFakeTimers({ doNotFake: ["performance"] });

    jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        (
          _url: string | URL | Request,
          init?: RequestInit,
        ): Promise<Response> => {
          return new Promise<Response>(
            (
              _resolve: (response: Response) => void,
              reject: (error: Error) => void,
            ) => {
              init?.signal?.addEventListener("abort", () => {
                reject(new Error("aborted"));
              });
            },
          );
        },
      );

    const sent: Promise<number> = sendIndexNowRequest(
      getIndexNowRequests("oneuptime.com", urls(1))[0] as IndexNowRequest,
    );

    jest.advanceTimersByTime(INDEXNOW_TIMEOUT_IN_MS);

    await expect(sent).rejects.toThrow("aborted");
  });
});
