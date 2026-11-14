import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The telemetry guided setup, step by step (issue #6806): the setup guide
 * and the wait for the first data, then recommended alerts on the service
 * that reported, created in one click. It ends with a monitor on the data
 * or with "not now"; the records decide which step a returning person
 * lands on; nothing is made twice; the Free plan's acknowledgement is
 * asked; and who is told is said.
 */

const api: Record<string, MockFunction> = {
  loadService: getJestMockFunction(),
  loadReportingServices: getJestMockFunction(),
  loadCoveredRecommendationIds: getJestMockFunction(),
  createMonitors: getJestMockFunction(),
  loadMonitors: getJestMockFunction(),
};
let mayCreate: boolean = true;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetupApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetupApi",
    ) as Record<string, unknown>;
    const calls: Record<string, (...args: Array<unknown>) => unknown> = {};

    for (const name of [
      "loadService",
      "loadReportingServices",
      "loadCoveredRecommendationIds",
      "createMonitors",
      "loadMonitors",
    ]) {
      calls[name] = (...args: Array<unknown>): unknown => {
        return api[name]!(...args);
      };
    }

    return {
      __esModule: true,
      default: calls,
      getTelemetryRecommendations: actual["getTelemetryRecommendations"],
      mayCreateMonitors: (): boolean => {
        return mayCreate;
      },
    };
  },
);

const loadWhoIsToldFacts: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownApi",
  () => {
    return {
      __esModule: true,
      default: {
        loadWhoIsToldFacts: (...args: Array<unknown>) => {
          return loadWhoIsToldFacts(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/Documentation",
  () => {
    return {
      __esModule: true,
      default: (props: { telemetryType?: string; isBare?: boolean }) => {
        return (
          <div
            data-testid="telemetry-guide"
            data-type={props.telemetryType}
            data-bare={String(Boolean(props.isBare))}
          />
        );
      },
    };
  },
);

// The wait: here a button stands in for the first service reporting.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOnboarding/ResourceConnectionWatch",
  () => {
    return {
      __esModule: true,
      default: (props: {
        onConnected?: (record: {
          _id: string;
          getColumnValue: (name: string) => unknown;
        }) => void;
      }) => {
        return (
          <button
            type="button"
            data-testid="first-data-arrives"
            onClick={() => {
              props.onConnected?.({
                _id: "svc-new",
                getColumnValue: (name: string): unknown => {
                  return name === "name" ? "checkout" : undefined;
                },
              });
            }}
          >
            Waiting
          </button>
        );
      },
    };
  },
);

let consentRequired: boolean = false;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PayAsYouGo",
  () => {
    return {
      __esModule: true,
      isMonitorBatchConsentRequired: (): boolean => {
        return consentRequired;
      },
      MonitorBatchPayAsYouGoConsent: (props: {
        value: boolean;
        onChange: (value: boolean) => void;
      }) => {
        return consentRequired ? (
          <input
            type="checkbox"
            data-testid="billing-consent"
            checked={props.value}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              props.onChange(event.target.checked);
            }}
          />
        ) : (
          <></>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to: { toString: () => string };
        children: React.ReactNode;
        dataTestId?: string;
      }) => {
        return (
          <a href={props.to.toString()} data-testid={props.dataTestId}>
            {props.children}
          </a>
        );
      },
    };
  },
);

const sendMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ProductEvents", () => {
  return {
    __esModule: true,
    default: {
      send: (...args: Array<unknown>) => {
        return sendMock(...args);
      },
    },
  };
});

import TelemetryGuidedSetup from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetryGuidedSetup";
import { getGuidedSetupRunKey } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupProgress";
import { TELEMETRY_SETUP_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetup";
import { getTelemetryRecommendations } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetupApi";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { MonitorRecommendation } from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "65f00000-0000-4000-8000-000000006806";
const USER_ID: string = "40000000-0000-4000-8000-000000000001";

const RUN_KEY: string = getGuidedSetupRunKey({
  setup: "telemetry",
  projectId: PROJECT_ID,
  userId: USER_ID,
});

const RECOMMENDATIONS: Array<MonitorRecommendation> =
  getTelemetryRecommendations();
const IDS: Array<string> = RECOMMENDATIONS.map((r: MonitorRecommendation) => {
  return r.recommendationId;
});

const storedRun: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  return JSON.parse(window.localStorage.getItem(RUN_KEY) || "{}") as Record<
    string,
    unknown
  >;
};

