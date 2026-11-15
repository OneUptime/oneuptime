import { describe, expect, test } from "@jest/globals";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { AUDIT_LOG_SESSION_RESOURCE_TYPE } from "Common/Types/AuditLog/AuditLogSessionEvent";
import { Translator } from "Common/Types/Translator";
import type { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import {
  DEFAULT_RESOURCE_META,
  getResourceMeta,
  getResourceTypeFilterOptions,
  getResourceTypeLabel,
  RESOURCE_META,
} from "../../FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTableUtils";

/*
 * THE AUDIT LOG'S RESOURCE TYPE FILTER OFFERS EACH TYPE BY TODAY'S NAME
 * (#7580).
 *
 * A renamed model keeps its old singular name for the API and the audit
 * log, so every entry about an On-Call Schedule is stored as "On-Call
 * Policy Schedule". The filter was free text on that stored value: a
 * person who typed "On-Call Schedule", as the rows call it, found nothing.
 * It now offers the types the entries are about, each by the name the rows
 * show, valued by the name the entries are stored under.
 *
 * Every renamed model is read from the models, so one renamed later is
 * held to the same.
 */

interface RenamedType {
  table: string;
  kept: string;
  screen: string;
}

const RENAMED: Array<RenamedType> = DatabaseModels.map(
  (modelType: typeof DatabaseBaseModel): DatabaseBaseModel => {
    return new modelType();
  },
)
  .filter((model: DatabaseBaseModel): boolean => {
    return Boolean(model.apiSingularName);
  })
  .map((model: DatabaseBaseModel): RenamedType => {
    return {
      table: model.tableName!,
      kept: model.apiSingularName!,
      screen: model.singularName!,
    };
  });

const ENGLISH: Record<string, string> = readDashboardLocale("en");

function onlyOption(options: Array<DropdownOption>): DropdownOption {
  expect(options).toHaveLength(1);

  return options[0]!;
}

describe("the Resource Type filter's choice for a renamed type", () => {
  test("covers every renamed model", () => {
    expect(RENAMED.length).toBeGreaterThanOrEqual(15);
  });

  test.each(RENAMED)(
    "$screen is offered by its name today, and asks for the entries stored as $kept",
    (renamed: RenamedType) => {
      const option: DropdownOption = onlyOption(
        getResourceTypeFilterOptions([renamed.kept]),
      );

      expect(option).toEqual({
        label: renamed.screen,
        value: renamed.kept,
        aliases: [renamed.screen],
        isUserContent: false,
      });
    },
  );

  test.each(RENAMED)(
    "$screen is offered once, though its entries are stored under both names",
    (renamed: RenamedType) => {
      const option: DropdownOption = onlyOption(
        getResourceTypeFilterOptions([
          renamed.kept,
          renamed.screen,
          renamed.kept,
        ]),
      );

      expect(option.value).toBe(renamed.kept);
      expect(option.label).toBe(renamed.screen);
    },
  );

  test.each(RENAMED)(
    "$screen, stored only under its name today, still asks for its kept name",
    (renamed: RenamedType) => {
      const option: DropdownOption = onlyOption(
        getResourceTypeFilterOptions([renamed.screen]),
      );

      expect(option.value).toBe(renamed.kept);
      expect(option.label).toBe(renamed.screen);
    },
  );

  test.each(RENAMED)(
    "$screen's label is a word of the Dashboard, looked up in every language",
    (renamed: RenamedType) => {
      const option: DropdownOption = onlyOption(
        getResourceTypeFilterOptions([renamed.kept]),
      );

      expect(ENGLISH[option.label]).toBe(renamed.screen);

      for (const language of DASHBOARD_LANGUAGES) {
        const words: Record<string, string> = readDashboardLocale(language);
        const translator: Translator = dashboardTranslator(language);

        expect({
          language,
          shown: translator.translateText(option.label) || option.label,
        }).toEqual({ language, shown: words[renamed.screen] });
      }
    },
  );
});

describe("the Resource Type filter's choices", () => {
  test("the two the issue names read as the rows call them", () => {
    const options: Array<DropdownOption> = getResourceTypeFilterOptions([
      "On-Call Policy Schedule",
      "User's On-Call Duty Escalation Rule",
    ]);

    expect(
      options.map((option: DropdownOption): [string, string] => {
        return [option.label, String(option.value)];
      }),
    ).toEqual([
      ["Escalation Rule User", "User's On-Call Duty Escalation Rule"],
      ["On-Call Schedule", "On-Call Policy Schedule"],
    ]);
  });

  test("a type never renamed is offered as it is stored, with no other name", () => {
    const options: Array<DropdownOption> = getResourceTypeFilterOptions([
      "Monitor",
      AUDIT_LOG_SESSION_RESOURCE_TYPE,
    ]);

    expect(options).toEqual([
      { label: "Monitor", value: "Monitor", isUserContent: false },
      {
        label: AUDIT_LOG_SESSION_RESOURCE_TYPE,
        value: AUDIT_LOG_SESSION_RESOURCE_TYPE,
        isUserContent: false,
      },
    ]);
  });

  test("a type the Dashboard does not know is offered by its stored name", () => {
    expect(getResourceTypeFilterOptions(["Something New"])).toEqual([
      { label: "Something New", value: "Something New", isUserContent: false },
    ]);
  });

  test("entries with no type offer nothing", () => {
    expect(getResourceTypeFilterOptions([undefined, null, "", "   "])).toEqual(
      [],
    );
  });

  test("are in the order of their labels, English by default", () => {
    const options: Array<DropdownOption> = getResourceTypeFilterOptions([
      "Telemetry Ingestion Key",
      "Monitor",
      "Scheduled Maintenance Event",
      "Incident",
    ]);

    expect(
      options.map((option: DropdownOption): string => {
        return option.label;
      }),
    ).toEqual(["Incident", "Ingestion Key", "Maintenance Event", "Monitor"]);
  });

  test("are in the order the reader reads their labels, when told how", () => {
    const spanish: Translator = dashboardTranslator("es");
    const shown: (label: string) => string = (label: string): string => {
      return spanish.translateText(label) || label;
    };

    const options: Array<DropdownOption> = getResourceTypeFilterOptions(
      ["Telemetry Ingestion Key", "Monitor", "Scheduled Maintenance Event"],
      (first: string, second: string): number => {
        return shown(first).localeCompare(shown(second), "es");
      },
    );

    // "Clave de ingesta", "Evento de mantenimiento", "Monitor".
    expect(
      options.map((option: DropdownOption): string => {
        return shown(option.label);
      }),
    ).toEqual([
      shown("Ingestion Key"),
      shown("Maintenance Event"),
      shown("Monitor"),
    ]);
    expect(shown("Ingestion Key")).toBe("Clave de ingesta");
  });
});

describe("an entry stored under a renamed type's name today", () => {
  test.each(RENAMED)(
    "$screen reads, and is drawn, as one stored as $kept",
    (renamed: RenamedType) => {
      expect(getResourceTypeLabel(renamed.screen)).toBe(renamed.screen);
      expect(getResourceTypeLabel(renamed.kept)).toBe(renamed.screen);
      expect(getResourceMeta(renamed.screen)).toBe(
        getResourceMeta(renamed.kept),
      );
    },
  );

  test("an On-Call Schedule and a Maintenance Event keep their icon and their page", () => {
    expect(getResourceMeta("On-Call Schedule")).toBe(
      RESOURCE_META["On-Call Policy Schedule"],
    );
    expect(getResourceMeta("Maintenance Event")).toBe(
      RESOURCE_META["Scheduled Maintenance Event"],
    );
    expect(getResourceMeta("On-Call Schedule")).not.toBe(DEFAULT_RESOURCE_META);
  });

  test("a type with no meta of its own, by either name, is drawn the default way", () => {
    expect(getResourceMeta("Ingestion Key")).toBe(DEFAULT_RESOURCE_META);
    expect(getResourceMeta(undefined)).toBe(DEFAULT_RESOURCE_META);
    expect(getResourceTypeLabel(undefined)).toBe("Resource");
  });
});
