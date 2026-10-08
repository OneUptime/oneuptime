import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import InsightHighlights, {
  getInsightRoute,
  getTelemetryServiceRoute,
  loadInsightHighlights,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIInsights/InsightHighlights";
import {
  INSIGHT_HIGHLIGHT_LABELS,
  INSIGHT_HIGHLIGHTS_DESCRIPTION,
  INSIGHT_HIGHLIGHTS_TITLE,
  INSIGHT_SERVICE_HIGHLIGHT_ADVICE,
  describeHighlightFinding,
  describeNewHighlight,
  describeNewestFinding,
  describeServiceHighlight,
  hasHighlights,
  parseAIInsightHighlights,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIInsights/InsightHighlightsData";
import {
  AI_INSIGHT_HIGHLIGHTS_PATH,
  AIInsightHighlightFinding,
  AIInsightHighlights,
} from "../../../Types/AI/AIInsightHighlights";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../Types/AI/AIInsightType";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";
import fs from "fs";
import path from "path";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * What the AI Insights inbox (AI → Insights) leads with, above its filters
 * and its list: the open finding to look at first, with what OneUptime AI's
 * triage concluded about it; the service behind most of them; what is new
 * this week. The words (InsightHighlightsData) and the card
 * (InsightHighlights), loaded from POST /ai-insight/highlights or given. It
 * says nothing while it loads, with nothing open, or when it could not be
 * read: the inbox below is the page either way.
 */

const WAIT_TIMEOUT: number = 20000;

const HOUR: number = 60 * 60 * 1000;

const TOP_ID: string = "99999999-0000-4000-8000-000000000001";
const NEWEST_ID: string = "99999999-0000-4000-8000-000000000002";
const SERVICE_ID: string = "77777777-0000-4000-8000-000000000001";

const INBOX_PATH: string = `/dashboard/${PROJECT_ID}/ai/insights`;

function ago(hours: number): string {
  return new Date(Date.now() - hours * HOUR).toISOString();
}

function topFinding(
  overrides: Partial<AIInsightHighlightFinding> = {},
): AIInsightHighlightFinding {
  return {
    id: TOP_ID,
    title: "Error logs from checkout spiked 6x",
    insightType: AIInsightType.ErrorLogSpike,
    severity: AIInsightSeverity.High,
    serviceName: "checkout",
    occurrenceCount: 3,
    firstSeenAt: ago(30),
    lastSeenAt: ago(2),
    triageSummary: "The 10:42 deploy shortened the gateway client's timeout.",
    ...overrides,
  };
}

function makeHighlights(
  overrides: Partial<AIInsightHighlights> = {},
): AIInsightHighlights {
  return {
    openCount: 12,
    topFinding: topFinding(),
    topService: { id: SERVICE_ID, name: "checkout", count: 5 },
    newCount: 3,
    newest: {
      id: NEWEST_ID,
      title: "p95 latency of GET /api/cart regressed 41%",
      insightType: AIInsightType.TraceLatencyRegression,
      severity: AIInsightSeverity.Medium,
      firstSeenAt: ago(4),
    },
    isPartial: false,
    ...overrides,
  };
}

function toBody(highlights: AIInsightHighlights): JSONObject {
  return JSON.parse(JSON.stringify(highlights)) as JSONObject;
}

// The links inside an element, as "text → href".
function linksIn(element: HTMLElement): Array<string> {
  return Array.from(element.querySelectorAll("a")).map(
    (anchor: HTMLAnchorElement): string => {
      return `${anchor.textContent?.trim()} → ${anchor.getAttribute("href")}`;
    },
  );
}

let postSpy: ReturnType<typeof jest.spyOn>;
let answer: () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

beforeEach(() => {
  goTo(INBOX_PATH);
  answer = async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(200, toBody(makeHighlights()), {});
  };
  postSpy = jest.spyOn(API, "post");
  postSpy.mockImplementation(
    async (): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      return await answer();
    },
  );
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
    tenantid: PROJECT_ID,
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("reading what the highlights route answers", () => {
  test("reads every highlight, as the route sends it", () => {
    const highlights: AIInsightHighlights = makeHighlights();

    expect(parseAIInsightHighlights(toBody(highlights))).toEqual(highlights);
  });

  test.each([
    ["null", null],
    ["a string", "highlights"],
    ["an array", [toBody(makeHighlights())]],
    ["an object without the open count", { topFinding: topFinding() }],
    ["an open count that is not a number", { openCount: "12" }],
  ])("refuses %s", (_label: string, value: unknown) => {
    expect(parseAIInsightHighlights(value)).toBeNull();
  });

  test("with nothing open, there is nothing to lead with", () => {
    const parsed: AIInsightHighlights | null = parseAIInsightHighlights({
      openCount: 0,
      newCount: 0,
      isPartial: false,
    });

    expect(parsed).toEqual({ openCount: 0, newCount: 0, isPartial: false });
    expect(hasHighlights(parsed)).toBe(false);
    expect(hasHighlights(null)).toBe(false);
    expect(hasHighlights(makeHighlights())).toBe(true);
  });

  test("a finding needs its id and its title; a service its name and a count", () => {
    expect(
      parseAIInsightHighlights({
        openCount: 2,
        topFinding: { id: TOP_ID, title: "  " },
        topService: { name: "checkout", count: 0 },
        newCount: 1,
        newest: { title: "No id" },
      }),
    ).toEqual({ openCount: 2, newCount: 1, isPartial: false });
  });

  test("counts are whole and never negative; only a literal true is partial", () => {
    expect(
      parseAIInsightHighlights({
        openCount: 7.8,
        newCount: -3,
        isPartial: "true",
        topFinding: {
          id: TOP_ID,
          title: "x",
          occurrenceCount: 2.5,
        },
        topService: { name: "checkout", count: 3.9 },
      }),
    ).toEqual({
      openCount: 7,
      newCount: 0,
      isPartial: false,
      topFinding: {
        id: TOP_ID,
        title: "x",
        insightType: "",
        severity: "",
        occurrenceCount: 2,
      },
      topService: { name: "checkout", count: 3 },
    });
  });

  test("blank words from the server are left out, never shown empty", () => {
    expect(
      parseAIInsightHighlights({
        openCount: 1,
        newCount: 0,
        topFinding: {
          id: TOP_ID,
          title: "x",
          serviceName: " ",
          triageSummary: "",
          lastSeenAt: "",
          occurrenceCount: -1,
        },
      })!.topFinding,
    ).toEqual({ id: TOP_ID, title: "x", insightType: "", severity: "" });
  });
});

describe("the highlights' words", () => {
  test("the card's title, description and the labels over each highlight", () => {
    expect(INSIGHT_HIGHLIGHTS_TITLE).toBe("What to look at first");
    expect(INSIGHT_HIGHLIGHTS_DESCRIPTION).toBe(
      "The open finding that matters most right now, where most of them are, and what is new.",
    );
    expect(INSIGHT_HIGHLIGHT_LABELS).toEqual({
      topFinding: "Look at this first",
      topService: "Where most of them are",
      newest: "New this week",
    });
    expect(INSIGHT_SERVICE_HIGHLIGHT_ADVICE).toBe(
      "Findings that share a service often share a cause: start there.",
    );
  });

  test("a finding's line: its kind, its service, how often and when last", () => {
    expect(describeHighlightFinding(topFinding(), "Error Log Spike")).toBe(
      "Error Log Spike · in checkout · seen 3 times · last seen 2 hours ago",
    );
    expect(
      describeHighlightFinding(
        topFinding({
          serviceName: undefined,
          occurrenceCount: 1,
          lastSeenAt: undefined,
        }),
        "Metric Drift",
      ),
    ).toBe("Metric Drift · seen 1 time");
    expect(
      describeHighlightFinding(
        topFinding({
          serviceName: undefined,
          occurrenceCount: undefined,
          lastSeenAt: "not a date",
        }),
        "",
      ),
    ).toBe("");
  });

  test("the service behind most of them, out of all the open findings", () => {
    expect(
      describeServiceHighlight({ name: "checkout", count: 5 }, 12),
    ).toBe("The checkout service has 5 of the 12 open findings");
    // Never fewer findings in all than the service has.
    expect(describeServiceHighlight({ name: "checkout", count: 5 }, 3)).toBe(
      "The checkout service has 5 of the 5 open findings",
    );
  });

  test("what is new, and the newest", () => {
    expect(describeNewHighlight(3)).toBe(
      "3 new findings in the last 7 days",
    );
    expect(describeNewHighlight(1)).toBe("1 new finding in the last 7 days");
    expect(
      describeNewestFinding({
        id: NEWEST_ID,
        title: "Latency regressed",
        insightType: "",
        severity: "",
        firstSeenAt: ago(4),
      }),
    ).toBe("The newest: Latency regressed, first seen 4 hours ago.");
    expect(
      describeNewestFinding({
        id: NEWEST_ID,
        title: "Latency regressed",
        insightType: "",
        severity: "",
      }),
    ).toBe("The newest: Latency regressed.");
  });

  test("server text goes into a sentence as it is", () => {
    expect(
      describeServiceHighlight({ name: "<b>{{count}}</b>", count: 2 }, 4),
    ).toBe("The <b>{{count}}</b> service has 2 of the 4 open findings");
  });
});

describe("the card, given its highlights", () => {
  function show(highlights: AIInsightHighlights | null): void {
    render(
      <MemoryRouter>
        <InsightHighlights highlights={highlights} />
      </MemoryRouter>,
    );
  }

  test("leads with the finding to look at first: what it is, what triage concluded, and the way to it", () => {
    show(makeHighlights());

    const card: HTMLElement = screen.getByTestId("ai-insight-highlights");
    expect(within(card).getByText("What to look at first")).toBeInTheDocument();

    const top: HTMLElement = within(card).getByTestId(
      "ai-insight-highlights-top",
    );
    expect(top).toHaveTextContent("Look at this first");
    expect(
      within(top).getByText("Error logs from checkout spiked 6x").tagName,
    ).toBe("H3");
    expect(top).toHaveTextContent(
      /Error Log Spike · in checkout · seen 3 times · last seen /,
    );
    expect(
      within(top).getByTestId("ai-insight-highlights-triage"),
    ).toHaveTextContent(
      "The 10:42 deploy shortened the gateway client's timeout.",
    );
    expect(top).toHaveTextContent("What OneUptime AI found");
    expect(linksIn(top)).toEqual([
      `Open insight → /dashboard/${PROJECT_ID}/ai/insights/${TOP_ID}`,
    ]);
  });

  test("then the service behind most of them, linked to its page", () => {
    show(makeHighlights());

    const service: HTMLElement = screen.getByTestId(
      "ai-insight-highlights-service",
    );
    expect(service).toHaveTextContent("Where most of them are");
    expect(service).toHaveTextContent(
      "The checkout service has 5 of the 12 open findings",
    );
    expect(service).toHaveTextContent(
      "Findings that share a service often share a cause: start there.",
    );
    expect(linksIn(service)).toEqual([
      `Open service → /dashboard/${PROJECT_ID}/service/${SERVICE_ID}`,
    ]);
  });

  test("a service named without its id is named, not linked", () => {
    show(makeHighlights({ topService: { name: "checkout", count: 5 } }));

    expect(
      linksIn(screen.getByTestId("ai-insight-highlights-service")),
    ).toEqual([]);
  });

  test("then what is new, and the way to the newest", () => {
    show(makeHighlights());

    const fresh: HTMLElement = screen.getByTestId("ai-insight-highlights-new");
    expect(fresh).toHaveTextContent("New this week");
    expect(fresh).toHaveTextContent("3 new findings in the last 7 days");
    expect(fresh).toHaveTextContent(
      /The newest: p95 latency of GET \/api\/cart regressed 41%, first seen 4 hours ago\./,
    );
    expect(linksIn(fresh)).toEqual([
      `Open the newest → /dashboard/${PROJECT_ID}/ai/insights/${NEWEST_ID}`,
    ]);
  });

  test("in that order", () => {
    show(makeHighlights());

    expect(
      within(screen.getByTestId("ai-insight-highlights"))
        .getAllByRole("listitem")
        .map((item: HTMLElement): string | null => {
          return item.getAttribute("data-testid");
        }),
    ).toEqual([
      "ai-insight-highlights-top",
      "ai-insight-highlights-service",
      "ai-insight-highlights-new",
    ]);
  });

  test("leaves out what it does not have: no service that stands out, nothing new, no triage", () => {
    show(
      makeHighlights({
        topFinding: topFinding({ triageSummary: undefined }),
        topService: undefined,
        newCount: 0,
        newest: undefined,
      }),
    );

    expect(screen.getByTestId("ai-insight-highlights-top")).toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-insight-highlights-triage"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-insight-highlights-service"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-insight-highlights-new"),
    ).not.toBeInTheDocument();
  });

  test("new findings without the newest named say nothing about them", () => {
    show(makeHighlights({ newCount: 2, newest: undefined }));

    expect(
      screen.queryByTestId("ai-insight-highlights-new"),
    ).not.toBeInTheDocument();
  });

  test("with nothing to lead with, there is no card at all", () => {
    show(makeHighlights({ topFinding: undefined }));
    expect(
      screen.queryByTestId("ai-insight-highlights"),
    ).not.toBeInTheDocument();
    cleanup();

    show(null);
    expect(
      screen.queryByTestId("ai-insight-highlights"),
    ).not.toBeInTheDocument();
    // Given its highlights, it never asks the server.
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("server text is shown as text, never as markup", () => {
    const markup: string = '<img src="x" onerror="window.hacked=1">';
    show(
      makeHighlights({
        topFinding: topFinding({
          title: markup,
          serviceName: markup,
          triageSummary: markup,
        }),
        topService: { id: SERVICE_ID, name: markup, count: 5 },
      }),
    );

    expect(screen.getByTestId("ai-insight-highlights-top")).toHaveTextContent(
      markup,
    );
    expect(
      screen.getByTestId("ai-insight-highlights-triage"),
    ).toHaveTextContent(markup);
    expect(document.querySelector("img")).toBeNull();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  // An icon is a <div>: inside a <p> or a heading it is invalid markup.
  test("never puts a block inside a paragraph or a heading", () => {
    show(makeHighlights());

    expect(
      document.querySelectorAll("p div, p p, h3 div, h3 p, p dl"),
    ).toHaveLength(0);
  });
});

describe("the highlights' words are in every Dashboard locale", () => {
  const LOCALES_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Locales",
  );
  const WORDS: Array<string> = [
    INSIGHT_HIGHLIGHTS_TITLE,
    INSIGHT_HIGHLIGHTS_DESCRIPTION,
    INSIGHT_HIGHLIGHT_LABELS.topFinding,
    INSIGHT_HIGHLIGHT_LABELS.topService,
    INSIGHT_HIGHLIGHT_LABELS.newest,
    INSIGHT_SERVICE_HIGHLIGHT_ADVICE,
    "The {{name}} service has {{shown}} of the {{count}} open findings",
    "{{count}} new findings in the last 7 days",
    "The newest: {{title}}, first seen {{when}}.",
    "The newest: {{title}}.",
    "in {{service}}",
    "Open the newest",
    "Open service",
    "OneUptime AI watches your telemetry around the clock and tells you about problems before anyone is paged: new or spiking exceptions, error-log spikes, slower requests and metrics that drift. Insights never page and never open incidents.",
  ];

  test.each(
    fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json") && file !== "en.json";
      })
      .map((file: string): string => {
        return file.replace(/\.json$/, "");
      }),
  )("%s says each in its own words", (code: string) => {
    const locale: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
    ) as Record<string, unknown>;

    expect(
      WORDS.filter((word: string): boolean => {
        return typeof locale[word] !== "string" || locale[word] === word;
      }),
    ).toEqual([]);
  });
});

describe("the card, loading its highlights", () => {
  function open(): void {
    render(
      <MemoryRouter>
        <InsightHighlights />
      </MemoryRouter>,
    );
  }

  test("asks the highlights route, with the project's headers, and shows what it answers", async () => {
    open();

    expect(
      await screen.findByTestId(
        "ai-insight-highlights",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledTimes(1);

    const request: JSONObject = postSpy.mock.calls[0]![0] as JSONObject;
    expect(String(request["url"])).toMatch(
      new RegExp(`/api${AI_INSIGHT_HIGHLIGHTS_PATH}$`),
    );
    expect(request["data"]).toEqual({});
    expect(request["headers"]).toEqual({ tenantid: PROJECT_ID });
  });

  test.each([
    [
      "an error",
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(403, { message: "No." }, {});
      },
    ],
    [
      "a failed request",
      async (): Promise<HTTPErrorResponse> => {
        throw new Error("Network Error");
      },
    ],
    [
      "a body it cannot read",
      async (): Promise<HTTPResponse<JSONObject>> => {
        return new HTTPResponse<JSONObject>(200, { open: "lots" }, {});
      },
    ],
    [
      "nothing open",
      async (): Promise<HTTPResponse<JSONObject>> => {
        return new HTTPResponse<JSONObject>(
          200,
          { openCount: 0, newCount: 0, isPartial: false },
          {},
        );
      },
    ],
  ])(
    "%s shows nothing: the inbox below is the page either way",
    async (
      _label: string,
      next: () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>,
    ) => {
      answer = next;
      open();

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByTestId("ai-insight-highlights"),
      ).not.toBeInTheDocument();
      expect(document.body.textContent).toBe("");
    },
  );

  test("an answer that lands after the card is gone is dropped", async () => {
    let release: (() => void) | undefined;
    answer = async (): Promise<HTTPResponse<JSONObject>> => {
      await new Promise<void>((resolve: () => void) => {
        release = resolve;
      });
      return new HTTPResponse<JSONObject>(200, toBody(makeHighlights()), {});
    };
    const errors: ReturnType<typeof jest.spyOn> = jest.spyOn(
      console,
      "error",
    );

    open();
    await act(async () => {
      await Promise.resolve();
    });
    cleanup();

    await act(async () => {
      release!();
      await Promise.resolve();
    });

    expect(
      screen.queryByTestId("ai-insight-highlights"),
    ).not.toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
  });

  test("the loader on its own: the highlights, or nothing", async () => {
    const highlights: AIInsightHighlights = makeHighlights();
    answer = async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(200, toBody(highlights), {});
    };
    expect(await loadInsightHighlights()).toEqual(highlights);

    answer = async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(500, { message: "down" }, {});
    };
    expect(await loadInsightHighlights()).toBeNull();
  });

  test("findings and services link to their own pages in this project", () => {
    expect(getInsightRoute(TOP_ID).toString()).toBe(
      `/dashboard/${PROJECT_ID}/ai/insights/${TOP_ID}`,
    );
    expect(getTelemetryServiceRoute(SERVICE_ID).toString()).toBe(
      `/dashboard/${PROJECT_ID}/service/${SERVICE_ID}`,
    );
  });
});
