import SubscriberTemplateValues, {
  SubscriberTemplateValueMap,
  SubscriberTemplateValueText,
} from "../../../../Server/Utils/StatusPage/SubscriberTemplateValues";
import { SubscriberEmailText } from "../../../../Server/Utils/StatusPage/SubscriberMessageText";
import {
  getServerTranslator,
  writeInLanguage,
} from "../../../../Server/Utils/ServerTranslation";
import OneUptimeDate from "../../../../Types/Date";
import { StatusPageNameList } from "../../../../Types/StatusPage/DefaultStatusNames";
import { getDefaultRecordNames } from "../../../../Utils/DefaultRecordNames";
import { StateListType } from "../../../../Utils/StateOrder";
import { Translator } from "../../../../Types/Translator";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import { describe, expect, test } from "@jest/globals";

/*
 * THE VALUES A CUSTOM TEMPLATE IS FILLED WITH, IN ITS PAGE'S LANGUAGE.
 *
 * A status page's custom template is the team's own text, written once,
 * most often in the page's default language: the values of OneUptime's own
 * words it is filled with - default state and severity names, a fixed word
 * such as "None", a Yes / No answer, the dates - are written in that
 * language (Server/Utils/StatusPage/SubscriberTemplateValues), and every
 * other value as it is. A page with no default language: English, exactly
 * as before.
 */

const POSTED_AT: Date = new Date("2026-09-27T14:05:00.000Z");

const GERMAN_PAGE: { defaultLanguage: string } = { defaultLanguage: "de" };

// The lists a status page, and so a custom template, names records of.
const STATUS_PAGE_LISTS: ReadonlyArray<StatusPageNameList> = [
  StateListType.IncidentState,
  StateListType.IncidentSeverity,
  StateListType.MonitorStatus,
  StateListType.ScheduledMaintenanceState,
];

describe("SubscriberTemplateValues.stateName", () => {
  test("OneUptime's default names in the page's language", () => {
    expect(
      SubscriberTemplateValues.inPageLanguage(GERMAN_PAGE, {
        state: SubscriberTemplateValues.stateName(
          StateListType.IncidentState,
          "Resolved",
        ),
        severity: SubscriberTemplateValues.stateName(
          StateListType.IncidentSeverity,
          "Major Incident",
        ),
        maintenance: SubscriberTemplateValues.stateName(
          StateListType.ScheduledMaintenanceState,
          "Ongoing",
        ),
      }),
    ).toEqual({
      state: "Behoben",
      severity: "Schwerwiegender Vorfall",
      maintenance: "Laufend",
    });
  });

  test("every default name reads in every language, as the status page reads it", () => {
    const translator: Translator = getServerTranslator("ja");

    for (const list of STATUS_PAGE_LISTS) {
      for (const name of getDefaultRecordNames(list)) {
        const value: string = SubscriberTemplateValues.write(
          { name: SubscriberTemplateValues.stateName(list, name) },
          translator,
        )["name"]!;

        expect([list, name, value === name]).toEqual([list, name, false]);
      }
    }
  });

  test("a name is a default by its own list: an incident state named Degraded is the project's (#8066)", () => {
    expect(
      SubscriberTemplateValues.inPageLanguage(GERMAN_PAGE, {
        // Degraded is a default monitor status, not an incident state.
        incidentState: SubscriberTemplateValues.stateName(
          StateListType.IncidentState,
          "Degraded",
        ),
        monitorStatus: SubscriberTemplateValues.stateName(
          StateListType.MonitorStatus,
          "Degraded",
        ),
        // Ongoing is a default maintenance state, not an incident severity.
        severity: SubscriberTemplateValues.stateName(
          StateListType.IncidentSeverity,
          "Ongoing",
        ),
        maintenanceState: SubscriberTemplateValues.stateName(
          StateListType.ScheduledMaintenanceState,
          "Ongoing",
        ),
        // Resolved is a default incident state, not a maintenance state.
        maintenanceNamedResolved: SubscriberTemplateValues.stateName(
          StateListType.ScheduledMaintenanceState,
          "Resolved",
        ),
      }),
    ).toEqual({
      incidentState: "Degraded",
      monitorStatus: "Beeinträchtigt",
      severity: "Ongoing",
      maintenanceState: "Laufend",
      maintenanceNamedResolved: "Resolved",
    });
  });

  test("a project's own name reads as written", () => {
    expect(
      SubscriberTemplateValues.inPageLanguage(GERMAN_PAGE, {
        state: SubscriberTemplateValues.stateName(
          StateListType.IncidentState,
          "Monitoring the fix",
        ),
        // Not quite a default name: as written.
        lowerCase: SubscriberTemplateValues.stateName(
          StateListType.IncidentState,
          "resolved",
        ),
      }),
    ).toEqual({ state: "Monitoring the fix", lowerCase: "resolved" });
  });

  test("no name reads as what the sender says it reads as", () => {
    expect(
      SubscriberTemplateValues.inPageLanguage(GERMAN_PAGE, {
        empty: SubscriberTemplateValues.stateName(
          StateListType.IncidentState,
          "",
        ),
        missing: SubscriberTemplateValues.stateName(
          StateListType.IncidentState,
          undefined,
          " - ",
        ),
        nothing: SubscriberTemplateValues.stateName(
          StateListType.IncidentState,
          null,
        ),
      }),
    ).toEqual({ empty: "", missing: " - ", nothing: "" });
  });
});

