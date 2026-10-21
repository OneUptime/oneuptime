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
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import StorageArrayDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/StorageArray/DocumentationCard";
import { SETUP_GUIDE_API_KEY_PLACEHOLDER } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";

/*
 * The Storage Array guide as it reaches the screen: SetupGuideCard with a
 * platform picker, the read-only user step, (for a FlashArray serving its
 * own metrics) the endpoint check, and the install step whose tabs are the
 * install script and Docker Compose. What is pinned here is the wiring the
 * pure guide tests cannot see — the question above the picker, that the
 * card hands the selected key's secret (not the placeholder) to the guide,
 * that picking a platform swaps the whole guide, and that an array's own
 * tab opens on its platform and installs for its name.
 *
 * The markdown viewer is a lazy boundary; it is rendered as plain text here
 * (as in SetupGuideCard.test.tsx) because these tests are about which
 * content is on screen, not how markdown is styled.
 */

interface MarkdownViewerProps {
  text: string;
}

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const SECRET: string = "secret-production";

const makeKey: () => TelemetryIngestionKey = (): TelemetryIngestionKey => {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID("key-1");
  key.name = "Production Key";
  key.secretKey = new ObjectID(SECRET);
  key.keyType = TelemetryIngestionKeyType.Server;
  return key;
};

const mockKeys: (keys: Array<TelemetryIngestionKey>) => void = (
  keys: Array<TelemetryIngestionKey>,
): void => {
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: keys,
    count: keys.length,
    skip: 0,
    limit: 50,
  } as never);
};

const renderElement: (element: React.ReactElement) => HTMLElement = (
  element: React.ReactElement,
): HTMLElement => {
  const { container } = render(<MemoryRouter>{element}</MemoryRouter>);
  return container;
};

// The platform radios, in picker order: FlashArray, older FlashArray, FlashBlade.
const platformRadio: (index: number) => HTMLElement = (
  index: number,
): HTMLElement => {
  return screen.getAllByRole("radio")[index]!;
};

const tab: (name: string) => HTMLElement = (name: string): HTMLElement => {
  return screen.getByRole("tab", { name: name });
};

const tabNames: () => Array<string> = (): Array<string> => {
  return screen.getAllByRole("tab").map((element: HTMLElement): string => {
    return element.textContent || "";
  });
};

