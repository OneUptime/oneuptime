import DocsFeedback, {
  DocsFeedbackMode,
} from "../../../FeatureSet/Docs/Utils/DocsFeedback";
import DocsFeedbackStore, {
  DocsFeedbackKeeper,
} from "../../../FeatureSet/Docs/Utils/DocsFeedbackStore";
import DocsSearchReport, {
  DOCS_SEARCH_REPORT_MAX_LENGTH,
} from "../../../FeatureSet/Docs/Utils/DocsSearchReport";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  DocsFeedbackReason,
  ProductFeedbackKind,
  ProductFeedbackSubmission,
} from "Common/Types/ProductFeedback/ProductFeedback";
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
 * THE DOCS' TWO WAYS FOR WHAT THEY FAIL AT (#7209, #7207), on the docs
 * server:
 *
 *   - "Was this page helpful?" kept on the server for its admins, through
 *     the keeper the App hands the docs (DocsFeedbackStore): nothing without
 *     a keeper, nothing while the switch is off, and never a failure on the
 *     page; and the page's mode - send, keep or local - as the server says.
 *   - A docs search that found nothing (DocsSearchReport): sent only where
 *     product analytics is set up, with its length and language, and on
 *     Cloud the words left once every word that could name or reach a
 *     person is out; never on a self-hosted server.
 */

