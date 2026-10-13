import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import { APIRequestOptions } from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import {
  CONTRIBUTORS_PAGE_TIMEOUT_IN_MS,
  CONTRIBUTORS_PER_PAGE,
  fetchGitHubContributors,
  GITHUB_CONTRIBUTORS_URL,
  MAX_CONTRIBUTOR_PAGES,
} from "../Utils/GitHubContributors";

/*
 * READING THE ABOUT PAGE'S CONTRIBUTORS FROM GITHUB (Utils/GitHubContributors).
 *
 * The /about route walked GitHub's contributor pages until one held fewer
 * than 30 entries. When GitHub rate limited the server it answered with an
 * error object instead of a list; an object has no length, `undefined < 30`
 * is false, and the walk asked for the next page forever, with the visitor's
 * request hanging the whole time. These answer every page from a script and
 * count the requests, so a walk that does not stop fails here instead of
 * spinning.
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
  };
});

type Answer = HTTPResponse<Array<JSONObject>> | HTTPErrorResponse | Error;

// What GitHub answers for page N (1-based), and every request it was sent.
let mockAnswerForPage: (page: number) => Answer = (): Answer => {
  return new Error("No answer was set up for this request.");
};
const mockRequests: Array<APIRequestOptions> = [];

/*
 * Far more requests than any correct walk makes. A walk that has not stopped
 * by then is the bug, and is failed rather than left to spin.
 */
const MOCK_RUNAWAY_LIMIT: number = 1000;

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      get: async (
        options: APIRequestOptions,
      ): Promise<HTTPResponse<Array<JSONObject>> | HTTPErrorResponse> => {
        mockRequests.push(options);

        if (mockRequests.length > MOCK_RUNAWAY_LIMIT) {
          throw new Error("The walk never stopped asking GitHub.");
        }

        // Answer on a later turn of the event loop, as a real request does.
        await new Promise<void>((resolve: () => void) => {
          setImmediate(resolve);
        });

        const answer: Answer = mockAnswerForPage(mockRequests.length);

        if (answer instanceof Error) {
          throw answer;
        }

        return answer;
      },
    },
  };
});

function contributor(index: number): JSONObject {
  return { login: `contributor-${index}`, contributions: 1000 - index };
}

// A page of GitHub's answer, holding exactly the entries given.
function pageOf(entries: Array<unknown>): HTTPResponse<Array<JSONObject>> {
  const response: HTTPResponse<Array<JSONObject>> = new HTTPResponse<
    Array<JSONObject>
  >(200, [], {});

  response.data = entries as Array<JSONObject>;

  return response;
}

function fullPage(page: number): HTTPResponse<Array<JSONObject>> {
  return pageOf(
    Array.from({ length: CONTRIBUTORS_PER_PAGE }, (_: unknown, i: number) => {
      return contributor((page - 1) * CONTRIBUTORS_PER_PAGE + i);
    }),
  );
}

// What GitHub sends when it rate limits an unauthenticated caller.
function rateLimited(): HTTPErrorResponse {
  return new HTTPErrorResponse(
    403,
    {
      message:
        "API rate limit exceeded for 203.0.113.7. (But here's the good news: Authenticated requests get a higher rate limit.)",
      documentation_url:
        "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting",
    },
    { "x-ratelimit-remaining": "0" },
  );
}

function requestedUrls(): Array<string> {
  return mockRequests.map((request: APIRequestOptions): string => {
    return request.url.toString();
  });
}

beforeEach(() => {
  mockRequests.length = 0;
  jest.mocked(logger.warn).mockClear();
});

