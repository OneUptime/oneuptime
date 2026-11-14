// UX rule: Docs/ux/README.md#help-text
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getMetricDescriptionParts,
  MetricDescriptionPart,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MetricPickerDescription";
import { getAllCephMetrics } from "../../../Types/Monitor/CephMetricCatalog";
import { getAllDatabaseMetrics } from "../../../Types/Monitor/DatabaseMetricCatalog";
import { getAllDockerMetrics } from "../../../Types/Monitor/DockerMetricCatalog";
import { getAllDockerSwarmMetrics } from "../../../Types/Monitor/DockerSwarmMetricCatalog";
import { getAllHostMetrics } from "../../../Types/Monitor/HostMetricCatalog";
import { getAllIoTMetrics } from "../../../Types/Monitor/IotMetricCatalog";
import { getAllKubernetesMetrics } from "../../../Types/Monitor/KubernetesMetricCatalog";
import { getAllOpenStackMetrics } from "../../../Types/Monitor/OpenStackMetricCatalog";
import { getAllPodmanMetrics } from "../../../Types/Monitor/PodmanMetricCatalog";
import { getAllProxmoxMetrics } from "../../../Types/Monitor/ProxmoxMetricCatalog";
import { getAllStorageArrayMetrics } from "../../../Types/Monitor/StorageArrayMetricCatalog";
import { getAllVMwareMetrics } from "../../../Types/Monitor/VMwareMetricCatalog";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import { listSourceFiles, toRelativePath } from "../../ForeignHiddenRuleGuard";

/*
 * A METRIC'S DESCRIPTION NEVER SHOWS A BACKTICK (#7883).
 *
 * The monitor metric catalogs (Common/Types/Monitor/*MetricCatalog.ts)
 * write what a reader types as code, in backticks: "fanned out by the
 * `status` datapoint attribute". Drawn as plain text, the VMware, OpenStack
 * and Kubernetes metric pickers showed the backticks under the dropdown in
 * fifty descriptions. A description handed to MetricPickerDescription has
 * its code drawn as code; read anywhere else - drawn on a page, handed to a
 * chart, stored as a metric's description - it is shown as it is written.
 *
 * So this finds every place the product reads a catalog's description - a
 * `.description` on a value typed as one of the catalogs' definitions, on a
 * loop's value over one of them, or on what one of their getters returns -
 * and a catalog any of them shows as text holds no backtick. A description
 * written with code in a catalog that is shown as text fails here, and so
 * does a picker that draws its code as text again. In every catalog the
 * backticks pair, with code between each pair, so MetricPickerDescription
 * leaves none of them on the page either.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const MONITOR_TYPES: string = "packages/Common/Types/Monitor";

/*
 * Where a description can be read: the product's source - the App, Common,
 * the probe, and ee/ when it is in the checkout.
 */
const SCAN_ROOTS: Array<string> = [
  "packages/App",
  "packages/Common",
  "packages/Probe",
  "ee",
];

const TEST_FILE_REGEX: RegExp = /\.test\.tsx?$/;

// Not a test, and not a catalog: a catalog writes its descriptions.
const isProductSource: (relativePath: string) => boolean = (
  relativePath: string,
): boolean => {
  return (
    !relativePath.split("/").includes("Tests") &&
    !TEST_FILE_REGEX.test(relativePath) &&
    !(
      relativePath.startsWith(`${MONITOR_TYPES}/`) &&
      relativePath.endsWith("MetricCatalog.ts")
    )
  );
};

// The component that draws a description's code as code.
const CODE_DRAWER: string = "MetricPickerDescription";

interface CatalogEntry {
  id: string;
  description: string;
}

// Every monitor metric catalog, by its file, with what it describes its metrics with.
const CATALOGS: Record<string, () => Array<CatalogEntry>> = {
  "CephMetricCatalog.ts": getAllCephMetrics,
  "DatabaseMetricCatalog.ts": getAllDatabaseMetrics,
  "DockerMetricCatalog.ts": getAllDockerMetrics,
  "DockerSwarmMetricCatalog.ts": getAllDockerSwarmMetrics,
  "HostMetricCatalog.ts": getAllHostMetrics,
  "IotMetricCatalog.ts": getAllIoTMetrics,
  "KubernetesMetricCatalog.ts": getAllKubernetesMetrics,
  "OpenStackMetricCatalog.ts": getAllOpenStackMetrics,
  "PodmanMetricCatalog.ts": getAllPodmanMetrics,
  "ProxmoxMetricCatalog.ts": getAllProxmoxMetrics,
  "StorageArrayMetricCatalog.ts": getAllStorageArrayMetrics,
  "VMwareMetricCatalog.ts": getAllVMwareMetrics,
};

