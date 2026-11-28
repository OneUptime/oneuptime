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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { Mock } from "jest-mock";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import CrowdSecSendAlertsModal, {
  CROWDSEC_ALERTS_WATCH_MS,
  CROWDSEC_SEND_ALERTS_TEST_ID,
  CrowdSecAlertsArrival,
  getCrowdSecAlertsArrival,
  getSecurityEventsIngestUrl,
  readLastAlertAt,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CrowdSec/CrowdSecSendAlertsModal";
import { ComponentProps as IngestionKeySelectorProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestionKeySelector";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ObjectID from "../../../Types/ObjectID";
import { SECURITY_EVENTS_INGEST_PATH } from "../../../Types/SecurityEvent/Connectors/PushedConnectionAddress";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * A CrowdSec connection's Send alerts (#11158): the notification that makes
 * CrowdSec's http plugin send its alerts to this connection, the line its
 * profiles add, the test alert - and whether one has arrived, asked every
 * few seconds while the dialog is open. The key picker is a stand-in that
 * hands over a key when pressed: what it is handed (a Server key, named for
 * CrowdSec) is checked, and the real picker has tests of its own.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestionKeySelector",
  () => {
    return {
      __esModule: true,
      default: (props: IngestionKeySelectorProps): ReactElement => {
        return (
          <div
            data-testid="ingestion-key-selector"
            data-key-type={props.keyTypeFilter}
            data-new-key-name={props.newKeyName}
            data-hides-values={String(Boolean(props.hideValues))}
          >
            <button
              type="button"
              onClick={(): void => {
                const key: TelemetryIngestionKey = new TelemetryIngestionKey();
                key.secretKey = new ObjectID(
                  "9a7c3e1f-2b4d-4f6a-8c0e-1d3b5f7a9c2e",
                );
                props.onSelectedKeyChange(key);
              }}
            >
              Pick the CrowdSec key
            </button>
          </div>
        );
      },
    };
  },
);

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: string = "66666666-6666-4666-8666-666666666666";
const TOKEN: string = "9a7c3e1f-2b4d-4f6a-8c0e-1d3b5f7a9c2e";
const NOW: number = new Date("2026-11-28T10:00:00Z").getTime();

function crowdsecConnection(
  overrides: Partial<SecurityEventConnection> = {},
): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = CONNECTION_ID;
  connection.projectId = PROJECT_ID;
  connection.name = "Edge CrowdSec";
  connection.provider = SecurityEventConnectorProvider.CrowdSec;
  connection.config = { blockIndicators: false };
  connection.isEnabled = true;
  Object.assign(connection, overrides);
  return connection;
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function arrival(): HTMLElement {
  return screen.getByTestId(`${CROWDSEC_SEND_ALERTS_TEST_ID}-arrival`);
}

function renderModal(connection: SecurityEventConnection): {
  onClose: Mock<() => void>;
} {
  const onClose: Mock<() => void> = jest.fn<() => void>();

  render(
    <MemoryRouter>
      <CrowdSecSendAlertsModal connection={connection} onClose={onClose} />
    </MemoryRouter>,
  );

  return { onClose };
}

// The connection as the API reads it back, its last alert at the time given.
function readsBack(lastEventIngestedAt: Date | undefined): void {
  jest
    .spyOn(ModelAPI, "getItem")
    .mockResolvedValue(crowdsecConnection({ lastEventIngestedAt }));
}

async function nextWatch(): Promise<void> {
  await act(async (): Promise<void> => {
    jest.advanceTimersByTime(CROWDSEC_ALERTS_WATCH_MS);
  });
  // The read's promise, and the state it sets.
  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

describe("CrowdSec's Send alerts", () => {
  beforeEach((): void => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    readsBack(undefined);
  });

  afterEach((): void => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("is the connection's, and walks a key, the notification, the profiles and a test alert", (): void => {
    renderModal(crowdsecConnection());

    expect(dialog()).toHaveAccessibleName("Send alerts: Edge CrowdSec");
    expect(
      within(screen.getByTestId("setup-guide-steps"))
        .getAllByRole("heading", { level: 3 })
        .map((heading: HTMLElement): string => {
          return (heading.textContent || "").replace(/^Step \d+: /, "");
        }),
    ).toEqual([
      "Pick an ingestion key",
      "Save this as /etc/crowdsec/notifications/oneuptime.yaml",
      "Send your profiles' alerts to it",
      "Send a test alert",
    ]);
  });

  test("asks for a Server key of CrowdSec's own, its values left to the notification", (): void => {
    renderModal(crowdsecConnection());

    const picker: HTMLElement = screen.getByTestId("ingestion-key-selector");
    expect(picker).toHaveAttribute(
      "data-key-type",
      TelemetryIngestionKeyType.Server,
    );
    expect(picker).toHaveAttribute("data-new-key-name", "CrowdSec key");
    expect(picker).toHaveAttribute("data-hides-values", "true");
  });

  test("the notification posts to this connection, with a placeholder until a key is picked, then the key in a header", (): void => {
    renderModal(crowdsecConnection());

    const address: string = `${getSecurityEventsIngestUrl()}?connection=${CONNECTION_ID}&format=crowdsec`;

    expect(dialog().textContent).toContain(`url: ${address}`);
    expect(dialog().textContent).toContain(
      "x-oneuptime-token: <YOUR_ONEUPTIME_TOKEN>",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Pick the CrowdSec key" }),
    );

    expect(dialog().textContent).toContain(`x-oneuptime-token: ${TOKEN}`);
    expect(address).not.toContain(TOKEN);
  });

  test("says which line the profiles add, how to reload, and how to send a test alert", (): void => {
    renderModal(crowdsecConnection());

    const text: string = dialog().textContent || "";
    expect(text).toContain("notifications:\n  - oneuptime");
    expect(text).toContain("sudo systemctl reload crowdsec");
    expect(text).toContain("sudo cscli notifications test oneuptime");
    expect(text).toContain(
      "In /etc/crowdsec/profiles.yaml, add it to the notifications of each profile whose alerts OneUptime should receive, then reload CrowdSec.",
    );
  });

  test("waits for the first alert, and says when it arrives, with where to see it", async (): Promise<void> => {
    renderModal(crowdsecConnection());

    expect(arrival()).toHaveAttribute("data-state", "waiting");
    expect(arrival()).toHaveTextContent(
      "Waiting for the first alert. It arrives within seconds of the test.",
    );
    expect(
      within(dialog()).getAllByRole("button", { name: "Close" }).length,
    ).toBeGreaterThan(0);

    // Nothing yet: still waiting.
    await nextWatch();
    expect(arrival()).toHaveAttribute("data-state", "waiting");
    expect(ModelAPI.getItem).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { lastEventIngestedAt: true },
      }),
    );

    readsBack(new Date(NOW + 2_000));
    await nextWatch();

    expect(arrival()).toHaveAttribute("data-state", "arrived");
    expect(arrival()).toHaveTextContent(
      /^An alert arrived at .+: CrowdSec's alerts reach this connection\./,
    );
    expect(
      within(arrival()).getByRole("link", { name: "View alerts" }),
    ).toHaveAttribute("href", expect.stringContaining("security-events"));
    expect(
      within(dialog()).getAllByRole("button", { name: "Done" }).length,
    ).toBeGreaterThan(0);
  });

  test("a connection that has had alerts waits for the next one, not for its last", async (): Promise<void> => {
    const last: Date = new Date(NOW - 60 * 60_000);
    readsBack(last);
    renderModal(crowdsecConnection({ lastEventIngestedAt: last }));

    await nextWatch();

    expect(arrival()).toHaveAttribute("data-state", "waiting");
    expect(arrival()).toHaveTextContent(
      /^Waiting for the next alert\. The last one arrived at .+\.$/,
    );
  });

  test("stops asking once it is closed", async (): Promise<void> => {
    const { onClose }: { onClose: Mock<() => void> } =
      renderModal(crowdsecConnection());

    fireEvent.click(
      within(dialog()).getAllByRole("button", { name: "Close" })[0]!,
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    cleanup();
    jest.mocked(ModelAPI.getItem).mockClear();
    await nextWatch();
    expect(ModelAPI.getItem).not.toHaveBeenCalled();
  });

  test("a disabled connection says its alerts open no cases", (): void => {
    renderModal(crowdsecConnection({ isEnabled: false }));

    expect(
      screen.getByTestId(`${CROWDSEC_SEND_ALERTS_TEST_ID}-disabled`),
    ).toHaveTextContent(
      "This connection is disabled: the alerts it receives are kept as events, and open no cases.",
    );
  });

  test("links CrowdSec's setup guide", (): void => {
    renderModal(crowdsecConnection());

    expect(
      screen.getByRole("link", { name: /CrowdSec setup guide/ }),
    ).toHaveAttribute(
      "href",
      expect.stringMatching(/\/integrations\/crowdsec$/),
    );
  });
});