const keepRun: (run: Record<string, unknown>) => void = (
  run: Record<string, unknown>,
): void => {
  window.localStorage.setItem(RUN_KEY, JSON.stringify(run));
};

const renderSetup: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(<TelemetryGuidedSetup />);
  });

  await waitFor(() => {
    expect(screen.getByTestId("guided-setup")).toBeInTheDocument();
  });
};

const stepState: (key: string) => string | null = (
  key: string,
): string | null => {
  return screen
    .getByTestId(`guided-setup-step-${key}`)
    .getAttribute("data-state");
};

const press: (testId: string) => Promise<void> = async (
  testId: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

const sent: (name: ProductEventName) => Array<Record<string, unknown>> = (
  name: ProductEventName,
): Array<Record<string, unknown>> => {
  return sendMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return call[0] === name;
    })
    .map((call: Array<unknown>): Record<string, unknown> => {
      return call[1] as Record<string, unknown>;
    });
};

const reachAlertStep: () => Promise<void> = async (): Promise<void> => {
  await renderSetup();
  await press("first-data-arrives");
  await waitFor(() => {
    expect(
      screen.getByTestId("guided-setup-recommendations"),
    ).toBeInTheDocument();
  });
};

beforeEach(() => {
  window.localStorage.clear();
  mayCreate = true;
  consentRequired = false;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(USER_ID));

  api["loadService"]!.mockResolvedValue({
    id: "svc-new",
    name: "checkout",
    hasReported: true,
  });
  api["loadReportingServices"]!.mockResolvedValue([]);
  api["loadCoveredRecommendationIds"]!.mockResolvedValue([]);
  api["createMonitors"]!.mockResolvedValue({
    createdIds: ["mon-1", "mon-2", "mon-3"],
    failures: [],
  });
  api["loadMonitors"]!.mockImplementation((async (ids: Array<string>) => {
    return ids.map((id: string) => {
      return { id: id, name: `checkout ${id}` };
    });
  }) as unknown as (...args: Array<unknown>) => unknown);
  loadWhoIsToldFacts.mockResolvedValue({
    policyCount: 0,
    incidentRuleCount: 0,
    alertRuleCount: 0,
    mayCreatePolicy: true,
    mayAddEscalationRules: true,
    mayAddRules: true,
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  for (const mock of Object.values(api)) {
    mock.mockReset();
  }
  loadWhoIsToldFacts.mockReset();
  sendMock.mockReset();
  window.localStorage.clear();
});

describe("1. Send your first data", () => {
  test("opens with the setup guide, OpenTelemetry for all three signals, and the wait", async () => {
    await renderSetup();

    expect(stepState("send")).toBe("open");
    expect(stepState("alert")).toBe("upcoming");
    expect(screen.getByTestId("telemetry-guide")).toHaveAttribute(
      "data-type",
      "traces",
    );
    expect(screen.getByTestId("telemetry-guide")).toHaveAttribute(
      "data-bare",
      "true",
    );
    expect(screen.getByTestId("first-data-arrives")).toBeInTheDocument();
    expect(sent(ProductEventName.GuidedSetupStarted)).toEqual([
      { setup: "telemetry" },
    ]);
  });

  test("the first data keeps the service in the run and opens the alert step", async () => {
    await reachAlertStep();

    expect(storedRun()).toEqual({ serviceId: "svc-new" });
    expect(stepState("send")).toBe("done");
    expect(
      screen.getByTestId("guided-setup-step-send-done-line"),
    ).toHaveTextContent("checkout is sending data.");
    expect(stepState("alert")).toBe("open");
  });

  test("a project already sending data can pick a service that has reported", async () => {
    api["loadReportingServices"]!.mockResolvedValue([
      { id: "svc-old", name: "billing", hasReported: true },
    ]);
    await renderSetup();

    expect(
      screen.getByTestId("guided-setup-reporting-services"),
    ).toHaveTextContent("Use billing");
    await press("guided-setup-use-service-svc-old");

    expect(storedRun()).toEqual({ serviceId: "svc-old" });
    expect(stepState("alert")).toBe("open");
  });

  test("a project with no reporting service is not offered one", async () => {
    await renderSetup();

    expect(
      screen.queryByTestId("guided-setup-reporting-services"),
    ).not.toBeInTheDocument();
  });
});

describe("2. Get alerted", () => {
  test("offers the three recommended monitors for the service, all ticked", async () => {
    await reachAlertStep();

    expect(
      api["loadCoveredRecommendationIds"]!.mock.calls[0]![0],
    ).toMatchObject({ service: { id: "svc-new", name: "checkout" } });
    for (const recommendation of RECOMMENDATIONS) {
      expect(
        screen.getByTestId(`guided-setup-pick-${recommendation.templateId}`),
      ).toBeChecked();
    }
    expect(
      screen.getByTestId("guided-setup-create-monitors"),
    ).toHaveTextContent("Create 3 monitors");
  });

  test("says these are alerts for the team, and who is told: the owners, with no on-call policy", async () => {
    await reachAlertStep();

    const who: HTMLElement = screen.getByTestId("guided-setup-who-is-told");
    expect(who).toHaveTextContent(TELEMETRY_SETUP_COPY.alertsNotIncidents);
    expect(who).toHaveTextContent(TELEMETRY_SETUP_COPY.whoOwners);
    expect(screen.getByTestId("guided-setup-page-someone")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/on-call-duty/setup`,
    );
  });

  test("a project that pages people already is told its on-call rules decide", async () => {
    loadWhoIsToldFacts.mockResolvedValue({
      policyCount: 1,
      incidentRuleCount: 1,
      alertRuleCount: 1,
      mayCreatePolicy: true,
      mayAddEscalationRules: true,
      mayAddRules: true,
    });
    await reachAlertStep();

    expect(screen.getByTestId("guided-setup-who-is-told")).toHaveTextContent(
      TELEMETRY_SETUP_COPY.whoExisting,
    );
    expect(
      screen.queryByTestId("guided-setup-page-someone"),
    ).not.toBeInTheDocument();
  });

  test("creates the ones picked in one click, keeps them in the run, and finishes", async () => {
    await reachAlertStep();
    await act(async () => {
      fireEvent.click(
        screen.getByTestId(
          `guided-setup-pick-${RECOMMENDATIONS[1]!.templateId}`,
        ),
      );
    });
    await press("guided-setup-create-monitors");

    const call: Record<string, unknown> = api["createMonitors"]!.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(call["recommendationIds"]).toEqual([IDS[0], IDS[2]]);
    expect(call["service"]).toMatchObject({ id: "svc-new" });
    expect(storedRun()).toEqual({
      serviceId: "svc-new",
      monitorIds: "mon-1,mon-2,mon-3",
    });
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    expect(
      screen.getByTestId("guided-setup-step-alert-done-line"),
    ).toHaveTextContent("3 monitors watch checkout.");
    expect(sent(ProductEventName.GuidedSetupFinished)).toHaveLength(1);
  });

  test("nothing picked is said, and makes nothing", async () => {
    await reachAlertStep();
    for (const recommendation of RECOMMENDATIONS) {
      await act(async () => {
        fireEvent.click(
          screen.getByTestId(`guided-setup-pick-${recommendation.templateId}`),
        );
      });
    }
    await press("guided-setup-create-monitors");

    expect(
      screen.getByText(TELEMETRY_SETUP_COPY.nothingPicked),
    ).toBeInTheDocument();
    expect(api["createMonitors"]).not.toHaveBeenCalled();
  });

  test("Not now ends the setup too, and is kept in the run", async () => {
    await reachAlertStep();
    await press("guided-setup-not-now");

    expect(storedRun()).toEqual({ serviceId: "svc-new", alertSkipped: true });
    expect(api["createMonitors"]).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("guided-setup-summary-watched-by"),
    ).toHaveTextContent(TELEMETRY_SETUP_COPY.summaryNotWatched);
    expect(sent(ProductEventName.GuidedSetupFinished)).toHaveLength(1);
  });

  test("a monitor the service has already is shown as watched, and not offered again", async () => {
    api["loadCoveredRecommendationIds"]!.mockResolvedValue([IDS[0]]);
    await reachAlertStep();

    expect(
      screen.getByTestId(
        `guided-setup-recommendation-${RECOMMENDATIONS[0]!.templateId}`,
      ),
    ).toHaveTextContent(TELEMETRY_SETUP_COPY.alreadyWatched);
    expect(
      screen.queryByTestId(
        `guided-setup-pick-${RECOMMENDATIONS[0]!.templateId}`,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("guided-setup-create-monitors"),
    ).toHaveTextContent("Create 2 monitors");
  });

  test("a service watched by all three already is confirmed with Continue", async () => {
    api["loadCoveredRecommendationIds"]!.mockResolvedValue(IDS);
    await reachAlertStep();

    expect(
      screen.queryByTestId("guided-setup-create-monitors"),
    ).not.toBeInTheDocument();
    await press("guided-setup-alert-continue");

    expect(storedRun()).toEqual({ serviceId: "svc-new", alertConfirmed: true });
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
  });

  test("on the Free plan, create waits for the billing acknowledgement", async () => {
    consentRequired = true;
    await reachAlertStep();

    expect(screen.getByTestId("guided-setup-create-monitors")).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("billing-consent"));
    });
    expect(screen.getByTestId("guided-setup-create-monitors")).toBeEnabled();
    await press("guided-setup-create-monitors");

    expect(
      (api["createMonitors"]!.mock.calls[0]![0] as Record<string, unknown>)[
        "hasAcknowledgedBilling"
      ],
    ).toBe(true);
  });

  test("a refused monitor is named with its reason; the ones made stay, and Continue moves on", async () => {
    api["createMonitors"]!.mockResolvedValue({
      createdIds: ["mon-1"],
      failures: [{ name: "checkout Error Burst", message: "Limit reached" }],
    });
    await reachAlertStep();
    await press("guided-setup-create-monitors");

    expect(
      screen.getByTestId("guided-setup-create-failures"),
    ).toHaveTextContent("checkout Error Burst: Limit reached");
    expect(stepState("alert")).toBe("open");
    expect(storedRun()["monitorIds"]).toBe("mon-1");
    await press("guided-setup-alert-continue-anyway");
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
  });

  test("an error says the server's reason and keeps the step open", async () => {
    api["createMonitors"]!.mockRejectedValue(new Error("Something broke"));
    await reachAlertStep();
    await press("guided-setup-create-monitors");

    expect(screen.getByText("Something broke")).toBeInTheDocument();
    expect(stepState("alert")).toBe("open");
  });

  test("someone who may not create monitors is told so, and can still say not now", async () => {
    mayCreate = false;
    await reachAlertStep();

    expect(
      screen.getByText(TELEMETRY_SETUP_COPY.cannotCreateMonitors),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("guided-setup-create-monitors"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("guided-setup-not-now")).toBeInTheDocument();
  });
});

describe("the summary", () => {
  test("lists the monitors made, each opening its page, and says what is next on the service", async () => {
    keepRun({ serviceId: "svc-new", monitorIds: "mon-1,mon-2" });
    await renderSetup();

    expect(screen.getByTestId("guided-setup-summary")).toHaveTextContent(
      "checkout is sending data",
    );
    expect(screen.getByText("checkout mon-1")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/mon-1`,
    );
    expect(
      screen.getByTestId("guided-setup-more-recommendations"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/service/svc-new/recommendations`,
    );
    expect(screen.getByText("View its logs")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/service/svc-new/logs`,
    );
  });

  test("Set up another service starts a new run", async () => {
    keepRun({ serviceId: "svc-new", alertSkipped: true });
    await renderSetup();
    await press("guided-setup-start-over");

    expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
    expect(stepState("send")).toBe("open");
  });
});

describe("leaving and coming back", () => {
  test("a service that reported opens the alert step, and asks nothing again", async () => {
    keepRun({ serviceId: "svc-new" });
    await renderSetup();

    await waitFor(() => {
      expect(stepState("alert")).toBe("open");
    });
    expect(stepState("send")).toBe("done");
    expect(api["loadService"]).toHaveBeenCalledWith("svc-new");
  });

  test("monitors deleted since open the alert step again", async () => {
    keepRun({ serviceId: "svc-new", monitorIds: "mon-1" });
    api["loadMonitors"]!.mockResolvedValue([]);
    await renderSetup();

    await waitFor(() => {
      expect(stepState("alert")).toBe("open");
    });
  });

  test("a service deleted since starts the run again", async () => {
    keepRun({ serviceId: "svc-gone", alertSkipped: true });
    api["loadService"]!.mockResolvedValue(null);
    await renderSetup();

    expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
    expect(stepState("send")).toBe("open");
  });

  test("a done step opened again goes back to the summary on Continue", async () => {
    keepRun({ serviceId: "svc-new", alertSkipped: true });
    await renderSetup();
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("guided-setup-step-send").querySelector("button")!,
      );
    });
    await press("guided-setup-send-continue");

    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
  });
});
