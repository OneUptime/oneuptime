import { describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import {
  INVENTORY_ASSET_ATTRIBUTE_KEYS,
  INVENTORY_ASSET_FIELDS,
  INVENTORY_ASSET_OPTIONAL_FIELDS,
  InventoryAssetField,
  InventoryAssetKind,
} from "Common/Utils/Inventory/InventoryAssetDetails";
import {
  INVENTORY_ASSET_FIELD_LABELS,
  INVENTORY_ASSET_HELP,
  INVENTORY_ASSET_UNKNOWN,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryAssetLabels";
import fs from "fs";
import path from "path";

/*
 * Issue #4569 - Inventory describes hosts and network devices with one set
 * of asset facts (Common/Utils/Inventory/InventoryAssetDetails). The facts
 * are unit-tested in Common; this covers the half that lives in text: the
 * CMDB page documents exactly those facts under exactly those keys, the
 * card's labels and sentences exist in every Dashboard locale, and the
 * card's help links land on headings that exist.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);
const DOCS_CONTENT: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);

function readDoc(...parts: Array<string>): string {
  return fs.readFileSync(path.join(DOCS_CONTENT, ...parts), "utf8");
}

function sectionOf(doc: string, heading: string): string {
  const start: number = doc.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const end: number = doc.indexOf("\n## ", start + 1);
  return doc.substring(start, end === -1 ? undefined : end);
}

interface TableRow {
  fact: string;
  key: string;
}

function tableRows(section: string): Array<TableRow> {
  const rowPattern: RegExp = /^\| ([^|]+?) \| `([^`]+)` \|/gm;
  return Array.from(section.matchAll(rowPattern)).map(
    (match: RegExpMatchArray): TableRow => {
      return { fact: match[1]!.trim(), key: match[2]! };
    },
  );
}

function locales(): Dictionary<Dictionary<string>> {
  const directory: string = path.join(DASHBOARD_SRC, "Locales");
  const out: Dictionary<Dictionary<string>> = {};
  for (const file of fs.readdirSync(directory)) {
    if (file.endsWith(".json")) {
      out[file.replace(".json", "")] = JSON.parse(
        fs.readFileSync(path.join(directory, file), "utf8"),
      );
    }
  }
  return out;
}

describe("the CMDB page documents the asset details (issue #4569)", () => {
  const doc: string = readDoc("inventory", "cmdb-sync.md");

  test("its Asset Details table lists every fact, in the card's order, under its key", () => {
    const rows: Array<TableRow> = tableRows(sectionOf(doc, "## Asset Details"));

    expect(
      rows.map((row: TableRow): string => {
        return row.key;
      }),
    ).toEqual(
      INVENTORY_ASSET_FIELDS.map((field: InventoryAssetField): string => {
        return INVENTORY_ASSET_ATTRIBUTE_KEYS[field];
      }),
    );
  });

  test("each fact is named as the card labels it", () => {
    const rows: Array<TableRow> = tableRows(sectionOf(doc, "## Asset Details"));

    expect(
      rows.map((row: TableRow): string => {
        return row.fact.toLowerCase();
      }),
    ).toEqual(
      INVENTORY_ASSET_FIELDS.map((field: InventoryAssetField): string => {
        return INVENTORY_ASSET_FIELD_LABELS[field].toLowerCase();
      }),
    );
  });

  test("it says an unreported fact reads Unknown, and that the list exports them", () => {
    expect(sectionOf(doc, "## Asset Details")).toContain("**Unknown**");
    expect(doc).toContain(
      "[asset detail](#asset-details) is a column there too",
    );
  });

  test("the host table lists the keys a host can now be stamped with", () => {
    const keys: Array<string> = tableRows(
      sectionOf(doc, "## Host Asset Attributes"),
    ).map((row: TableRow): string => {
      return row.key;
    });

    for (const key of ["os.name", "device.type", "device.location"]) {
      expect(keys).toContain(key);
    }
  });

  test("the network device table lists every asset key", () => {
    const keys: Array<string> = tableRows(
      sectionOf(doc, "## Network Device Asset Attributes"),
    ).map((row: TableRow): string => {
      return row.key;
    });

    for (const field of [
      ...INVENTORY_ASSET_FIELDS,
      ...INVENTORY_ASSET_OPTIONAL_FIELDS,
    ]) {
      if (field === InventoryAssetField.Architecture) {
        // A host's fact only.
        continue;
      }
      expect(keys).toContain(INVENTORY_ASSET_ATTRIBUTE_KEYS[field]);
    }
    // The address syncs written before #4569 read is still documented.
    expect(keys).toContain("net.device.hostname");
  });

  test("it says the hostname is never the IP address", () => {
    expect(sectionOf(doc, "## Network Device Asset Attributes")).toContain(
      "The hostname is never the IP address.",
    );
  });

  test("the Inventory overview points at the asset details", () => {
    const overview: string = readDoc("inventory", "overview.md");
    expect(overview).toContain("**Asset Details**");
    expect(overview).toContain("/docs/inventory/cmdb-sync#asset-details");
  });
});

describe("the card's help links land on headings that exist", () => {
  test.each([
    [InventoryAssetKind.Host, "telemetry", "host-otel-collector.md"],
    [InventoryAssetKind.NetworkDevice, "inventory", "cmdb-sync.md"],
  ])(
    "the %s link",
    (kind: InventoryAssetKind, folder: string, file: string) => {
      const url: string = INVENTORY_ASSET_HELP[kind].docsUrl;
      expect(
        url.startsWith(`/docs/${folder}/${file.replace(".md", "")}#`),
      ).toBe(true);

      const anchor: string = url.split("#")[1]!;
      const doc: string = readDoc(folder, file);
      const anchors: Array<string> = doc
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("#");
        })
        .map((line: string): string => {
          return line
            .replace(/^#+\s*/, "")
            .toLowerCase()
            .replace(/[^a-z0-9 -]/g, "")
            .trim()
            .replace(/\s+/g, "-");
        });

      expect(anchors).toContain(anchor);
    },
  );
});

