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
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";
import type { Mock } from "jest-mock";

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
function mockKeys(keys: Array<TelemetryIngestionKey>): Mock<GetList> {
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
  }) as never) as unknown as Mock<GetList>;
}

function requestedKeyTypes(getList: Mock<GetList>): Array<unknown> {
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

const onClose: Mock<() => void> = jest.fn<() => void>();

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
    const getList: Mock<GetList> = mockKeys([BROWSER_KEY]);
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

      expect(dialog.textContent).toContain(
        `Browser key — intended for client distribution.`,
      );
      // What the key is accepted for: a Sentry browser SDK's events too (#7872).
      expect(dialog.textContent).toContain(
        `Web origins may send traces, logs, metrics, session replays and Sentry events; app:// identities authorize React Native replay only.`,
      );
      expect(dialog.textContent).toContain(
        `Accepted identities: ${ORIGIN}. Native app identities are self-asserted, not platform attestation.`,
      );
      expect(dialog.textContent).not.toContain(FIRST_STRONG_ISOLATE);
    });

    test("in German and in Persian, in their words - the origins set apart where the sentence reads right to left", async () => {
      mockKeys([BROWSER_KEY]);
      let dialog: HTMLElement = await openIn("de", "logs");

      expect(dialog.textContent).toContain(
        `Browser-Schlüssel — zur Weitergabe an Clients gedacht.`,
      );
      expect(dialog.textContent).toContain(
        `Sitzungswiedergaben und Sentry-Ereignisse senden;`,
      );
      expect(dialog.textContent).toContain(
        `Akzeptierte Identitäten: ${ORIGIN}.`,
      );
      expect(dialog.textContent).not.toContain("client distribution");
      cleanup();

      dialog = await openIn("fa", "logs");
      expect(dialog.textContent).toContain(
        `شناسه‌های پذیرفته: ${FIRST_STRONG_ISOLATE}${ORIGIN}${POP_DIRECTIONAL_ISOLATE}.`,
      );
      expect(dialog.textContent).toContain(
        `بازپخش نشست و رویدادهای Sentry بفرستند؛`,
      );
      expect(dialog.textContent).not.toContain("client distribution");

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
        `شناسه‌های ${LEFT_TO_RIGHT_ISOLATE}app://${POP_DIRECTIONAL_ISOLATE} فقط`,
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