// Resolves once the key has been loaded and handed to the guide.
const waitForKey: (container: HTMLElement) => Promise<void> = async (
  container: HTMLElement,
): Promise<void> => {
  await waitFor(() => {
    expect(container.textContent).toContain(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${SECRET}`,
    );
  });
};

describe("StorageArrayDocumentationCard", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("asks which array, opens on the FlashArray's native endpoint, with the picked key", async () => {
    mockKeys([makeKey()]);
    const container: HTMLElement = renderElement(
      <StorageArrayDocumentationCard
        title="Getting Started with Storage Array Monitoring"
        description="No storage arrays connected yet."
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Getting Started with Storage Array Monitoring",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", {
        name: "Which array are you connecting?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("radio").map((element: HTMLElement): string => {
        return element.textContent || "";
      }),
    ).toEqual([
      expect.stringMatching(/^FlashArrayRecommended/),
      expect.stringMatching(/^FlashArray, older Purity/),
      expect.stringMatching(/^FlashBlade/),
    ]);
    expect(platformRadio(0)).toHaveAttribute("aria-checked", "true");

    await waitForKey(container);
    expect(container.textContent).toContain(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${SECRET} STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.yaml bash install.sh`,
    );
    expect(container.textContent).toContain(
      "Check the array serves its own metrics",
    );
    expect(container.textContent).not.toContain(
      SETUP_GUIDE_API_KEY_PLACEHOLDER,
    );
  });

  test("the read-only user and install steps show their tabs", async () => {
    mockKeys([makeKey()]);
    const container: HTMLElement = renderElement(
      <StorageArrayDocumentationCard title="Connect" description="A guide." />,
    );
    await waitForKey(container);

    expect(tabNames()).toEqual([
      "Purity CLI",
      "FlashArray GUI",
      "Install script",
      "Docker Compose",
    ]);
    expect(container.textContent).toContain(
      "pureadmin create --role readonly oneuptime",
    );
  });

  test("Docker Compose swaps in the .env file, with the key, the example name and the native settings", async () => {
    mockKeys([makeKey()]);
    const container: HTMLElement = renderElement(
      <StorageArrayDocumentationCard title="Connect" description="A guide." />,
    );
    await waitForKey(container);

    fireEvent.click(tab("Docker Compose"));

    expect(tab("Docker Compose")).toHaveAttribute("aria-selected", "true");
    expect(container.textContent).toContain(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${SECRET}\nSTORAGE_ARRAY_NAME=my-storage-array\nSTORAGE_SYSTEM=purestorage.flasharray\nSTORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.yaml\nCOMPOSE_PROFILES=\nPURE_FA_ENDPOINT=fa-prod-01.example.com`,
    );
    expect(container.textContent).toContain("docker compose up -d");
    expect(container.textContent).not.toContain("bash install.sh");
  });

  test("picking FlashBlade swaps the whole guide to the FlashBlade exporter", async () => {
    mockKeys([makeKey()]);
    const container: HTMLElement = renderElement(
      <StorageArrayDocumentationCard title="Connect" description="A guide." />,
    );
    await waitForKey(container);

    fireEvent.click(platformRadio(2));

    expect(platformRadio(2)).toHaveAttribute("aria-checked", "true");
    await waitFor(() => {
      expect(container.textContent).toContain(
        "STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flashblade.yaml bash install.sh",
      );
    });
    expect(container.textContent).not.toContain(
      "Check the array serves its own metrics",
    );
    expect(container.textContent).toContain("`T-`");

    fireEvent.click(tab("Docker Compose"));

    expect(container.textContent).toContain("PURE_FB_ENDPOINT=");
    expect(container.textContent).toContain("COMPOSE_PROFILES=flashblade");
    expect(container.textContent).not.toContain("PURE_FA_ENDPOINT=");
  });

  test("picking the older FlashArray runs Pure's FlashArray exporter", async () => {
    mockKeys([makeKey()]);
    const container: HTMLElement = renderElement(
      <StorageArrayDocumentationCard title="Connect" description="A guide." />,
    );
    await waitForKey(container);

    fireEvent.click(platformRadio(1));

    await waitFor(() => {
      expect(container.textContent).toContain(
        "STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml bash install.sh",
      );
    });

    fireEvent.click(tab("Docker Compose"));

    expect(container.textContent).toContain(
      "COMPOSE_PROFILES=flasharray-exporter",
    );
    expect(container.textContent).toContain("pure-fa-exporter");
  });

  test("an array's own tab opens on its platform and installs for its name", async () => {
    mockKeys([makeKey()]);
    const container: HTMLElement = renderElement(
      <StorageArrayDocumentationCard
        arrayName="fb-prod-01"
        storageSystem={StorageSystem.PureStorageFlashBlade}
        title="Storage Array Agent Installation Guide"
        description="A guide."
      />,
    );
    await waitForKey(container);

    expect(platformRadio(2)).toHaveAttribute("aria-checked", "true");
    expect(container.textContent).toContain(
      "STORAGE_ARRAY_NAME=fb-prod-01 STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flashblade.yaml bash install.sh",
    );

    fireEvent.click(tab("Docker Compose"));

    expect(container.textContent).toContain("STORAGE_ARRAY_NAME=fb-prod-01");
  });

  test("an array that has not reported a platform opens on the FlashArray", async () => {
    mockKeys([makeKey()]);
    const container: HTMLElement = renderElement(
      <StorageArrayDocumentationCard
        arrayName="new-array"
        title="Connect"
        description="A guide."
      />,
    );
    await waitForKey(container);

    expect(platformRadio(0)).toHaveAttribute("aria-checked", "true");
  });

  test("without a key, the install script prompts for the URL and key", async () => {
    mockKeys([]);
    const container: HTMLElement = renderElement(
      <StorageArrayDocumentationCard title="Connect" description="A guide." />,
    );
    await waitFor(() => {
      expect(screen.getByText("No ingestion keys yet")).toBeInTheDocument();
    });
    expect(container.textContent).toContain(
      "-o install.sh\nSTORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.yaml bash install.sh",
    );
    expect(container.textContent).not.toContain(
      "ONEUPTIME_TELEMETRY_INGESTION_KEY=",
    );
  });

  test("folds Advanced and Troubleshooting away", async () => {
    mockKeys([makeKey()]);
    const container: HTMLElement = renderElement(
      <StorageArrayDocumentationCard title="Connect" description="A guide." />,
    );
    await waitForKey(container);
    expect(screen.getByTestId("setup-guide-advanced-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.getByTestId("setup-guide-troubleshooting-toggle"),
    ).toHaveAttribute("aria-expanded", "false");
    expect(container.textContent).not.toContain("scrape_configs:");
  });
});
