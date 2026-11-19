import { describe, expect, test } from "@jest/globals";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import {
  DEVICE_ADDRESS_MONITOR_TYPES,
  DEVICE_MONITOR_TEMPLATE_TYPES,
  DEVICE_MONITOR_TEMPLATE_TYPE_REFUSAL,
  DEVICE_TEMPLATE_HAS_NO_STEPS,
  DEVICE_URL_MONITOR_TYPES,
} from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
import {
  URL_TEMPLATE_HOST_IS_VARIABLE,
  URL_TEMPLATE_NEEDS_HOST,
  URL_TEMPLATE_NEEDS_URL,
  URL_TEMPLATE_NEEDS_WEB_SCHEME,
  URL_TEMPLATE_PORT_NOT_A_NUMBER,
} from "Common/Utils/Monitor/DeviceUrlTarget";
import fs from "fs";
import path from "path";
import {
  ADDRESS_TEMPLATES_GROUP_TITLE,
  LISTED_TEMPLATE_KINDS_RULE,
  MANAGE_TEMPLATES_LINK_TITLE,
  NO_DEVICE_MONITOR_TEMPLATE_REASON,
  POLL_TEMPLATES_GROUP_TITLE,
  UNNAMED_TEMPLATE_NAME,
  WEB_TEMPLATES_GROUP_TITLE,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportTemplateCopy";

/*
 * WHAT THE IMPORT'S MONITORING STEP SAYS ABOUT ITS TEMPLATES (OneUptime
 * issue #5145).
 *
 * The step lists the kinds of template a device's monitor can be made
 * from, and says so in one line, so nobody wonders where theirs went. That
 * line, the list's group headings and the refusals all name the kinds by
 * the monitor type picker's own titles - and they are held here to the one
 * list the import and the server work from (DEVICE_MONITOR_TEMPLATE_TYPES),
 * so a kind added there cannot go unnamed here, and a kind named here is
 * one the import takes.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

function titleOf(monitorType: MonitorType): string {
  return MonitorTypeHelper.getTitle(monitorType);
}

// The titles a sentence names, in the order it names them.
function titlesNamedIn(sentence: string): Array<string> {
  return Object.values(MonitorType)
    .map((monitorType: MonitorType): string => {
      return titleOf(monitorType);
    })
    .filter((title: string): boolean => {
      return new RegExp(`(^|[ ,])${escapeRegExp(title)}(?=[ ,])`).test(
        sentence,
      );
    })
    .sort((first: string, second: string): number => {
      return sentence.indexOf(first) - sentence.indexOf(second);
    });
}

describe("the line under Monitor template", () => {
  test("names exactly the kinds the import lists, in its order", () => {
    expect(titlesNamedIn(LISTED_TEMPLATE_KINDS_RULE)).toEqual(
      DEVICE_MONITOR_TEMPLATE_TYPES.map(titleOf),
    );
  });

  test("says how a web template's URL is made each device's (#9546)", () => {
    expect(LISTED_TEMPLATE_KINDS_RULE).toBe(
      "Network Device, Ping, IP, Port, NTP, Website, API and SSL Certificate templates are listed. A web one's URL takes each device's address as its host.",
    );
    // A field's description: short enough for the line under it.
    expect(LISTED_TEMPLATE_KINDS_RULE.length).toBeLessThanOrEqual(150);
  });

  test("sits beside a link to the templates, named as the product names it elsewhere", () => {
    expect(MANAGE_TEMPLATES_LINK_TITLE).toBe("Manage templates");
  });
});

describe("the list's three groups", () => {
  test("Network Device templates first: they read each device's polls", () => {
    expect(POLL_TEMPLATES_GROUP_TITLE).toBe(
      `${titleOf(MonitorType.NetworkDevice)} templates`,
    );
  });

  test("then the ones that check each device's address, every such kind named", () => {
    expect(titlesNamedIn(ADDRESS_TEMPLATES_GROUP_TITLE)).toEqual(
      DEVICE_ADDRESS_MONITOR_TYPES.map(titleOf),
    );
  });

  test("then the ones that check a URL on each device, as Web templates (#9546)", () => {
    expect(WEB_TEMPLATES_GROUP_TITLE).toBe("Web templates");
    // The kinds it holds are the ones a web template's URL is made each device's for.
    expect(DEVICE_URL_MONITOR_TYPES.map(titleOf)).toEqual([
      "Website",
      "API",
      "SSL Certificate",
    ]);
  });
});

describe("the refusals name the same kinds", () => {
  test("the server's, when a template of another kind is sent", () => {
    expect(titlesNamedIn(DEVICE_MONITOR_TEMPLATE_TYPE_REFUSAL)).toEqual(
      DEVICE_MONITOR_TEMPLATE_TYPES.map(titleOf),
    );
  });

  test("the step's, when the project has no template and the reader may not make one", () => {
    expect(titlesNamedIn(NO_DEVICE_MONITOR_TEMPLATE_REASON)).toEqual(
      expect.arrayContaining(DEVICE_MONITOR_TEMPLATE_TYPES.map(titleOf)),
    );
  });
});

describe("every one of these is a Dashboard string, translated", () => {
  const english: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
  ) as Record<string, string>;

  const strings: Array<string> = [
    LISTED_TEMPLATE_KINDS_RULE,
    MANAGE_TEMPLATES_LINK_TITLE,
    POLL_TEMPLATES_GROUP_TITLE,
    ADDRESS_TEMPLATES_GROUP_TITLE,
    WEB_TEMPLATES_GROUP_TITLE,
    UNNAMED_TEMPLATE_NAME,
    NO_DEVICE_MONITOR_TEMPLATE_REASON,
    /*
     * Why a web template cannot give each device a monitor, shown before
     * an import starts (#9546): the server's own words, translated.
     */
    DEVICE_TEMPLATE_HAS_NO_STEPS,
    URL_TEMPLATE_NEEDS_URL,
    URL_TEMPLATE_NEEDS_WEB_SCHEME,
    URL_TEMPLATE_NEEDS_HOST,
    URL_TEMPLATE_HOST_IS_VARIABLE,
    URL_TEMPLATE_PORT_NOT_A_NUMBER,
  ];

  test.each(strings)("%s is an en.json key", (text: string) => {
    expect(english[text]).toBe(text);
  });

  test.each(["de", "fr", "es", "ja", "zh-CN", "fa"])(
    "the %s Dashboard words each of them its own way",
    (code: string) => {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
      ) as Record<string, string>;

      for (const text of strings) {
        expect(locale[text]).toBeTruthy();
        expect(locale[text]).not.toBe(text);
      }
    },
  );
});
