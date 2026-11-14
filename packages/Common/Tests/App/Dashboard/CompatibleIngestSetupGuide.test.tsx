import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import TelemetryDocumentation, {
  TelemetryType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/Documentation";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import API from "../../../UI/Utils/API/API";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";
import { preloadProviderLogoMarks } from "../../Helpers/ProviderLogoMarks";

/*
 * The Setup Guide's "Already using another tool?" ways (issue #6797), as a
 * reader meets them: under the guide's own ways, the tools that fill that
 * product; one picked shows three steps - the key with the URL the tool is
 * pointed at, the tool's configuration with that URL and key in it, and what
 * the data becomes - and Sentry asks where the app runs, so a browser app is
 * offered a Browser key for its public DSN.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const SECRET: string = "6b4a1d5c-0c5e-4a8f-9a30-1f1f2b7d1e11";

const serverKey: () => TelemetryIngestionKey = (): TelemetryIngestionKey => {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID("key-1");
  key.name = "Production Key";
  key.secretKey = new ObjectID(SECRET);
  key.keyType = TelemetryIngestionKeyType.Server;
  return key;
};

const renderGuide: (telemetryType: TelemetryType) => void = (
  telemetryType: TelemetryType,
): void => {
  render(
    <MemoryRouter>
      <TelemetryDocumentation telemetryType={telemetryType} />
    </MemoryRouter>,
  );
};

const compatibleGroup: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("compatible-ingest-methods");
};

const compatibleLabels: () => Array<string> = (): Array<string> => {
  return within(compatibleGroup())
    .getAllByRole("button")
    .map((button: HTMLElement): string => {
      return button.querySelector("div")?.textContent || "";
    });
};

const stepTitles: () => Array<string> = (): Array<string> => {
  return screen
    .getAllByRole("heading", { level: 4 })
    .map((heading: HTMLElement): string => {
      return heading.textContent || "";
    });
};

// Every code sample on screen, as text.
const codeOnScreen: () => string = (): string => {
  return Array.from(document.querySelectorAll("pre, code"))
    .map((element: Element): string => {
      return element.textContent || "";
    })
    .join("\n");
};

describe("Setup Guide: Already using another tool?", () => {
  beforeAll(async (): Promise<void> => {
    await preloadProviderLogoMarks();
  });

  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [serverKey()],
      count: 1,
      skip: 0,
      limit: 50,
    } as never);
    jest.spyOn(API, "post").mockResolvedValue({
      data: { activity: [] },
    } as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test.each<[TelemetryType, Array<string>]>([
    ["logs", ["Loki", "Splunk HEC", "Datadog Agent"]],
    ["metrics", ["Prometheus", "Splunk HEC", "Datadog Agent"]],
    ["traces", ["Sentry SDK"]],
    ["exceptions", ["Sentry SDK"]],
  ])(
    "the %s guide lists the tools that fill it",
    (telemetryType: TelemetryType, expected: Array<string>) => {
      renderGuide(telemetryType);

      expect(
        within(compatibleGroup()).getByText("Already using another tool?"),
      ).toBeInTheDocument();
      expect(compatibleLabels()).toEqual(expected);
    },
  );

  test("the profiles guide has no such group", () => {
    renderGuide("profiles");

    expect(screen.queryByTestId("compatible-ingest-methods")).toBeNull();
  });

  test("OpenTelemetry stays the recommended way, picked first, above the group", () => {
    renderGuide("metrics");

    const openTelemetry: HTMLElement = screen
      .getByText("OpenTelemetry", { selector: "div" })
      .closest("button") as HTMLElement;

    expect(openTelemetry).toHaveAttribute("aria-pressed", "true");
    expect(
      openTelemetry.compareDocumentPosition(compatibleGroup()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("Prometheus: the key with the remote write URL, the configuration with both, and what it becomes", async () => {
    renderGuide("metrics");

    fireEvent.click(screen.getByTestId("compatible-ingest-prometheus"));

    expect(screen.getByTestId("compatible-ingest-prometheus")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(stepTitles()).toEqual([
      "Get Your Ingestion Credentials",
      "Point it at OneUptime",
      "What you will see in OneUptime",
    ]);
    // The key's own card, once the keys have loaded.
    expect(await screen.findByText("Remote write URL")).toBeInTheDocument();

    await waitFor(() => {
      expect(codeOnScreen()).toContain(`credentials: ${SECRET}`);
    });

    expect(codeOnScreen()).toContain("/telemetry/prometheus/api/v1/write");
    expect(
      screen.getByText(
        "Each job becomes a service, and every series keeps its name and labels.",
      ),
    ).toBeInTheDocument();
  });

  test("Datadog: the API key is written as 32 hex digits, as the Agent needs it", async () => {
    renderGuide("logs");

    fireEvent.click(screen.getByTestId("compatible-ingest-datadog"));

    await waitFor(() => {
      expect(codeOnScreen()).toContain(`api_key: ${SECRET.replace(/-/g, "")}`);
    });

    expect(codeOnScreen()).toContain("/telemetry/datadog");
  });

  test("Splunk HEC offers each client as a tab of one step", () => {
    renderGuide("logs");

    fireEvent.click(screen.getByTestId("compatible-ingest-splunk-hec"));

    for (const tab of ["Docker", "OpenTelemetry Collector", "curl"]) {
      expect(screen.getByRole("tab", { name: tab })).toBeInTheDocument();
    }
  });

  test("Sentry asks where the app runs; a browser app is offered Browser keys and warned its DSN is public", async () => {
    renderGuide("exceptions");

    fireEvent.click(screen.getByTestId("compatible-ingest-sentry"));

    const runtime: HTMLElement = screen.getByTestId(
      "compatible-ingest-sentry-runtime",
    );

    expect(within(runtime).getByText("Where does your app run?")).toBeVisible();
    expect(
      within(runtime).getByRole("button", { name: /On a server/ }),
    ).toHaveAttribute("aria-pressed", "true");

    // A server app: Node, Python and the environment, as tabs.
    expect(screen.getByRole("tab", { name: "Python" })).toBeInTheDocument();

    fireEvent.click(
      within(runtime).getByRole("button", { name: /In the browser/ }),
    );

    await waitFor(() => {
      const calls: Array<Array<unknown>> = (ModelAPI.getList as jest.Mock).mock
        .calls as Array<Array<unknown>>;
      const lastQuery: Record<string, unknown> = (
        calls[calls.length - 1]![0] as { query: Record<string, unknown> }
      ).query;

      expect(lastQuery["keyType"]).toBe(TelemetryIngestionKeyType.Browser);
    });

    expect(codeOnScreen()).toContain("@sentry/browser");
    expect(
      screen.getByText(/This file is bundled and served to your users/),
    ).toBeInTheDocument();
  });

  test("picking OpenTelemetry again brings its own steps back", async () => {
    renderGuide("metrics");

    fireEvent.click(screen.getByTestId("compatible-ingest-prometheus"));
    expect(await screen.findByText("Remote write URL")).toBeInTheDocument();

    fireEvent.click(screen.getByText("OpenTelemetry", { selector: "div" }));

    expect(await screen.findByText("OTLP Endpoint")).toBeInTheDocument();
    expect(screen.queryByText("Remote write URL")).toBeNull();
  });
});
