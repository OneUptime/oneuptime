import GitHubUpdateCheck, {
  ADVISORIES_PER_PAGE,
  GITHUB_REQUEST_HEADERS,
  LatestRelease,
  MAX_ADVISORY_PAGES,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_IN_MS,
  UpdateCheckResult,
} from "../../../../Server/Utils/UpdateCheck/GitHubUpdateCheck";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import APIException from "../../../../Types/Exception/ApiException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  SecurityAdvisory,
  SecurityAdvisorySeverity,
} from "../../../../Types/UpdateCheck/SecurityAdvisory";
import UpdateCheckFailure from "../../../../Types/UpdateCheck/UpdateCheckFailure";
import API from "../../../../Utils/API";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The two questions the daily update check asks GitHub, against GitHub's
 * answers as they come - the latest release, a page of OneUptime's published
 * advisories (the fixture is the real list, read on 2026-10-30) - and every
 * way they fail: an empty list, an answer that is not GitHub's, the rate
 * limit (403 and 429), an HTTP error, a timeout and no route at all. None of
 * them throws; each failure says why, so the job keeps its last good answer.
 */

const RELEASE_URL: URL = URL.fromString(
  "https://api.github.com/repos/OneUptime/oneuptime/releases/latest",
);
const ADVISORIES_URL: URL = URL.fromString(
  "https://api.github.com/repos/OneUptime/oneuptime/security-advisories",
);

const PUBLISHED: JSONArray = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Utils",
      "Fixtures",
      "OneUptimePublishedSecurityAdvisories.json",
    ),
    "utf8",
  ),
) as JSONArray;

// jest.Mock<what it returns, its arguments>, as BasicCron's RunMock.
type GetMock = jest.Mock<Promise<unknown>, Array<unknown>>;

let get: GetMock;

const ok: (
  data: JSONObject | JSONArray,
  headers?: JSONObject,
) => HTTPResponse<JSONObject> = (
  data: JSONObject | JSONArray,
  headers?: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(
    200,
    data as JSONObject,
    (headers || {}) as Record<string, string>,
  );
};

const error: (
  status: number,
  data: JSONObject,
  headers?: JSONObject,
) => HTTPErrorResponse = (
  status: number,
  data: JSONObject,
  headers?: JSONObject,
): HTTPErrorResponse => {
  return new HTTPErrorResponse(
    status,
    data,
    (headers || {}) as Record<string, string>,
  );
};

// What the code asked for, the n-th call.
const requested: (call: number) => {
  url: string;
  headers: Record<string, string>;
  options: JSONObject;
} = (call: number) => {
  const argument: {
    url: URL;
    headers: Record<string, string>;
    options: JSONObject;
  } = get.mock.calls[call]![0] as {
    url: URL;
    headers: Record<string, string>;
    options: JSONObject;
  };

  return {
    url: argument.url.toString(),
    headers: argument.headers,
    options: argument.options,
  };
};

const advisoryJson: (id: string, overrides?: JSONObject) => JSONObject = (
  id: string,
  overrides?: JSONObject,
): JSONObject => {
  return {
    ghsa_id: id,
    cve_id: null,
    html_url: `https://github.com/OneUptime/oneuptime/security/advisories/${id}`,
    summary: `Summary of ${id}`,
    severity: "high",
    state: "published",
    published_at: "2026-10-01T00:00:00Z",
    withdrawn_at: null,
    vulnerabilities: [
      {
        package: { ecosystem: "npm", name: "oneuptime" },
        vulnerable_version_range: "<= 14.0.66",
        patched_versions: "14.0.67",
      },
    ],
    ...(overrides || {}),
  };
};

