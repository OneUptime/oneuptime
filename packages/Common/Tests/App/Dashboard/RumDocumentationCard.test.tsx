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
import RumDocumentationCard from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumDocumentationCard";
import { SETUP_GUIDE_API_KEY_PLACEHOLDER } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";

/*
 * The RUM guide as it reaches the screen. The one thing it must never get
 * wrong is the key: the browser snippet is public, so the key picker may
 * only ever list (and create) Browser keys for it, and a mobile app cannot
 * use a Browser key at all, so the mobile option never asks for one.
 *
 * ModelAPI.getList answers like the real list does — only the keys of the
 * type asked for — so what reaches the snippet is whatever the picker was
 * allowed to offer.
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

const makeKey: (data: {
  id: string;
  name: string;
  secret: string;
  keyType: TelemetryIngestionKeyType;
}) => TelemetryIngestionKey = (data: {
  id: string;
  name: string;
  secret: string;
  keyType: TelemetryIngestionKeyType;
}): TelemetryIngestionKey => {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID(data.id);
  key.name = data.name;
  key.secretKey = new ObjectID(data.secret);
  key.keyType = data.keyType;
  key.allowedOrigins = ["https://shop.example.com"];
  return key;
};

const BROWSER_KEY: TelemetryIngestionKey = makeKey({
  id: "key-browser",
  name: "Storefront Browser Key",
  secret: "secret-browser",
  keyType: TelemetryIngestionKeyType.Browser,
});

const SERVER_KEY: TelemetryIngestionKey = makeKey({
  id: "key-server",
  name: "Mobile Key",
  secret: "secret-server",
  keyType: TelemetryIngestionKeyType.Server,
});

type GetList = typeof ModelAPI.getList;

interface ListArguments {
  query: Record<string, unknown>;
}

// Answers with the keys of the requested type, as the API does.
const mockKeys: (keys: Array<TelemetryIngestionKey>) => jest.Mock<GetList> = (
  keys: Array<TelemetryIngestionKey>,
): jest.Mock<GetList> => {
  return jest.spyOn(ModelAPI, "getList").mockImplementation(((
    args: ListArguments,
  ): Promise<unknown> => {
    const matching: Array<TelemetryIngestionKey> = keys.filter(
      (key: TelemetryIngestionKey): boolean => {
        return !args.query["keyType"] || key.keyType === args.query["keyType"];
      },
    );
    return Promise.resolve({
      data: matching,
      count: matching.length,
      skip: 0,
      limit: 50,
    });
  }) as never) as unknown as jest.Mock<GetList>;
};

// The key types the picker has asked for, in order.
const requestedKeyTypes: (getList: jest.Mock<GetList>) => Array<unknown> = (
  getList: jest.Mock<GetList>,
): Array<unknown> => {
  return getList.mock.calls.map((call: Array<unknown>): unknown => {
    return (call[0] as ListArguments).query["keyType"];
  });
};

const renderCard: (props?: {
  appName?: string | undefined;
  clientType?: string | undefined;
}) => HTMLElement = (props?: {
  appName?: string | undefined;
  clientType?: string | undefined;
}): HTMLElement => {
  const { container } = render(
    <MemoryRouter>
      <RumDocumentationCard
        title="Getting Started with Real User Monitoring"
        description="Instrument your app."
        appName={props?.appName}
        clientType={props?.clientType}
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

describe("RumDocumentationCard", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("asks what is being instrumented, and opens on Browser", async () => {
    mockKeys([BROWSER_KEY, SERVER_KEY]);
    const container: HTMLElement = renderCard();

    await waitFor(() => {
      expect(container.textContent).toContain("secret-browser");
    });
    expect(
      screen.getByRole("radiogroup", { name: "What are you instrumenting?" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(radio("Browser")).toHaveAttribute("aria-checked", "true");
    expect(radio("Mobile (iOS / Android)")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("the Browser option asks for Browser keys only, and its snippet carries one", async () => {
    const getList: jest.Mock<GetList> = mockKeys([BROWSER_KEY, SERVER_KEY]);
    const container: HTMLElement = renderCard();

    await waitFor(() => {
      expect(container.textContent).toContain(
        '"x-oneuptime-token": "secret-browser"',
      );
    });

    expect(requestedKeyTypes(getList)).toEqual([
      TelemetryIngestionKeyType.Browser,
    ]);
    expect(container.textContent).not.toContain("secret-server");
    expect(container.textContent).toContain("src/telemetry.ts");
  });

  test("the Mobile option does not ask for Browser keys: it asks for Server keys", async () => {
    const getList: jest.Mock<GetList> = mockKeys([BROWSER_KEY, SERVER_KEY]);
    const container: HTMLElement = renderCard();

    await waitFor(() => {
      expect(container.textContent).toContain("secret-browser");
    });

    fireEvent.click(radio("Mobile (iOS / Android)"));

    await waitFor(() => {
      expect(requestedKeyTypes(getList)).toEqual([
        TelemetryIngestionKeyType.Browser,
        TelemetryIngestionKeyType.Server,
      ]);
    });

    expect(radio("Mobile (iOS / Android)")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(container.textContent).toContain(
      "Point the SDK's exporter at OneUptime",
    );
    // The Browser key picked a moment ago never reaches the mobile snippet.
    await waitFor(() => {
      expect(container.textContent).not.toContain("secret-browser");
    });
    expect(container.textContent).toContain(
      `OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=`,
    );
  });

  test("opens on the application's own client type, asking only for Server keys", async () => {
    const getList: jest.Mock<GetList> = mockKeys([BROWSER_KEY, SERVER_KEY]);
    const container: HTMLElement = renderCard({ clientType: "mobile" });

    expect(radio("Mobile (iOS / Android)")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await waitFor(() => {
      expect(container.textContent).toContain(
        'OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=secret-server"',
      );
    });

    expect(requestedKeyTypes(getList)).toEqual([
      TelemetryIngestionKeyType.Server,
    ]);
    expect(container.textContent).not.toContain("secret-browser");
    expect(container.textContent).not.toContain("src/telemetry.ts");
  });

  test("an unknown client type falls back to Browser", async () => {
    const getList: jest.Mock<GetList> = mockKeys([BROWSER_KEY, SERVER_KEY]);
    const container: HTMLElement = renderCard({ clientType: "desktop" });

    expect(radio("Browser")).toHaveAttribute("aria-checked", "true");
    await waitFor(() => {
      expect(container.textContent).toContain("secret-browser");
    });
    expect(requestedKeyTypes(getList)).toEqual([
      TelemetryIngestionKeyType.Browser,
    ]);
  });

  test("fills in the application's own name", async () => {
    mockKeys([BROWSER_KEY]);
    const container: HTMLElement = renderCard({ appName: "checkout-web" });

    await waitFor(() => {
      expect(container.textContent).toContain("secret-browser");
    });
    expect(container.textContent).toContain(
      '[ATTR_SERVICE_NAME]: "checkout-web",',
    );
    expect(container.textContent).not.toContain("storefront-web");
  });

  test("with no Browser key yet, offers to create one and keeps the placeholder", async () => {
    mockKeys([SERVER_KEY]);
    const container: HTMLElement = renderCard();

    await waitFor(() => {
      expect(
        screen.getByText("No browser ingestion keys yet"),
      ).toBeInTheDocument();
    });
    // The project's Server key is never offered for the page.
    expect(container.textContent).not.toContain("secret-server");
    expect(container.textContent).toContain(
      `"x-oneuptime-token": "${SETUP_GUIDE_API_KEY_PLACEHOLDER}"`,
    );
  });
});
