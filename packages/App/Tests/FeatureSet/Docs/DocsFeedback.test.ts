import DocsFeedback, {
  DOCS_FEEDBACK_REASONS,
  DocsFeedbackAnswer,
} from "../../../FeatureSet/Docs/Utils/DocsFeedback";
import {
  ProductEventName,
  getProductEventDefinition,
  isForbiddenPropertyName,
} from "Common/Types/Analytics/ProductEvent";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * "WAS THIS PAGE HELPFUL?" ON THE DOCS SERVER (Docs/Utils/DocsFeedback,
 * issue #6822).
 *
 * The answer leaves the server only where product analytics is set up
 * (ANALYTICS_KEY and ANALYTICS_HOST: OneUptime Cloud), as the catalog's
 * docs/feedback_given, with nothing the catalog does not list and never a
 * word anyone wrote. Anywhere else - every self-hosted server - nothing is
 * sent, whatever arrives.
 */

const mockConfig: {
  AnalyticsKey: string;
  AnalyticsHost: string;
  IsBillingEnabled: boolean;
  IsEnterpriseEdition: boolean;
} = {
  AnalyticsKey: "",
  AnalyticsHost: "",
  IsBillingEnabled: false,
  IsEnterpriseEdition: false,
};

const mockPost: Mock = jest.fn();
const mockLoggerError: Mock = jest.fn();

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    get AnalyticsKey(): string {
      return mockConfig.AnalyticsKey;
    },
    get AnalyticsHost(): string {
      return mockConfig.AnalyticsHost;
    },
    get IsBillingEnabled(): boolean {
      return mockConfig.IsBillingEnabled;
    },
    get IsEnterpriseEdition(): boolean {
      return mockConfig.IsEnterpriseEdition;
    },
  };
});

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return mockPost(...args);
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: (...args: Array<unknown>): unknown => {
        return mockLoggerError(...args);
      },
    },
  };
});

const ON_CLOUD: () => void = (): void => {
  mockConfig.AnalyticsKey = "phc_key";
  mockConfig.AnalyticsHost = "https://analytics.example.com";
  mockConfig.IsBillingEnabled = true;
};

beforeEach(() => {
  mockConfig.AnalyticsKey = "";
  mockConfig.AnalyticsHost = "";
  mockConfig.IsBillingEnabled = false;
  mockConfig.IsEnterpriseEdition = false;
  mockPost.mockReset();
  mockLoggerError.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reading an answer", () => {
  test("reads a yes, and a no with or without its reason", () => {
    expect(
      DocsFeedback.read({
        page: "monitor/website-monitor",
        isHelpful: true,
        language: "de",
      }),
    ).toEqual({
      page: "monitor/website-monitor",
      isHelpful: true,
      language: "de",
    });
    expect(
      DocsFeedback.read({
        page: "introduction/getting-started",
        isHelpful: false,
        reason: "missing",
        language: "fa",
      }),
    ).toEqual({
      page: "introduction/getting-started",
      isHelpful: false,
      reason: "missing",
      language: "fa",
    });
    expect(
      DocsFeedback.read({
        page: "introduction/getting-started",
        isHelpful: false,
        reason: null,
      }),
    ).toEqual({
      page: "introduction/getting-started",
      isHelpful: false,
      language: "en",
    });
  });

  test("reads a language the docs do not have as English", () => {
    expect(
      DocsFeedback.read({
        page: "monitor/website-monitor",
        isHelpful: true,
        language: "xx",
      })?.language,
    ).toBe("en");
  });

  test("refuses anything that is not an answer", () => {
    for (const body of [
      undefined,
      null,
      "yes",
      [],
      {},
      { page: "monitor/website-monitor" },
      { page: "monitor/website-monitor", isHelpful: "yes" },
      { page: "not/a-page", isHelpful: true },
      { page: "../secrets", isHelpful: true },
      { page: 42, isHelpful: true },
      // A reason belongs to a no, and is one the page offers.
      { page: "monitor/website-monitor", isHelpful: true, reason: "missing" },
      { page: "monitor/website-monitor", isHelpful: false, reason: "rude" },
      { page: "monitor/website-monitor", isHelpful: false, reason: 3 },
    ]) {
      expect({ body, answer: DocsFeedback.read(body as JSONObject) }).toEqual({
        body,
        answer: null,
      });
    }
  });

  test("offers four reasons, each a word the event may carry", () => {
    expect(DOCS_FEEDBACK_REASONS).toEqual([
      "unclear",
      "missing",
      "wrong",
      "not_found",
    ]);
  });
});

