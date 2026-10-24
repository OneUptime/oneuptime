import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { act } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * A slow-code finding's page (Profiler → AI → Insights → one finding):
 * while it is open with no fix linked, "Fix with AI" as the Profiler offers
 * it for the function - what an AI rule that asks before fixing leaves to a
 * person. The fix it starts names the finding; once it has, the page reads
 * the finding again and shows its fix task instead. "Open in Profiler" goes
 * to the function, in the window it was found in.
 *
 * The UI review: the offer said what was found a third time (the title and
 * the evidence say it), now it says what Fix with AI does; Create Monitor
 * was greyed out ("Monitors cannot be created from this kind of insight
 * yet"), now it opens the Profiler's own monitor on the function; and the
 * panels' titles and labels were English in every language.
 */

const INSIGHT_ID: string = "5092fafa-1111-4111-8111-111111111111";
const SERVICE_ID: string = "5092fafa-2222-4222-8222-222222222222";
const TASK_ID: string = "5092fafa-3333-4333-8333-333333333333";

const postMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;
const getItemMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

// The page reads its insight's id from the route; the rest is the router's own.
jest.mock("react-router-dom", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "react-router-dom",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    useParams: () => {
      return { id: INSIGHT_ID };
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "Request failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 5 });
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

// The words a test reads in another language; English otherwise.
const translations: Record<string, string> = {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return translations[value] || value;
        },
      };
    },
  };
});

import AIInsightViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AIInsights/View/Index";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import { ProfileInsightEvidence } from "../../../Types/AI/AIInsightEvidence";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  FIX_HOT_SENTENCE,
  FIX_WITH_AI_TOOLTIP,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileCopy";

// The Profiler's own address, whatever project it is under.
const PROFILER_PATH: RegExp = /\/profiles$/;
// Create Monitor's address, whatever project it is under.
const MONITOR_CREATE_PATH: RegExp = /\/monitors\/create$/;

const PROFILE: ProfileInsightEvidence = {
  serviceId: SERVICE_ID,
  functionName: "OrderParser.parse",
  fileName: "src/orders/parser.ts",
  lineNumber: 42,
  profileType: "cpu",
  category: "cpu",
  reason: "Hot",
  ownShare: 18,
  functionSampleCount: 900,
  windowSampleCount: 5000,
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
  callers: [],
  callees: [],
};

interface Finding {
  status: AIInsightStatus;
  fixAiRunId: ObjectID | null;
  insightType: AIInsightType;
}

let finding: Finding;

function buildInsight(): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(INSIGHT_ID);
  insight.title = "OrderParser.parse takes 18% of the CPU time in checkout";
  insight.insightType = finding.insightType;
  insight.severity = AIInsightSeverity.Medium;
  insight.status = finding.status;
  insight.serviceName = "checkout";
  insight.telemetryServiceId = new ObjectID(SERVICE_ID);
  insight.detailMarkdown = "OrderParser.parse takes 18% of the CPU time.";
  insight.evidence = { profile: PROFILE };
  insight.lastSeenAt = new Date("2026-10-24T09:00:00.000Z");
  if (finding.fixAiRunId) {
    insight.fixAiRunId = finding.fixAiRunId;
  }
  return insight;
}

function posted(route: string): Array<JSONObject> {
  return postMock.mock.calls
    .map((call: Array<any>): JSONObject => {
      return call[0] as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).includes(route);
    })
    .map((request: JSONObject): JSONObject => {
      return request["data"] as JSONObject;
    });
}

