import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { ComponentArgument } from "Common/Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentsUtil from "Common/Utils/Dashboard/Components/Index";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";

/*
 * A DASHBOARD WIDGET'S SETTINGS READ IN THE READER'S LANGUAGE (#8164).
 *
 * The widget settings form looks every word of a widget's settings up as it
 * draws it: a setting's name, what it does, its placeholder, its options and
 * the section it is in. None of them was extracted (Common/Utils/Dashboard
 * was no source root), so a word read in the reader's language only where
 * another page happened to use it: the Incident List's and the Alert List's
 * Lifecycle State filter read "Lifecycle State", "Quick filter by lifecycle
 * state" and "Unresolved (open)" in English in every language, beside
 * "Alle", "Bestätigt" and "Behoben" in German.
 *
 * Those two widgets' settings, and the View Mode every list widget offers,
 * are keys now, worded in every language. The other widgets' settings are
 * still to come (STILL_TO_COME, #8479): the list only shrinks, and a widget
 * not on it must have every word a key.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const LETTER: RegExp = /\p{L}/u;

interface SettingsWord {
  text: string;
  where: string;
}

// Every word a widget's settings form draws, looked up.
function settingsWords(type: DashboardComponentType): Array<SettingsWord> {
  const words: Array<SettingsWord> = [];
  const add: (text: string | undefined, where: string) => void = (
    text: string | undefined,
    where: string,
  ): void => {
    if (text && LETTER.test(text)) {
      words.push({ text, where });
    }
  };

  for (const argument of DashboardComponentsUtil.getComponentSettingsArguments(
    type,
  ) as Array<ComponentArgument<DashboardBaseComponent>>) {
    const id: string = String(argument.id);

    add(argument.name, `${id}: name`);
    add(argument.description, `${id}: description`);
    add(argument.placeholder, `${id}: placeholder`);
    add(argument.section?.name, `${id}: section`);
    add(argument.section?.description, `${id}: section description`);

    for (const option of argument.dropdownOptions || []) {
      // A name as written (a product's) is never looked up.
      if (!option.isUserContent) {
        add(String(option.label), `${id}: option`);
      }
    }
  }

  return words;
}

// The words of a widget's settings no locale has a key for.
function unkeyed(type: DashboardComponentType): Array<string> {
  const english: Record<string, string> = readDashboardLocale("en");

  return [
    ...new Set(
      settingsWords(type)
        .filter((word: SettingsWord): boolean => {
          return english[word.text] === undefined;
        })
        .map((word: SettingsWord): string => {
          return word.text;
        }),
    ),
  ].sort();
}

const KEYED: ReadonlyArray<DashboardComponentType> = [
  DashboardComponentType.IncidentList,
  DashboardComponentType.AlertList,
];

/*
 * Widgets whose settings still read English somewhere: #8479 makes them
 * keys (Common/Utils/Dashboard/Components, a source root
 * of the extraction each, as the Incident List's is). The list only
 * shrinks: a widget keyed leaves it, and a new widget is keyed from the
 * start.
 */