describe("the card reads in every Dashboard language", () => {
  const all: Dictionary<Dictionary<string>> = locales();

  test("there are seventeen locale files", () => {
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(17);
  });

  test("every label and the Unknown chip have an entry in every locale", () => {
    const labels: Array<string> = [
      ...Object.values(INVENTORY_ASSET_FIELD_LABELS),
      INVENTORY_ASSET_UNKNOWN,
      "Asset Details",
    ];

    for (const [locale, entries] of Object.entries(all)) {
      for (const label of labels) {
        const value: string | undefined = entries[label];
        expect({ locale, label, present: Boolean(value) }).toEqual({
          locale,
          label,
          present: true,
        });
      }
    }
  });

  test("the card's own sentences are translated, not left in English", () => {
    const sentences: Array<string> = [
      "Asset Details",
      "What this machine is and where it is, in the same terms for every host and network device. Unknown means nothing has reported it yet.",
      INVENTORY_ASSET_HELP[InventoryAssetKind.Host].linkText,
      INVENTORY_ASSET_HELP[InventoryAssetKind.NetworkDevice].linkText,
      INVENTORY_ASSET_HELP[InventoryAssetKind.Host].unknown.other,
      INVENTORY_ASSET_HELP[InventoryAssetKind.NetworkDevice].unknown.other,
    ];

    for (const [locale, entries] of Object.entries(all)) {
      if (locale === "en") {
        continue;
      }
      for (const sentence of sentences) {
        expect({
          locale,
          sentence,
          translated: entries[sentence] !== sentence,
        }).toEqual({ locale, sentence, translated: true });
      }
    }
  });

  /*
   * A plural template is one key - its "other" sentence - with a "_one" form
   * beside it. Two plain keys would show English for one of the counts.
   */
  test("the unknown-count sentences are plural keys with a _one form", () => {
    const english: Dictionary<string> = all["en"]!;

    for (const kind of [
      InventoryAssetKind.Host,
      InventoryAssetKind.NetworkDevice,
    ]) {
      const plural: { one: string; other: string } =
        INVENTORY_ASSET_HELP[kind].unknown;
      expect(english[plural.other]).toBe(plural.other);
      expect(english[`${plural.other}_one`]).toBe(plural.one);
      expect(english[plural.one]).toBeUndefined();
      expect(plural.one).toContain("{{count}}");
      expect(plural.other).toContain("{{count}}");
    }
  });
});

/*
 * The device's own page and the Network device list name the same maker,
 * model, operating system and versions as its Inventory item: all three read
 * the device's asset facts, and fetch the columns those facts read.
 */
describe("the network pages read the same asset facts as Inventory", () => {
  const COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
  const SPACE: RegExp = /\s+/g;

  function readCode(...parts: Array<string>): string {
    return fs
      .readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8")
      .replace(COMMENT, " ")
      .replace(SPACE, " ");
  }

  test("the device's Inventory card shows the asset facts", () => {
    const card: string = readCode(
      "Components",
      "NetworkDevice",
      "DeviceInventoryCard.tsx",
    );

    expect(card).toContain("getNetworkDeviceAssetFacts(item)[fact]");
    for (const fact of [
      "manufacturer",
      "model",
      "firmwareVersion",
      "operatingSystem",
      "osVersion",
    ]) {
      expect(card).toContain(`factElement(item, "${fact}")`);
    }
    expect(card).toContain(
      "selectMoreFields: { sysDescr: true, sysObjectId: true, }",
    );
  });

  test("the device list's Vendor / Model column shows the asset facts", () => {
    const list: string = readCode("Pages", "NetworkDevice", "Devices.tsx");

    expect(list).toContain("getNetworkDeviceAssetFacts(item)");
    expect(list).toContain("sysObjectId: true, sysDescr: true,");
  });
});
