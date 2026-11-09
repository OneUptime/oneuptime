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
import RumSignalSetupModal from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalSetupModal";
import { getConfiguredOneUptimeUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/ConfiguredOneUptimeUrl";
import { SETUP_GUIDE_API_KEY_PLACEHOLDER } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";

/*
 * "Set up exceptions" and "Set up logs" (issue #5770), as the dialog draws
 * them: the few lines that send a browser application's uncaught errors or
 * its log records, with this install's URL and - for logs - a Browser key
 * filled in. The snippet ships in the page, so the picker may only ever
 * offer Browser keys; exceptions travel with the traces the app already
 * sends, so they ask for no key at all.
 */

// Rendered as plain text, as in SetupGuideCard.test.tsx.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID("project-1");

function makeKey(data: {
  id: string;
  name: string;
  secret: string;
  keyType: TelemetryIngestionKeyType;
}): TelemetryIngestionKey {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID(data.id);
  key.name = data.name;
  key.secretKey = new ObjectID(data.secret);
  key.keyType = data.keyType;
  key.allowedOrigins = ["https://shop.example.com"];
  return key;
}

const BROWSER_KEY: TelemetryIngestionKey = makeKey({
  id: "key-browser",
  name: "Storefront Browser Key",
  secret: "secret-browser",
  keyType: TelemetryIngestionKeyType.Browser,
});

const SERVER_KEY: TelemetryIngestionKey = makeKey({
  id: "key-server",
  name: "Backend Key",
  secret: "secret-server",
  keyType: TelemetryIngestionKeyType.Server,
});

type GetList = typeof ModelAPI.getList;

interface ListArguments {
  query: Record<string, unknown>;
}

// Answers with the keys of the requested type, as the API does.
function mockKeys(keys: Array<TelemetryIngestionKey>): jest.Mock<GetList> {
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
}

function requestedKeyTypes(getList: jest.Mock<GetList>): Array<unknown> {
  return getList.mock.calls.map((call: Array<unknown>): unknown => {
    return (call[0] as ListArguments).query["keyType"];
  });
}

// The steps' titles, without the "Step 1:" a screen reader hears first.
const STEP_PREFIX: RegExp = /^Step \d+: /;

function stepTitles(dialog: HTMLElement): Array<string> {
  return within(dialog)
    .getAllByRole("heading", { level: 3 })
    .map((heading: HTMLElement): string => {
      return (heading.textContent || "").replace(STEP_PREFIX, "");
    });
}

const onClose: jest.Mock<() => void> = jest.fn<() => void>();

function open(signal: "exceptions" | "logs"): HTMLElement {
  render(
    <RumSignalSetupModal
      signal={signal}
      appName="storefront-web"
      onClose={onClose}
    />,
  );
  return screen.getByTestId(`rum-${signal}-setup`);
}

beforeEach(() => {
  onClose.mockReset();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Set up logs", () => {
  test("asks for Browser keys only, and its log exporter carries the one picked", async () => {
    const getList: jest.Mock<GetList> = mockKeys([BROWSER_KEY, SERVER_KEY]);
    const dialog: HTMLElement = open("logs");

    await waitFor(() => {
      expect(dialog.textContent).toContain(
        '"x-oneuptime-token": "secret-browser"',
      );
    });
    expect(requestedKeyTypes(getList)).toEqual([
      TelemetryIngestionKeyType.Browser,
    ]);
    expect(dialog.textContent).not.toContain("secret-server");
    expect(dialog.textContent).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
  });

  test("sends to this install's OTLP logs endpoint, with the app's own resource", async () => {
    mockKeys([BROWSER_KEY]);
    const dialog: HTMLElement = open("logs");

    await waitFor(() => {
      expect(dialog.textContent).toContain("secret-browser");
    });
    expect(dialog.textContent).toContain(
      `url: "${getConfiguredOneUptimeUrl()}/otlp/v1/logs"`,
    );
    expect(dialog.textContent).toContain("resource: resource,");
    expect(dialog.textContent).toContain("OTLP logs endpoint");
  });

  test("names the dialog after the application, and walks the steps in order", async () => {
    mockKeys([BROWSER_KEY]);
    const dialog: HTMLElement = open("logs");

    expect(screen.getByTestId("modal-title")).toHaveTextContent("Set up logs");
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Send log records from storefront-web, so they appear on its Logs page.",
    );
    await waitFor(() => {
      expect(dialog.textContent).toContain("secret-browser");
    });
    const titles: Array<string> = stepTitles(dialog);
    expect(titles.slice(-4)).toEqual([
      "Install the log packages",
      "Add a log pipeline to src/telemetry.ts",
      "Write log records",
      "Check that they arrive",
    ]);
    // The key comes first.
    expect(titles).toHaveLength(5);
    expect(dialog.textContent).toContain("npm install @opentelemetry/api-logs");
    expect(dialog.textContent).toContain("@opentelemetry/sdk-logs");
    expect(dialog.textContent).toContain(
      "@opentelemetry/exporter-logs-otlp-http",
    );
    expect(dialog.textContent).toContain("logger.emit({");
  });

  test("links to the browser guide's logs section and the troubleshooting page", () => {
    mockKeys([BROWSER_KEY]);
    const dialog: HTMLElement = open("logs");

    expect(
      within(dialog).getByRole("link", { name: "Browser setup" }),
    ).toHaveAttribute("href", "/docs/rum/browser-setup#add-logs-and-metrics");
    expect(
      within(dialog).getByRole("link", { name: "RUM troubleshooting" }),
    ).toHaveAttribute(
      "href",
      "/docs/rum/troubleshooting#exceptions-or-logs-are-empty",
    );
  });
});

describe("Set up exceptions", () => {
  test("asks for no key: the trace exporter the app has sends them", async () => {
    const getList: jest.Mock<GetList> = mockKeys([BROWSER_KEY]);
    const dialog: HTMLElement = open("exceptions");

    expect(stepTitles(dialog)).toEqual([
      "Add the error handlers to src/telemetry.ts",
      "Record the errors your code handles",
      "Check that they arrive",
    ]);
    expect(getList).not.toHaveBeenCalled();
    expect(dialog.textContent).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
    expect(dialog.textContent).toContain('window.addEventListener("error"');
    expect(dialog.textContent).toContain(
      'window.addEventListener("unhandledrejection"',
    );
    expect(dialog.textContent).toContain(
      "span.recordException(error as Error)",
    );
    expect(dialog.textContent).toContain(
      'throw new Error("OneUptime test error")',
    );
  });

  test("names the dialog after the application and links to the errors section", () => {
    mockKeys([]);
    const dialog: HTMLElement = open("exceptions");

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Set up exceptions",
    );
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Report the errors storefront-web throws, so they appear under Exceptions.",
    );
    expect(
      within(dialog).getByRole("link", { name: "Browser setup" }),
    ).toHaveAttribute("href", "/docs/rum/browser-setup#report-uncaught-errors");
  });

  test("Done closes it", () => {
    mockKeys([]);
    open("exceptions");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
