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
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import IoTDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/IoT/DocumentationCard";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  getSetupGuideOneUptimeUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import { getIoTMqttWebSocketUrl } from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/DocumentationMarkdown";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { HOST, HTTP_PROTOCOL } from "../../../UI/Config";
import Protocol from "../../../Types/API/Protocol";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ObjectID from "../../../Types/ObjectID";

/*
 * The IoT guide as it reaches the screen: a thin IoTDocumentationCard over
 * SetupGuideCard. SetupGuideCard.test.tsx covers the layout itself; this
 * pins the wiring — the question and the three ways to connect, that step 1
 * switches between the OTLP endpoint and the MQTT WebSocket URL with the
 * option, and that the selected key reaches the snippets.
 */

interface MarkdownViewerProps {
  text: string;
}

// Render markdown as its source text, as SetupGuideCard.test.tsx does.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID("project-1");

const ONEUPTIME_URL: string = getSetupGuideOneUptimeUrl({
  host: HOST,
  isHttps: HTTP_PROTOCOL === Protocol.HTTPS,
});

type GetList = typeof ModelAPI.getList;

const mockKeys: (keys: Array<TelemetryIngestionKey>) => jest.Mock<GetList> = (
  keys: Array<TelemetryIngestionKey>,
): jest.Mock<GetList> => {
  return jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: keys,
    count: keys.length,
    skip: 0,
    limit: 50,
  } as never) as unknown as jest.Mock<GetList>;
};

const productionKey: () => TelemetryIngestionKey =
  (): TelemetryIngestionKey => {
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    key.id = new ObjectID("key-1");
    key.name = "Production Key";
    key.secretKey = new ObjectID("secret-production");
    return key;
  };

const renderCard: () => { container: HTMLElement } = (): {
  container: HTMLElement;
} => {
  return render(
    <MemoryRouter>
      <IoTDocumentationCard
        title="Getting Started with IoT Monitoring"
        description="No IoT fleets connected yet."
      />
    </MemoryRouter>,
  );
};

const radio: (label: string) => HTMLElement = (label: string): HTMLElement => {
  return screen.getByRole("radio", { name: new RegExp(`^${label}`) });
};

const stepTitle: (stepNumber: number) => string = (
  stepNumber: number,
): string => {
  const step: HTMLElement = screen.getByTestId(
    `setup-guide-step-${stepNumber}`,
  );
  return (within(step).getByRole("heading").textContent || "").replace(
    `Step ${stepNumber}: `,
    "",
  );
};

describe("IoTDocumentationCard", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("asks how the devices send data and offers the three ways", () => {
    mockKeys([]);
    renderCard();

    expect(
      screen.getByRole("heading", {
        name: "Getting Started with IoT Monitoring",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", {
        name: "How do your devices send data?",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(radio("OpenTelemetry SDK")).toHaveAttribute("aria-checked", "true");
    expect(radio("OpenTelemetry Collector")).toBeInTheDocument();
    expect(radio("MQTT")).toBeInTheDocument();
  });

  test("each way shows its own steps", () => {
    mockKeys([]);
    renderCard();

    expect(stepTitle(2)).toBe("Point the SDK at OneUptime");
    expect(stepTitle(3)).toBe("Record readings as iot_* metrics");

    fireEvent.click(radio("OpenTelemetry Collector"));
    expect(stepTitle(2)).toBe("Save the gateway's collector config");
    expect(stepTitle(3)).toBe("Run the collector on the gateway");
    expect(
      screen.getAllByRole("tab").map((tab: HTMLElement): string => {
        return tab.textContent || "";
      }),
    ).toEqual(["Docker", "otelcol-contrib binary"]);

    fireEvent.click(radio("MQTT"));
    expect(stepTitle(2)).toBe("Publish a reading");
    expect(stepTitle(3)).toBe("Check the fleet appears");
    expect(screen.queryByTestId("setup-guide-step-4")).not.toBeInTheDocument();
  });

  test("step 1 follows the option: the OTLP endpoint, then the MQTT URL", async () => {
    mockKeys([productionKey()]);
    renderCard();

    const first: HTMLElement = screen.getByTestId("setup-guide-step-1");
    await waitFor(() => {
      expect(within(first).getByText("OTLP Endpoint")).toBeInTheDocument();
    });
    expect(
      within(first).getByText(`${ONEUPTIME_URL}/otlp`),
    ).toBeInTheDocument();

    fireEvent.click(radio("MQTT"));

    expect(within(first).getByText("MQTT WebSocket URL")).toBeInTheDocument();
    expect(
      within(first).getByText(getIoTMqttWebSocketUrl(ONEUPTIME_URL)),
    ).toBeInTheDocument();
    expect(
      within(first).getByText(
        "Send the ingestion token below as the MQTT password — the username is ignored.",
      ),
    ).toBeInTheDocument();
    expect(within(first).queryByText("OTLP Endpoint")).not.toBeInTheDocument();
  });

  test("the selected key reaches the snippets of every option", async () => {
    mockKeys([productionKey()]);
    const { container } = renderCard();

    await waitFor(() => {
      expect(container.textContent).toContain(
        "x-oneuptime-token=secret-production",
      );
    });

    fireEvent.click(radio("MQTT"));
    expect(container.textContent).toContain('password: "secret-production"');
    expect(container.textContent).not.toContain(
      SETUP_GUIDE_API_KEY_PLACEHOLDER,
    );
  });

  test("shows the placeholder, and where to pick a key, while there is none", async () => {
    mockKeys([]);
    const { container } = renderCard();

    await waitFor(() => {
      expect(screen.getByText("No ingestion keys yet")).toBeInTheDocument();
    });
    expect(container.textContent).toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
    expect(container.textContent).toContain("Pick an ingestion key in step 1");
  });
});