const STILL_TO_COME: ReadonlySet<DashboardComponentType> =
  new Set<DashboardComponentType>([
    DashboardComponentType.Chart,
    DashboardComponentType.Value,
    DashboardComponentType.Text,
    DashboardComponentType.Clock,
    DashboardComponentType.Table,
    DashboardComponentType.Gauge,
    DashboardComponentType.DataSourceChart,
    DashboardComponentType.DataSourceValue,
    DashboardComponentType.DataSourceGauge,
    DashboardComponentType.DataSourceTable,
    DashboardComponentType.LogStream,
    DashboardComponentType.LogChart,
    DashboardComponentType.SecurityEventsList,
    DashboardComponentType.SecurityEventsFlow,
    DashboardComponentType.ProductAnalyticsFunnel,
    DashboardComponentType.ProductAnalyticsRetention,
    DashboardComponentType.TraceList,
    DashboardComponentType.TraceChart,
    DashboardComponentType.TraceTable,
    DashboardComponentType.MonitorList,
    DashboardComponentType.Slo,
    DashboardComponentType.SloList,
    DashboardComponentType.KubernetesPodList,
    DashboardComponentType.KubernetesNodeList,
    DashboardComponentType.KubernetesNamespaceList,
    DashboardComponentType.KubernetesDeploymentList,
    DashboardComponentType.KubernetesStatefulSetList,
    DashboardComponentType.KubernetesDaemonSetList,
    DashboardComponentType.KubernetesJobList,
    DashboardComponentType.KubernetesCronJobList,
    DashboardComponentType.DockerHostList,
    DashboardComponentType.DockerContainerList,
    DashboardComponentType.DockerImageList,
    DashboardComponentType.DockerNetworkList,
    DashboardComponentType.DockerVolumeList,
    DashboardComponentType.PodmanHostList,
    DashboardComponentType.PodmanContainerList,
    DashboardComponentType.PodmanImageList,
    DashboardComponentType.PodmanNetworkList,
    DashboardComponentType.PodmanVolumeList,
    DashboardComponentType.HostList,
    DashboardComponentType.ProxmoxNodeList,
    DashboardComponentType.ProxmoxGuestList,
    DashboardComponentType.VMwareHostList,
    DashboardComponentType.VMwareVirtualMachineList,
    DashboardComponentType.DockerSwarmNodeList,
    DashboardComponentType.DockerSwarmServiceList,
    DashboardComponentType.CephOsdList,
    DashboardComponentType.CephPoolList,
    DashboardComponentType.StorageArrayVolumeList,
    DashboardComponentType.StorageArrayHardwareList,
    DashboardComponentType.NetworkMap,
    DashboardComponentType.Html,
  ]);

function hasSettings(type: DashboardComponentType): boolean {
  try {
    return (
      DashboardComponentsUtil.getComponentSettingsArguments(type).length > 0
    );
  } catch {
    return false;
  }
}

describe("the Incident List and Alert List settings", () => {
  test.each(KEYED)(
    "%s: every word its settings form draws is a key",
    (type: DashboardComponentType) => {
      expect(settingsWords(type).length).toBeGreaterThan(15);
      expect(unkeyed(type)).toEqual([]);
    },
  );

  test.each(KEYED)(
    "%s: and each is worded in every language",
    (type: DashboardComponentType) => {
      const notWorded: Array<string> = [];

      for (const language of DASHBOARD_LANGUAGES) {
        for (const word of settingsWords(type)) {
          if (!isWordedInDashboardLocale(word.text, language)) {
            notWorded.push(`${language} ${word.where}: ${word.text}`);
          }
        }
      }

      expect(notWorded).toEqual([]);
    },
  );

  test("the Lifecycle State filter: its name, what it does and its options", () => {
    const german: Record<string, string> = readDashboardLocale("de");

    for (const type of KEYED) {
      const lifecycle: ComponentArgument<DashboardBaseComponent> | undefined =
        DashboardComponentsUtil.getComponentSettingsArguments(type).find(
          (argument: ComponentArgument<DashboardBaseComponent>): boolean => {
            return argument.id === "stateFilter";
          },
        );

      expect(lifecycle?.name).toBe("Lifecycle State");
      expect(
        (lifecycle?.dropdownOptions || []).map(
          (option: { label: string }): string => {
            return german[option.label] as string;
          },
        ),
      ).toEqual(["Alle", "Nicht behoben (offen)", "Bestätigt", "Behoben"]);
    }

    expect(german["Lifecycle State"]).toBe("Lebenszyklus-Status");
    expect(german["Quick filter by lifecycle state"]).toBe(
      "Schnellfilter nach Lebenszyklus-Status",
    );
  });

  /*
   * "Unresolved (open)" is worded with each language's own Unresolved, the
   * word the Dashboard says beside it, and reads as its whole text: it is
   * no key that names a meaning (MeaningKeys).
   */
  test("Unresolved (open) says each language's Unresolved", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        startsWithUnresolved: (locale["Unresolved (open)"] || "").startsWith(
          locale["Unresolved"] as string,
        ),
      }).toEqual({ language, startsWithUnresolved: true });
    }
  });
});

