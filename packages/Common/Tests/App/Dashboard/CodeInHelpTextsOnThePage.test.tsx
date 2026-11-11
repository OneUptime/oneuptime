import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { FunctionComponent, ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import arabicLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import FieldLabelElement from "../../../UI/Components/Forms/Fields/FieldLabel";
import {
  codeReadsAsWrittenPostProcessor,
  getTranslationPostProcess,
  leaveIsolatesOutOfCopiedText,
  withoutIsolates,
} from "../../../UI/Utils/CodeReadsAsWritten";
import { productNamePostProcessor } from "../../../UI/Utils/ProductNameTranslation";
import useTranslator from "../../../UI/Utils/UseTranslator";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import {
  DrawnLine,
  drawLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";

/*
 * CODE IN A HELP TEXT, ON THE PAGE, IN ARABIC AND PERSIAN.
 *
 * A field's description, read from the Dashboard's real locale files by an
 * i18next set up as the Dashboard's is (Utils/i18n.ts: the product-name and
 * code-reads-as-written post-processors, getTranslationPostProcess), drawn
 * by the shared FieldLabel. Its text is laid out as a page read from the
 * right lays it out (Tests/Helpers/BidiLayout): the path, the flag and the
 * address it names are drawn as they are written. Laid out as the locale
 * file holds the sentence, none of them was - the test's negative control.
 * The sentence round the code is still laid out from the right: a help
 * line reads the way most of its letters do (readAsWritten), and the code
 * set apart is not counted. Copied from the page, the sentence is the
 * locale file's again.
 */

const LRI: string = String.fromCharCode(0x2066);

const OIDC_HELP: string =
  "OIDC discovery document URL — usually ends in /.well-known/openid-configuration.";
/*
 * A flag each language names right after a word of its own: Persian's
 * --help, Arabic's --disable-metric (Arabic words its --help after a
 * command, "oneuptime … --help", which reads right as it is).
 */
const FLAG_HELP: Record<string, { help: string; flag: string }> = {
  ar: {
    help: "Counted per region. Per project, these come from Neutron's quotas, which the agent leaves off: delete the --disable-metric=neutron-quota_network line from the exporter to see them.",
    flag: "--disable-metric=neutron-quota_network",
  },
  fa: {
    help: "Every command the CLI has for these. Add --help to any of them for its flags.",
    flag: "--help",
  },
};
const OTLP_HELP: string =
  "Send with the otlp_http exporter to {{url}}/otlp, with the header x-oneuptime-token: {{key}}. Each host fills in its own address and key.";
const REPLAY_HELP: string =
  "Nothing uploads until the page calls OneUptimeReplay.grantConsent().";
/*
 * A sentence of each language whose code has more Latin letters than its
 * words have Arabic or Persian ones.
 */
const TURNED_BY_ITS_CODE: Record<string, string> = {
  ar: REPLAY_HELP,
  fa: OIDC_HELP,
};

const LOCALES: Record<string, Record<string, unknown>> = {
  ar: arabicLocale as Record<string, unknown>,
  fa: persianLocale as Record<string, unknown>,
};

const dashboardI18n: i18n = createInstance();
// The negative control: the sentences handed to the page as the locale files hold them.
const rawI18n: i18n = createInstance();

beforeAll(async () => {
  await dashboardI18n
    .use(productNamePostProcessor)
    .use(codeReadsAsWrittenPostProcessor)
    .init({
      lng: "ar",
      fallbackLng: "en",
      postProcess: getTranslationPostProcess(),
      resources: {
        en: { translation: englishLocale },
        ar: { translation: arabicLocale },
        fa: { translation: persianLocale },
      },
      interpolation: { escapeValue: false },
    });
  await rawI18n.init({
    lng: "ar",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      ar: { translation: arabicLocale },
      fa: { translation: persianLocale },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

const inLanguage: (
  language: string,
  element: ReactElement,
  instance?: i18n,
) => void = (
  language: string,
  element: ReactElement,
  instance: i18n = dashboardI18n,
): void => {
  void instance.changeLanguage(language);
  render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>);
};

/*
 * Where each unit of `written` is in `shown`, the same text with isolates'
 * marks added: shown holds every unit of written, in order.
 */
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

// Whether `code`, where `shown` first names it, is drawn as it is written.
const isCodeDrawnAsWritten: (shown: string, code: string) => boolean = (
  shown: string,
  code: string,
): boolean => {
  const written: string = withoutIsolates(shown);
  const start: number = written.indexOf(code);

  expect(start).toBeGreaterThanOrEqual(0);

  const places: Array<number> = placesIn(written, shown);
  const line: DrawnLine = drawLine(shown, "rtl");

  return isDrawnAsWritten(
    line,
    places[start] as number,
    (places[start + code.length - 1] as number) + 1,
  );
};

const describedBy: (id: string) => string = (id: string): string => {
  return document.getElementById(id)?.textContent || "";
};

describe.each(["ar", "fa"])("a field's help in %s", (language: string) => {
  const locale: Record<string, unknown> = LOCALES[language] as Record<
    string,
    unknown
  >;

  test("draws the path it names as it is written", () => {
    inLanguage(
      language,
      <FieldLabelElement
        title="Discovery URL"
        description={OIDC_HELP}
        descriptionId="oidc-help"
      />,
    );

    const shown: string = describedBy("oidc-help");

    expect(withoutIsolates(shown)).toBe(locale[OIDC_HELP]);
    expect(shown).toContain(`${LRI}/.well-known/openid-configuration`);
    expect(
      isCodeDrawnAsWritten(shown, "/.well-known/openid-configuration"),
    ).toBe(true);

    // The negative control: as the locale file holds it, it was not.
    expect(
      isCodeDrawnAsWritten(
        locale[OIDC_HELP] as string,
        "/.well-known/openid-configuration",
      ),
    ).toBe(false);
  });

  test("draws the flag it names as it is written: --help, not help--", () => {
    const { help, flag } = FLAG_HELP[language] as {
      help: string;
      flag: string;
    };

    inLanguage(
      language,
      <FieldLabelElement
        title="Commands"
        description={help}
        descriptionId="flag-help"
      />,
    );

    const shown: string = describedBy("flag-help");
    const bareFlag: string = flag.replace(/^-+/, "");

    expect(withoutIsolates(shown)).toBe(locale[help]);
    expect(isCodeDrawnAsWritten(shown, flag)).toBe(true);
    expect(getDrawnText(drawLine(shown, "rtl"))).not.toContain(`${bareFlag}--`);
    expect(isCodeDrawnAsWritten(locale[help] as string, flag)).toBe(false);
    expect(getDrawnText(drawLine(locale[help] as string, "rtl"))).toContain(
      `${bareFlag}--`,
    );
  });

  /*
   * The Translator looks the sentence up with {{url}} still in it, so the
   * code round the placeholder is set apart before the address goes in:
   * the address and its /otlp read as one.
   */
  test("draws an address a value fills in, with the path written onto it", () => {
    const Sentence: FunctionComponent = (): ReactElement => {
      const translator: Translator = useTranslator();

      return (
        <p data-testid="otlp-help">
          {translator.translateTemplate(OTLP_HELP, {
            url: "https://oneuptime.example.com",
            key: "abc123",
          })}
        </p>
      );
    };

    inLanguage(language, <Sentence />);

    const shown: string = screen.getByTestId("otlp-help").textContent || "";

    expect(shown).toContain("https://oneuptime.example.com");
    expect(
      isCodeDrawnAsWritten(shown, "https://oneuptime.example.com/otlp"),
    ).toBe(true);
  });

  /*
   * A help line is drawn in a box read from the left when most of its
   * letters read that way (readAsWritten): an English line left on the
   * page. The code it names is set apart, and its letters are not counted,
   * so the sentence round it is still read from the right.
   */
  test("is laid out from the right, however many letters its code has", () => {
    for (const help of [
      OIDC_HELP,
      REPLAY_HELP,
      (FLAG_HELP[language] as { help: string }).help,
    ]) {
      inLanguage(
        language,
        <FieldLabelElement
          title="Help"
          description={help}
          descriptionId="code-help"
        />,
      );

      const element: HTMLElement = document.getElementById(
        "code-help",
      ) as HTMLElement;

      expect(withoutIsolates(element.textContent || "")).toBe(locale[help]);
      expect({ help, box: element.querySelector("bdi")?.outerHTML }).toEqual({
        help,
        box: undefined,
      });
      cleanup();
    }
  });

  test("as the locale file holds it, a sentence with more code than words was laid out from the left", () => {
    const help: string = TURNED_BY_ITS_CODE[language] as string;

    inLanguage(
      language,
      <FieldLabelElement
        title="Help"
        description={help}
        descriptionId="code-help"
      />,
      rawI18n,
    );

    const element: HTMLElement = document.getElementById(
      "code-help",
    ) as HTMLElement;

    expect(element.textContent).toBe(locale[help]);
    expect(element.querySelector('bdi[dir="ltr"]')?.textContent).toBe(
      locale[help],
    );
  });

  test("is copied from the page as the locale file words it", () => {
    leaveIsolatesOutOfCopiedText(document);
    inLanguage(
      language,
      <FieldLabelElement
        title="Discovery URL"
        description={OIDC_HELP}
        descriptionId="oidc-help"
      />,
    );

    const help: HTMLElement = document.getElementById(
      "oidc-help",
    ) as HTMLElement;
    const range: Range = document.createRange();

    range.selectNodeContents(help);
    window.getSelection()?.addRange(range);

    const copied: Record<string, string> = {};
    const event: Event = new Event("copy", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "clipboardData", {
      value: {
        setData: (type: string, data: string): void => {
          copied[type] = data;
        },
      },
    });
    help.dispatchEvent(event);

    expect(copied["text/plain"]).toBe(locale[OIDC_HELP]);
  });
});

describe("a field's help in English", () => {
  test("is drawn as it is written, with nothing set apart", () => {
    inLanguage(
      "en",
      <FieldLabelElement
        title="Discovery URL"
        description={OIDC_HELP}
        descriptionId="oidc-help"
      />,
    );

    expect(describedBy("oidc-help")).toBe(OIDC_HELP);
  });
});