describe("SubscriberTemplateValues.text", () => {
  test("a fixed word in the page's language", () => {
    expect(
      SubscriberTemplateValues.inPageLanguage(
        { defaultLanguage: "fr" },
        { none: SubscriberTemplateValues.text(SubscriberEmailText.none) },
      ),
    ).toEqual({ none: "Aucune" });
    expect(
      SubscriberTemplateValues.textInPageLanguage(
        { defaultLanguage: "sv" },
        SubscriberEmailText.none,
      ),
    ).toBe("Inga");
  });

  test("a text no language words reads as it is", () => {
    expect(
      SubscriberTemplateValues.textInPageLanguage(
        GERMAN_PAGE,
        "Not a sentence OneUptime has",
      ),
    ).toBe("Not a sentence OneUptime has");
  });
});

describe("SubscriberTemplateValues.date", () => {
  test("a date as the notifications write one, in the page's language", () => {
    const german: string = SubscriberTemplateValues.inPageLanguage(
      GERMAN_PAGE,
      { postedAt: SubscriberTemplateValues.date(POSTED_AT) },
    )["postedAt"]!;

    expect(german).toBe(
      writeInLanguage("de", (): string => {
        return OneUptimeDate.getDateAsUserFriendlyFormattedString(POSTED_AT);
      }),
    );
    expect(german).not.toBe(
      OneUptimeDate.getDateAsUserFriendlyFormattedString(POSTED_AT),
    );
  });

  test("no date is nothing", () => {
    expect(
      SubscriberTemplateValues.inPageLanguage(GERMAN_PAGE, {
        endsAt: SubscriberTemplateValues.date(undefined),
        never: SubscriberTemplateValues.date(null),
      }),
    ).toEqual({ endsAt: "", never: "" });
  });
});

describe("SubscriberTemplateValues.yesOrNo", () => {
  test("a Yes / No answer in the reader's language", () => {
    const translator: Translator = getServerTranslator("de");

    expect(
      SubscriberTemplateValues.yesOrNo(
        SubscriberTemplateValueText.yes,
        translator,
      ),
    ).toBe("Ja");
    expect(
      SubscriberTemplateValues.yesOrNo(
        SubscriberTemplateValueText.no,
        translator,
      ),
    ).toBe("Nein");
  });

  test("Spanish and Italian say 'No' as English does", () => {
    for (const language of ["es", "it"]) {
      expect(
        SubscriberTemplateValues.yesOrNo("No", getServerTranslator(language)),
      ).toBe("No");
    }

    expect(
      SubscriberTemplateValues.yesOrNo("Yes", getServerTranslator("es")),
    ).toBe("Sí");
  });

  test("any other answer reads as it is, a word OneUptime has among them", () => {
    const translator: Translator = getServerTranslator("de");

    for (const text of ["Maybe", "yes", "", "Incident", "None"]) {
      expect(SubscriberTemplateValues.yesOrNo(text, translator)).toBe(text);
    }
  });
});

describe("SubscriberTemplateValues.inPageLanguage", () => {
  const values: () => SubscriberTemplateValueMap =
    (): SubscriberTemplateValueMap => {
      return {
        title: "Checkout failing",
        url: "https://status.acme.com",
        state: SubscriberTemplateValues.stateName(
          StateListType.IncidentState,
          "Identified",
        ),
        none: SubscriberTemplateValues.text(SubscriberEmailText.none),
        postedAt: SubscriberTemplateValues.date(POSTED_AT),
      };
    };

  test("a page with no default language: English, exactly as before", () => {
    for (const page of [
      {},
      { defaultLanguage: null },
      { defaultLanguage: "" },
      null,
      undefined,
    ]) {
      expect(SubscriberTemplateValues.inPageLanguage(page, values())).toEqual({
        title: "Checkout failing",
        url: "https://status.acme.com",
        state: "Identified",
        none: "None",
        postedAt: OneUptimeDate.getDateAsUserFriendlyFormattedString(POSTED_AT),
      });
    }
  });

  test("a language OneUptime does not write in is English", () => {
    expect(
      SubscriberTemplateValues.inPageLanguage(
        { defaultLanguage: "tlh" },
        values(),
      )["state"],
    ).toBe("Identified");
  });

  test("text values read as given, in any language", () => {
    const written: Record<string, string> =
      SubscriberTemplateValues.inPageLanguage(GERMAN_PAGE, values());

    expect(written["title"]).toBe("Checkout failing");
    expect(written["url"]).toBe("https://status.acme.com");
    expect(written["state"]).toBe("Identifiziert");
    expect(written["none"]).toBe("Keine");
  });

  test("a page read from the right sets each value apart from the words around it", () => {
    const written: Record<string, string> =
      SubscriberTemplateValues.inPageLanguage(
        { defaultLanguage: "fa" },
        {
          state: SubscriberTemplateValues.stateName(
            StateListType.IncidentState,
            "Resolved",
          ),
        },
      );

    expect(withoutIsolateMarks(written["state"]!)).toBe(
      getServerTranslator("fa").translateText("Resolved"),
    );
  });

  test("dates are English again once the values are written", () => {
    SubscriberTemplateValues.inPageLanguage(GERMAN_PAGE, values());

    expect(OneUptimeDate.convertMinutesToDaysHoursAndMinutes(5)).toBe(
      "5\u00A0minutes",
    );
  });

  test("workInPageLanguage hands the work the page's translator", () => {
    expect(
      SubscriberTemplateValues.workInPageLanguage(
        { defaultLanguage: "ko" },
        (translator: Translator): string => {
          return translator.language;
        },
      ),
    ).toBe("ko");
    expect(
      SubscriberTemplateValues.workInPageLanguage(
        {},
        (translator: Translator): string => {
          return translator.language;
        },
      ),
    ).toBe("en");
  });
});