describe("the event", () => {
  test("is the catalog's docs/feedback_given, no longer reserved, with a reason", () => {
    expect(
      getProductEventDefinition(ProductEventName.DocsFeedbackGiven)?.name,
    ).toBe("docs/feedback_given");
    expect(
      getProductEventDefinition(ProductEventName.DocsFeedbackGiven)
        ?.reservedFor,
    ).toBeUndefined();
    expect(
      getProductEventDefinition(
        ProductEventName.DocsFeedbackGiven,
      )!.properties.map((property: { name: string }): string => {
        return property.name;
      }),
    ).toEqual(["page", "is_helpful", "reason"]);
  });

  test("carries the page, the answer, the reason, the edition and the language, and nothing else", () => {
    ON_CLOUD();

    const properties: JSONObject = DocsFeedback.toEventProperties({
      page: "monitor/website-monitor",
      isHelpful: false,
      reason: "not_found",
      language: "ja",
    });

    expect(properties).toEqual({
      page: "monitor/website-monitor",
      is_helpful: false,
      reason: "not_found",
      edition: "cloud",
      language: "ja",
    });

    for (const name of Object.keys(properties)) {
      expect({ name, forbidden: isForbiddenPropertyName(name) }).toEqual({
        name,
        forbidden: false,
      });
    }
  });

  test("names the edition the server runs", () => {
    expect(DocsFeedback.getEdition()).toBe("community");
    mockConfig.IsEnterpriseEdition = true;
    expect(DocsFeedback.getEdition()).toBe("enterprise");
    mockConfig.IsBillingEnabled = true;
    expect(DocsFeedback.getEdition()).toBe("cloud");
  });
});

describe("sending it", () => {
  const answer: DocsFeedbackAnswer = {
    page: "monitor/website-monitor",
    isHelpful: true,
    language: "en",
  };

  test("sends nothing where product analytics is not set up: every self-hosted server", async () => {
    expect(DocsFeedback.isSent()).toBe(false);
    expect(await DocsFeedback.send(answer)).toBe(false);

    // A key without a host, or a host without a key, is not set up either.
    mockConfig.AnalyticsKey = "phc_key";
    expect(DocsFeedback.isSent()).toBe(false);
    mockConfig.AnalyticsKey = "";
    mockConfig.AnalyticsHost = "https://analytics.example.com";
    expect(DocsFeedback.isSent()).toBe(false);
    expect(await DocsFeedback.send(answer)).toBe(false);

    expect(mockPost).not.toHaveBeenCalled();
  });

  test("sends it to product analytics on OneUptime Cloud, under an id of its own and with no person profile", async () => {
    ON_CLOUD();
    mockPost.mockImplementation(async () => {
      return new HTTPResponse(200, {}, {});
    });

    expect(DocsFeedback.isSent()).toBe(true);
    expect(await DocsFeedback.send(answer)).toBe(true);
    expect(await DocsFeedback.send(answer)).toBe(true);
    expect(mockPost).toHaveBeenCalledTimes(2);

    const first: { url: { toString: () => string }; data: JSONObject } =
      mockPost.mock.calls[0]![0] as {
        url: { toString: () => string };
        data: JSONObject;
      };
    const second: { data: JSONObject } = mockPost.mock.calls[1]![0] as {
      data: JSONObject;
    };

    expect(first.url.toString()).toBe("https://analytics.example.com/capture/");
    expect(first.data).toEqual({
      api_key: "phc_key",
      event: "docs/feedback_given",
      distinct_id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      properties: {
        source: "oneuptime-docs",
        $process_person_profile: false,
        page: "monitor/website-monitor",
        is_helpful: true,
        edition: "cloud",
        language: "en",
      },
    });
    // Two answers are two readers as far as anyone can tell.
    expect(second.data["distinct_id"]).not.toBe(first.data["distinct_id"]);
  });

  test("says so in the log, and never throws, when analytics refuses or cannot be reached", async () => {
    ON_CLOUD();
    mockPost.mockImplementationOnce(async () => {
      return new HTTPErrorResponse(401, { message: "bad key" }, {});
    });
    expect(await DocsFeedback.send(answer)).toBe(false);

    mockPost.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    expect(await DocsFeedback.send(answer)).toBe(false);
    expect(mockLoggerError).toHaveBeenCalled();
  });
});

describe("Tell us on GitHub", () => {
  test("opens a new issue with the page's name and address filled in, to finish or not", () => {
    const url: string = DocsFeedback.getGitHubIssueUrl({
      page: "on-call/escalation-rules",
      title: "Escalation Rules",
      lang: "de",
    });
    const parsed: URL = new URL(url);

    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      "https://github.com/OneUptime/oneuptime/issues/new",
    );
    expect(parsed.searchParams.get("labels")).toBe("documentation");
    expect(parsed.searchParams.get("title")).toBe("Docs: Escalation Rules");
    expect(parsed.searchParams.get("body")).toContain(
      "Page: /docs/de/on-call/escalation-rules",
    );
  });
});