beforeEach(() => {
  get = jest.fn() as GetMock;
  jest.spyOn(API, "get").mockImplementation(get as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what is sent", () => {
  test("names OneUptime as the User-Agent, never the version, and asks for GitHub's JSON", async () => {
    get.mockResolvedValue(ok({ tag_name: "v14.0.80" }));

    await GitHubUpdateCheck.fetchLatestRelease(RELEASE_URL);

    expect(requested(0).headers).toEqual({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "OneUptime",
    });
    expect(GITHUB_REQUEST_HEADERS["User-Agent"]).not.toMatch(/\d/);
  });

  test("waits 15 seconds at most, and takes no answer bigger than 10 MB", async () => {
    get.mockResolvedValue(ok({ tag_name: "14.0.80" }));

    await GitHubUpdateCheck.fetchLatestRelease(RELEASE_URL);

    expect(REQUEST_TIMEOUT_IN_MS).toBe(15000);
    expect(MAX_RESPONSE_BYTES).toBe(10 * 1024 * 1024);
    expect(requested(0).options).toEqual({
      timeout: REQUEST_TIMEOUT_IN_MS,
      maxContentLength: MAX_RESPONSE_BYTES,
    });
  });

  test("asks for published advisories, newest first, 100 a page, with no token", async () => {
    get.mockResolvedValue(ok([]));

    await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(ADVISORIES_URL);

    const asked: globalThis.URL = new globalThis.URL(requested(0).url);

    expect(`${asked.origin}${asked.pathname}`).toBe(ADVISORIES_URL.toString());
    expect(Object.fromEntries(asked.searchParams.entries())).toEqual({
      state: "published",
      sort: "published",
      direction: "desc",
      per_page: String(ADVISORIES_PER_PAGE),
    });
    expect(requested(0).headers["Authorization"]).toBeUndefined();
  });

  test("never changes the configured URL it is handed", async () => {
    get.mockResolvedValue(ok([]));

    await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(ADVISORIES_URL);
    await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(ADVISORIES_URL);

    expect(ADVISORIES_URL.toString()).toBe(
      "https://api.github.com/repos/OneUptime/oneuptime/security-advisories",
    );
    expect(requested(1).url).toBe(requested(0).url);
  });
});

describe("the latest release", () => {
  test("is the tag's version, canonical, with when it was published", async () => {
    get.mockResolvedValue(
      ok({ tag_name: "v14.0.80", published_at: "2026-10-20T09:00:00Z" }),
    );

    const result: UpdateCheckResult<LatestRelease> =
      await GitHubUpdateCheck.fetchLatestRelease(RELEASE_URL);

    expect(result).toEqual({
      ok: true,
      value: {
        version: "14.0.80",
        publishedAt: new Date("2026-10-20T09:00:00.000Z"),
      },
    });
  });

  test("has no publish date when GitHub gives none, or one that is not a date", async () => {
    for (const publishedAt of [undefined, null, "yesterday", 42]) {
      get.mockResolvedValueOnce(
        ok({ tag_name: "14.0.80", published_at: publishedAt } as JSONObject),
      );

      const result: UpdateCheckResult<LatestRelease> =
        await GitHubUpdateCheck.fetchLatestRelease(RELEASE_URL);

      expect(result).toEqual({
        ok: true,
        value: { version: "14.0.80", publishedAt: null },
      });
    }
  });

  test.each([
    [{ tag_name: "build-number-7866" }],
    [{ tag_name: "" }],
    [{ tag_name: null }],
    [{}],
    [{ name: "14.0.80" }],
  ] as Array<[JSONObject]>)(
    "a tag that is not a version (%j) is a malformed answer",
    async (body: JSONObject) => {
      get.mockResolvedValue(ok(body));

      const result: UpdateCheckResult<LatestRelease> =
        await GitHubUpdateCheck.fetchLatestRelease(RELEASE_URL);

      expect(result.ok).toBe(false);
      expect((result as { failure: UpdateCheckFailure }).failure).toBe(
        UpdateCheckFailure.MalformedResponse,
      );
    },
  );

  test("a list where an object belongs, or a page of HTML from a proxy, is malformed", async () => {
    for (const body of [[{ tag_name: "14.0.80" }], "<html>Blocked</html>"]) {
      get.mockResolvedValueOnce(ok(body as unknown as JSONObject));

      const result: UpdateCheckResult<LatestRelease> =
        await GitHubUpdateCheck.fetchLatestRelease(RELEASE_URL);

      expect(result).toMatchObject({
        ok: false,
        failure: UpdateCheckFailure.MalformedResponse,
      });
    }
  });
});

describe("the published security advisories", () => {
  test("every advisory OneUptime has published reads", async () => {
    get.mockResolvedValue(ok(PUBLISHED));

    const result: UpdateCheckResult<Array<SecurityAdvisory>> =
      await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(ADVISORIES_URL);

    expect(result.ok).toBe(true);

    const advisories: Array<SecurityAdvisory> = (
      result as { value: Array<SecurityAdvisory> }
    ).value;

    expect(advisories).toHaveLength(PUBLISHED.length);

    const first: SecurityAdvisory = advisories[0]!;
    const raw: JSONObject = PUBLISHED[0] as JSONObject;

    expect(first).toEqual({
      ghsaId: raw["ghsa_id"],
      cveId: null,
      summary: raw["summary"],
      severity: raw["severity"],
      url: raw["html_url"],
      publishedAt: new Date(raw["published_at"] as string).toISOString(),
      vulnerabilities: [
        {
          vulnerableVersionRange: "<= 14.0.67",
          patchedVersions: "14.0.68",
        },
      ],
    });
  });

  test("an empty list is an answer: nothing is published", async () => {
    get.mockResolvedValue(ok([]));

    expect(
      await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(ADVISORIES_URL),
    ).toEqual({ ok: true, value: [] });
  });

  test("keeps only what it shows: no description, no credits, nothing GitHub did not check", async () => {
    get.mockResolvedValue(
      ok([
        advisoryJson("GHSA-aaaa-bbbb-cccc", {
          description: "x".repeat(100000),
          credits: [{ login: "someone" }],
          summary: "  Two\n\nlines\tand\u0000a control  ",
          cve_id: "cve-2026-12345",
          severity: "moderate",
        }),
      ]),
    );

    const result: UpdateCheckResult<Array<SecurityAdvisory>> =
      await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(ADVISORIES_URL);
    const advisory: SecurityAdvisory = (
      result as { value: Array<SecurityAdvisory> }
    ).value[0]!;

    expect(Object.keys(advisory).sort()).toEqual(
      [
        "cveId",
        "ghsaId",
        "publishedAt",
        "severity",
        "summary",
        "url",
        "vulnerabilities",
      ].sort(),
    );
    expect(advisory.summary).toBe("Two lines and a control");
    expect(advisory.cveId).toBe("CVE-2026-12345");
    expect(advisory.severity).toBe(SecurityAdvisorySeverity.Medium);
  });

  test("leaves out drafts, withdrawn advisories and repeats", async () => {
    get.mockResolvedValue(
      ok([
        advisoryJson("GHSA-aaaa-bbbb-0001"),
        advisoryJson("GHSA-aaaa-bbbb-0002", { state: "draft" }),
        advisoryJson("GHSA-aaaa-bbbb-0003", {
          withdrawn_at: "2026-10-02T00:00:00Z",
        }),
        advisoryJson("GHSA-aaaa-bbbb-0001"),
        advisoryJson("GHSA-AAAA-BBBB-0001"),
      ]),
    );

    const result: UpdateCheckResult<Array<SecurityAdvisory>> =
      await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(ADVISORIES_URL);

    expect(
      (result as { value: Array<SecurityAdvisory> }).value.map(
        (advisory: SecurityAdvisory): string => {
          return advisory.ghsaId;
        },
      ),
    ).toEqual(["GHSA-aaaa-bbbb-0001"]);
  });

  test("links an advisory only to github.com over HTTPS", async () => {
    get.mockResolvedValue(
      ok([
        advisoryJson("GHSA-aaaa-bbbb-0001", {
          html_url: "javascript:alert(1)",
        }),
        advisoryJson("GHSA-aaaa-bbbb-0002", {
          html_url: "https://github.com.evil.example/advisory",
        }),
        advisoryJson("GHSA-aaaa-bbbb-0003", {
          html_url: "http://github.com/OneUptime/oneuptime",
        }),
        advisoryJson("GHSA-aaaa-bbbb-0004"),
      ]),
    );

    const result: UpdateCheckResult<Array<SecurityAdvisory>> =
      await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(ADVISORIES_URL);

    expect(
      (result as { value: Array<SecurityAdvisory> }).value.map(
        (advisory: SecurityAdvisory): string | null => {
          return advisory.url;
        },
      ),
    ).toEqual([
      null,
      null,
      null,
      "https://github.com/OneUptime/oneuptime/security/advisories/GHSA-aaaa-bbbb-0004",
    ]);
  });

  test("skips the odd item that is not an advisory, but refuses a page of nothing else", async () => {
    get.mockResolvedValueOnce(
      ok([
        null,
        42,
        "x",
        { ghsa_id: "nope" },
        advisoryJson("GHSA-aaaa-bbbb-0001"),
      ] as unknown as JSONArray),
    );

    const mixed: UpdateCheckResult<Array<SecurityAdvisory>> =
      await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(ADVISORIES_URL);

    expect((mixed as { value: Array<SecurityAdvisory> }).value).toHaveLength(1);

    get.mockResolvedValueOnce(
      ok([{ message: "hello" }, { id: 1 }] as unknown as JSONArray),
    );

    expect(
      await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(ADVISORIES_URL),
    ).toMatchObject({
      ok: false,
      failure: UpdateCheckFailure.MalformedResponse,
    });
  });

  test.each([
    [{ message: "Not Found" }],
    ["<html>Captive portal</html>"],
  ] as Array<[unknown]>)(
    "an answer that is not a list (%j) is malformed",
    async (body: unknown) => {
      get.mockResolvedValue(ok(body as JSONObject));

      expect(
        await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(
          ADVISORIES_URL,
        ),
      ).toMatchObject({
        ok: false,
        failure: UpdateCheckFailure.MalformedResponse,
      });
    },
  );

  test("follows GitHub's next-page cursor, asking the configured URL each time", async () => {
    const firstPage: JSONArray = Array.from(
      { length: ADVISORIES_PER_PAGE },
      (_: unknown, index: number): JSONObject => {
        return advisoryJson(`GHSA-aaaa-bbbb-${String(index).padStart(4, "0")}`);
      },
    );

    get
      .mockResolvedValueOnce(
        ok(firstPage, {
          link: '<https://api.github.com/repositories/380744866/security-advisories?state=published&per_page=100&after=Y3Vyc29yOnYyOpK5MjAyNg%3D%3D>; rel="next"',
        }),
      )
      .mockResolvedValueOnce(ok([advisoryJson("GHSA-cccc-dddd-0001")]));

    const result: UpdateCheckResult<Array<SecurityAdvisory>> =
      await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(ADVISORIES_URL);

    expect(get).toHaveBeenCalledTimes(2);
    expect((result as { value: Array<SecurityAdvisory> }).value).toHaveLength(
      ADVISORIES_PER_PAGE + 1,
    );

    const second: globalThis.URL = new globalThis.URL(requested(1).url);

    expect(second.host).toBe("api.github.com");
    expect(second.pathname).toBe(
      "/repos/OneUptime/oneuptime/security-advisories",
    );
    expect(second.searchParams.get("after")).toBe("Y3Vyc29yOnYyOpK5MjAyNg==");
  });

  test("never follows a next page to another address, or a cursor that is not one", async () => {
    expect(
      GitHubUpdateCheck.getNextPageCursor({
        link: '<https://evil.example/steal?after=abc123>; rel="next"',
      }),
    ).toBe("abc123");
    expect(
      GitHubUpdateCheck.getNextPageCursor({
        link: '<https://api.github.com/x?after=a%20b%3Cscript%3E>; rel="next"',
      }),
    ).toBeNull();
    expect(
      GitHubUpdateCheck.getNextPageCursor({
        link: '<https://api.github.com/x?after=abc>; rel="prev"',
      }),
    ).toBeNull();
    expect(
      GitHubUpdateCheck.getNextPageCursor({ Link: "not a link" }),
    ).toBeNull();
    expect(GitHubUpdateCheck.getNextPageCursor({})).toBeNull();
    expect(GitHubUpdateCheck.getNextPageCursor(undefined)).toBeNull();
    expect(
      GitHubUpdateCheck.getNextPageCursor({
        link: `<https://api.github.com/x?after=${"a".repeat(5000)}>; rel="next"`,
      }),
    ).toBeNull();
  });

  test("reads at most MAX_ADVISORY_PAGES pages, however many GitHub offers", async () => {
    let page: number = 0;

    get.mockImplementation(async (): Promise<unknown> => {
      page++;
      return ok(
        [advisoryJson(`GHSA-aaaa-bbbb-${String(page).padStart(4, "0")}`)],
        {
          link: `<https://api.github.com/x?after=cursor${page}>; rel="next"`,
        },
      );
    });

    const result: UpdateCheckResult<Array<SecurityAdvisory>> =
      await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(ADVISORIES_URL);

    expect(get).toHaveBeenCalledTimes(MAX_ADVISORY_PAGES);
    expect((result as { value: Array<SecurityAdvisory> }).value).toHaveLength(
      MAX_ADVISORY_PAGES,
    );
  });

  test("a page that fails fails the whole read, so a partial list never replaces a whole one", async () => {
    get
      .mockResolvedValueOnce(
        ok([advisoryJson("GHSA-aaaa-bbbb-0001")], {
          link: '<https://api.github.com/x?after=abc>; rel="next"',
        }),
      )
      .mockResolvedValueOnce(error(502, { message: "Bad Gateway" }));

    expect(
      await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(ADVISORIES_URL),
    ).toMatchObject({ ok: false, failure: UpdateCheckFailure.HttpError });
  });
});

describe("when GitHub refuses, fails or cannot be reached", () => {
  const both: Array<[string, () => Promise<UpdateCheckResult<unknown>>]> = [
    [
      "the latest release",
      (): Promise<UpdateCheckResult<unknown>> => {
        return GitHubUpdateCheck.fetchLatestRelease(RELEASE_URL);
      },
    ],
    [
      "the advisories",
      (): Promise<UpdateCheckResult<unknown>> => {
        return GitHubUpdateCheck.fetchPublishedSecurityAdvisories(
          ADVISORIES_URL,
        );
      },
    ],
  ];

  test.each(both)(
    "%s: GitHub's rate limit, as a 403 with no requests remaining",
    async (_name: string, fetch: () => Promise<UpdateCheckResult<unknown>>) => {
      get.mockResolvedValue(
        error(
          403,
          { message: "API rate limit exceeded for 203.0.113.7." },
          { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793366269" },
        ),
      );

      expect(await fetch()).toMatchObject({
        ok: false,
        failure: UpdateCheckFailure.RateLimited,
      });
    },
  );

  test.each(both)(
    "%s: GitHub's secondary rate limit, a 403 that says so",
    async (_name: string, fetch: () => Promise<UpdateCheckResult<unknown>>) => {
      get.mockResolvedValue(
        error(403, {
          message:
            "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
        }),
      );

      expect(await fetch()).toMatchObject({
        ok: false,
        failure: UpdateCheckFailure.RateLimited,
      });
    },
  );

  test.each(both)(
    "%s: 429 Too Many Requests",
    async (_name: string, fetch: () => Promise<UpdateCheckResult<unknown>>) => {
      get.mockResolvedValue(error(429, {}, { "retry-after": "60" }));

      expect(await fetch()).toMatchObject({
        ok: false,
        failure: UpdateCheckFailure.RateLimited,
      });
    },
  );

  test.each(both)(
    "%s: a 403 that is not the rate limit is an HTTP error",
    async (_name: string, fetch: () => Promise<UpdateCheckResult<unknown>>) => {
      get.mockResolvedValue(
        error(
          403,
          { message: "Forbidden by proxy" },
          { "x-ratelimit-remaining": "57" },
        ),
      );

      expect(await fetch()).toMatchObject({
        ok: false,
        failure: UpdateCheckFailure.HttpError,
      });
    },
  );

  test.each(both)(
    "%s: a 404 from a mirror, and a 500, are HTTP errors that say the status",
    async (_name: string, fetch: () => Promise<UpdateCheckResult<unknown>>) => {
      for (const status of [404, 500, 503]) {
        get.mockResolvedValueOnce(error(status, { message: "Nope" }));

        const result: UpdateCheckResult<unknown> = await fetch();

        expect(result).toMatchObject({
          ok: false,
          failure: UpdateCheckFailure.HttpError,
        });
        expect((result as { detail: string }).detail).toContain(
          `answered ${status}`,
        );
      }
    },
  );

  test.each(both)(
    "%s: a timeout",
    async (_name: string, fetch: () => Promise<UpdateCheckResult<unknown>>) => {
      const timeout: Error & { code?: string } = new Error(
        "timeout of 15000ms exceeded",
      );
      timeout.code = "ECONNABORTED";

      get.mockRejectedValue(
        new APIException(
          "Request failed to https://api.github.com. timeout of 15000ms exceeded",
          timeout,
        ),
      );

      expect(await fetch()).toMatchObject({
        ok: false,
        failure: UpdateCheckFailure.TimedOut,
      });
    },
  );

  test.each(both)(
    "%s: no route at all - DNS, a refused connection, the network down",
    async (_name: string, fetch: () => Promise<UpdateCheckResult<unknown>>) => {
      for (const code of [
        "ENOTFOUND",
        "ECONNREFUSED",
        "ENETUNREACH",
        "EAI_AGAIN",
      ]) {
        const cause: Error & { code?: string } = new Error(code);
        cause.code = code;

        get.mockRejectedValueOnce(
          new APIException(
            `Request failed to https://api.github.com. ${code}`,
            cause,
          ),
        );

        expect(await fetch()).toMatchObject({
          ok: false,
          failure: UpdateCheckFailure.Unreachable,
        });
      }
    },
  );

  test.each(both)(
    "%s: anything else thrown is no route, and never escapes",
    async (_name: string, fetch: () => Promise<UpdateCheckResult<unknown>>) => {
      get.mockRejectedValue("a string, not an error");

      await expect(fetch()).resolves.toMatchObject({
        ok: false,
        failure: UpdateCheckFailure.Unreachable,
      });
    },
  );

  test("a detail is capped, whatever an error says", async () => {
    get.mockResolvedValue(error(500, { message: "x".repeat(100000) }));

    const result: UpdateCheckResult<unknown> =
      await GitHubUpdateCheck.fetchLatestRelease(RELEASE_URL);

    expect((result as { detail: string }).detail.length).toBeLessThan(700);
  });
});
