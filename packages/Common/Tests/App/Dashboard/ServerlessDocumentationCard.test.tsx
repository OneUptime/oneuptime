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
import ServerlessDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/Serverless/ServerlessDocumentationCard";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";

/*
 * The serverless guide as it reaches the screen: the platform picker opens
 * on the platform a function reported, only Server keys are offered (a
 * function sends no Origin header, so a Browser key would be refused on
 * every export), and the picked key and the function's own name land in the
 * settings the reader copies.
 */

interface MarkdownViewerProps {
  text: string;
}

// Rendered as plain text, as in SetupGuideCard.test.tsx.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID("project-1");

const SERVER_KEY: TelemetryIngestionKey = new TelemetryIngestionKey();
SERVER_KEY.id = new ObjectID("key-server");
SERVER_KEY.name = "Functions Key";
SERVER_KEY.secretKey = new ObjectID("secret-server");
SERVER_KEY.keyType = TelemetryIngestionKeyType.Server;

type GetList = typeof ModelAPI.getList;

interface ListArguments {
  query: Record<string, unknown>;
}

const mockKeys: () => jest.Mock<GetList> = (): jest.Mock<GetList> => {
  return jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [SERVER_KEY],
    count: 1,
    skip: 0,
    limit: 50,
  } as never) as unknown as jest.Mock<GetList>;
};

const renderCard: (props?: {
  functionName?: string | undefined;
  cloudPlatform?: string | undefined;
}) => HTMLElement = (props?: {
  functionName?: string | undefined;
  cloudPlatform?: string | undefined;
}): HTMLElement => {
  const { container } = render(
    <MemoryRouter>
      <ServerlessDocumentationCard
        title="Getting Started with Serverless Functions"
        description="Instrument a function."
        functionName={props?.functionName}
        cloudPlatform={props?.cloudPlatform}
      />
    </MemoryRouter>,
  );
  return container;
};

const radio: (label: string) => HTMLElement = (label: string): HTMLElement => {
  return screen.getByRole("radio", {
    name: (accessibleName: string): boolean => {
      return accessibleName.startsWith(label);
    },
  });
};

const waitForKey: (container: HTMLElement) => Promise<void> = async (
  container: HTMLElement,
): Promise<void> => {
  await waitFor(() => {
    expect(container.textContent).toContain(
      "OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=secret-server",
    );
  });
};

describe("ServerlessDocumentationCard", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("asks where the functions run, and opens on AWS Lambda", async () => {
    mockKeys();
    const container: HTMLElement = renderCard();
    await waitForKey(container);

    expect(
      screen.getByRole("radiogroup", { name: "Where do your functions run?" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(radio("AWS Lambda")).toHaveAttribute("aria-checked", "true");
    expect(container.textContent).toContain(
      "AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler",
    );
  });

  test("offers only Server keys, whichever platform is picked", async () => {
    const getList: jest.Mock<GetList> = mockKeys();
    const container: HTMLElement = renderCard();
    await waitForKey(container);

    for (const label of [
      "Google Cloud Functions",
      "Azure Functions",
      "Other runtimes",
    ]) {
      fireEvent.click(radio(label));
      expect(radio(label)).toHaveAttribute("aria-checked", "true");
    }

    expect(getList).toHaveBeenCalled();
    for (const call of getList.mock.calls) {
      expect((call[0] as unknown as ListArguments).query["keyType"]).toBe(
        TelemetryIngestionKeyType.Server,
      );
    }
  });

  test("switching the platform swaps the instructions and keeps the key", async () => {
    mockKeys();
    const container: HTMLElement = renderCard();
    await waitForKey(container);

    fireEvent.click(radio("Google Cloud Functions"));

    expect(container.textContent).toContain("Edit & deploy new revision");
    expect(container.textContent).toContain(
      "OTEL_RESOURCE_ATTRIBUTES=faas.name=checkout-handler,faas.version=1.4.2,cloud.platform=gcp_cloud_functions",
    );
    expect(container.textContent).not.toContain("AWS_LAMBDA_EXEC_WRAPPER");
    expect(container.textContent).toContain(
      "OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=secret-server",
    );
  });

  test("opens on the platform the function reported", async () => {
    mockKeys();
    const container: HTMLElement = renderCard({
      cloudPlatform: "azure_functions",
    });
    await waitForKey(container);

    expect(radio("Azure Functions")).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getAllByRole("tab").map((tab: HTMLElement): string => {
        return tab.textContent || "";
      }),
    ).toEqual(["Azure portal", "Azure CLI"]);

    fireEvent.click(screen.getByRole("tab", { name: "Azure CLI" }));

    expect(container.textContent).toContain(
      "az functionapp config appsettings set",
    );
  });

  test("a platform without an option of its own opens the generic guide", async () => {
    mockKeys();
    const container: HTMLElement = renderCard({
      cloudPlatform: "tencent_cloud_scf",
    });
    await waitForKey(container);

    expect(radio("Other runtimes")).toHaveAttribute("aria-checked", "true");
  });

  test("a function that has reported no platform opens on the default", async () => {
    mockKeys();
    const container: HTMLElement = renderCard({ cloudPlatform: "" });
    await waitForKey(container);

    expect(radio("AWS Lambda")).toHaveAttribute("aria-checked", "true");
  });

  test("fills in faas.name with the function's own identifier", async () => {
    mockKeys();
    const container: HTMLElement = renderCard({
      functionName: "invoice-mailer",
      cloudPlatform: "gcp_cloud_functions",
    });
    await waitForKey(container);

    expect(radio("Google Cloud Functions")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(container.textContent).toContain(
      "OTEL_RESOURCE_ATTRIBUTES=faas.name=invoice-mailer,",
    );
    expect(container.textContent).not.toContain("faas.name=checkout-handler");
  });
});