describe("the other widgets' settings, still to come", () => {
  test("each widget on the list still has a word no locale keys: a keyed one leaves it", () => {
    for (const type of STILL_TO_COME) {
      expect({ type, unkeyed: unkeyed(type).length > 0 }).toEqual({
        type,
        unkeyed: true,
      });
    }
  });

  test("a widget not on the list has every word of its settings a key", () => {
    for (const type of Object.values(DashboardComponentType)) {
      if (STILL_TO_COME.has(type) || !hasSettings(type)) {
        continue;
      }

      expect({ type, unkeyed: unkeyed(type) }).toEqual({ type, unkeyed: [] });
    }

    for (const type of KEYED) {
      expect(STILL_TO_COME.has(type)).toBe(false);
    }
  });

  test("the View Mode every list widget offers is keyed already", () => {
    for (const type of [
      DashboardComponentType.IncidentList,
      DashboardComponentType.AlertList,
      DashboardComponentType.MonitorList,
    ]) {
      const words: Array<string> = settingsWords(type)
        .filter((word: SettingsWord): boolean => {
          return word.where.startsWith("viewMode");
        })
        .map((word: SettingsWord): string => {
          return word.text;
        });

      expect(words).toEqual(
        expect.arrayContaining(["View Mode", "List", "Honeycomb"]),
      );

      for (const word of words) {
        expect({ type, word, keyed: unkeyed(type).includes(word) }).toEqual({
          type,
          word,
          keyed: false,
        });
      }
    }
  });
});

/*
 * The widgets page describes the Lifecycle State filter by its options,
 * and five languages named Acknowledged by a word the Dashboard does not
 * draw (Danish kvitterede, French acquittés, Italian presi in carico, Korean
 * 확인됨 - its word for Confirmed - and Portuguese reconhecidos); German,
 * Dutch, Russian and Persian named Unresolved and Resolved so too. Each
 * cell names the three as the Dashboard does, inflected as its sentence
 * needs: the stem below is in the Dashboard's word and in the cell.
 */
const LIFECYCLE_STEMS: Record<
  string,
  { unresolved: string; acknowledged: string; resolved: string }
> = {
  de: {
    unresolved: "nicht behoben",
    acknowledged: "bestätigt",
    resolved: "behoben",
  },
  fr: {
    unresolved: "non résolu",
    acknowledged: "en compte",
    resolved: "résolu",
  },
  es: {
    unresolved: "sin resolver",
    acknowledged: "reconocid",
    resolved: "resuelt",
  },
  it: {
    unresolved: "non risolt",
    acknowledged: "riconosciut",
    resolved: "risolt",
  },
  pt: {
    unresolved: "não resolvid",
    acknowledged: "confirmad",
    resolved: "resolvid",
  },
  nl: {
    unresolved: "niet opgelost",
    acknowledged: "bevestigd",
    resolved: "opgelost",
  },
  da: { unresolved: "uløst", acknowledged: "bekræfte", resolved: "løst" },
  no: { unresolved: "uløst", acknowledged: "bekrefte", resolved: "løst" },
  sv: { unresolved: "olöst", acknowledged: "bekräftad", resolved: "löst" },
  ru: {
    unresolved: "устранён",
    acknowledged: "подтверждён",
    resolved: "устранён",
  },
  ja: { unresolved: "未解決", acknowledged: "確認済み", resolved: "解決済み" },
  ko: { unresolved: "미해결", acknowledged: "인지됨", resolved: "해결됨" },
  "zh-CN": { unresolved: "未解决", acknowledged: "已确认", resolved: "已解决" },
  "zh-TW": { unresolved: "未解決", acknowledged: "已確認", resolved: "已解決" },
  hi: { unresolved: "अनसुलझ", acknowledged: "स्वीकार", resolved: "सुलझ" },
  fa: {
    unresolved: "برطرف‌نشده",
    acknowledged: "تأییدشده",
    resolved: "برطرف‌شده",
  },
};

