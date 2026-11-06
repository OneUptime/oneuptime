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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityTelemetrySourcesCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityTelemetrySourcesCard";
import { SECURITY_TELEMETRY_SOURCES_CARD_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityTelemetrySourcesModel";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import SecurityTelemetrySource from "../../../Models/DatabaseModels/SecurityTelemetrySource";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import ObjectID from "../../../Types/ObjectID";
import { SecurityTelemetrySourceKind } from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * "Your OneUptime data" on the Connections page, as drawn: one switch a
 * kind, and Cloud audit logs - the audit logs of the cloud accounts
 * connected under Cloud - saying where no cloud account is connected, with
 * the way to connect one, and waiting for the next read of the accounts
 * rather than the minute's scan. ModelAPI is the card's only door to the
 * server, so it is what is stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CLOUD: SecurityTelemetrySourceKind =
  SecurityTelemetrySourceKind.CloudAudit;

let stored: Array<SecurityTelemetrySource> = [];
let cloudConnections: number | Error = 0;

function source(
  kind: SecurityTelemetrySourceKind,
  overrides: Partial<SecurityTelemetrySource> = {},
): SecurityTelemetrySource {
  const value: SecurityTelemetrySource = new SecurityTelemetrySource();
  value.id = ObjectID.generate();
  value.projectId = PROJECT_ID;
  value.kind = kind;
  value.isEnabled = true;
  Object.assign(value, overrides);
  return value;
}

beforeEach(() => {
  stored = [];
  cloudConnections = 0;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(ModelAPI, "getList").mockImplementation(async () => {
    return {
      data: [...stored],
      count: stored.length,
      skip: 0,
      limit: 10,
    } as never;
  });
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(async (data: { modelType: unknown }) => {
      expect(data.modelType).toBe(CloudConnection);

      if (cloudConnections instanceof Error) {
        throw cloudConnections;
      }

      return cloudConnections;
    });
  jest
    .spyOn(ModelAPI, "create")
    .mockImplementation(async (data: { model: unknown }) => {
      const created: SecurityTelemetrySource =
        data.model as SecurityTelemetrySource;
      stored = [
        ...stored,
        source(created.kind!, { isEnabled: created.isEnabled === true }),
      ];
      return new HTTPResponse(200, {}, {}) as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <SecurityTelemetrySourcesCard />
      </MemoryRouter>,
    );
  });
  await waitFor(() => {
    expect(cloudSwitch()).not.toHaveAttribute("aria-disabled", "true");
  });
}

function cloudRow(): HTMLElement {
  return screen.getByTestId(`security-telemetry-source-${CLOUD}`);
}

function cloudSwitch(): HTMLElement {
  return within(cloudRow()).getByRole("switch", { name: /Cloud audit logs/ });
}

describe("Your OneUptime data - Cloud audit logs", () => {
  test("a row of its own, last, saying what it reads, under a card that names cloud accounts", async () => {
    await renderCard();

    const rows: Array<HTMLElement> = within(
      screen.getByTestId(SECURITY_TELEMETRY_SOURCES_CARD_ID),
    ).getAllByRole("listitem");

    expect(rows[rows.length - 1]).toBe(cloudRow());
    expect(cloudRow()).toHaveTextContent(
      "Changes, refused calls and AWS console sign-ins in the cloud accounts connected under Cloud, from their own audit logs.",
    );
    expect(cloudSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(
        "Attacks show up in your traces, network traffic, audit log, session replays and cloud accounts too. Turn on what OneUptime should watch.",
      ),
    ).toBeInTheDocument();
  });

  test("no cloud account connected: it says so, with the way to connect one", async () => {
    cloudConnections = 0;
    await renderCard();

    const note: HTMLElement = await screen.findByTestId(
      `security-telemetry-source-cloud-note-${CLOUD}`,
    );

    // One short sentence, then the way to connect one: never said twice.
    expect(note).toHaveTextContent(
      "No cloud account is connected yet. Connect a cloud account",
    );
    expect(note.textContent).toBe(
      "No cloud account is connected yet. Connect a cloud account",
    );
    expect(
      within(note).getByRole("link", { name: "Connect a cloud account" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/cloud/connect`,
    );
    // The switch is still there: it can be on before an account is connected.
    expect(cloudSwitch()).not.toHaveAttribute("aria-disabled", "true");
    // No other row says anything of cloud accounts.
    expect(
      screen.getAllByText(/No cloud account is connected yet/),
    ).toHaveLength(1);
  });

  test("with a cloud account connected, or when that cannot be told, nothing is said", async () => {
    cloudConnections = 2;
    await renderCard();

    expect(
      screen.queryByTestId(`security-telemetry-source-cloud-note-${CLOUD}`),
    ).toBeNull();

    cleanup();
    cloudConnections = new Error("You do not have permission to read this.");
    await renderCard();

    expect(
      screen.queryByTestId(`security-telemetry-source-cloud-note-${CLOUD}`),
    ).toBeNull();
  });

  test("on and not read yet, it waits for the next read of the cloud accounts", async () => {
    cloudConnections = 1;
    stored = [source(CLOUD), source(SecurityTelemetrySourceKind.Traces)];
    await renderCard();

    expect(
      screen.getByTestId(`security-telemetry-source-status-${CLOUD}`),
    ).toHaveTextContent(
      "The first check runs with your cloud accounts' next read, within a few minutes.",
    );
    expect(
      screen.getByTestId(
        `security-telemetry-source-status-${SecurityTelemetrySourceKind.Traces}`,
      ),
    ).toHaveTextContent("The first check runs within a minute.");
  });

  /*
   * On with no cloud account to read: the note says what is missing, and
   * no line promises a first check that has nothing to read.
   */
  test("on with no cloud account connected, it says so and promises no first check", async () => {
    cloudConnections = 0;
    stored = [source(CLOUD), source(SecurityTelemetrySourceKind.Traces)];
    await renderCard();

    expect(
      await screen.findByTestId(
        `security-telemetry-source-cloud-note-${CLOUD}`,
      ),
    ).toHaveTextContent("No cloud account is connected yet.");
    expect(
      screen.queryByTestId(`security-telemetry-source-status-${CLOUD}`),
    ).toBeNull();
    expect(cloudRow()).not.toHaveTextContent("The first check runs");
    // The other kinds wait for their first check as before.
    expect(
      screen.getByTestId(
        `security-telemetry-source-status-${SecurityTelemetrySourceKind.Traces}`,
      ),
    ).toHaveTextContent("The first check runs within a minute.");
  });

  test("read, it says when, and what the last read found", async () => {
    cloudConnections = 1;
    stored = [
      source(CLOUD, {
        lastScannedAt: new Date(Date.now() - 2 * 60 * 1000),
        lastEventFoundAt: new Date(Date.now() - 2 * 60 * 1000),
        lastScanResult: {
          recordsRead: 30,
          eventsFound: 3,
          bySignal: { "aws-cloudtrail": 2, "google-cloud-audit": 1 },
        },
      }),
    ];
    await renderCard();

    const status: HTMLElement = screen.getByTestId(
      `security-telemetry-source-status-${CLOUD}`,
    );

    expect(status).toHaveTextContent("Checked");
    expect(status).toHaveTextContent("Found in the last check: 3");
  });

  test("the first flip creates the project's cloud audit logs source, on", async () => {
    cloudConnections = 1;
    await renderCard();

    await act(async () => {
      fireEvent.click(cloudSwitch());
    });

    await waitFor(() => {
      expect(ModelAPI.create).toHaveBeenCalledTimes(1);
    });

    const created: SecurityTelemetrySource = (
      (ModelAPI.create as unknown as jest.Mock).mock.calls[0]![0] as {
        model: SecurityTelemetrySource;
      }
    ).model;

    expect(created.kind).toBe(CLOUD);
    expect(created.isEnabled).toBe(true);
    expect(created.projectId?.toString()).toBe(PROJECT_ID.toString());
  });
});