const mockConfig: {
  AnalyticsKey: string;
  AnalyticsHost: string;
  IsBillingEnabled: boolean;
  AppVersion: string;
} = {
  AnalyticsKey: "",
  AnalyticsHost: "",
  IsBillingEnabled: false,
  AppVersion: "16.0.0",
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
    IsEnterpriseEdition: false,
    get AppVersion(): string {
      return mockConfig.AppVersion;
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

let kept: Array<ProductFeedbackSubmission> = [];
let isKeepingOn: boolean = false;

const keeper: DocsFeedbackKeeper = {
  isDocsFeedbackKept: async (): Promise<boolean> => {
    return isKeepingOn;
  },
  keepDocsAnswer: async (
    submission: ProductFeedbackSubmission,
  ): Promise<boolean> => {
    kept.push(submission);
    return true;
  },
};

beforeEach(() => {
  mockConfig.AnalyticsKey = "";
  mockConfig.AnalyticsHost = "";
  mockConfig.IsBillingEnabled = false;
  mockConfig.AppVersion = "16.0.0";
  mockPost.mockReset();
  mockLoggerError.mockReset();
  kept = [];
  isKeepingOn = false;
  DocsFeedbackStore.useKeeper(null);
});

afterEach(() => {
  DocsFeedbackStore.useKeeper(null);
  jest.restoreAllMocks();
});

describe("Was this page helpful?, kept for the server's admins (#7209)", () => {
  test("with no keeper - a server that never handed the docs one - nothing is kept, and the page posts nothing", async () => {
    expect(await DocsFeedbackStore.isKept()).toBe(false);
    expect(await DocsFeedback.getMode()).toBe(DocsFeedbackMode.Local);
    expect(
      await DocsFeedbackStore.keep({
        page: "monitor/website-monitor",
        isHelpful: true,
        language: "en",
      }),
    ).toBe(false);
  });

  test("switched off: the page posts nothing", async () => {
    DocsFeedbackStore.useKeeper(keeper);

    expect(await DocsFeedback.getMode()).toBe(DocsFeedbackMode.Local);
  });

  test("switched on: the page keeps answers, and the answer is kept with the page, its language, the no, its reason and the version", async () => {
    DocsFeedbackStore.useKeeper(keeper);
    isKeepingOn = true;

    expect(await DocsFeedback.getMode()).toBe(DocsFeedbackMode.Keep);
    expect(
      await DocsFeedbackStore.keep({
        page: "monitor/website-monitor",
        isHelpful: false,
        reason: "unclear",
        language: "fa",
      }),
    ).toBe(true);
    expect(kept).toEqual([
      {
        kind: ProductFeedbackKind.DocsPage,
        topic: "monitor/website-monitor",
        score: null,
        isPositive: false,
        reason: DocsFeedbackReason.Unclear,
        details: null,
        page: "/docs/fa/monitor/website-monitor",
        version: "16.0.0",
      },
    ]);
  });

  test("where analytics is set up, the page sends as before, with consent, and the server keeps what it was sent too", async () => {
    ON_CLOUD();
    mockPost.mockImplementation(async () => {
      return new HTTPResponse(200, {}, {});
    });
    DocsFeedbackStore.useKeeper(keeper);
    isKeepingOn = true;

    expect(await DocsFeedback.getMode()).toBe(DocsFeedbackMode.Send);

    await DocsFeedback.take({
      page: "monitor/website-monitor",
      isHelpful: true,
      language: "en",
    });

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(kept).toHaveLength(1);
  });

  test("a server whose version is not known keeps none, not unknown", async () => {
    DocsFeedbackStore.useKeeper(keeper);
    isKeepingOn = true;
    mockConfig.AppVersion = "unknown";

    await DocsFeedbackStore.keep({
      page: "monitor/website-monitor",
      isHelpful: true,
      language: "en",
    });

    expect(kept[0]!.version).toBe("");
  });

  test("a keeper that fails is logged, and never fails the page or the answer", async () => {
    DocsFeedbackStore.useKeeper({
      isDocsFeedbackKept: async (): Promise<boolean> => {
        throw new Error("The database is asleep.");
      },
      keepDocsAnswer: async (): Promise<boolean> => {
        throw new Error("The database is asleep.");
      },
    });

    expect(await DocsFeedbackStore.isKept()).toBe(false);
    expect(await DocsFeedback.getMode()).toBe(DocsFeedbackMode.Local);
    expect(
      await DocsFeedbackStore.keep({
        page: "monitor/website-monitor",
        isHelpful: true,
        language: "en",
      }),
    ).toBe(false);
    expect(mockLoggerError).toHaveBeenCalled();
  });

  test("a page that is not one is never handed to the keeper", async () => {
    DocsFeedbackStore.useKeeper(keeper);
    isKeepingOn = true;

    expect(
      await DocsFeedbackStore.keep({
        page: "../../etc/passwd",
        isHelpful: true,
        language: "en",
      }),
    ).toBe(false);
    expect(kept).toEqual([]);
  });
});

describe("a docs search that found nothing (#7207)", () => {
  test("reads what the box posts: what was typed, trimmed, and its language", () => {
    expect(
      DocsSearchReport.read({ query: "  sentinelone  ", language: "de" }),
    ).toEqual({ query: "sentinelone", language: "de" });
    expect(DocsSearchReport.read({ query: "sentinelone" })).toEqual({
      query: "sentinelone",
      language: "en",
    });
    expect(
      DocsSearchReport.read({ query: "sentinelone", language: "klingon" }),
    ).toEqual({ query: "sentinelone", language: "en" });
  });

  test("a search shorter than two characters, or what is not one, is none", () => {
    for (const body of [
      { query: "z" },
      { query: "   " },
      { query: 42 },
      {},
      null,
      [],
      "sentinelone",
    ]) {
      expect(DocsSearchReport.read(body as never)).toBeNull();
    }
  });

  test("a long search is cut before anything is read", () => {
    expect(
      DocsSearchReport.read({ query: "a".repeat(5000) })?.query.length,
    ).toBe(DOCS_SEARCH_REPORT_MAX_LENGTH);
  });

  test("on a self-hosted server it is never sent", async () => {
    expect(DocsSearchReport.isReported()).toBe(false);
    expect(
      await DocsSearchReport.send({ query: "sentinelone", language: "en" }),
    ).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  test("on Cloud it goes as docs/search_found_nothing, under an id of its own, with no person profile and none of the words that could name or reach a person", async () => {
    ON_CLOUD();
    mockPost.mockImplementation(async () => {
      return new HTTPResponse(200, {}, {});
    });

    expect(DocsSearchReport.isReported()).toBe(true);
    expect(
      await DocsSearchReport.send({
        query: "maya.chen@acme.example wazuh +4915123456789 integration",
        language: "fr",
      }),
    ).toBe(true);

    const data: JSONObject = (
      mockPost.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(data["event"]).toBe("docs/search_found_nothing");
    expect(data["distinct_id"]).toEqual(
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(data["properties"]).toEqual({
      source: "oneuptime-docs",
      $process_person_profile: false,
      query_length: 55,
      query: "wazuh integration",
      edition: "cloud",
      language: "fr",
    });
  });

  test("analytics set up on a server that is not Cloud: how long and in what language, never the words", async () => {
    mockConfig.AnalyticsKey = "phc_key";
    mockConfig.AnalyticsHost = "https://analytics.example.com";
    mockPost.mockImplementation(async () => {
      return new HTTPResponse(200, {}, {});
    });

    await DocsSearchReport.send({ query: "wazuh integration", language: "en" });

    expect(
      (mockPost.mock.calls[0]![0] as { data: JSONObject }).data["properties"],
    ).toEqual({
      source: "oneuptime-docs",
      $process_person_profile: false,
      query_length: 17,
      edition: "community",
      language: "en",
    });
  });
});