beforeEach(() => {
  finding = {
    status: AIInsightStatus.ActionRequired,
    fixAiRunId: null,
    insightType: AIInsightType.ProfileHotspot,
  };

  getItemMock.mockImplementation(() => {
    return Promise.resolve(buildInsight());
  });

  postMock.mockImplementation(
    async (args: {
      url: { toString: () => string };
    }): Promise<HTTPResponse<JSONObject>> => {
      const url: string = args.url.toString();

      if (url.includes("/ai-investigation/profile-fix-suggestion")) {
        return new HTTPResponse<JSONObject>(
          200,
          {
            offer: SuggestionOffer.Act,
            reason: "Hot",
            blocker: null,
            evidence: {
              category: "cpu",
              isOwnCode: true,
              ownShare: 18,
              functionSampleCount: 900,
              windowSampleCount: 5000,
            },
            repository: {
              id: "5092fafa-4444-4444-8444-444444444444",
              name: "acme/shop",
            },
            repositories: [],
            taskId: null,
          } as unknown as JSONObject,
          {},
        );
      }

      if (url.includes("/ai-investigation/create-profile-fix-task")) {
        // The finding links the task once it has started.
        finding.fixAiRunId = new ObjectID(TASK_ID);
        finding.status = AIInsightStatus.FixOpened;
        return new HTTPResponse<JSONObject>(200, { taskId: TASK_ID }, {});
      }

      // The triage panel: none yet.
      return new HTTPResponse<JSONObject>(200, { run: null, events: [] }, {});
    },
  );
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  jest.restoreAllMocks();

  for (const key of Object.keys(translations)) {
    delete translations[key];
  }
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <AIInsightViewPage
          pageRoute={new Route("/")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

describe("a slow-code finding's page", () => {
  test("offers Fix with AI for the function, read in the window it was found in", async () => {
    await renderPage();

    expect(
      await screen.findByTestId("profiles-fix-with-ai"),
    ).toBeInTheDocument();

    const [asked] = posted("/ai-investigation/profile-fix-suggestion");

    expect(asked).toEqual(
      expect.objectContaining({
        serviceId: SERVICE_ID,
        functionName: "OrderParser.parse",
        fileName: "src/orders/parser.ts",
        profileType: "cpu",
        startTime: "2026-10-24T08:00:00.000Z",
        endTime: "2026-10-24T09:00:00.000Z",
      }),
    );
  });

  test("the fix names the finding, and the page then shows the finding's fix task", async () => {
    await renderPage();

    fireEvent.click(await screen.findByTestId("profiles-fix-with-ai"));

    await waitFor(() => {
      expect(posted("/ai-investigation/create-profile-fix-task")).toHaveLength(
        1,
      );
    });

    expect(posted("/ai-investigation/create-profile-fix-task")[0]).toEqual(
      expect.objectContaining({
        insightId: INSIGHT_ID,
        serviceId: SERVICE_ID,
        functionName: "OrderParser.parse",
      }),
    );

    // The finding is read again: its fix task now shows, and the offer goes.
    expect(
      await screen.findByText("View the fix task and pull request"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId("profiles-fix")).not.toBeInTheDocument();
    });
  });

  test("the offer says what Fix with AI does, not the finding a third time", async () => {
    await renderPage();

    const strip: HTMLElement = await screen.findByTestId("profiles-fix");

    expect(await screen.findByTestId("profiles-fix-finding")).toHaveTextContent(
      FIX_WITH_AI_TOOLTIP,
    );
    // Not the Profiler's own lead, which names the share again.
    expect(strip).not.toHaveTextContent(
      FIX_HOT_SENTENCE.substring(0, FIX_HOT_SENTENCE.indexOf(",")),
    );
  });

  test("Create Monitor opens a Profiles monitor on the function, set above the share it takes now", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    await renderPage();

    const button: HTMLElement = await screen.findByRole("button", {
      name: "Create Monitor",
    });

    // Offered, not greyed out with "cannot be created from this kind".
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    const target: string = String(navigate.mock.calls[0]![0]);
    const query: URLSearchParams = new URLSearchParams(
      target.substring(target.indexOf("?") + 1),
    );

    expect(target.split("?")[0]).toMatch(MONITOR_CREATE_PATH);
    expect(query.get("profileServiceId")).toBe(SERVICE_ID);
    expect(query.get("profileFunction")).toBe("OrderParser.parse");
    expect(query.get("profileType")).toBe("cpu");
    // 18% now: the threshold is above it (18 + 10, to the next 5).
    expect(query.get("profileThreshold")).toBe("30");
    // Not the AI insight prefill, which has no monitor for slow code.
    expect(query.get("aiInsightId")).toBeNull();
  });

  test("its panels' titles and labels are drawn in the reader's language", async () => {
    translations["Evidence"] = "Belege";
    translations["Details"] = "Einzelheiten";
    translations["Service"] = "Dienst";

    await renderPage();

    expect(await screen.findByText("Belege")).toBeInTheDocument();
    expect(screen.getByText("Einzelheiten")).toBeInTheDocument();
    expect(screen.getByText("Dienst")).toBeInTheDocument();
    expect(screen.queryByText("Evidence")).not.toBeInTheDocument();
  });

  test("Open in Profiler goes to the function, in the window it was found in", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Open in Profiler" }),
    );

    const target: string = String(navigate.mock.calls[0]![0]);
    const query: URLSearchParams = new URLSearchParams(
      target.substring(target.indexOf("?") + 1),
    );

    expect(target.split("?")[0]).toMatch(PROFILER_PATH);
    expect(query.get("serviceId")).toBe(SERVICE_ID);
    expect(query.get("function")).toBe("OrderParser.parse");
    expect(query.get("file")).toBe("src/orders/parser.ts");
    expect(query.get("startTime")).toBe("2026-10-24T08:00:00.000Z");
    expect(query.get("endTime")).toBe("2026-10-24T09:00:00.000Z");

    navigate.mockRestore();
  });

  test.each([
    [
      "a fix already linked",
      (): void => {
        finding.fixAiRunId = new ObjectID(TASK_ID);
        finding.status = AIInsightStatus.FixOpened;
      },
    ],
    [
      "a resolved finding",
      (): void => {
        finding.status = AIInsightStatus.Resolved;
      },
    ],
    [
      "another kind of finding",
      (): void => {
        finding.insightType = AIInsightType.TraceLatencyRegression;
      },
    ],
  ])("offers nothing for %s", async (_name: string, change: () => void) => {
    change();
    await renderPage();

    await screen.findByText(
      "OrderParser.parse takes 18% of the CPU time in checkout",
    );

    expect(screen.queryByTestId("profiles-fix")).not.toBeInTheDocument();
    expect(posted("/ai-investigation/profile-fix-suggestion")).toHaveLength(0);
  });
});
