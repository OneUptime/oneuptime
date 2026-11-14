import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ADMIN DASHBOARD > SETTINGS > PRODUCTS (#6815, #2471).
 *
 * What most admins need comes first: three presets, one click each, the
 * current one marked; what switching off does right under them; the switch
 * per product folded away. It says where the switches come from until an
 * admin saves (SERVER_PRODUCTS), and ties itself to what the server runs:
 * stopped ingestion turns the telemetry products off, and every telemetry
 * product switched off suggests stopping ingestion.
 *
 * The real page is rendered with the Admin Dashboard's English locale; only
 * its two routes (ServerProductsApi), the page chrome and the side menu are
 * stand-ins.
 */

const mockFetch: MockFunction = getJestMockFunction();
const mockPostPreset: MockFunction = getJestMockFunction();
const mockPostSwitch: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Products/ServerProductsApi",
  () => {
    return {
      __esModule: true,
      fetchServerProducts: (...args: Array<unknown>): unknown => {
        return mockFetch(...args);
      },
      postServerProductsPreset: (...args: Array<unknown>): unknown => {
        return mockPostPreset(...args);
      },
      postServerProductSwitched: (...args: Array<unknown>): unknown => {
        return mockPostSwitch(...args);
      },
    };
  },
);

interface MockPageProps {
  title?: string | undefined;
  breadcrumbLinks?: Array<{ title: string; to: { toString: () => string } }>;
  children?: ReactNode | undefined;
}

const mockPageRenders: Array<MockPageProps> = [];

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      mockPageRenders.push(props);
      return <main data-testid="admin-page">{props.children}</main>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import SettingsProducts from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Products/Index";
import {
  SERVER_PRODUCTS_INGESTION_STOPPED_TEST_ID,
  SERVER_PRODUCTS_ONE_BY_ONE_TOGGLE_TEST_ID,
  SERVER_PRODUCTS_OWN_CHOICE_TEST_ID,
  SERVER_PRODUCTS_STARTING_VALUE_TEST_ID,
  SERVER_PRODUCTS_SUGGEST_STOPPING_TEST_ID,
  getPresetTestId,
  getServerProductSwitchTestId,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Products/ServerProductsCopy";
import PageMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/RouteMap";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  SWITCHABLE_PRODUCTS,
  ServerProductOffReason,
  ServerProductsPreset,
  TELEMETRY_INGESTION_PRODUCTS,
  getOffByPreset,
} from "../../../Types/Product/ServerProducts";
import {
  ServerProductsAnswer,
  ServerProductsSource,
} from "../../../Types/Product/ServerProductsAnswer";

const ADMIN_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
);

const ENGLISH: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(ADMIN_SRC, "Locales", "en.json"), "utf8"),
) as Record<string, unknown>;

const answer: (extra: Partial<ServerProductsAnswer>) => ServerProductsAnswer = (
  extra: Partial<ServerProductsAnswer>,
): ServerProductsAnswer => {
  return {
    off: {},
    switchedOff: [],
    preset: ServerProductsPreset.Everything,
    source: ServerProductsSource.StartingValue,
    startingValue: "",
    startingValueUnknownNames: [],
    isTelemetryIngestionStopped: false,
    shouldSuggestStoppingIngestion: false,
    changedAt: null,
    ...extra,
  };
};

const savedPreset: (preset: ServerProductsPreset) => ServerProductsAnswer = (
  preset: ServerProductsPreset,
): ServerProductsAnswer => {
  const off: Array<ProductKey> = getOffByPreset(preset);

  return answer({
    off: Object.fromEntries(
      off.map((product: ProductKey) => {
        return [product, ServerProductOffReason.SwitchedOff];
      }),
    ),
    switchedOff: off,
    preset: preset,
    source: ServerProductsSource.Saved,
    // Both smaller presets switch every telemetry product off.
    shouldSuggestStoppingIngestion: preset !== ServerProductsPreset.Everything,
    changedAt: "2026-11-12T10:00:00.000Z",
  });
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function renderPage(): Promise<void> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: ENGLISH } },
    interpolation: { escapeValue: false },
    keySeparator: ".",
  });

  render(
    <I18nextProvider i18n={instance}>
      <SettingsProducts />
    </I18nextProvider>,
  );

  await flush();
}

