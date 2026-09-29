import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import Permission from "../../../Types/Permission";

/*
 * https://github.com/OneUptime/oneuptime/issues/3867
 *
 * "Test Monitor" on the Monitor Overview's summary card.
 *
 * The card is where a reader already asks "is this working right now", so it
 * is where the on-demand version of that question belongs. What these pin is
 * when the action is offered at all - because the summary card renders for
 * every monitor type except Manual, while a test only means something for the
 * fourteen types a probe actually runs, and only when there are steps to run
 * and something to run them on.
 *
 * The other half is coexistence: the card's right-hand slot already holds the
 * "Showing results from:" probe picker, and an implementation that reached for
 * the same slot would silently replace it - the regression that issue #2899
 * was about. So every test that expects the button also checks the picker is
 * still there.
 *
 * ModelAPI is stubbed because MonitorTestForm imports it; nothing here presses
 * the button, so the stub only has to exist.
 */

let currentPermissions: Array<Permission> = [Permission.ProjectAdmin];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: (): Promise<never> => {
        return Promise.reject(new Error("not used"));
      },
      getItem: (): Promise<null> => {
        return Promise.resolve(null);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return currentPermissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

/*
 * SummaryInfo is the real component, wrapped so each render's props are
 * recorded: "what did the card show on its very first commit" cannot be
 * asserted after the fact from the DOM alone, because effects have run by
 * the time render() returns.
 */
const mockSummaryInfoRenders: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo",
  () => {
    const actual: {
      default: React.FunctionComponent<Record<string, unknown>>;
    } = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo",
    ) as { default: React.FunctionComponent<Record<string, unknown>> };
    const ReactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        mockSummaryInfoRenders.push(props);
        return ReactModule.createElement(actual.default, props);
      },
    };
  },
);

import Summary from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/Summary";
import Probe from "../../../Models/DatabaseModels/Probe";
import { MonitorStepProbeResponse } from "../../../Models/DatabaseModels/MonitorProbe";
import Dictionary from "../../../Types/Dictionary";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "../../../Types/ObjectID";

const MONITOR_ID: string = "11111111-1111-4111-8111-111111111111";
const PROBE_ID: string = "44444444-4444-4444-8444-444444444444";
const DISABLED_PROBE_ID: string = "55555555-5555-4555-8555-555555555555";

function probe(id: string, name: string): Probe {
  return Object.assign(new Probe(), { _id: id, name: name });
}

const ATTACHED_PROBES: Array<Probe> = [probe(PROBE_ID, "Ohio Probe")];

function stepsWith(count: number): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();

  monitorSteps.data = {
    monitorStepsInstanceArray: Array.from({ length: count }, () => {
      return new MonitorStep();
    }),
  };

  return monitorSteps;
}

interface SummaryOptions {
  monitorType?: MonitorType | undefined;
  monitorSteps?: MonitorSteps | undefined;
  /*
   * Spelled as its own flag rather than `monitorSteps: undefined`, which a
   * `?? default` in this helper would silently turn back into the default -
   * and the test would then assert the opposite of what it says.
   */
  withoutMonitorSteps?: boolean | undefined;
  probes?: Array<Probe> | undefined;
  disabledProbeIds?: Array<string> | undefined;
  withoutMonitorId?: boolean | undefined;
}

function renderSummary(options: SummaryOptions = {}): void {
  const monitorSteps: MonitorSteps | undefined = options.withoutMonitorSteps
    ? undefined
    : options.monitorSteps || stepsWith(1);

  if (options.withoutMonitorId) {
    render(
      <Summary
        monitorType={options.monitorType || MonitorType.Website}
        monitorSteps={monitorSteps}
        probes={options.probes || ATTACHED_PROBES}
        disabledProbeIds={options.disabledProbeIds}
      />,
    );

    return;
  }

  render(
    <Summary
      monitorType={options.monitorType || MonitorType.Website}
      monitorSteps={monitorSteps}
      monitorId={new ObjectID(MONITOR_ID)}
      probes={options.probes || ATTACHED_PROBES}
      disabledProbeIds={options.disabledProbeIds}
    />,
  );
}