describe("fetchGitHubContributors", () => {
  test("reads full pages until a short one, a page per request", async () => {
    mockAnswerForPage = (page: number): Answer => {
      return page < 3
        ? fullPage(page)
        : pageOf([contributor(200), contributor(201)]);
    };

    const contributors: Array<JSONObject> = await fetchGitHubContributors();

    expect(contributors).toHaveLength(2 * CONTRIBUTORS_PER_PAGE + 2);
    expect(contributors[0]).toEqual(contributor(0));
    expect(contributors[contributors.length - 1]).toEqual(contributor(201));
    expect(requestedUrls()).toEqual([
      `${GITHUB_CONTRIBUTORS_URL}?per_page=${CONTRIBUTORS_PER_PAGE}&page=1`,
      `${GITHUB_CONTRIBUTORS_URL}?per_page=${CONTRIBUTORS_PER_PAGE}&page=2`,
      `${GITHUB_CONTRIBUTORS_URL}?per_page=${CONTRIBUTORS_PER_PAGE}&page=3`,
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("stops at GitHub's rate-limit error object, after one request", async () => {
    // The regression: this answer used to send the walk round forever.
    mockAnswerForPage = (): Answer => {
      return rateLimited();
    };

    await expect(fetchGitHubContributors()).resolves.toEqual([]);
    expect(mockRequests).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(jest.mocked(logger.warn).mock.calls[0]![0])).toContain(
      "status 403",
    );
  });

  test("keeps the pages it read before GitHub started refusing", async () => {
    mockAnswerForPage = (page: number): Answer => {
      return page === 1 ? fullPage(1) : rateLimited();
    };

    const contributors: Array<JSONObject> = await fetchGitHubContributors();

    expect(contributors).toHaveLength(CONTRIBUTORS_PER_PAGE);
    expect(mockRequests).toHaveLength(2);
  });

  test.each([
    ["an object", { message: "Moved Permanently" }],
    ["a page of HTML a proxy put in its place", "<html>Bad gateway</html>"],
    ["nothing", null],
    ["a number", 30],
  ] as Array<[string, unknown]>)(
    "stops at a successful answer that is %s rather than a list",
    async (_kind: string, body: unknown) => {
      mockAnswerForPage = (page: number): Answer => {
        return page === 1 ? fullPage(1) : pageOf(body as Array<unknown>);
      };

      const contributors: Array<JSONObject> = await fetchGitHubContributors();

      expect(contributors).toHaveLength(CONTRIBUTORS_PER_PAGE);
      expect(mockRequests).toHaveLength(2);
    },
  );

  test("does not take a list out of an error answer", async () => {
    mockAnswerForPage = (): Answer => {
      return new HTTPErrorResponse(
        502,
        [contributor(1)] as unknown as JSONObject,
        {},
      );
    };

    await expect(fetchGitHubContributors()).resolves.toEqual([]);
    expect(mockRequests).toHaveLength(1);
  });

  test("never throws: a request that fails ends the walk with what was read", async () => {
    mockAnswerForPage = (page: number): Answer => {
      return page === 1
        ? fullPage(1)
        : new Error("Request failed to api.github.com. Connection timed out");
    };

    const contributors: Array<JSONObject> = await fetchGitHubContributors();

    expect(contributors).toHaveLength(CONTRIBUTORS_PER_PAGE);
    expect(mockRequests).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test("a first request that fails leaves no contributors and no exception", async () => {
    mockAnswerForPage = (): Answer => {
      return new Error("Request failed to api.github.com. Host not found");
    };

    await expect(fetchGitHubContributors()).resolves.toEqual([]);
    expect(mockRequests).toHaveLength(1);
  });

  test(`stops after ${MAX_CONTRIBUTOR_PAGES} full pages, however many GitHub has`, async () => {
    mockAnswerForPage = (page: number): Answer => {
      return fullPage(page);
    };

    const contributors: Array<JSONObject> = await fetchGitHubContributors();

    expect(mockRequests).toHaveLength(MAX_CONTRIBUTOR_PAGES);
    expect(contributors).toHaveLength(
      MAX_CONTRIBUTOR_PAGES * CONTRIBUTORS_PER_PAGE,
    );
    expect(requestedUrls()[MAX_CONTRIBUTOR_PAGES - 1]).toBe(
      `${GITHUB_CONTRIBUTORS_URL}?per_page=${CONTRIBUTORS_PER_PAGE}&page=${MAX_CONTRIBUTOR_PAGES}`,
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test("an empty first page is the whole list", async () => {
    mockAnswerForPage = (): Answer => {
      return pageOf([]);
    };

    await expect(fetchGitHubContributors()).resolves.toEqual([]);
    expect(mockRequests).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("a page exactly full is followed by one more request", async () => {
    mockAnswerForPage = (page: number): Answer => {
      return page === 1 ? fullPage(1) : pageOf([]);
    };

    const contributors: Array<JSONObject> = await fetchGitHubContributors();

    expect(contributors).toHaveLength(CONTRIBUTORS_PER_PAGE);
    expect(mockRequests).toHaveLength(2);
  });

  test("keeps only the entries that are contributors", async () => {
    mockAnswerForPage = (): Answer => {
      return pageOf([
        contributor(1),
        null,
        "contributor-2",
        3,
        [contributor(4)],
        contributor(5),
      ]);
    };

    await expect(fetchGitHubContributors()).resolves.toEqual([
      contributor(1),
      contributor(5),
    ]);
  });

  test("asks GitHub's JSON API with a time limit on every page", async () => {
    mockAnswerForPage = (page: number): Answer => {
      return page === 1 ? fullPage(1) : pageOf([contributor(100)]);
    };

    await fetchGitHubContributors();

    expect(mockRequests).toHaveLength(2);

    for (const request of mockRequests) {
      expect(request.headers).toEqual({
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "OneUptime-Home",
      });
      expect(request.options?.timeout).toBe(CONTRIBUTORS_PAGE_TIMEOUT_IN_MS);
    }
  });

  test("the ceiling holds every contributor GitHub can name", () => {
    // GitHub ties at most 500 author addresses of a repository to accounts.
    expect(
      MAX_CONTRIBUTOR_PAGES * CONTRIBUTORS_PER_PAGE,
    ).toBeGreaterThanOrEqual(500);
    expect(CONTRIBUTORS_PER_PAGE).toBeLessThanOrEqual(100);
    expect(CONTRIBUTORS_PAGE_TIMEOUT_IN_MS).toBeGreaterThan(0);
  });
});
