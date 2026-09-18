import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
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

import Summary from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/Summary";
import Probe from "../../../Models/DatabaseModels/Probe";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
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
