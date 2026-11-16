// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import Handlebars from "handlebars";
import { getServerTranslator } from "Common/Server/Utils/ServerTranslation";
import {
  NO_BREAK_SPACE,
  withNumbersKeptWithUnits,
} from "Common/Types/NoBreakSpaces";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import {
  getSloWindowPhrase,
  getSloWindowText,
} from "Common/Utils/Slo/SloOverviewText";
import {
  getSloWindowPhraseInLanguage,
  getSloWindowTextInLanguage,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloOverviewTextInLanguage";
import { registerEmailLanguageHelpers } from "../../FeatureSet/Notification/Utils/EmailLanguage";

/*
 * ENGLISH A PAGE DRAWS WITHOUT A PAGE'S TRANSLATOR KEEPS A DURATION'S
 * NUMBER ON THE LINE OF ITS WORD (#8811).
 *
 * #8770 held a duration's figure to its word in every wording and in the
 * English a page's translator writes. Three kinds of English still parted
 * them: a Dashboard module's own English fallback, used where no translator
 * is passed ("Rolling 30 days"); an English key drawn as written ("Every 5
 * minutes"); and the server's emails ("for 2 hours"). Each is held now. An
 * email is read in a mail client, which draws a no-break space as a browser
 * does; English the server writes into a record still keeps its plain
 * space, so what is stored matches what reads it back. And Danish and
 * Norwegian, which write the count as an ordinal ("Hvert 5. minut"), hold
 * it too.
 */

const NB: string = NO_BREAK_SPACE;

describe("an email's English holds a duration's figure to its word", () => {
  const render: (template: string, language: string) => string = (
    template: string,
    language: string,
  ): string => {
    const handlebars: typeof Handlebars = Handlebars.create();

    registerEmailLanguageHelpers(handlebars);

    return handlebars.compile(template)({ emailLanguage: language, count: 2 });
  };

  test("an email's sentence, in English and in German", () => {
    expect(
      getServerTranslator("en", { readByAPerson: true }).translatePlural(
        { one: "{{count}} hour", other: "{{count}} hours" },
        2,
      ),
    ).toBe(`2${NB}hours`);
    expect(
      getServerTranslator("de", { readByAPerson: true })
        .translatePlural({ one: "{{count}} hour", other: "{{count}} hours" }, 2)
        .includes(`2${NB}`),
    ).toBe(true);
  });

  test("an email template's own words, through its translator", () => {
    expect(render('{{tt "Every {{count}} minutes" count=count}}', "en")).toBe(
      `Every 2${NB}minutes`,
    );
    expect(render('{{t "Sent again every 5 minutes"}}', "en")).toBe(
      `Sent again every 5${NB}minutes`,
    );
    expect(render('{{tHtml "Within 15 minutes"}}', "en")).toBe(
      `Within 15${NB}minutes`,
    );
    // Negative control: a number before another word.
    expect(render('{{t "Up to 5 people"}}', "en")).toBe("Up to 5 people");
  });

  test("negative control: English the server writes into a record keeps its plain space", () => {
    expect(
      getServerTranslator("en").translatePlural(
        { one: "{{count}} hour", other: "{{count}} hours" },
        2,
      ),
    ).toBe("2 hours");
    // Two translators, one each: asking for one never changes the other.
    expect(getServerTranslator("en")).not.toBe(
      getServerTranslator("en", { readByAPerson: true }),
    );
    expect(getServerTranslator("en", { readByAPerson: true })).toBe(
      getServerTranslator("en", { readByAPerson: true }),
    );
  });
});

describe("a Dashboard module's English fallback is a page's", () => {
  test("an SLO's window, with no translator, reads as its code's English, held", () => {
    const rolling: { windowType: SloWindowType; windowDays: number } = {
      windowType: SloWindowType.Rolling,
      windowDays: 30,
    };

    expect(getSloWindowTextInLanguage(rolling)).toBe(`Rolling 30${NB}days`);
    expect(getSloWindowTextInLanguage(rolling)).toBe(getSloWindowText(rolling));
    expect(getSloWindowPhraseInLanguage(rolling)).toBe(
      getSloWindowPhrase(rolling),
    );
    expect(getSloWindowText({ ...rolling, windowDays: 1 })).toBe(
      `Rolling 1${NB}day`,
    );
    // Negative control: a calendar month names no count.
    expect(getSloWindowText({ windowType: SloWindowType.CalendarMonth })).toBe(
      "Calendar month (UTC)",
    );
  });
});

describe("Danish and Norwegian write a duration's count as an ordinal", () => {
  test("its space is held after the ordinal's dot", () => {
    expect(
      withNumbersKeptWithUnits(
        "Hvert {{count}}. minut",
        "Every {{count}} minutes",
        { durationWords: true },
      ),
    ).toBe(`Hvert {{count}}.${NB}minut`);
    expect(
      withNumbersKeptWithUnits(
        "Hver {{count}}. time",
        "Every {{count}} hours",
        { durationWords: true },
      ),
    ).toBe(`Hver {{count}}.${NB}time`);
  });

  test("negative control: a sentence that ends on its count, and a text that may become a value", () => {
    // A full stop, then the next sentence's figure: no ordinal.
    expect(
      withNumbersKeptWithUnits(
        "Venter {{count}}. 5 forsøg",
        "Waits {{count}} minutes",
        { durationWords: true },
      ),
    ).toBe(`Venter {{count}}. 5 forsøg`);
    expect(
      withNumbersKeptWithUnits(
        "Hvert {{count}}. minut",
        "Every {{count}} minutes",
      ),
    ).toBe("Hvert {{count}}. minut");
  });
});
