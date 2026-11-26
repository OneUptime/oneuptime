import { describe, expect, test } from "@jest/globals";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import {
  StorageArrayAgentConfig,
  StorageArrayPlatform,
} from "Common/Types/StorageArray/StorageArrayPlatform";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";

/*
 * THE SUPPORTED PLATFORMS ARE ONE TABLE, IN EVERY LANGUAGE (#11000).
 *
 * telemetry/storage-arrays opens with the platforms Storage Arrays reads:
 * one row per way the agent reads an array (each StorageArrayPlatform's
 * agentConfigs, in the registry's order) - the product, the storage.system
 * value it reports under, how the agent reads it and the collector config
 * it runs. A new platform is a row here in each language; this fails until
 * every language has it, and when a language's table names a config or a
 * platform that no longer ships.
 */

const PAGE: string = "telemetry/storage-arrays";

interface Row {
  product: string;
  storageSystem: string;
  how: string;
  config: string;
}

interface Expected {
  displayName: string;
  storageSystem: string;
  config: string;
}

const EXPECTED: Array<Expected> =
  StorageArrayPlatformRegistry.getPlatforms().flatMap(
    (platform: StorageArrayPlatform): Array<Expected> => {
      return platform.agentConfigs.map(
        (config: StorageArrayAgentConfig): Expected => {
          return {
            displayName: platform.displayName,
            storageSystem: platform.storageSystem,
            config: config.collectorConfigFile,
          };
        },
      );
    },
  );

function cellsOf(line: string): Array<string> {
  return line
    .replace(/^\|\s*/, "")
    .replace(/\s*\|\s*$/, "")
    .split(/\s+\|\s+/);
}

// The page's first table: its supported platforms.
function platformsTable(language: string): {
  header: Array<string>;
  rows: Array<Row>;
} {
  const lines: Array<string> = readPage(language, PAGE).split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("| ");
  });
  expect(start).toBeGreaterThan(0);
  const table: Array<string> = [];
  for (let index: number = start; index < lines.length; index++) {
    if (!lines[index]!.startsWith("|")) {
      break;
    }
    table.push(lines[index]!);
  }
  return {
    header: cellsOf(table[0]!),
    rows: table.slice(2).map((line: string): Row => {
      const cells: Array<string> = cellsOf(line);
      expect({ line, cells: cells.length }).toEqual({ line, cells: 4 });
      return {
        product: cells[0]!,
        storageSystem: cells[1]!,
        how: cells[2]!,
        config: cells[3]!,
      };
    }),
  };
}

describe("the supported platforms table", () => {
  test("the registry ships Pure Storage's three ways in", () => {
    expect(EXPECTED).toEqual([
      {
        displayName: "Pure Storage FlashArray",
        storageSystem: "purestorage.flasharray",
        config: "otel-collector-config.yaml",
      },
      {
        displayName: "Pure Storage FlashArray",
        storageSystem: "purestorage.flasharray",
        config: "otel-collector-config.flasharray-exporter.yaml",
      },
      {
        displayName: "Pure Storage FlashBlade",
        storageSystem: "purestorage.flashblade",
        config: "otel-collector-config.flashblade.yaml",
      },
    ]);
  });

  test("is in all 17 languages", () => {
    expect(DOCS_LANGUAGES).toHaveLength(17);
  });

  test.each(DOCS_LANGUAGES)(
    "%s: one row per way the agent reads an array, in the registry's order",
    (language: string) => {
      const { header, rows } = platformsTable(language);

      expect(header).toHaveLength(4);
      // The value column is code, the same in every language.
      expect(header[1]).toBe("`storage.system`");
      expect(rows).toHaveLength(EXPECTED.length);
      rows.forEach((row: Row, index: number) => {
        const expected: Expected = EXPECTED[index]!;
        expect({
          language,
          product: row.product.startsWith(`**${expected.displayName}**`),
          storageSystem: row.storageSystem,
          config: row.config.startsWith(`\`${expected.config}\``),
        }).toEqual({
          language,
          product: true,
          storageSystem: `\`${expected.storageSystem}\``,
          config: true,
        });
        expect(row.how).not.toBe("");
      });
    },
  );

  test.each(DOCS_LANGUAGES)(
    "%s: the English table's code, word for word",
    (language: string) => {
      const codeOf: (rows: Array<Row>) => Array<Array<string>> = (
        rows: Array<Row>,
      ): Array<Array<string>> => {
        return rows.map((row: Row): Array<string> => {
          return Array.from(
            `${row.storageSystem} ${row.how} ${row.config}`.matchAll(
              /`([^`]+)`/g,
            ),
          ).map((match: RegExpMatchArray): string => {
            return match[1]!;
          });
        });
      };
      expect(codeOf(platformsTable(language).rows)).toEqual(
        codeOf(platformsTable("en").rows),
      );
    },
  );
});
