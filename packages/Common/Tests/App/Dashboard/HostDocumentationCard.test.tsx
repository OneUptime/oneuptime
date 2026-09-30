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
import HostDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/Host/DocumentationCard";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  getSetupGuideOneUptimeUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import { HOST_INSTALL_METHODS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/DocumentationMarkdown";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { HOST, HTTP_PROTOCOL } from "../../../UI/Config";
import Protocol from "../../../Types/API/Protocol";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ObjectID from "../../../Types/ObjectID";

/*
 * The host guide as it reaches the screen: a thin HostDocumentationCard
 * over SetupGuideCard. SetupGuideCard.test.tsx covers the layout itself;
 * this pins the wiring — the question and the seven install methods, that
 * picking one swaps in that method's steps, and that step 1 and the config
 * carry the OTLP endpoint and the selected key.
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
      <HostDocumentationCard
        title="Getting Started with Host Monitoring"
        description="No hosts connected yet."
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

describe("HostDocumentationCard", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("asks how to install the collector and offers the seven methods", () => {
    mockKeys([]);
    renderCard();

    expect(
      screen.getByRole("heading", {
        name: "Getting Started with Host Monitoring",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", {
        name: "How do you want to install the collector?",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(
      HOST_INSTALL_METHODS.length,
    );
    for (const option of HOST_INSTALL_METHODS) {
      expect(radio(option.label)).toBeInTheDocument();
    }
  });

  test("opens on Docker, with its three steps after the key", () => {
    mockKeys([]);
    renderCard();

    expect(radio("Docker")).toHaveAttribute("aria-checked", "true");
    expect(stepTitle(1)).toBe("Choose an ingestion key");
    expect(stepTitle(2)).toBe("Save the collector config");
    expect(stepTitle(3)).toBe("Run the collector with Docker");
    expect(stepTitle(4)).toBe("Check the host appears");
  });

  test("picking a method swaps in that method's install", () => {
    mockKeys([]);
    const { container } = renderCard();

    fireEvent.click(radio("Windows"));
    expect(stepTitle(3)).toBe("Install and start the collector");
    expect(container.textContent).toContain("sc.exe --% create");
    expect(container.textContent).not.toContain("docker run -d");

    // Kubernetes nodes live under their cluster: the agent's install, not a collector.
    fireEvent.click(radio("Kubernetes"));
    expect(stepTitle(2)).toBe("Check kubectl points at your cluster");
    expect(stepTitle(3)).toBe("Install the agent");
    expect(container.textContent).not.toContain("Save the collector config");
    expect(container.textContent).toContain(
      "helm install kubernetes-agent oneuptime/kubernetes-agent",
    );
  });

  test("the systemd topic is under Advanced for a native Linux install only", () => {
    mockKeys([]);
    renderCard();

    fireEvent.click(radio("Debian / Ubuntu"));
    fireEvent.click(screen.getByTestId("setup-guide-advanced-toggle"));
    expect(
      screen.getByText("Enable the Systemd Units tab"),
    ).toBeInTheDocument();

    fireEvent.click(radio("Docker"));
    expect(
      screen.queryByText("Enable the Systemd Units tab"),
    ).not.toBeInTheDocument();
  });

  test("step 1 shows the OTLP endpoint, and the config carries the key", async () => {
    mockKeys([productionKey()]);
    const { container } = renderCard();

    const first: HTMLElement = screen.getByTestId("setup-guide-step-1");
    await waitFor(() => {
      expect(within(first).getByText("OTLP Endpoint")).toBeInTheDocument();
    });
    expect(
      within(first).getByText(`${ONEUPTIME_URL}/otlp`),
    ).toBeInTheDocument();
    // The selector hands the key up after it renders it.
    await waitFor(() => {
      expect(container.textContent).toContain(
        "x-oneuptime-token: secret-production",
      );
    });
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
    expect(container.textContent).toContain(
      `x-oneuptime-token: ${SETUP_GUIDE_API_KEY_PLACEHOLDER}`,
    );
    expect(container.textContent).toContain("Pick an ingestion key in step 1");
  });
});
