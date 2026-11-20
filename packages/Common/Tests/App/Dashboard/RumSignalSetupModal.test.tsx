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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import RumSignalSetupModal from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalSetupModal";
import { getConfiguredOneUptimeUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/ConfiguredOneUptimeUrl";
import { SETUP_GUIDE_API_KEY_PLACEHOLDER } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  codeReadsAsWrittenPostProcessor,
  getTranslationPostProcess,
  withoutIsolates,
} from "../../../UI/Utils/CodeReadsAsWritten";
import { productNamePostProcessor } from "../../../UI/Utils/ProductNameTranslation";
import { LEFT_TO_RIGHT_ISOLATE } from "../../../Types/CodeInSentence";
import { drawLine, isDrawnAsWritten } from "../../Helpers/BidiLayout";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyRefusal from "../../../Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import { TelemetryIngestRefusalReason } from "../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import ObjectID from "../../../Types/ObjectID";
import { RUM_SIGNAL_ARRIVAL_POLL_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalArrival";
import type { Mock } from "jest-mock";

/*
 * "Set up exceptions" and "Set up logs" (issue #5770), as the dialog draws
 * them: the few lines that send a browser application's uncaught errors or
 * its log records, with this install's URL and - for logs - a Browser key
 * filled in. The snippet ships in the page, so the picker may only ever
 * offer Browser keys; exceptions travel with the traces the app already
 * sends, so they ask for no key at all. Their last step waits for the
 * first log or exception, and says when it arrives (issue #6379).
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
const APP_ID: ObjectID = new ObjectID("rum-app-1");

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
type GetItem = typeof ModelAPI.getItem;

interface ListArguments {
  modelType: unknown;
  query: Record<string, unknown>;
}

// What the last step's reads answer: the newest exception, the refusals.
interface ArrivalRows {
  exceptions?: Array<Record<string, unknown>>;
  refusals?: Array<Record<string, unknown>>;
}

/*
 * Answers with the keys of the requested type, as the API does, and with
 * the rows the last step reads.
 */
function mockKeys(
  keys: Array<TelemetryIngestionKey>,
  rows: ArrivalRows = {},
): Mock<GetList> {
  return jest.spyOn(ModelAPI, "getList").mockImplementation(((
    args: ListArguments,
  ): Promise<unknown> => {
    const listOf: (data: Array<unknown>) => Promise<unknown> = (
      data: Array<unknown>,
    ): Promise<unknown> => {
      return Promise.resolve({
        data: data,
        count: data.length,
        skip: 0,
        limit: 50,
      });
    };

    if (args.modelType === TelemetryException) {
      return listOf(rows.exceptions || []);
    }

    if (args.modelType === TelemetryIngestionKeyRefusal) {
      return listOf(rows.refusals || []);
    }

    return listOf(
      keys.filter((key: TelemetryIngestionKey): boolean => {
        return !args.query["keyType"] || key.keyType === args.query["keyType"];
      }),
    );
  }) as never) as unknown as Mock<GetList>;
}

// The key types the picker asked for, in order: the key reads only.
function requestedKeyTypes(getList: Mock<GetList>): Array<unknown> {
  return getList.mock.calls
    .map((call: Array<unknown>): ListArguments => {
      return call[0] as ListArguments;
    })
    .filter((args: ListArguments): boolean => {
      return args.modelType === TelemetryIngestionKey;
    })
    .map((args: ListArguments): unknown => {
      return args.query["keyType"];
    });
}

// The application row the last step reads: when logs and traces last came.
function mockApplication(
  row: Record<string, unknown> | Error = {
    logsLastReceivedAt: null,
    tracesLastReceivedAt: null,
  },
): Mock<GetItem> {
  return jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(((): Promise<unknown> => {
      return row instanceof Error ? Promise.reject(row) : Promise.resolve(row);
    }) as never) as unknown as Mock<GetItem>;
}

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
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

const onClose: Mock<() => void> = jest.fn<() => void>();

function open(signal: "exceptions" | "logs"): HTMLElement {
  render(
    <RumSignalSetupModal
      signal={signal}
      rumApplicationId={APP_ID}
      appName="storefront-web"
      onClose={onClose}
    />,
  );
  return screen.getByTestId(`rum-${signal}-setup`);
}

beforeEach(() => {
  onClose.mockReset();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  mockApplication();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Set up logs", () => {
  test("asks for Browser keys only, and its log exporter carries the one picked", async () => {
    const getList: Mock<GetList> = mockKeys([BROWSER_KEY, SERVER_KEY]);
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
    // The live step is the only check: no static one repeats it before it.
    expect(titles.slice(-4)).toEqual([
      "Install the log packages",
      "Add a log pipeline to src/telemetry.ts",
      "Write log records",
      "Wait for the first log",
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
    const getList: Mock<GetList> = mockKeys([BROWSER_KEY]);
    const dialog: HTMLElement = open("exceptions");

    expect(stepTitles(dialog)).toEqual([
      "Add the error handlers to src/telemetry.ts",
      "Record the errors your code handles",
      "Check that they arrive",
      "Wait for the first exception",
    ]);
    await waitFor(() => {
      expect(screen.getByTestId("rum-signal-arrival-waiting")).toHaveAttribute(
        "data-state",
        "waiting",
      );
    });
    expect(requestedKeyTypes(getList)).toEqual([]);
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

/*
 * The last step (issue #6379): it looks for the application's first log or
 * exception while the dialog is open, and says when one arrives, what was
 * refused, or that it could not look.
 */
describe("the last step waits for the first one", () => {
  test("logs: waits, naming the application, and reads the application's own row", async () => {
    mockKeys([BROWSER_KEY]);
    const getItem: Mock<GetItem> = mockApplication({
      logsLastReceivedAt: null,
      tracesLastReceivedAt: ago(60 * 1000),
    });
    open("logs");

    const waiting: HTMLElement = await screen.findByTestId(
      "rum-signal-arrival-waiting",
    );
    await waitFor(() => {
      expect(waiting).toHaveAttribute("data-state", "waiting");
    });
    expect(waiting.textContent).toBe(
      "Waiting for the first log from storefront-web…",
    );
    const read: Record<string, unknown> = getItem.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect((read["id"] as ObjectID).toString()).toBe(APP_ID.toString());
    expect(read["select"]).toEqual({
      logsLastReceivedAt: true,
      tracesLastReceivedAt: true,
    });
  });

  test("logs: says when they arrive", async () => {
    mockKeys([BROWSER_KEY]);
    mockApplication({
      logsLastReceivedAt: ago(20 * 1000),
      tracesLastReceivedAt: ago(20 * 1000),
    });
    open("logs");

    const arrived: HTMLElement = await screen.findByTestId(
      "rum-signal-arrival-arrived",
    );
    expect(arrived.textContent).toMatch(
      /^Logs are arriving from storefront-web\. The latest arrived .+\.$/,
    );
  });

  test("exceptions: says when the newest one was seen", async () => {
    mockKeys([], { exceptions: [{ lastSeenAt: ago(30 * 1000) }] });
    open("exceptions");

    const arrived: HTMLElement = await screen.findByTestId(
      "rum-signal-arrival-arrived",
    );
    expect(arrived.textContent).toMatch(
      /^Exceptions are arriving from storefront-web\. The latest was seen .+\.$/,
    );
  });

  test("a key the logs are refused with: why, and that step 1 picks another", async () => {
    mockKeys([BROWSER_KEY], {
      refusals: [
        {
          reason: TelemetryIngestRefusalReason.KeyDisabled,
          surface: TelemetryIngestSurface.OtelLogs,
          refusedCount: 12,
          firstRefusedAt: ago(10 * 60 * 1000),
          lastRefusedAt: ago(60 * 1000),
          telemetryIngestionKeyId: "key-browser",
          telemetryIngestionKey: {
            name: "Storefront Browser Key",
            keyType: TelemetryIngestionKeyType.Browser,
          },
        },
      ],
    });
    open("logs");

    const refused: HTMLElement = await screen.findByTestId(
      "rum-signal-arrival-refused",
    );
    expect(
      within(refused).getByTestId("rum-signal-arrival-refusal").textContent,
    ).toBe(
      'The key "Storefront Browser Key" is turned off, so everything sent with it is refused.',
    );
    expect(refused.textContent).toContain(
      "Pick another key in step 1, and deploy with it.",
    );
  });

  test("a look that fails says so, and is not taken for nothing arriving", async () => {
    mockKeys([BROWSER_KEY]);
    mockApplication(new Error("Network down"));
    open("logs");

    const failed: HTMLElement = await screen.findByTestId(
      "rum-signal-arrival-failed",
    );
    expect(failed.textContent).toBe(
      "Couldn't check just now. Trying again in a few seconds.",
    );
    expect(screen.queryByTestId("rum-signal-arrival-nothing-yet")).toBeNull();
  });

  test("looks again every few seconds while open, and stops when the dialog closes", async () => {
    jest.useFakeTimers();

    try {
      mockKeys([BROWSER_KEY]);
      const getItem: Mock<GetItem> = mockApplication();
      const { unmount } = render(
        <RumSignalSetupModal
          signal="logs"
          rumApplicationId={APP_ID}
          appName="storefront-web"
          onClose={onClose}
        />,
      );

      const settle: (ms: number) => Promise<void> = async (
        ms: number,
      ): Promise<void> => {
        await act(async () => {
          jest.advanceTimersByTime(ms);
        });
        for (let turn: number = 0; turn < 10; turn++) {
          await act(async () => {
            await Promise.resolve();
          });
        }
      };

      await settle(0);
      expect(getItem).toHaveBeenCalledTimes(1);

      await settle(RUM_SIGNAL_ARRIVAL_POLL_MS);
      expect(getItem).toHaveBeenCalledTimes(2);

      unmount();
      await settle(10 * RUM_SIGNAL_ARRIVAL_POLL_MS);
      expect(getItem).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("in the reader's language", () => {
  const instances: Record<string, i18n> = {};

  // The Persian of the step that names the packages: more English letters.
  const INSTALL_STEP: string =
    "The OpenTelemetry logs API, its SDK and the OTLP log exporter.";

  /*
   * Each language's i18next is set up as the Dashboard's is (Utils/i18n.ts):
   * with the product-name and code-reads-as-written post-processors, which
   * set code in a Persian sentence apart as it reaches the dialog.
   */
  beforeAll(async () => {
    for (const [language, locale] of [
      ["en", englishLocale],
      ["de", germanLocale],
      ["fa", persianLocale],
    ] as Array<[string, Record<string, unknown>]>) {
      const instance: i18n = createInstance();

      await instance
        .use(productNamePostProcessor)
        .use(codeReadsAsWrittenPostProcessor)
        .init({
          lng: language,
          fallbackLng: "en",
          postProcess: getTranslationPostProcess(),
          resources: {
            en: { translation: englishLocale },
            [language]: { translation: locale },
          },
          interpolation: { escapeValue: false },
          keySeparator: false,
          nsSeparator: false,
        });

      instances[language] = instance;
    }
  });

  async function openIn(
    language: string,
    signal: "exceptions" | "logs",
  ): Promise<HTMLElement> {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <RumSignalSetupModal
          signal={signal}
          rumApplicationId={APP_ID}
          appName="storefront-web"
          onClose={onClose}
        />
      </I18nextProvider>,
    );
    const dialog: HTMLElement = screen.getByTestId(`rum-${signal}-setup`);

    if (signal === "logs") {
      await waitFor(() => {
        expect(dialog.textContent).toContain("secret-browser");
      });
    }

    return dialog;
  }

  // Each step's description, as the guide card draws it.
  function stepDescriptions(dialog: HTMLElement): Array<HTMLElement> {
    return within(dialog)
      .getAllByTestId(/^setup-guide-step-\d+$/)
      .map((step: HTMLElement): HTMLElement | null => {
        return step.querySelector("h3 + p");
      })
      .filter((description: HTMLElement | null): boolean => {
        return description !== null;
      }) as Array<HTMLElement>;
  }

  test("in Persian, every step reads right to left - the one naming the packages too", async () => {
    mockKeys([BROWSER_KEY]);
    const persianInstall: string = persianLocale[
      INSTALL_STEP as keyof typeof persianLocale
    ] as string;

    // The trap: by its letters alone, this sentence reads left to right.
    expect(persianInstall).toBeTruthy();
    expect(persianInstall.match(/[A-Za-z]/g)!.length).toBeGreaterThan(
      persianInstall.match(/[\u0600-\u06FF]/g)!.length,
    );

    for (const signal of ["logs", "exceptions"] as const) {
      const dialog: HTMLElement = await openIn("fa", signal);
      const descriptions: Array<HTMLElement> = stepDescriptions(dialog);

      expect(descriptions.length).toBeGreaterThan(2);
      for (const description of descriptions) {
        expect({
          text: description.textContent,
          dir: description.getAttribute("dir"),
        }).toEqual({ text: description.textContent, dir: "rtl" });
      }

      if (signal === "logs") {
        expect(
          descriptions.map((description: HTMLElement): string => {
            return description.textContent || "";
          }),
        ).toContain(persianInstall);
      }

      cleanup();
    }
  });

  test("in English, left to right", async () => {
    mockKeys([BROWSER_KEY]);
    const dialog: HTMLElement = await openIn("en", "logs");
    const descriptions: Array<HTMLElement> = stepDescriptions(dialog);

    expect(descriptions.length).toBeGreaterThan(2);
    for (const description of descriptions) {
      expect(description).toHaveAttribute("dir", "ltr");
    }
    expect(dialog.textContent).toContain(INSTALL_STEP);
  });

  /*
   * The picked key's caution, under its token, is the guide's too: it was
   * English on every language's page, and in Persian the full stop after
   * the origins jumped to the start of the line.
   */
  describe("the picked Browser key's caution", () => {
    const ORIGIN: string = "https://shop.example.com";
    const FIRST_STRONG_ISOLATE: string = "⁨";
    const POP_DIRECTIONAL_ISOLATE: string = "⁩";

    test("in English, names the origins as they are", async () => {
      mockKeys([BROWSER_KEY]);
      const dialog: HTMLElement = await openIn("en", "logs");

      /*
       * What the key is accepted for, a Sentry browser SDK's events too
       * (#7872), in plain words (#6458).
       */
      expect(dialog.textContent).toContain(
        `Browser key: safe to put in a web page. It can send traces, logs, metrics, session replays and Sentry events, and only from: ${ORIGIN}.`,
      );
      expect(dialog.textContent).toContain(
        "An app:// entry lets a React Native app send session replays only, and anyone who has the app can send as it.",
      );
      expect(dialog.textContent).not.toContain("client distribution");
      expect(dialog.textContent).not.toContain("self-asserted");
      expect(dialog.textContent).not.toContain(FIRST_STRONG_ISOLATE);
    });

    test("in German and in Persian, in their words - the origins set apart where the sentence reads right to left", async () => {
      mockKeys([BROWSER_KEY]);
      let dialog: HTMLElement = await openIn("de", "logs");

      expect(dialog.textContent).toContain(
        `Browser-Schlüssel: gefahrlos in einer Webseite einsetzbar.`,
      );
      expect(dialog.textContent).toContain(
        `Sitzungswiedergaben und Sentry-Ereignisse senden, und nur von: ${ORIGIN}.`,
      );
      expect(dialog.textContent).not.toContain("safe to put in a web page");
      cleanup();

      dialog = await openIn("fa", "logs");
      expect(dialog.textContent).toContain(
        `و فقط از: ${FIRST_STRONG_ISOLATE}${ORIGIN}${POP_DIRECTIONAL_ISOLATE}.`,
      );
      expect(dialog.textContent).toContain(
        `بازپخش‌های نشست و رویدادهای Sentry را بفرستد`,
      );
      expect(dialog.textContent).not.toContain("safe to put in a web page");

      /*
       * A left-to-right isolate keeps "://" with "app", or it is drawn
       * "//:app": fa.json writes app:// as en.json does, and the sentence is
       * set apart as it reaches the dialog (CodeReadsAsWritten). Laid out on
       * a line read from the right, app:// is drawn as it is written; as the
       * locale file holds it, it is not.
       */
      const caution: string =
        within(dialog).getByText(/app:\/\//).textContent || "";
      const isAppDrawnAsWritten: (sentence: string) => boolean = (
        sentence: string,
      ): boolean => {
        const start: number = sentence.indexOf("app://");

        expect(start).toBeGreaterThanOrEqual(0);

        return isDrawnAsWritten(
          drawLine(sentence, "rtl"),
          start,
          start + "app://".length,
        );
      };

      expect(caution).toContain(
        `ورودی ${LEFT_TO_RIGHT_ISOLATE}app://${POP_DIRECTIONAL_ISOLATE} به`,
      );
      expect(isAppDrawnAsWritten(caution)).toBe(true);
      expect(isAppDrawnAsWritten(withoutIsolates(caution))).toBe(false);
    });

    test("a key with no origins says every request is refused, naming the menu as the German Dashboard draws it", async () => {
      const keyWithoutOrigins: TelemetryIngestionKey = makeKey({
        id: "key-no-origins",
        name: "Storefront Browser Key",
        secret: "secret-browser",
        keyType: TelemetryIngestionKeyType.Browser,
      });
      keyWithoutOrigins.allowedOrigins = [];
      mockKeys([keyWithoutOrigins]);
      const dialog: HTMLElement = await openIn("de", "logs");

      expect(dialog.textContent).toContain(
        "Dieser Browser-Schlüssel hat keine zulässigen Ursprünge, daher wird jede damit gestellte Anfrage abgelehnt.",
      );
      expect(dialog.textContent).toContain(
        "Projekteinstellungen > Telemetrie & APM > Ingestion-Schlüssel",
      );
      expect(dialog.textContent).not.toContain("has no allowed origins");
    });
  });
});
