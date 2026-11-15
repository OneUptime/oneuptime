import { describe, expect, test } from "@jest/globals";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import {
  getHostLegend,
  getHostLoad,
  getHostLoadBusyBand,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardVMwareHostListComponent";
import { HoneycombLegendItem } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceHoneycomb";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE VMWARE HOST LIST'S LOAD BANDS, IN THE READER'S LANGUAGE (#8270).
 *
 * The honeycomb names a host's band in its tile's tooltip and in the
 * legend under the tiles, through translateText. "Under 70%" and "Over
 * 90%" are keys every locale words, and the busy band, "70–90%", was none
 * - the extractor keeps no key without a letter - so a Persian board read
 * "70–90%" in Latin digits beside "کمتر از ۷۰٪". It is written in the
 * reader's digits and percent sign now; English reads as it did.
 */

const LATIN_DIGIT: RegExp = /[0-9]/;

function host(cpu?: number, memory?: number): VMwareResource {
  const resource: VMwareResource = new VMwareResource();

  if (cpu !== undefined) {
    resource.latestCpuPercent = cpu;
  }
  if (memory !== undefined) {
    resource.latestMemoryPercent = memory;
  }

  return resource;
}

// The words the honeycomb draws for a band: its label, looked up.
function drawn(label: string, translator: Translator): string {
  return translator.translateText(label) || label;
}

describe("the VMware host list's load bands", () => {
  test("English reads as it always did", () => {
    expect(getHostLoad(host(50, 20)).text).toBe("Under 70%");
    expect(getHostLoad(host(80, 20)).text).toBe("70–90%");
    expect(getHostLoad(host(20, 95)).text).toBe("Over 90%");
    expect(getHostLoad(host()).text).toBe("No data");
    expect(getHostLoad(host(80), "en").text).toBe("70–90%");
    expect(
      getHostLegend("en").map((item: HoneycombLegendItem): string => {
        return item.label;
      }),
    ).toEqual(["Under 70%", "70–90%", "Over 90%", "No data"]);
  });

  test("the busy band in the reader's digits and percent sign", () => {
    expect(getHostLoadBusyBand("fa")).toBe("۷۰–۹۰٪");
    expect(getHostLoadBusyBand("de")).toBe("70–90 %");
    expect(getHostLoadBusyBand("ar")).toMatch(/^70–90/);
    expect(getHostLoad(host(85), "fa").text).toBe("۷۰–۹۰٪");
  });

  test("on a Persian board no band, in a tile or the legend, reads a Latin digit", () => {
    const fa: Translator = dashboardTranslator("fa");

    for (const item of getHostLegend("fa")) {
      expect(drawn(item.label, fa)).not.toMatch(LATIN_DIGIT);
    }

    for (const load of [host(50), host(80), host(95), host()]) {
      expect(drawn(getHostLoad(load, "fa").text, fa)).not.toMatch(LATIN_DIGIT);
    }
  });

  test("every band with words is worded in every language the Dashboard ships", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const key of ["Under 70%", "Over 90%", "No data"]) {
        expect({
          language,
          key,
          worded: typeof locale[key] === "string",
        }).toEqual({ language, key, worded: true });
      }
    }
  });

  test("the legend keeps its colours, in the order of the bands", () => {
    const english: Array<HoneycombLegendItem> = getHostLegend("en");
    const persian: Array<HoneycombLegendItem> = getHostLegend("fa");

    expect(
      persian.map((item: HoneycombLegendItem): string => {
        return item.color;
      }),
    ).toEqual(
      english.map((item: HoneycombLegendItem): string => {
        return item.color;
      }),
    );
    expect(getHostLoad(host(80), "fa").color).toBe(english[1]!.color);
  });
});