beforeEach(() => {
  mockFetch.mockReset();
  mockPostPreset.mockReset();
  mockPostSwitch.mockReset();
  mockPageRenders.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("the page", () => {
  test("lives at /admin/settings/products, with a trail to it", async () => {
    mockFetch.mockResolvedValue(answer({}));
    await renderPage();

    expect(RouteMap[PageMap.SETTINGS_PRODUCTS]?.toString()).toBe(
      "/admin/settings/products",
    );

    const trail: Array<string> = (
      mockPageRenders[mockPageRenders.length - 1]?.breadcrumbLinks || []
    ).map((link: { title: string }): string => {
      return link.title;
    });

    expect(trail).toEqual(["Admin Dashboard", "Settings", "Products"]);
  });

  test("a read that fails says so, with what to do", async () => {
    mockFetch.mockRejectedValue(
      new Error("The products on this server could not be read."),
    );
    await renderPage();

    expect(
      screen.getByText("The products on this server could not be read."),
    ).toBeInTheDocument();
  });
});

describe("the presets", () => {
  test("three, smallest first, with the current one marked and the others one click away", async () => {
    mockFetch.mockResolvedValue(answer({}));
    await renderPage();

    const presets: Array<HTMLElement> = [
      ServerProductsPreset.MonitoringAndStatusPages,
      ServerProductsPreset.IncidentResponse,
      ServerProductsPreset.Everything,
    ].map((preset: ServerProductsPreset): HTMLElement => {
      return screen.getByTestId(getPresetTestId(preset));
    });

    expect(presets[0]).toHaveTextContent("Monitoring and status pages");
    expect(presets[0]).toHaveTextContent("5 products");
    expect(presets[1]).toHaveTextContent("Incident response");
    expect(presets[1]).toHaveTextContent("9 products");
    expect(presets[2]).toHaveTextContent("Everything");
    expect(presets[2]).toHaveTextContent(
      `${SWITCHABLE_PRODUCTS.length} products`,
    );

    expect(presets[2]).toHaveAttribute("data-current", "true");
    expect(
      screen.getByTestId(
        `${getPresetTestId(ServerProductsPreset.Everything)}-current`,
      ),
    ).toHaveTextContent("Current");
    expect(
      screen.getByTestId(
        `${getPresetTestId(ServerProductsPreset.MonitoringAndStatusPages)}-apply`,
      ),
    ).toHaveTextContent("Use this");
  });

  test("one click applies a preset, and the page shows what the server now says", async () => {
    mockFetch.mockResolvedValue(answer({}));
    mockPostPreset.mockResolvedValue(
      savedPreset(ServerProductsPreset.MonitoringAndStatusPages),
    );
    await renderPage();

    fireEvent.click(
      screen.getByTestId(
        `${getPresetTestId(ServerProductsPreset.MonitoringAndStatusPages)}-apply`,
      ),
    );
    await flush();

    expect(mockPostPreset).toHaveBeenCalledWith(
      ServerProductsPreset.MonitoringAndStatusPages,
    );
    expect(
      screen.getByTestId(
        getPresetTestId(ServerProductsPreset.MonitoringAndStatusPages),
      ),
    ).toHaveAttribute("data-current", "true");
    expect(
      screen.getByTestId(SERVER_PRODUCTS_SUGGEST_STOPPING_TEST_ID),
    ).toHaveTextContent(
      "Every telemetry product is off. You can also stop telemetry ingestion to save memory: set DISABLE_TELEMETRY_INGESTION=true (Helm: telemetry.disableIngestion) and restart OneUptime.",
    );
  });

  test("a refused preset says why, and the page stays as it was", async () => {
    mockFetch.mockResolvedValue(answer({}));
    mockPostPreset.mockRejectedValue(
      new Error("Only a master admin can change the products on this server."),
    );
    await renderPage();

    fireEvent.click(
      screen.getByTestId(
        `${getPresetTestId(ServerProductsPreset.IncidentResponse)}-apply`,
      ),
    );
    await flush();

    expect(
      screen.getByText(
        "Only a master admin can change the products on this server.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(getPresetTestId(ServerProductsPreset.Everything)),
    ).toHaveAttribute("data-current", "true");
  });

  test("a choice of one's own marks no preset, and says how many products are on", async () => {
    mockFetch.mockResolvedValue(
      answer({
        preset: null,
        switchedOff: [ProductKey.Logs],
        off: { [ProductKey.Logs]: ServerProductOffReason.SwitchedOff },
        source: ServerProductsSource.Saved,
      }),
    );
    await renderPage();

    expect(
      screen.getByTestId(SERVER_PRODUCTS_OWN_CHOICE_TEST_ID),
    ).toHaveTextContent(
      `Your own choice: ${SWITCHABLE_PRODUCTS.length - 1} of ${SWITCHABLE_PRODUCTS.length} products are on.`,
    );

    for (const preset of [
      ServerProductsPreset.MonitoringAndStatusPages,
      ServerProductsPreset.IncidentResponse,
      ServerProductsPreset.Everything,
    ]) {
      expect(screen.getByTestId(getPresetTestId(preset))).toHaveAttribute(
        "data-current",
        "false",
      );
    }
  });

  test("says what switching off does: nothing deleted, what runs keeps running, the API refuses changes", async () => {
    mockFetch.mockResolvedValue(answer({}));
    await renderPage();

    expect(screen.getByText("What switching off does")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nothing is deleted. A product switched on again comes back as it was.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "What already runs keeps running: monitors keep checking, published status pages stay up, and telemetry keeps arriving unless you also stop ingestion.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The API refuses to create, change or delete its records, and Ask AI leaves it out.",
      ),
    ).toBeInTheDocument();
  });
});

describe("where the switches come from", () => {
  test("SERVER_PRODUCTS, until an admin saves, with what it got wrong", async () => {
    mockFetch.mockResolvedValue(
      answer({
        preset: ServerProductsPreset.MonitoringAndStatusPages,
        startingValue: "monitoring-and-status-pages,logz",
        startingValueUnknownNames: ["logz"],
      }),
    );
    await renderPage();

    const line: HTMLElement = screen.getByTestId(
      SERVER_PRODUCTS_STARTING_VALUE_TEST_ID,
    );

    expect(line).toHaveTextContent(
      "Set by SERVER_PRODUCTS=monitoring-and-status-pages,logz in this server's configuration, until you change it here.",
    );
    expect(line).toHaveTextContent(
      "SERVER_PRODUCTS names logz, which is neither a preset nor a product, so it was left out.",
    );
  });

  test("nothing about it once an admin saved, or when it is unset", async () => {
    mockFetch.mockResolvedValue(
      answer({
        source: ServerProductsSource.Saved,
        startingValue: "incident-response",
      }),
    );
    await renderPage();
    expect(
      screen.queryByTestId(SERVER_PRODUCTS_STARTING_VALUE_TEST_ID),
    ).toBeNull();

    cleanup();
    mockFetch.mockResolvedValue(answer({}));
    await renderPage();
    expect(
      screen.queryByTestId(SERVER_PRODUCTS_STARTING_VALUE_TEST_ID),
    ).toBeNull();
  });
});

describe("telemetry ingestion", () => {
  test("while it is stopped, the page says so and names the setting; the telemetry switches are off and locked", async () => {
    mockFetch.mockResolvedValue(
      answer({
        isTelemetryIngestionStopped: true,
        off: Object.fromEntries(
          TELEMETRY_INGESTION_PRODUCTS.map((product: ProductKey) => {
            return [product, ServerProductOffReason.TelemetryIngestionStopped];
          }),
        ),
      }),
    );
    await renderPage();

    expect(
      screen.getByTestId(SERVER_PRODUCTS_INGESTION_STOPPED_TEST_ID),
    ).toHaveTextContent(
      "Telemetry ingestion is stopped on this server (DISABLE_TELEMETRY_INGESTION), so Logs, Metrics, Traces, Profiles and Exceptions are off.",
    );
    expect(
      screen.queryByTestId(SERVER_PRODUCTS_SUGGEST_STOPPING_TEST_ID),
    ).toBeNull();

    fireEvent.click(
      screen.getByTestId(SERVER_PRODUCTS_ONE_BY_ONE_TOGGLE_TEST_ID),
    );

    // The switch itself carries the test id; locked, it says so (aria-disabled).
    const logsSwitch: HTMLElement = screen.getByTestId(
      getServerProductSwitchTestId(ProductKey.Logs),
    );

    expect(logsSwitch).toHaveAttribute("role", "switch");
    expect(logsSwitch).toHaveAttribute("aria-disabled", "true");
    expect(logsSwitch).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getAllByText("Off while telemetry ingestion is stopped.").length,
    ).toBe(TELEMETRY_INGESTION_PRODUCTS.length);
  });

  test("no word about it while some telemetry product is still on", async () => {
    mockFetch.mockResolvedValue(answer({}));
    await renderPage();

    expect(
      screen.queryByTestId(SERVER_PRODUCTS_INGESTION_STOPPED_TEST_ID),
    ).toBeNull();
    expect(
      screen.queryByTestId(SERVER_PRODUCTS_SUGGEST_STOPPING_TEST_ID),
    ).toBeNull();
  });
});

describe("choosing products one by one", () => {
  test("is folded away until opened, then lists every product by category, with the ones always on said once", async () => {
    mockFetch.mockResolvedValue(answer({}));
    await renderPage();

    expect(
      screen.queryByTestId(getServerProductSwitchTestId(ProductKey.Logs)),
    ).toBeNull();
    expect(
      screen.getByText(
        `${SWITCHABLE_PRODUCTS.length} of ${SWITCHABLE_PRODUCTS.length} products are on. Each switch saves the moment it is flipped.`,
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId(SERVER_PRODUCTS_ONE_BY_ONE_TOGGLE_TEST_ID),
    );

    for (const product of SWITCHABLE_PRODUCTS) {
      expect(
        screen.getByTestId(getServerProductSwitchTestId(product)),
      ).toBeInTheDocument();
    }

    expect(
      screen.queryByTestId(
        getServerProductSwitchTestId(ProductKey.ProjectSettings),
      ),
    ).toBeNull();
    expect(
      screen.getByText("Users, Teams and Project Settings"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Always on: every project needs them to run itself."),
    ).toBeInTheDocument();
    expect(screen.getByText("Observability")).toBeInTheDocument();
    expect(screen.getByText("Profiles")).toBeInTheDocument();
  });

  test("a switch saves the moment it is flipped", async () => {
    mockFetch.mockResolvedValue(answer({}));
    mockPostSwitch.mockResolvedValue(
      answer({
        preset: null,
        source: ServerProductsSource.Saved,
        switchedOff: [ProductKey.Traces],
        off: { [ProductKey.Traces]: ServerProductOffReason.SwitchedOff },
      }),
    );
    await renderPage();

    fireEvent.click(
      screen.getByTestId(SERVER_PRODUCTS_ONE_BY_ONE_TOGGLE_TEST_ID),
    );

    const traces: HTMLElement = screen.getByTestId(
      getServerProductSwitchTestId(ProductKey.Traces),
    );
    expect(traces).toHaveAttribute("aria-checked", "true");
    fireEvent.click(traces);
    await flush();

    expect(mockPostSwitch).toHaveBeenCalledWith({
      product: ProductKey.Traces,
      isOn: false,
    });
    expect(
      screen.getByTestId(SERVER_PRODUCTS_OWN_CHOICE_TEST_ID),
    ).toBeInTheDocument();
  });
});
