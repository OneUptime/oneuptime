import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { FunctionComponent, ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import Card from "../../../UI/Components/Card/Card";
import FieldLabelElement from "../../../UI/Components/Forms/Fields/FieldLabel";
import {
  codeReadsAsWrittenPostProcessor,
  getTranslationPostProcess,
  whenCodeCanBeSetApart,
  withoutIsolates,
} from "../../../UI/Utils/CodeReadsAsWritten";
import { productNamePostProcessor } from "../../../UI/Utils/ProductNameTranslation";
import useTranslator from "../../../UI/Utils/UseTranslator";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import {
  DrawnLine,
  drawLine,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";

/*
 * THE PERSIAN DASHBOARD'S LAST ENGLISH STRINGS, ON THE PAGE (#7089).
 *
 * The strings the Persian Dashboard still read in English were the
 * authenticator apps help, the help texts with code #6733 named, the
 * strings pages started drawing as #7089 closed and the old keys no page
 * draws any more. Each kind is drawn here as a page draws it, by the
 * shared components and an i18next set up as the Dashboard's is
 * (Utils/i18n.ts: the product-name and code-reads-as-written
 * post-processors), from the Dashboard's real locale files: the reader
 * sees Persian, its code laid out from the right as it is written
 * (Tests/Helpers/BidiLayout), and its counts in Persian digits. An English
 * reader still sees the English, word for word.
 */

const EN: Record<string, unknown> = englishLocale as Record<string, unknown>;
const FA: Record<string, unknown> = persianLocale as Record<string, unknown>;

const AUTHENTICATOR_APPS: string = "Authenticator apps";
const AUTHENTICATOR_HELP: string =
  "Get a one-time code from an app such as 1Password, Google Authenticator, or Microsoft Authenticator.";

// Help texts with code #6733 named, and the code each names.
const CODE_HELP: ReadonlyArray<{ help: string; code: string }> = [
  {
    help: "Create a .env file next to the downloaded files, then start the agent.",
    code: ".env",
  },
  {
    help: "Counted per region. Per project, these come from Neutron's quotas, which the agent leaves off: delete the --disable-metric=neutron-quota_network line from the exporter to see them.",
    code: "--disable-metric=neutron-quota_network",
  },
  {
    help: "1.3.6.1.4.1.9.* (Cisco) or 1.3.6.1.4.1.2636.* (Juniper)",
    code: "1.3.6.1.4.1.2636.*",
  },
  {
    help: "Tail /var/log/ceph/ceph.log on a mon host to fill the Cluster Log page.",
    code: "/var/log/ceph/ceph.log",
  },
];

const dashboardI18n: i18n = createInstance();

beforeAll(async () => {
  await whenCodeCanBeSetApart("fa");
  await dashboardI18n
    .use(productNamePostProcessor)
    .use(codeReadsAsWrittenPostProcessor)
    .init({
      lng: "fa",
      fallbackLng: "en",
      postProcess: getTranslationPostProcess(),
      resources: {
        en: { translation: englishLocale },
        fa: { translation: persianLocale },
      },
      interpolation: { escapeValue: false },
    });
});

afterEach(() => {
  cleanup();
});

const inLanguage: (language: string, element: ReactElement) => void = (
  language: string,
  element: ReactElement,
): void => {
  void dashboardI18n.changeLanguage(language);
  render(
    <MemoryRouter>
      <I18nextProvider i18n={dashboardI18n}>{element}</I18nextProvider>
    </MemoryRouter>,
  );
};

// Where each unit of `written` is in `shown`, the same text with isolates' marks added.
const placesIn: (written: string, shown: string) => Array<number> = (
  written: string,
  shown: string,
): Array<number> => {
  const places: Array<number> = [];
  let at: number = 0;

  for (let index: number = 0; index < shown.length; index++) {
    if (at < written.length && shown[index] === written[at]) {
      places.push(index);
      at++;
    }
  }

  return places;
};

// Whether `code`, where `shown` first names it, is drawn from the right as it is written.
const isCodeDrawnAsWritten: (shown: string, code: string) => boolean = (
  shown: string,
  code: string,
): boolean => {
  const written: string = withoutIsolates(shown);
  const start: number = written.indexOf(code);

  expect({ code, found: start >= 0 }).toEqual({ code, found: true });

  const places: Array<number> = placesIn(written, shown);
  const line: DrawnLine = drawLine(shown, "rtl");

  return isDrawnAsWritten(
    line,
    places[start] as number,
    (places[start + code.length - 1] as number) + 1,
  );
};

// A text the Persian file words its own way, which this test then expects on the page.
const persian: (english: string) => string = (english: string): string => {
  expect({ english, worded: FA[english] !== english }).toEqual({
    english,
    worded: true,
  });

  return FA[english] as string;
};

describe("the authenticator apps card, in Persian", () => {
  test("draws its title and the help #6733 named in Persian", () => {
    inLanguage(
      "fa",
      <Card title={AUTHENTICATOR_APPS} description={AUTHENTICATOR_HELP} />,
    );

    const page: string = withoutIsolates(document.body.textContent || "");

    expect(page).toContain(persian(AUTHENTICATOR_APPS));
    expect(page).toContain(persian(AUTHENTICATOR_HELP));
    expect(page).not.toContain("Get a one-time code");
    // The apps keep their names.
    for (const app of [
      "1Password",
      "Google Authenticator",
      "Microsoft Authenticator",
    ]) {
      expect(page).toContain(app);
    }
  });

  test("an English reader still reads the English (control)", () => {
    inLanguage(
      "en",
      <Card title={AUTHENTICATOR_APPS} description={AUTHENTICATOR_HELP} />,
    );

    expect(document.body.textContent).toContain(AUTHENTICATOR_HELP);
  });
});

describe.each(CODE_HELP)(
  "a help text with code, in Persian: $code",
  ({ help, code }: { help: string; code: string }) => {
    test("reads in Persian, and draws its code as it is written", () => {
      inLanguage(
        "fa",
        <FieldLabelElement
          title="Help"
          description={help}
          descriptionId="code-help"
        />,
      );

      const shown: string =
        document.getElementById("code-help")?.textContent || "";

      expect(withoutIsolates(shown)).toBe(persian(help));
      expect(isCodeDrawnAsWritten(shown, code)).toBe(true);
    });
  },
);

describe("code laid out as the locale file holds it (control)", () => {
  test.each(CODE_HELP.slice(0, 2))(
    "$code is drawn backwards without the page's isolates",
    ({ help, code }: { help: string; code: string }) => {
      expect(isCodeDrawnAsWritten(persian(help), code)).toBe(false);
    },
  );
});

describe("strings pages started drawing as #7089 closed, in Persian", () => {
  const Line: FunctionComponent<{ text: string }> = (props: {
    text: string;
  }): ReactElement => {
    const translator: Translator = useTranslator();

    return <p data-testid="line">{translator.translateText(props.text)}</p>;
  };

  test.each([
    "Telemetry key",
    "Created Notification Held At",
    "Initialize OpenTelemetry with the OTLP exporter pointing to your OneUptime instance. Logs are what your logger writes, not print or console.log lines.",
  ])("%s", (english: string) => {
    inLanguage("fa", <Line text={english} />);

    expect(withoutIsolates(screen.getByTestId("line").textContent || "")).toBe(
      persian(english),
    );
  });
});

describe("counts, in Persian digits and Persian words", () => {
  const Count: FunctionComponent<{ other: string; count: number }> = (props: {
    other: string;
    count: number;
  }): ReactElement => {
    const translator: Translator = useTranslator();

    return (
      <p data-testid="count">
        {translator.translatePlural(
          { one: EN[`${props.other}_one`] as string, other: props.other },
          props.count,
        )}
      </p>
    );
  };

  test.each([
    ["{{count}} investigations", 1, "۱ بررسی"],
    ["{{count}} investigations", 12, "۱۲ بررسی"],
    ["Show {{count}} advanced settings", 3, "نمایش ۳ تنظیم پیشرفته"],
    ["Hide {{count}} kernel threads", 0, "پنهان کردن ۰ نخ هسته"],
    ["{{count}} samples in window", 250, "۲۵۰ نمونه در بازه"],
  ])("%s at %d reads %s", (other: string, count: number, drawn: string) => {
    inLanguage("fa", <Count other={other} count={count} />);

    expect(withoutIsolates(screen.getByTestId("count").textContent || "")).toBe(
      drawn,
    );
  });

  test("an English reader counts in English (control)", () => {
    inLanguage("en", <Count other="{{count}} investigations" count={1} />);

    expect(screen.getByTestId("count")).toHaveTextContent("1 investigation");
  });
});
