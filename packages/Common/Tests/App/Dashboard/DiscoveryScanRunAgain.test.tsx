import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import DiscoveryScanRunAgain from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryScanRunAgain";
import {
  getDiscoveryScanLastRunAt,
  getDiscoveryScanRunRequester,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryScanRunAgainState";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Toast from "../../../UI/Utils/Toast";
import { getErrorInSentenceText } from "../../../UI/Utils/ErrorInSentence";
import {
  DISCOVERY_SCAN_ALREADY_QUEUED_REFUSAL,
  DISCOVERY_SCAN_ALREADY_RUNNING_REFUSAL,
  DISCOVERY_SCAN_NOT_FOUND_REFUSAL,
  DISCOVERY_SCAN_PROBE_GONE_REFUSAL,
  DISCOVERY_SCAN_RUN_NOT_ALLOWED_REFUSAL,
  DISCOVERY_SCAN_UNNAMED_PROBE_OFFLINE_REFUSAL,
  getDiscoveryScanProbeOfflineRefusal,
  getDiscoveryScanRunRoute,
} from "../../../Utils/NetworkDiscovery/DiscoveryScanRun";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * RUN AGAIN ON A DISCOVERY SCAN'S ROW (OneUptime issue #10334).
 *
 * A one-time scan's row ended at "Completed", and nothing on it said it
 * could sweep again. The Status column now says when the scan last ran and
 * who asked for the run on the row, and offers Run Again once the run has
 * ended, to whoever may edit scans. While a run is queued or sweeping there
 * is no button: the progress is the run.
 *
 * Pressed, it asks the run route, says the scan is queued and has the list
 * read again; refused, it says why in the reader's language - each refusal
 * is a key of the locales, and the probe's has its name read back into it.
 */

const SCAN_ID: string = "10334000-0000-4000-8000-0000000000f1";
const NOW: Date = new Date("2026-11-22T10:00:00.000Z");
const THREE_DAYS_AGO: Date = new Date("2026-11-19T10:00:00.000Z");

type ScanOverrides = {
  [Key in keyof NetworkDeviceDiscoveryScan]?:
    | NetworkDeviceDiscoveryScan[Key]
    | undefined
    | null;
};

function simon(): User {
  const user: User = new User();
  user.name = new Name("Simon Larsen");
  user.email = new Email("simon@example.com");
  return user;
}

function scan(overrides: ScanOverrides = {}): NetworkDeviceDiscoveryScan {
  return Object.assign(
    new NetworkDeviceDiscoveryScan(),
    {
      _id: SCAN_ID,
      name: "All Tablets Discovery",
      cidr: "10.16-49.0-255.45-47",
      status: "Completed",
      isRecurring: false,
      startedAt: new Date("2026-11-19T09:56:00.000Z"),
      completedAt: THREE_DAYS_AGO,
    },
    overrides,
  );
}

let postSpy: jest.SpyInstance;
let successSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
let onRunQueued: jest.Mock;

function renderRow(
  row: NetworkDeviceDiscoveryScan,
  canRun: boolean = true,
): void {
  render(
    <DiscoveryScanRunAgain
      scan={row}
      canRun={canRun}
      onRunQueued={onRunQueued}
    />,
  );
}

function runAgainButton(): HTMLElement | null {
  return screen.queryByTestId(`discovery-scan-run-again-button-${SCAN_ID}`);
}

async function pressRunAgain(): Promise<void> {
  await act(async () => {
    fireEvent.click(runAgainButton()!);
  });
}

function refusedWith(message: string): void {
  postSpy.mockResolvedValue(new HTTPErrorResponse(400, { message }, {}));
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(NOW);
  onRunQueued = jest.fn();
  postSpy = jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          scanId: SCAN_ID,
          status: "Pending",
          runRequestedAt: NOW.toISOString(),
        },
        {},
      ),
    );
  jest
    .spyOn(ModelAPI, "getCommonHeaders")
    .mockReturnValue({ tenantid: "the-project" });
  successSpy = jest.spyOn(Toast, "success").mockReturnValue("toast");
  errorSpy = jest.spyOn(Toast, "error").mockReturnValue("toast");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("a finished scan's row", () => {
  test("says when the scan last ran, to the minute on hover, and offers Run Again", () => {
    renderRow(scan());

    const lastRun: HTMLElement = screen.getByTestId("discovery-scan-last-run");

    expect(lastRun).toHaveTextContent("Last run 3 days ago");
    expect(lastRun.getAttribute("title")).toContain("2026");
    expect(runAgainButton()).toBeInTheDocument();
    expect(runAgainButton()).toHaveTextContent("Run Again");
  });

  test("names the scan to a screen reader: every finished row has a Run Again", () => {
    renderRow(scan());

    expect(
      screen.getByRole("button", { name: "Run All Tablets Discovery again" }),
    ).toBeInTheDocument();
  });

  test("offers Run Again after a failed run too", () => {
    renderRow(scan({ status: "Failed" }));

    expect(screen.getByTestId("discovery-scan-last-run")).toHaveTextContent(
      "Last run 3 days ago",
    );
    expect(runAgainButton()).toBeInTheDocument();
  });

  test("says who asked for the run, when someone did", () => {
    renderRow(
      scan({ runRequestedAt: THREE_DAYS_AGO, runRequestedByUser: simon() }),
    );

    expect(screen.getByTestId("discovery-scan-last-run")).toHaveTextContent(
      "Last run 3 days ago, requested by Simon Larsen",
    );
  });

  test("names a person with no name by their email", () => {
    const nameless: User = simon();
    nameless.name = undefined;

    renderRow(scan({ runRequestedAt: THREE_DAYS_AGO, runRequestedByUser: nameless }));

    expect(screen.getByTestId("discovery-scan-last-run")).toHaveTextContent(
      "requested by simon@example.com",
    );
  });

  test("shows when it last ran, but no button, to whoever may not edit scans", () => {
    renderRow(scan(), false);

    expect(screen.getByTestId("discovery-scan-last-run")).toBeInTheDocument();
    expect(runAgainButton()).not.toBeInTheDocument();
  });
});