// Lower case, with no spaces: a stem is found whatever the cell's spacing.
function folded(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function widgetsPageRows(language: string): Array<string> {
  const page: string = fs.readFileSync(
    path.join(
      REPOSITORY_ROOT,
      "packages/App/FeatureSet/Docs/Content",
      language,
      "dashboards/widgets.md",
    ),
    "utf8",
  );
  const lines: Array<string> = page.split("\n");
  const english: Array<string> = fs
    .readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/Docs/Content/en/dashboards/widgets.md",
      ),
      "utf8",
    )
    .split("\n");

  // The rows the English page gives the Incident List and the Alert List.
  return english
    .map((line: string, index: number): string | undefined => {
      return line.startsWith("| **Incident List** |") ||
        line.startsWith("| **Alert List** |")
        ? lines[index]
        : undefined;
    })
    .filter((line: string | undefined): line is string => {
      return Boolean(line);
    });
}

describe("the widgets page names the Lifecycle State options as the Dashboard draws them", () => {
  test("every docs language has its stems, each in the Dashboard's word", () => {
    for (const language of Object.keys(LIFECYCLE_STEMS)) {
      const locale: Record<string, string> = readDashboardLocale(language);
      const stems: {
        unresolved: string;
        acknowledged: string;
        resolved: string;
      } = LIFECYCLE_STEMS[language] as {
        unresolved: string;
        acknowledged: string;
        resolved: string;
      };

      expect({
        language,
        unresolved: folded(locale["Unresolved"] as string).includes(
          folded(stems.unresolved),
        ),
        acknowledged: folded(locale["Acknowledged"] as string).includes(
          folded(stems.acknowledged),
        ),
        resolved: folded(locale["Resolved"] as string).includes(
          folded(stems.resolved),
        ),
      }).toEqual({
        language,
        unresolved: true,
        acknowledged: true,
        resolved: true,
      });
    }
  });

  test.each(Object.keys(LIFECYCLE_STEMS))(
    "%s: the Incident List and Alert List rows name the three by them",
    (language: string) => {
      const rows: Array<string> = widgetsPageRows(language);
      const stems: {
        unresolved: string;
        acknowledged: string;
        resolved: string;
      } = LIFECYCLE_STEMS[language] as {
        unresolved: string;
        acknowledged: string;
        resolved: string;
      };

      expect(rows).toHaveLength(2);

      for (const row of rows) {
        // The filters' column: the row's last cell.
        const cells: Array<string> = row.split("|");
        const filters: string = folded(cells[cells.length - 2] || "");

        expect({
          language,
          unresolved: filters.includes(folded(stems.unresolved)),
          acknowledged: filters.includes(folded(stems.acknowledged)),
          resolved: filters.includes(folded(stems.resolved)),
        }).toEqual({
          language,
          unresolved: true,
          acknowledged: true,
          resolved: true,
        });
      }
    },
  );

  test("the words the issue found are gone (negative control)", () => {
    const gone: Record<string, string> = {
      da: "kvitterede",
      fr: "acquitt",
      it: "presi in carico",
      ko: "확인됨",
      pt: "reconhecidos",
    };

    for (const language of Object.keys(gone)) {
      for (const row of widgetsPageRows(language)) {
        expect({
          language,
          found: row.includes(gone[language] as string),
        }).toEqual({ language, found: false });
      }
    }
  });
});