function testButton(): HTMLElement | null {
  return screen.queryByTestId("test-monitor-button");
}

function probePicker(): HTMLElement | null {
  return screen.queryByRole("combobox");
}

beforeEach(() => {
  currentPermissions = [Permission.ProjectAdmin];
  mockSummaryInfoRenders.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("the summary card offers a test", () => {
  test("a probeable monitor with steps and a probe gets the button", () => {
    renderSummary();

    expect(testButton()).toBeInTheDocument();
  });

  test("the button lives on the Monitor Summary card itself", () => {
    /*
     * Queried through the card rather than the page, because a second
     * component in the dashboard also renders a card titled "Monitor Summary"
     * (the snapshot card on incident and alert pages). This one is the
     * overview's.
     */
    renderSummary();

    const card: HTMLElement = screen.getByTestId("card");

    expect(
      within(card).getByRole("heading", { name: "Monitor Summary" }),
    ).toBeInTheDocument();
    expect(within(card).getByTestId("test-monitor-button")).toBeInTheDocument();
  });

  test("the probe picker is still there next to it", () => {
    /*
     * The card's right-hand slot was already taken by "Showing results from:".
     * Putting the button there instead of in the card's own actions slot would
     * have removed the picker - and would have shipped green, because nothing
     * else asserts the picker renders.
     */
    renderSummary();

    expect(testButton()).toBeInTheDocument();
    expect(probePicker()).toBeInTheDocument();
    expect(screen.getByText("Showing results from:")).toBeInTheDocument();
  });

  test("the picker and the button get a row of their own under the title", () => {
    /*
     * In the overview's two-thirds column, side by side they squeezed the
     * title and description into a column a word or two wide.
     */
    renderSummary();

    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "stacked",
    );
    const actions: HTMLElement = screen.getByTestId("card-header-actions");
    expect(within(actions).getByTestId("test-monitor-button")).toBeTruthy();
    expect(
      within(actions).getByText("Showing results from:"),
    ).toBeInTheDocument();
  });

  test("the button is offered for every probeable monitor type", () => {
    const probeableTypes: Array<MonitorType> = [
      MonitorType.API,
      MonitorType.Website,
      MonitorType.IP,
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.SSLCertificate,
      MonitorType.SyntheticMonitor,
      MonitorType.CustomJavaScriptCode,
      MonitorType.DNS,
      MonitorType.DNSSEC,
      MonitorType.Domain,
      MonitorType.SQLQuery,
      MonitorType.Database,
      MonitorType.ExternalStatusPage,
    ];

    for (const monitorType of probeableTypes) {
      renderSummary({ monitorType: monitorType });

      expect(testButton()).toBeInTheDocument();

      cleanup();
    }
  });

  test("an attached probe that is switched off can still be tested against", () => {
    /*
     * A disabled probe stops WATCHING the monitor; it still picks up a test,
     * because the queue is claimed by probe id alone. Being able to test with
     * it is how an operator checks a probe before switching it back on.
     */
    renderSummary({
      probes: [
        probe(PROBE_ID, "Ohio Probe"),
        probe(DISABLED_PROBE_ID, "Attic"),
      ],
      disabledProbeIds: [DISABLED_PROBE_ID],
    });

    expect(testButton()).toBeInTheDocument();
  });
});

describe("the summary card withholds a test", () => {
  test("a monitor type no probe runs gets no button", () => {
    /*
     * The card still renders for these - they have their own summary - so the
     * button has to be withheld at this call site rather than left to the form
     * to render nothing, which would leave an empty slot in the header.
     */
    renderSummary({ monitorType: MonitorType.Logs });

    expect(testButton()).not.toBeInTheDocument();
  });

  test("an incoming-request monitor gets no button", () => {
    renderSummary({ monitorType: MonitorType.IncomingRequest });

    expect(testButton()).not.toBeInTheDocument();
  });

  test("a server monitor gets no button", () => {
    renderSummary({ monitorType: MonitorType.Server });

    expect(testButton()).not.toBeInTheDocument();
  });

  test("a monitor with no steps gets no button", () => {
    /*
     * The row would be created and accepted, and the probe would return
     * without reporting anything - so the only thing the user would ever see
     * is the poll giving up two and a half minutes later.
     */
    renderSummary({ withoutMonitorSteps: true });

    expect(testButton()).not.toBeInTheDocument();
  });

  test("a monitor with an empty steps array gets no button", () => {
    renderSummary({ monitorSteps: stepsWith(0) });

    expect(testButton()).not.toBeInTheDocument();
  });

  test("a monitor with nothing attached gets no button", () => {
    /*
     * The modal's "Select Probe" field is required and would have no options,
     * so Run Test could never be submitted. The card already explains this
     * case in its body.
     */
    renderSummary({ probes: [] });

    expect(testButton()).not.toBeInTheDocument();
    expect(probePicker()).not.toBeInTheDocument();
  });

  test("a read-only user gets no button", () => {
    currentPermissions = [Permission.Viewer];

    renderSummary();

    expect(testButton()).not.toBeInTheDocument();
  });

  test("withholding the button leaves the rest of the card alone", () => {
    renderSummary({ probes: [] });

    expect(
      screen.getByRole("heading", { name: "Monitor Summary" }),
    ).toBeInTheDocument();
  });

  test("a manual monitor renders no card at all", () => {
    renderSummary({ monitorType: MonitorType.Manual });

    expect(screen.queryByTestId("card")).not.toBeInTheDocument();
    expect(testButton()).not.toBeInTheDocument();
  });
});

describe("what the card hands the test form", () => {
  test("it still renders the button when the page has no monitor id", () => {
    /*
     * monitorId is optional on the card so that a caller which cannot supply
     * one is not forced to; the overview page always does, which is what lets
     * the server resolve this monitor's secrets for the run.
     */
    renderSummary({ withoutMonitorId: true });

    expect(testButton()).toBeInTheDocument();
  });
});

/*
 * The overview redesign's changes to the card: the picked probe is worked
 * out during render (so the first paint is already right), the criteria
 * verdict follows the picked probe, and the three situations a generic "no
 * summary" used to cover - probes unreadable, agent never reported, and a
 * verdict that belongs to another probe - each say what is true.
 */

const SECOND_PROBE_ID: string = "66666666-6666-4666-8666-666666666666";

function pingResponse(
  probeId: string,
  failureCause: string,
): MonitorStepProbeResponse {
  return {
    "step-1": {
      probeId: new ObjectID(probeId),
      monitorStepId: "step-1",
      isOnline: false,
      failureCause: failureCause,
      monitoredAt: new Date("2026-09-21T11:59:00.000Z"),
    },
  } as unknown as MonitorStepProbeResponse;
}

function evaluation(criteriaName: string): MonitorEvaluationSummary {
  return {
    evaluatedAt: new Date("2026-09-21T11:59:00.000Z"),
    criteriaResults: [
      {
        criteriaName: criteriaName,
        filterCondition: FilterCondition.All,
        met: false,
        message: `${criteriaName} was not met`,
        filters: [],
      },
    ],
    events: [],
  };
}

interface CardOptions {
  monitorType?: MonitorType | undefined;
  probes?: Array<Probe> | undefined;
  disabledProbeIds?: Array<string> | undefined;
  monitorSteps?: MonitorSteps | undefined;
  probeMonitorResponses?: Array<MonitorStepProbeResponse> | undefined;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
  evaluationSummariesByProbeId?:
    | Dictionary<MonitorEvaluationSummary>
    | undefined;
  probeLoadError?: string | undefined;
  description?: string | undefined;
  serverMonitorResponse?: ServerMonitorResponse | undefined;
}

function renderCard(options: CardOptions): RenderResult {
  return render(
    <Summary
      monitorType={options.monitorType || MonitorType.Ping}
      monitorId={new ObjectID(MONITOR_ID)}
      monitorSteps={options.monitorSteps}
      probes={options.probes || ATTACHED_PROBES}
      disabledProbeIds={options.disabledProbeIds}
      probeMonitorResponses={options.probeMonitorResponses}
      evaluationSummary={options.evaluationSummary}
      evaluationSummariesByProbeId={options.evaluationSummariesByProbeId}
      probeLoadError={options.probeLoadError}
      description={options.description}
      serverMonitorResponse={options.serverMonitorResponse}
    />,
  );
}

function lastSummaryInfoProps(): Record<string, unknown> {
  const props: Record<string, unknown> | undefined =
    mockSummaryInfoRenders[mockSummaryInfoRenders.length - 1];

  if (!props) {
    throw new Error("SummaryInfo was never rendered");
  }

  return props;
}

function pickProbe(name: string): void {
  const combobox: HTMLElement = screen.getByRole("combobox");
  fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
  fireEvent.click(screen.getByText(name));
}

const TWO_PROBES: Array<Probe> = [
  probe(PROBE_ID, "Ohio Probe"),
  probe(SECOND_PROBE_ID, "London Probe"),
];

describe("the summary card's first paint", () => {
  test("no 'has not reported' text on the first commit when the selected probe has responses", () => {
    renderCard({
      probeMonitorResponses: [pingResponse(PROBE_ID, "Host unreachable")],
    });

    // Every render, the first included, already had the probe's result.
    expect(mockSummaryInfoRenders.length).toBeGreaterThan(0);
    for (const props of mockSummaryInfoRenders) {
      expect(props["probeName"]).toBe("Ohio Probe");
      expect((props["probeMonitorResponses"] as Array<unknown>).length).toBe(1);
    }

    expect(screen.queryByText(/has not reported a result yet/)).toBeNull();
    expect(screen.getByText("Host unreachable")).toBeInTheDocument();
  });

  test("the summary scrolls inside the card instead of widening the page", () => {
    /*
     * The per-type views put four quarter-width cards in one row, wider
     * than a phone; the page must never scroll sideways because of them.
     */
    renderCard({
      probeMonitorResponses: [pingResponse(PROBE_ID, "Host unreachable")],
    });

    const body: HTMLElement = screen.getByTestId("monitor-summary-body");
    expect(body).toHaveClass("overflow-x-auto");
    expect(within(body).getByText("Host unreachable")).toBeInTheDocument();
  });

  test("a probe with no result yet says so by name, once there really is nothing", () => {
    renderCard({ probeMonitorResponses: [] });

    expect(
      screen.getByText(
        "Ohio Probe has not reported a result yet. Results usually appear within a few minutes of its next check.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the summary card when probe results cannot be read", () => {
  test("probeLoadError replaces the no-probes message", () => {
    renderCard({ probes: [] });
    expect(
      screen.getByText(
        "No probes are monitoring this resource. Add one under Probes to start collecting data.",
      ),
    ).toBeInTheDocument();
    cleanup();

    renderCard({
      probes: [],
      probeLoadError: "You do not have permission to read this Monitor Probe.",
    });

    expect(
      screen.getByText(
        "Probe results are unavailable. You do not have permission to read this Monitor Probe.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No probes are monitoring this resource/),
    ).toBeNull();
  });

  test("with an error there is no picker and no Test button, even with probes", () => {
    renderCard({
      monitorSteps: stepsWith(1),
      probeLoadError: "Network error.",
    });

    expect(probePicker()).not.toBeInTheDocument();
    expect(testButton()).not.toBeInTheDocument();
    expect(mockSummaryInfoRenders).toHaveLength(0);
  });
});

describe("the criteria verdict follows the picked probe", () => {
  test("per-probe evaluation follows the picker", () => {
    const ohio: MonitorEvaluationSummary = evaluation("Ohio criteria");
    const london: MonitorEvaluationSummary = evaluation("London criteria");

    renderCard({
      probes: TWO_PROBES,
      probeMonitorResponses: [
        pingResponse(PROBE_ID, "Ohio says no"),
        pingResponse(SECOND_PROBE_ID, "London says no"),
      ],
      // The newest verdict overall is London's.
      evaluationSummary: london,
      evaluationSummariesByProbeId: {
        [PROBE_ID]: ohio,
        [SECOND_PROBE_ID]: london,
      },
    });

    expect(lastSummaryInfoProps()["evaluationSummary"]).toBe(ohio);
    expect(screen.getByText("Ohio says no")).toBeInTheDocument();

    pickProbe("London Probe");

    expect(lastSummaryInfoProps()["probeName"]).toBe("London Probe");
    expect(lastSummaryInfoProps()["evaluationSummary"]).toBe(london);
    expect(screen.getByText("London says no")).toBeInTheDocument();
    expect(screen.queryByText("Ohio says no")).toBeNull();
  });

  test("a note says which probe the newest verdict came from", () => {
    const london: MonitorEvaluationSummary = evaluation("London criteria");

    renderCard({
      probes: TWO_PROBES,
      evaluationSummary: london,
      evaluationSummariesByProbeId: { [SECOND_PROBE_ID]: london },
    });

    // Ohio is picked first and has no verdict of its own.
    expect(lastSummaryInfoProps()["evaluationSummary"]).toBeUndefined();
    expect(
      screen.getByTestId("monitor-summary-other-evaluation"),
    ).toHaveTextContent(
      "The latest criteria evaluation came from London Probe. Pick it above to see why it passed or failed.",
    );

    pickProbe("London Probe");

    expect(lastSummaryInfoProps()["evaluationSummary"]).toBe(london);
    expect(screen.queryByTestId("monitor-summary-other-evaluation")).toBeNull();
  });

  test("without per-probe verdicts the newest one is shown, as before", () => {
    const latest: MonitorEvaluationSummary = evaluation("Any criteria");

    renderCard({ probes: TWO_PROBES, evaluationSummary: latest });

    expect(lastSummaryInfoProps()["evaluationSummary"]).toBe(latest);
    expect(screen.queryByTestId("monitor-summary-other-evaluation")).toBeNull();
  });
});

describe("the summary card's header and empty states", () => {
  test("no right element at all when there are no probes", () => {
    renderCard({ probes: [] });

    expect(probePicker()).not.toBeInTheDocument();
    /*
     * With neither a right element nor buttons the title takes the whole
     * width. An empty fragment in the slot used to count as a right element
     * and reserve an empty column.
     */
    expect(
      screen.getByTestId("card-details-heading").parentElement,
    ).toHaveClass("w-full");
  });

  test("a server that has never reported says so instead of rendering an empty card", () => {
    renderCard({ monitorType: MonitorType.Server });

    expect(
      screen.getByText(
        "No report from the server agent yet. Install the agent to start sending data; setup instructions are under Documentation.",
      ),
    ).toBeInTheDocument();
    expect(mockSummaryInfoRenders).toHaveLength(0);
    cleanup();

    renderCard({
      monitorType: MonitorType.Server,
      serverMonitorResponse: {
        hostname: "web-01",
        requestReceivedAt: new Date("2026-09-21T11:59:00.000Z"),
      } as ServerMonitorResponse,
    });

    expect(mockSummaryInfoRenders.length).toBeGreaterThan(0);
    expect(
      screen.queryByText(/No report from the server agent yet/),
    ).toBeNull();
  });

  test("the description can be overridden, and defaults to the old copy", () => {
    renderCard({
      description: "What each probe saw on its most recent check.",
    });

    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "What each probe saw on its most recent check.",
    );
    expect(
      screen.getByRole("heading", { name: "Monitor Summary" }),
    ).toBeInTheDocument();
    cleanup();

    renderCard({});
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Here is how your monitor is performing at this moment.",
    );
  });
});