describe("whether an alert has arrived", () => {
  const opened: Date = new Date("2026-11-28T09:00:00Z");

  test("one after the last the dialog opened with has arrived", () => {
    const later: Date = new Date("2026-11-28T09:00:05Z");

    expect(
      getCrowdSecAlertsArrival({
        lastAlertAtWhenOpened: opened,
        lastAlertAt: later,
      }),
    ).toEqual({ state: "arrived", at: later });
  });

  test("the one it opened with is not a new one", () => {
    expect(
      getCrowdSecAlertsArrival({
        lastAlertAtWhenOpened: opened,
        lastAlertAt: new Date(opened.getTime()),
      }),
    ).toEqual({ state: "waiting", lastAt: opened });
  });

  test("the first one ever has arrived, whatever the browser's clock says", () => {
    const serverTime: Date = new Date("2026-01-01T00:00:00Z");
    const result: CrowdSecAlertsArrival = getCrowdSecAlertsArrival({
      lastAlertAtWhenOpened: null,
      lastAlertAt: serverTime,
    });

    expect(result).toEqual({ state: "arrived", at: serverTime });
  });

  test("none yet is waiting for the first", () => {
    expect(
      getCrowdSecAlertsArrival({
        lastAlertAtWhenOpened: null,
        lastAlertAt: null,
      }),
    ).toEqual({ state: "waiting", lastAt: null });
  });

  test("reads the time as the API hands it back, a date or its text, and nothing else", () => {
    const at: Date = new Date("2026-11-28T09:00:05Z");

    expect(readLastAlertAt(at)).toEqual(at);
    expect(readLastAlertAt("2026-11-28T09:00:05.000Z")).toEqual(at);
    expect(readLastAlertAt(undefined)).toBeNull();
    expect(readLastAlertAt("")).toBeNull();
    expect(readLastAlertAt("not a time")).toBeNull();
  });

  test("the ingest's address ends in its path", () => {
    expect(
      getSecurityEventsIngestUrl().endsWith(SECURITY_EVENTS_INGEST_PATH),
    ).toBe(true);
  });
});