describe("a scan whose run is queued or sweeping", () => {
  test.each([["Pending"], ["In Progress"]])(
    "%s: no Run Again, and no time of a last run - the progress above is the run",
    (status: string) => {
      renderRow(scan({ status: status, completedAt: null }));

      expect(runAgainButton()).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("discovery-scan-last-run"),
      ).not.toBeInTheDocument();
    },
  );

  test("says who asked for it, when someone pressed Run Again", () => {
    renderRow(
      scan({
        status: "Pending",
        completedAt: null,
        runRequestedAt: NOW,
        runRequestedByUser: simon(),
      }),
    );

    expect(
      screen.getByTestId("discovery-scan-run-requester"),
    ).toHaveTextContent("Requested by Simon Larsen");
  });

  test("names nobody for a run that started by itself", () => {
    renderRow(
      scan({
        status: "In Progress",
        completedAt: null,
        runRequestedAt: null,
        // A stale relation the row still carries names nobody either.
        runRequestedByUser: simon(),
      }),
    );

    expect(
      screen.queryByTestId("discovery-scan-run-requester"),
    ).not.toBeInTheDocument();
  });
});

describe("pressing Run Again", () => {
  test("asks the scan's run route in the project, says the scan is queued, and has the list read again", async () => {
    renderRow(scan());

    await pressRunAgain();

    expect(postSpy).toHaveBeenCalledTimes(1);

    const request: { url: unknown; headers: unknown } = postSpy.mock.calls[0]![0];

    expect(String(request.url)).toContain(getDiscoveryScanRunRoute(SCAN_ID));
    expect(request.headers).toEqual({ tenantid: "the-project" });
    expect(successSpy).toHaveBeenCalledWith(
      "All Tablets Discovery is queued to run again.",
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(onRunQueued).toHaveBeenCalledTimes(1);
  });

  test("names an unnamed scan by its target", async () => {
    renderRow(scan({ name: null }));

    await pressRunAgain();

    expect(successSpy).toHaveBeenCalledWith(
      "10.16-49.0-255.45-47 is queued to run again.",
    );
  });

  test("says why a refused run did not run, keeps the button, and reads nothing again", async () => {
    refusedWith(getDiscoveryScanProbeOfflineRefusal("Office Probe"));
    renderRow(scan());

    await pressRunAgain();

    expect(errorSpy).toHaveBeenCalledWith(
      "This scan's probe, Office Probe, is not connected to OneUptime, so the scan cannot run now. Start the probe, or pick another probe in Edit.",
    );
    expect(successSpy).not.toHaveBeenCalled();
    expect(onRunQueued).not.toHaveBeenCalled();
    expect(runAgainButton()).toBeInTheDocument();
  });

  test("shows the button busy while the request is out, then usable again", async () => {
    let answer: (value: unknown) => void = (): void => {};
    postSpy.mockImplementation(() => {
      return new Promise((resolve: (value: unknown) => void) => {
        answer = resolve;
      });
    });
    renderRow(scan());

    await act(async () => {
      fireEvent.click(runAgainButton()!);
    });

    expect(runAgainButton()).toBeDisabled();

    await act(async () => {
      answer(new HTTPErrorResponse(400, { message: DISCOVERY_SCAN_ALREADY_RUNNING_REFUSAL }, {}));
    });

    expect(runAgainButton()).not.toBeDisabled();
  });
});

describe("why a run was refused, in the reader's language", () => {
  const REFUSALS: Array<string> = [
    DISCOVERY_SCAN_ALREADY_RUNNING_REFUSAL,
    DISCOVERY_SCAN_ALREADY_QUEUED_REFUSAL,
    DISCOVERY_SCAN_NOT_FOUND_REFUSAL,
    DISCOVERY_SCAN_PROBE_GONE_REFUSAL,
    DISCOVERY_SCAN_UNNAMED_PROBE_OFFLINE_REFUSAL,
    DISCOVERY_SCAN_RUN_NOT_ALLOWED_REFUSAL,
  ];

  test.each(["de", "fr", "ja", "fa", "ar"])(
    "every refusal reads in %s, not in English",
    (language: string) => {
      for (const refusal of REFUSALS) {
        const said: string = getErrorInSentenceText({
          message: refusal,
          translator: dashboardTranslator(language),
        });

        expect({ refusal, said }).not.toEqual({ refusal, said: refusal });
      }
    },
  );

  test("the probe's name is read back out of the English and kept as written", () => {
    const said: string = withoutIsolateMarks(
      getErrorInSentenceText({
        message: getDiscoveryScanProbeOfflineRefusal("Büro Probe, 2. OG"),
        translator: dashboardTranslator("de"),
      }),
    );

    expect(said).toBe(
      "Die Sonde dieses Scans, Büro Probe, 2. OG, ist nicht mit OneUptime verbunden, daher kann der Scan jetzt nicht ausgeführt werden. Starten Sie die Sonde, oder wählen Sie unter „Bearbeiten“ eine andere Sonde.",
    );
  });
});

describe("what the row reads off the scan", () => {
  test("the last run is when the run ended, else when it started; none while a run is on", () => {
    expect(getDiscoveryScanLastRunAt(scan())).toEqual(THREE_DAYS_AGO);
    expect(
      getDiscoveryScanLastRunAt(
        scan({ completedAt: null, startedAt: THREE_DAYS_AGO }),
      ),
    ).toEqual(THREE_DAYS_AGO);
    expect(
      getDiscoveryScanLastRunAt(scan({ completedAt: null, startedAt: null })),
    ).toBeNull();
    expect(
      getDiscoveryScanLastRunAt(scan({ status: "In Progress" })),
    ).toBeNull();
  });

  test("who asked is named only while the row says someone asked", () => {
    expect(
      getDiscoveryScanRunRequester(
        scan({ runRequestedAt: NOW, runRequestedByUser: simon() }),
      ),
    ).toBe("Simon Larsen");
    expect(
      getDiscoveryScanRunRequester(scan({ runRequestedAt: NOW })),
    ).toBeNull();
    expect(
      getDiscoveryScanRunRequester(
        scan({ runRequestedAt: null, runRequestedByUser: simon() }),
      ),
    ).toBeNull();
  });

  test("a scan id the run route is asked with is the scan's own", () => {
    expect(getDiscoveryScanRunRoute(new ObjectID(SCAN_ID).toString())).toBe(
      `/network-device-discovery-scan/${SCAN_ID}/run`,
    );
  });
});