// What a reader's code names a catalog by: its definition and its getters.
interface CatalogNames {
  catalog: string;
  definition: string;
  getters: Array<string>;
}

interface DescriptionRead {
  catalog: string;
  line: number;
  // Handed to MetricPickerDescription, which draws its code as code.
  isDrawnAsCode: boolean;
}

const DEFINITION_REGEX: RegExp = /export interface (\w+MetricDefinition)\b/;

const GETTER_REGEX: RegExp = /export function (\w+)\s*\(/g;

const IDENTIFIER: string = "[A-Za-z_$][\\w$]*";

const readCatalogNames: (catalog: string) => CatalogNames = (
  catalog: string,
): CatalogNames => {
  const source: string = fs.readFileSync(
    path.join(REPOSITORY_ROOT, MONITOR_TYPES, catalog),
    "utf8",
  );

  return {
    catalog: catalog,
    definition: source.match(DEFINITION_REGEX)?.[1] || "",
    getters: Array.from(
      source.matchAll(GETTER_REGEX),
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  };
};

/*
 * The code of a file, its comments blanked out but its lines kept: a
 * comment that names `metric.description` reads nothing.
 */
const withoutComments: (source: string) => string = (
  source: string,
): string => {
  const blank: (comment: string) => string = (comment: string): string => {
    return comment.replace(/[^\n]/g, " ");
  };

  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank);
};

const CODE_DRAWER_REGEX: RegExp = new RegExp(`<${CODE_DRAWER}(?![\\w$])`, "g");

// The read is the value of the element's description prop.
const AS_DESCRIPTION_PROP_REGEX: RegExp = /\bdescription=\{\s*$/;

// Whether the read at `at` is the description handed to MetricPickerDescription.
const isHandedToCodeDrawer: (code: string, at: number) => boolean = (
  code: string,
  at: number,
): boolean => {
  let opening: number = -1;

  for (const match of code.matchAll(CODE_DRAWER_REGEX)) {
    if ((match.index ?? 0) < at) {
      opening = match.index ?? 0;
    }
  }

  if (opening < 0) {
    return false;
  }

  const between: string = code.slice(opening, at);

  return !between.includes("/>") && AS_DESCRIPTION_PROP_REGEX.test(between);
};

// The first group of every match of `regex` in `code`.
const firstGroups: (code: string, regex: RegExp) => Array<string> = (
  code: string,
  regex: RegExp,
): Array<string> => {
  return Array.from(code.matchAll(regex), (match: RegExpMatchArray): string => {
    return match[1] as string;
  });
};

const asName: (name: string) => string = (name: string): string => {
  return `(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`;
};

/*
 * Where `source` reads a description of one of `catalogs`: a `.description`
 * on a name typed as the catalog's definition (`selectedMetric:
 * VMwareMetricDefinition | undefined`, `(metric: VMwareMetricDefinition)`,
 * a prop `metric: VMwareMetricDefinition`), on a loop's value over its
 * getter or over an array typed as its definitions (`for (const metric of
 * getAllVMwareMetrics())`, which can carry no type of its own), or on what
 * one of its getters returns (`getVMwareMetricById(id)?.description`).
 */
const findDescriptionReads: (
  source: string,
  catalogs: Array<CatalogNames>,
) => Array<DescriptionRead> = (
  source: string,
  catalogs: Array<CatalogNames>,
): Array<DescriptionRead> => {
  const code: string = withoutComments(source);
  const reads: Array<DescriptionRead> = [];

  const lineAt: (at: number) => number = (at: number): number => {
    return code.slice(0, at).split("\n").length;
  };

  for (const names of catalogs) {
    const getterCalls: Array<string> =
      names.getters.length > 0
        ? [`\\b(?:${names.getters.join("|")})\\s*\\([^()]*\\)`]
        : [];

    const arrays: Array<string> = firstGroups(
      code,
      new RegExp(
        `\\b(${IDENTIFIER})\\??\\s*:\\s*(?:(?:Readonly)?Array<\\s*${names.definition}\\s*>|${names.definition}\\s*\\[\\s*\\])`,
        "g",
      ),
    );

    const loopSources: Array<string> = [...getterCalls, ...arrays.map(asName)];

    const typedNames: Set<string> = new Set<string>([
      ...firstGroups(
        code,
        new RegExp(
          `\\b(${IDENTIFIER})\\??\\s*:\\s*${names.definition}\\b`,
          "g",
        ),
      ),
      ...(loopSources.length > 0
        ? firstGroups(
            code,
            new RegExp(
              `\\bfor\\s*\\(\\s*(?:const|let|var)\\s+(${IDENTIFIER})\\s+of\\s+(?:${loopSources.join("|")})`,
              "g",
            ),
          )
        : []),
    ]);

    const readers: Array<string> = [
      ...Array.from(typedNames).map((name: string): string => {
        return `(?<![\\w$])${escapeRegExp(name)}`;
      }),
      ...getterCalls,
    ];

    if (readers.length === 0) {
      continue;
    }

    const readRegex: RegExp = new RegExp(
      `(?:${readers.join("|")})\\s*[?!]?\\s*\\.\\s*description\\b`,
      "g",
    );

    for (const match of code.matchAll(readRegex)) {
      const at: number = match.index ?? 0;

      reads.push({
        catalog: names.catalog,
        line: lineAt(at),
        isDrawnAsCode: isHandedToCodeDrawer(code, at),
      });
    }
  }

  return reads;
};

interface FileRead extends DescriptionRead {
  file: string;
}

const CATALOG_NAMES: Array<CatalogNames> =
  Object.keys(CATALOGS).map(readCatalogNames);

let scanned: Array<FileRead> | null = null;

// Every read of a catalog's description in the product's source.
const scanRepository: () => Array<FileRead> = (): Array<FileRead> => {
  if (scanned) {
    return scanned;
  }

  scanned = [];

  for (const root of SCAN_ROOTS) {
    for (const file of listSourceFiles(path.join(REPOSITORY_ROOT, root))) {
      const relativePath: string = toRelativePath(REPOSITORY_ROOT, file);

      if (!isProductSource(relativePath)) {
        continue;
      }

      const source: string = fs.readFileSync(file, "utf8");

      if (!source.includes("MetricCatalog")) {
        continue;
      }

      for (const read of findDescriptionReads(source, CATALOG_NAMES)) {
        scanned.push({ ...read, file: relativePath });
      }
    }
  }

  return scanned;
};

const VMWARE: CatalogNames = {
  catalog: "VMwareMetricCatalog.ts",
  definition: "VMwareMetricDefinition",
  getters: ["getAllVMwareMetrics", "getVMwareMetricById"],
};

describe("finding where a catalog's descriptions are read", () => {
  test("a description drawn as text, by a typed name or a getter", () => {
    const source: string = [
      "const selectedMetric: VMwareMetricDefinition | undefined = pick();",
      "const line = <p>{selectedMetric.description}</p>;",
      "const other = getVMwareMetricById(props.id)?.description;",
      "metrics.map((m: VMwareMetricDefinition) => { return m!.description; });",
    ].join("\n");

    expect(findDescriptionReads(source, [VMWARE])).toEqual([
      { catalog: "VMwareMetricCatalog.ts", line: 2, isDrawnAsCode: false },
      { catalog: "VMwareMetricCatalog.ts", line: 3, isDrawnAsCode: false },
      { catalog: "VMwareMetricCatalog.ts", line: 4, isDrawnAsCode: false },
    ]);
  });

  test("a description handed to MetricPickerDescription is drawn as code", () => {
    const source: string = [
      "const selectedMetric: VMwareMetricDefinition | undefined = pick();",
      "const line = (",
      "  <MetricPickerDescription",
      "    description={selectedMetric.description}",
      "    metricName={selectedMetric.metricName}",
      "  />",
      ");",
      "const words = <MetricPickerDescription description={x} />;",
      "const after = <p title={selectedMetric.description} />;",
    ].join("\n");

    expect(findDescriptionReads(source, [VMWARE])).toEqual([
      { catalog: "VMwareMetricCatalog.ts", line: 4, isDrawnAsCode: true },
      { catalog: "VMwareMetricCatalog.ts", line: 9, isDrawnAsCode: false },
    ]);
  });

  test("a description read in a loop over a getter or over an array of the definitions", () => {
    const source: string = [
      "for (const definition of getAllVMwareMetrics()) {",
      "  push({ description: definition.description });",
      "}",
      "const metrics: Array<VMwareMetricDefinition> = pick();",
      "for (const metric of metrics) {",
      "  rows.push(metric.description);",
      "}",
      "for (const field of fields) {",
      "  rows.push(field.description);",
      "}",
    ].join("\n");

    expect(findDescriptionReads(source, [VMWARE])).toEqual([
      { catalog: "VMwareMetricCatalog.ts", line: 2, isDrawnAsCode: false },
      { catalog: "VMwareMetricCatalog.ts", line: 6, isDrawnAsCode: false },
    ]);
  });

  test("a comment, another value's description or another catalog's reads nothing", () => {
    const source: string = [
      "// the picker draws selectedMetric.description under the dropdown",
      "/* getVMwareMetricById(id).description */",
      "const selectedMetric: CephMetricDefinition = pick();",
      "const field = { description: 'Only this host' };",
      "const words = <p>{field.description}{selectedMetric.description}</p>;",
    ].join("\n");

    expect(findDescriptionReads(source, [VMWARE])).toEqual([]);
  });
});

describe("a metric catalog's description", () => {
  test("every catalog in Types/Monitor is read here", () => {
    expect(
      fs
        .readdirSync(path.join(REPOSITORY_ROOT, MONITOR_TYPES))
        .filter((name: string): boolean => {
          return name.endsWith("MetricCatalog.ts");
        })
        .sort(),
    ).toEqual(Object.keys(CATALOGS).sort());

    // Each is found by its definition's name and its getters.
    expect(
      CATALOG_NAMES.filter((names: CatalogNames): boolean => {
        return !names.definition || names.getters.length === 0;
      }),
    ).toEqual([]);
  });

  test("pairs its backticks, with code between each pair", () => {
    const unpaired: Array<string> = [];

    for (const [catalog, getAll] of Object.entries(CATALOGS)) {
      for (const metric of getAll()) {
        const parts: Array<MetricDescriptionPart> = getMetricDescriptionParts(
          metric.description,
        );
        const isDrawnWhole: boolean = parts.every(
          (part: MetricDescriptionPart): boolean => {
            return part.isCode
              ? part.text.trim() === part.text && !part.text.includes("\n")
              : !part.text.includes("`");
          },
        );

        if (!isDrawnWhole) {
          unpaired.push(`${catalog} ${metric.id}`);
        }
      }
    }

    expect(unpaired).toEqual([]);
  });

  test("is read somewhere in the product, for every catalog", () => {
    const readCatalogs: Set<string> = new Set<string>(
      scanRepository().map((read: FileRead): string => {
        return read.catalog;
      }),
    );

    expect(Object.keys(CATALOGS).sort()).toEqual(
      Array.from(readCatalogs).sort(),
    );
  });

  test("is drawn with its code as code by the VMware, OpenStack and Kubernetes pickers", () => {
    for (const picker of [
      "VMwareMonitor/VMwareMetricPicker.tsx",
      "OpenStackMonitor/OpenStackMetricPicker.tsx",
      "KubernetesMonitor/KubernetesMetricPicker.tsx",
    ]) {
      const reads: Array<FileRead> = scanRepository().filter(
        (read: FileRead): boolean => {
          return read.file.endsWith(`/Components/Form/Monitor/${picker}`);
        },
      );

      expect({ picker, isRead: reads.length > 0 }).toEqual({
        picker,
        isRead: true,
      });
      expect(
        reads
          .filter((read: FileRead): boolean => {
            return !read.isDrawnAsCode;
          })
          .map((read: FileRead): string => {
            return `${read.file}:${read.line}`;
          }),
      ).toEqual([]);
    }
  });

  test("holds no backtick where it is shown as text", () => {
    const shownAsText: Array<{
      catalog: string;
      shownAsTextAt: Array<string>;
      descriptionsWithBackticks: Array<string>;
    }> = [];

    for (const [catalog, getAll] of Object.entries(CATALOGS)) {
      const readsAsText: Array<FileRead> = scanRepository().filter(
        (read: FileRead): boolean => {
          return read.catalog === catalog && !read.isDrawnAsCode;
        },
      );

      if (readsAsText.length === 0) {
        continue;
      }

      const withBackticks: Array<string> = getAll()
        .filter((metric: CatalogEntry): boolean => {
          return metric.description.includes("`");
        })
        .map((metric: CatalogEntry): string => {
          return metric.id;
        });

      if (withBackticks.length > 0) {
        shownAsText.push({
          catalog,
          shownAsTextAt: readsAsText.map((read: FileRead): string => {
            return `${read.file}:${read.line}`;
          }),
          descriptionsWithBackticks: withBackticks,
        });
      }
    }

    /*
     * Draw the description through MetricPickerDescription where it is
     * read, or write the names it gives without backticks.
     */
    expect(shownAsText).toEqual([]);
  });
});
