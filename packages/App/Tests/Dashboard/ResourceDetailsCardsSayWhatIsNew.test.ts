import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { CLOUD_RESOURCE_CATEGORY_LABELS } from "Common/Types/Cloud/CloudResourceCatalog";
import {
  DATABASE_SERVER_DISCOVERY_SOURCES,
  getDatabaseServerDiscoverySourceLabel,
} from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import {
  getMessageQueueDiscoverySourceLabel,
  MESSAGE_QUEUE_DISCOVERY_SOURCES,
} from "Common/Models/DatabaseModels/MessageQueue";
import {
  HERO_AND_HEADER_COLUMNS,
  isRepeatedHeroColumn,
  isReportedDetailValue,
  RESOURCE_RECORD_DETAILS_COLUMNS,
  RESOURCE_RECORD_DETAILS_EMPTY_MESSAGE,
} from "../../FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceRecordDetails";
import { SOURCE_ROOTS } from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";

/*
 * A RESOURCE OVERVIEW'S DETAILS CARD SAYS WHAT THE HERO AND THE HEADER DO
 * NOT (#5307's follow-up; the rules are in
 * Components/TelemetryResource/ResourceRecordDetails).
 *
 * #5298's UI review left six lines for later, each held here:
 *
 *   - The Details cards of a Docker and a Podman host, a Kubernetes, a
 *     Proxmox and a Ceph cluster, a vCenter, a storage array and a host
 *     (CardModelDetail cards, a host's four of them) repeated the hero's
 *     name, its description and when it was last seen, and the header's
 *     labels, said "Not reported" for every fact a new resource had not
 *     sent, and were one column on some pages and two on others. They draw
 *     through ResourceRecordDetailsCard now: only what the resource
 *     reported, in two columns, its ID line at the foot, Edit in Settings
 *     in its header, the labels a phone's card under it - and the
 *     description is the hero's line, under the name.
 *   - The Docker, Podman, Ceph and storage array Overviews' Quick Links
 *     card repeated the side menu beside it, as Explore telemetry did
 *     before #4980's follow-up.
 *   - ResourceOverview's Details rows mixed Title Case ("Service Version")
 *     and sentence case ("Discovered from", "Engine metrics", "Recording
 *     health") across its pages, and within the RUM card. One casing now,
 *     Title Case as every details card's labels are, each a key of every
 *     locale - Persian's among them.
 *   - The card's line said "Metadata captured from OpenTelemetry resource
 *     attributes." on a database's and a queue's card, whose rows come from
 *     spans, the broker and its agent. Every page says where its rows come
 *     from now (detailsDescription is required).
 *   - The product's own words in Details values - where a database or a
 *     queue was found, its engine metrics' status, a cloud resource's
 *     category - and the database hero's chips read English on every page.
 *     They are keys of the locales now, looked up where they are drawn.
 *   - TechStackView had no user. It is gone, with its plural sentence.
 *
 * App's jest runs in node without React: the pages are read through the
 * TypeScript AST and whitespace-squashed source. The card itself is
 * rendered in Common's ResourceRecordDetailsCard and DetailEmptyMessage
 * suites; the pages in the browser in E2E/ResourceOverviews and the
 * infrastructure page suites.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");
const I18N_DIR: string = path.join(DASHBOARD_SRC, "..", "i18n");

function read(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

// Comments out, whitespace squashed: the code as prettier may wrap it.
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

/*
 * Without the breaks prettier puts inside brackets and parentheses when a
 * page key is too long for one line.
 */
function tight(text: string): string {
  return text.replace(/([[(]) /g, "$1").replace(/,? ([\])])/g, "$1");
}

function parse(relative: string): ts.SourceFile {
  return ts.createSourceFile(
    relative,
    read(relative),
    ts.ScriptTarget.Latest,
    true,
    relative.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node): void => {
    visit(child, onNode);
  });
}

type JsxTag = ts.JsxElement | ts.JsxSelfClosingElement;

function tagName(element: JsxTag): string {
  return (
    ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName
  ).getText();
}

function attributesOf(element: JsxTag): ts.JsxAttributes {
  return ts.isJsxElement(element)
    ? element.openingElement.attributes
    : element.attributes;
}

function jsxTagsNamed(source: ts.SourceFile, name: string): Array<JsxTag> {
  const tags: Array<JsxTag> = [];
  visit(source, (node: ts.Node): void => {
    if (
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagName(node) === name
    ) {
      tags.push(node);
    }
  });
  return tags;
}

function attribute(element: JsxTag, name: string): ts.JsxAttribute | null {
  for (const property of attributesOf(element).properties) {
    if (ts.isJsxAttribute(property) && property.name.getText() === name) {
      return property;
    }
  }
  return null;
}

// A string attribute's text (`title="Host Details"`), else null.
function stringAttribute(element: JsxTag, name: string): string | null {
  const found: ts.JsxAttribute | null = attribute(element, name);
  return found?.initializer && ts.isStringLiteral(found.initializer)
    ? found.initializer.text
    : null;
}

// What an attribute is set to, as written (`settingsRoute={...}`).
function attributeText(element: JsxTag, name: string): string {
  const found: ts.JsxAttribute | null = attribute(element, name);
  return found?.initializer ? found.initializer.getText() : "";
}

function propertyNamed(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === name) {
      return property;
    }
  }
  return null;
}

interface Fact {
  title: string;
  columns: Array<string>;
  properties: Array<string>;
  text: string;
}

// The facts a page hands its ResourceRecordDetailsCard, as it wrote them.
function factsOf(card: JsxTag): Array<Fact> {
  const found: ts.JsxAttribute | null = attribute(card, "facts");
  const expression: ts.Expression | undefined =
    found?.initializer && ts.isJsxExpression(found.initializer)
      ? found.initializer.expression
      : undefined;
  expect(expression && ts.isArrayLiteralExpression(expression)).toBe(true);

  return (expression as ts.ArrayLiteralExpression).elements.map(
    (element: ts.Expression): Fact => {
      expect(ts.isObjectLiteralExpression(element)).toBe(true);
      const object: ts.ObjectLiteralExpression =
        element as ts.ObjectLiteralExpression;
      const title: ts.PropertyAssignment | null = propertyNamed(
        object,
        "title",
      );
      const field: ts.PropertyAssignment | null = propertyNamed(
        object,
        "field",
      );
      const columns: Array<string> =
        field && ts.isObjectLiteralExpression(field.initializer)
          ? field.initializer.properties.map(
              (property: ts.ObjectLiteralElementLike): string => {
                return property.name ? property.name.getText() : "";
              },
            )
          : [];

      return {
        title:
          title && ts.isStringLiteral(title.initializer)
            ? title.initializer.text
            : "",
        columns,
        properties: object.properties.map(
          (property: ts.ObjectLiteralElementLike): string => {
            return property.name ? property.name.getText() : "";
          },
        ),
        text: object.getText(),
      };
    },
  );
}

/*
 * Title Case, as every details card's labels are: each word after the
 * first starts with a capital, but for the short words Title Case keeps
 * small ("Name on the Array", "Name in the Cloud"). What is in brackets is
 * the attribute the value is read from ("Host Name (host.name)"), written
 * as the telemetry names it.
 */
const SMALL_WORDS: ReadonlyArray<string> = [
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
];

function isTitleCase(label: string): boolean {
  const words: Array<string> = label
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return words.every((word: string, index: number): boolean => {
    const first: string = word.charAt(0);
    if (first.toLowerCase() === first.toUpperCase()) {
      // A number, or a word that starts with no letter.
      return true;
    }
    if (index > 0 && SMALL_WORDS.includes(word)) {
      return true;
    }
    return first === first.toUpperCase();
  });
}

// Each Dashboard language's words, and the keys it means to write as English.
interface Language {
  code: string;
  words: Record<string, string>;
  sameAsEnglish: Set<string>;
}

const SAME_EVERYWHERE: ReadonlyArray<string> = JSON.parse(
  fs.readFileSync(path.join(I18N_DIR, "SameAsEnglish.json"), "utf8"),
) as Array<string>;

const LANGUAGES: Array<Language> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): Language => {
    const code: string = file.replace(/\.json$/, "");
    const progress: string = path.join(I18N_DIR, "Progress", `${code}.json`);
    const own: Array<string> = fs.existsSync(progress)
      ? (
          JSON.parse(fs.readFileSync(progress, "utf8")) as {
            sameAsEnglish?: Array<string>;
          }
        ).sameAsEnglish ?? []
      : [];

    return {
      code,
      words: JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as Record<string, string>,
      sameAsEnglish: new Set<string>([...SAME_EVERYWHERE, ...own]),
    };
  });

const ENGLISH: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
) as Record<string, string>;

/*
 * The languages that draw a key in English though they should not: a key
 * the language lacks, or one it writes as in English without the i18n
 * tooling recording that as meant ("ID", "Kubernetes").
 */
function untranslatedIn(key: string): Array<string> {
  const missing: Array<string> = [];
  if (ENGLISH[key] !== key) {
    missing.push(`en has no key "${key}"`);
  }
  for (const language of LANGUAGES) {
    const value: string | undefined = language.words[key];
    if (typeof value !== "string" || value.trim() === "") {
      missing.push(`${language.code}: no "${key}"`);
    } else if (value === key && !language.sameAsEnglish.has(key)) {
      missing.push(`${language.code}: "${key}" in English`);
    }
  }
  return missing;
}

/*
 * ---------------------------------------------------------------------------
 * The rules (ResourceRecordDetails)
 * ---------------------------------------------------------------------------
 */
describe("the rules every resource Details card keeps", () => {
  test("the columns the hero and the header say, which no card repeats", () => {
    expect([...HERO_AND_HEADER_COLUMNS]).toEqual([
      "name",
      "description",
      "lastSeenAt",
      "labels",
      "otelCollectorStatus",
    ]);
    for (const column of HERO_AND_HEADER_COLUMNS) {
      expect(isRepeatedHeroColumn(column)).toBe(true);
    }
    for (const column of [
      "hostIdentifier",
      "agentVersion",
      "osVersion",
      "fsid",
      "collectionMethod",
      "_id",
    ]) {
      expect(isRepeatedHeroColumn(column)).toBe(false);
    }
  });

  test("two columns from 640px, and one line when nothing is reported", () => {
    expect(RESOURCE_RECORD_DETAILS_COLUMNS).toBe(2);
    expect(RESOURCE_RECORD_DETAILS_EMPTY_MESSAGE).toBe(
      "No details reported yet.",
    );
    // The same words a ResourceOverview's Details card says.
    expect(code("Components/TelemetryResource/ResourceOverview.tsx")).toContain(
      'translator.translateText("No details reported yet.")',
    );
    expect(untranslatedIn(RESOURCE_RECORD_DETAILS_EMPTY_MESSAGE)).toEqual([]);
  });

  test.each([
    ["a word", "linux", true],
    ["a version", "0.161.1", true],
    ["an empty string", "", false],
    ["blanks", " \t ", false],
    ["zero", 0, true],
    ["a count", 212, true],
    ["not a number", Number.NaN, false],
    ["no end", Number.POSITIVE_INFINITY, false],
    ["true", true, true],
    ["false, which a resource reported", false, true],
    ["a date", new Date("2026-11-02T08:00:00.000Z"), true],
    ["a list", ["10.0.0.4"], true],
    ["an empty list", [], false],
    ["an object", { name: "probe-eu" }, true],
    ["null", null, false],
    ["nothing", undefined, false],
  ] as Array<[string, unknown, boolean]>)(
    "%s: reported is %s",
    (_name: string, value: unknown, reported: boolean) => {
      expect(isReportedDetailValue(value)).toBe(reported);
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * The Overviews whose Details are their record's columns
 * ---------------------------------------------------------------------------
 */
interface RecordPage {
  name: string;
  overview: string;
  model: string;
  title: string;
  settings: string;
  settingsPage: string;
  // The first fact: the identifier the telemetry matches it by, if any.
  identifier: string | null;
}

const RECORD_PAGES: Array<RecordPage> = [
  {
    name: "Docker host",
    overview: "Pages/Docker/View/Overview.tsx",
    model: "DockerHost",
    title: "Docker Host Details",
    settings: "Pages/Docker/View/Settings.tsx",
    settingsPage: "DOCKER_HOST_VIEW_SETTINGS",
    identifier: "hostIdentifier",
  },
  {
    name: "Podman host",
    overview: "Pages/Podman/View/Overview.tsx",
    model: "PodmanHost",
    title: "Podman Host Details",
    settings: "Pages/Podman/View/Settings.tsx",
    settingsPage: "PODMAN_HOST_VIEW_SETTINGS",
    identifier: "hostIdentifier",
  },
  {
    name: "Kubernetes cluster",
    overview: "Pages/Kubernetes/View/Index.tsx",
    model: "KubernetesCluster",
    title: "Cluster Details",
    settings: "Pages/Kubernetes/View/Settings.tsx",
    settingsPage: "KUBERNETES_CLUSTER_VIEW_SETTINGS",
    identifier: "clusterIdentifier",
  },
  {
    name: "vCenter",
    overview: "Pages/VMware/View/Index.tsx",
    model: "VMwareVCenter",
    title: "vCenter Details",
    settings: "Pages/VMware/View/Settings.tsx",
    settingsPage: "VMWARE_VCENTER_VIEW_SETTINGS",
    identifier: null,
  },
  {
    name: "Proxmox cluster",
    overview: "Pages/Proxmox/View/Index.tsx",
    model: "ProxmoxCluster",
    title: "Cluster Details",
    settings: "Pages/Proxmox/View/Settings.tsx",
    settingsPage: "PROXMOX_CLUSTER_VIEW_SETTINGS",
    identifier: null,
  },
  {
    name: "Ceph cluster",
    overview: "Pages/Ceph/View/Index.tsx",
    model: "CephCluster",
    title: "Ceph Cluster Details",
    settings: "Pages/Ceph/View/Settings.tsx",
    settingsPage: "CEPH_CLUSTER_VIEW_SETTINGS",
    identifier: "fsid",
  },
  {
    name: "Storage array",
    overview: "Pages/StorageArray/View/Index.tsx",
    model: "StorageArray",
    title: "Storage Array Details",
    settings: "Pages/StorageArray/View/Settings.tsx",
    settingsPage: "STORAGE_ARRAY_VIEW_SETTINGS",
    identifier: null,
  },
  {
    name: "Host",
    overview: "Pages/Host/View/Overview.tsx",
    model: "Host",
    title: "Host Details",
    settings: "Pages/Host/View/Settings.tsx",
    settingsPage: "HOST_VIEW_SETTINGS",
    identifier: "hostIdentifier",
  },
];

// The row titles that said what the hero and the header say.
const REPEATED_ROW_TITLES: ReadonlyArray<string> = [
  "Name",
  "Display Name",
  "Cluster Name",
  "vCenter Name",
  "Description",
  "Last Seen",
  "Labels",
  "Collector Status",
];

describe.each(RECORD_PAGES)("$name Overview", (page: RecordPage) => {
  const source: ts.SourceFile = parse(page.overview);
  const squashed: string = code(page.overview);
  const cards: Array<JsxTag> = jsxTagsNamed(
    source,
    "ResourceRecordDetailsCard",
  );

  test("draws its Details through ResourceRecordDetailsCard, once, of its own record", () => {
    expect(cards).toHaveLength(1);
    expect(squashed).toContain(`<ResourceRecordDetailsCard<${page.model}>`);
    expect(attributeText(cards[0]!, "modelType")).toBe(`{${page.model}}`);
    expect(attributeText(cards[0]!, "modelId")).toBe("{modelId}");
    // A page's refresh reads it again.
    expect(attributeText(cards[0]!, "refresher")).toBe("{detailsRefresher}");
  });

  test("no details card of its own any more: no CardModelDetail, no Detail, no labels row", () => {
    expect(squashed).not.toContain("<CardModelDetail");
    expect(squashed).not.toContain(
      'from "Common/UI/Components/ModelDetail/CardModelDetail"',
    );
    expect(squashed).not.toContain('from "Common/UI/Components/Detail/Detail"');
    expect(squashed).not.toContain("<LabelsElement");
  });

  test("its title is the card's on its Settings page, where what it leaves out is edited", () => {
    expect(stringAttribute(cards[0]!, "title")).toBe(page.title);
    expect(code(page.settings)).toContain(`title="${page.title}"`);
    expect(untranslatedIn(page.title)).toEqual([]);
  });

  test("Edit in Settings opens its own Settings page", () => {
    const settingsRoute: string = tight(
      attributeText(cards[0]!, "settingsRoute").replace(/\s+/g, " "),
    );
    expect(settingsRoute).toContain(`PageMap.${page.settingsPage}`);
  });

  test("its facts are what the resource reported: none the hero or the header says", () => {
    const facts: Array<Fact> = factsOf(cards[0]!);
    expect(facts.length).toBeGreaterThan(0);

    for (const fact of facts) {
      expect({ title: fact.title, columns: fact.columns.length }).toEqual({
        title: fact.title,
        columns: 1,
      });
      expect({
        title: fact.title,
        repeats: fact.columns.filter(isRepeatedHeroColumn),
      }).toEqual({ title: fact.title, repeats: [] });
      expect(REPEATED_ROW_TITLES).not.toContain(fact.title);
    }
  });

  test("a fact it has not reported is no row: no placeholder, no Not reported, no dash", () => {
    for (const fact of factsOf(cards[0]!)) {
      expect({ title: fact.title, properties: fact.properties }).toEqual({
        title: fact.title,
        properties: expect.not.arrayContaining(["placeholder"]),
      });
      expect(fact.text).not.toContain("Not reported");
      expect(fact.text).not.toContain("—");
    }
    expect(squashed).not.toContain('placeholder="Not reported"');
  });

  test("its identifier, when it has one, is the first fact: whole, and to copy", () => {
    const facts: Array<Fact> = factsOf(cards[0]!);
    if (page.identifier) {
      expect(facts[0]!.columns).toEqual([page.identifier]);
    }
  });

  test("its facts' labels are Title Case, each a key of every language", () => {
    for (const fact of factsOf(cards[0]!)) {
      expect({ label: fact.title, titleCase: isTitleCase(fact.title) }).toEqual(
        { label: fact.title, titleCase: true },
      );
      expect(untranslatedIn(fact.title)).toEqual([]);
    }
  });

  test("its description is the hero's line, under its name, read with the page", () => {
    expect(squashed).toContain("<ResourceHeroDescription text={");
    expect(squashed).toMatch(/select: \{[^}]*description: true,/);
  });
});

test("every page that draws ResourceRecordDetailsCard is held to these rules", () => {
  const drawers: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.name.endsWith(".tsx") &&
        fs.readFileSync(full, "utf8").includes("<ResourceRecordDetailsCard")
      ) {
        drawers.push(
          path.relative(DASHBOARD_SRC, full).split(path.sep).join("/"),
        );
      }
    }
  };
  walk(path.join(DASHBOARD_SRC, "Pages"));

  expect(drawers.sort()).toEqual(
    RECORD_PAGES.map((page: RecordPage): string => {
      return page.overview;
    }).sort(),
  );
});

describe("the card itself", () => {
  const card: string = code(
    "Components/TelemetryResource/ResourceRecordDetailsCard.tsx",
  );

  test("hands its detail the two columns, the empty line, the facts with their rule and the ID line", () => {
    expect(card).toContain(
      "showDetailsInNumberOfColumns: RESOURCE_RECORD_DETAILS_COLUMNS,",
    );
    expect(card).toContain(
      "emptyMessage: RESOURCE_RECORD_DETAILS_EMPTY_MESSAGE,",
    );
    expect(card).toContain(
      "fields: getResourceRecordDetailFields<TBaseModel>(props.facts),",
    );
    expect(card).toContain(
      "return isReportedDetailValue( (item as unknown as Record<string, unknown>)[column], );",
    );
    expect(card).toContain(
      '{ field: { _id: true, } as Select<TBaseModel>, title: "ID", fieldType: FieldType.ObjectID, },',
    );
  });

  test("Edit in Settings in its header, and the labels a phone's card under it", () => {
    expect(card).toContain(
      '<EditInSettingsLink key="edit-in-settings" to={props.settingsRoute} />',
    );
    expect(card).toContain("labels: { name: true, color: true, },");
    expect(card).toContain("<ResourceLabelsCard labels={labels} />");
    // The same card ResourceOverview draws.
    expect(code("Components/TelemetryResource/ResourceOverview.tsx")).toContain(
      "<ResourceLabelsCard labels={props.labels} />",
    );
    expect(
      code("Components/TelemetryResource/ResourceLabelsCard.tsx"),
    ).toContain(
      'data-testid={RESOURCE_LABELS_TEST_ID} className="mt-6 sm:hidden"',
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * A host's four detail cards are one
 * ---------------------------------------------------------------------------
 */
describe("a host's Overview has one Host Details card", () => {
  const overview: string = code("Pages/Host/View/Overview.tsx");

  test("no Identification, Hardware & Runtime, Operating System or Network card", () => {
    for (const title of [
      "Identification",
      "Hardware & Runtime",
      "Operating System",
      "Network",
    ]) {
      expect(overview).not.toContain(`title="${title}"`);
    }
    expect(overview).not.toContain('id="host-identification"');
    expect(overview).not.toContain('id="host-hardware"');
  });

  test("their facts are its rows, the addresses across both columns", () => {
    const facts: Array<Fact> = factsOf(
      jsxTagsNamed(
        parse("Pages/Host/View/Overview.tsx"),
        "ResourceRecordDetailsCard",
      )[0]!,
    );

    expect(
      facts.map((fact: Fact): string => {
        return fact.title;
      }),
    ).toEqual([
      "Host Name (host.name)",
      "Host Type",
      "OS Type",
      "OS Version",
      "Architecture",
      "CPU Cores",
      "Total Memory",
      "Container Runtime",
      // When it last started (#5535), the hero's "Up 12d 4h" as a date.
      "Booted",
      "Process Count (cached)",
      "Agent Version",
      "IP Addresses",
    ]);
    const addresses: Fact = facts[facts.length - 1]!;
    expect(addresses.text.replace(/\s+/g, " ")).toContain("colSpan: 2,");
  });

  test("drawn once the host is read: a host that is not found has nothing to detail", () => {
    expect(overview).toContain("{host ? ( <ResourceRecordDetailsCard<Host>");
  });

  test("its agent's upgrade guide still knows the host's OS and whether a manager runs it", () => {
    expect(overview).toContain(
      "selectMoreFields={{ collectorInstanceUid: true, }}",
    );
    expect(tight(overview)).toContain(
      "upgradeGuideContext={{ hostOsType: item.osType, isHostCollectorManaged: Boolean(item.collectorInstanceUid), }}",
    );
  });
});

describe("a Ceph cluster's fsid reads as one label on both pages", () => {
  test("Cluster FSID on the Overview and on Settings", () => {
    expect(code("Pages/Ceph/View/Index.tsx")).toContain(
      'title: "Cluster FSID",',
    );
    expect(code("Pages/Ceph/View/Settings.tsx")).toContain(
      'title: "Cluster FSID",',
    );
    expect(read("Pages/Ceph/View/Index.tsx")).not.toContain("Cluster fsid");
    expect(read("Pages/Ceph/View/Settings.tsx")).not.toContain("Cluster fsid");
  });
});

/*
 * ---------------------------------------------------------------------------
 * No Quick Links card repeats the side menu
 * ---------------------------------------------------------------------------
 */
interface QuickLinksPage {
  name: string;
  overview: string;
  sideMenu: string;
  // The pages the Quick Links card linked to.
  formerLinks: Array<string>;
}

const QUICK_LINKS_PAGES: Array<QuickLinksPage> = [
  {
    name: "Docker host",
    overview: "Pages/Docker/View/Overview.tsx",
    sideMenu: "Pages/Docker/View/SideMenu.tsx",
    formerLinks: [
      "DOCKER_HOST_VIEW_CONTAINERS",
      "DOCKER_HOST_VIEW_METRICS",
      "DOCKER_HOST_VIEW_LOGS",
    ],
  },
  {
    name: "Podman host",
    overview: "Pages/Podman/View/Overview.tsx",
    sideMenu: "Pages/Podman/View/SideMenu.tsx",
    formerLinks: [
      "PODMAN_HOST_VIEW_CONTAINERS",
      "PODMAN_HOST_VIEW_METRICS",
      "PODMAN_HOST_VIEW_LOGS",
    ],
  },
  {
    name: "Ceph cluster",
    overview: "Pages/Ceph/View/Index.tsx",
    sideMenu: "Pages/Ceph/View/SideMenu.tsx",
    formerLinks: [
      "CEPH_CLUSTER_VIEW_OSDS",
      "CEPH_CLUSTER_VIEW_POOLS",
      "CEPH_CLUSTER_VIEW_DAEMONS",
      "CEPH_CLUSTER_VIEW_METRICS",
    ],
  },
  {
    name: "Storage array",
    overview: "Pages/StorageArray/View/Index.tsx",
    sideMenu: "Pages/StorageArray/View/SideMenu.tsx",
    formerLinks: [
      "STORAGE_ARRAY_VIEW_VOLUMES",
      "STORAGE_ARRAY_VIEW_HOSTS",
      "STORAGE_ARRAY_VIEW_FILE_SYSTEMS",
      "STORAGE_ARRAY_VIEW_BUCKETS",
      "STORAGE_ARRAY_VIEW_HARDWARE",
      "STORAGE_ARRAY_VIEW_METRICS",
    ],
  },
];

describe.each(QUICK_LINKS_PAGES)(
  "$name Overview: no Quick Links",
  (page: QuickLinksPage) => {
    test("draws no Quick Links card", () => {
      const overview: string = code(page.overview);
      expect(overview).not.toContain("Quick Links");
      expect(overview).not.toContain("renderQuickLink");
      expect(overview).not.toContain("Jump to key views");
    });

    /*
     * As a menu item's route, or - a storage array's inventory pages, which
     * the menu offers only for a platform that has them, as the card did -
     * as an entry of the menu's inventory list.
     */
    test.each(page.formerLinks)(
      "%s, which the card linked to, is in the side menu",
      (pageKey: string) => {
        const sideMenu: string = tight(code(page.sideMenu));
        expect(
          sideMenu.includes(`RouteMap[PageMap.${pageKey}]`) ||
            sideMenu.includes(`pageKey: PageMap.${pageKey},`),
        ).toBe(true);
      },
    );
  },
);

test("no Dashboard page draws a Quick Links card", () => {
  const found: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.name.endsWith(".tsx") &&
        fs.readFileSync(full, "utf8").includes('title="Quick Links"')
      ) {
        found.push(path.relative(DASHBOARD_SRC, full));
      }
    }
  };
  walk(path.join(DASHBOARD_SRC, "Pages"));

  expect(found).toEqual([]);
});

/*
 * ---------------------------------------------------------------------------
 * ResourceOverview's Details: one casing, a line of its own, its words
 * ---------------------------------------------------------------------------
 */
interface OverviewPage {
  name: string;
  file: string;
  /*
   * Whether its rows are the resource attributes its telemetry reported
   * (RESOURCE_OVERVIEW_DETAILS_DESCRIPTION), or come from somewhere else
   * and the page says where.
   */
  rowsAreResourceAttributes: boolean;
}

const OVERVIEW_PAGES: Array<OverviewPage> = [
  {
    name: "Service",
    file: "Pages/Service/View/Index.tsx",
    rowsAreResourceAttributes: true,
  },
  {
    name: "Serverless function",
    file: "Pages/Serverless/View/Overview.tsx",
    rowsAreResourceAttributes: true,
  },
  {
    name: "Cloud environment",
    file: "Pages/AppPlatforms/View/Overview.tsx",
    rowsAreResourceAttributes: true,
  },
  {
    name: "Database",
    file: "Pages/Database/View/Overview.tsx",
    rowsAreResourceAttributes: false,
  },
  {
    name: "Queue",
    file: "Pages/MessageQueue/View/Overview.tsx",
    rowsAreResourceAttributes: false,
  },
  {
    name: "RUM application",
    file: "Pages/Rum/View/Overview.tsx",
    rowsAreResourceAttributes: false,
  },
  {
    name: "Cloud resource",
    file: "Pages/Cloud/View/MonitoredResourceOverview.tsx",
    rowsAreResourceAttributes: false,
  },
  {
    name: "Cloud account",
    file: "Pages/Cloud/Accounts/View/Overview.tsx",
    rowsAreResourceAttributes: false,
  },
];

/*
 * The label of every row a page builds for its Details card: in the
 * `detailRows` array it writes, and in each `detailRows.push(...)`.
 */
function detailRowLabels(file: string): Array<string> {
  const source: ts.SourceFile = parse(file);
  const containers: Array<ts.Node> = [];

  visit(source, (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === "detailRows" &&
      node.initializer
    ) {
      containers.push(node.initializer);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText() === "detailRows.push"
    ) {
      containers.push(node);
    }
  });

  const labels: Array<string> = [];
  for (const container of containers) {
    visit(container, (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText() === "label" &&
        ts.isStringLiteral(node.initializer)
      ) {
        labels.push(node.initializer.text);
      }
    });
  }
  return labels;
}

// What the page hands ResourceOverview as its Details card's line.
function detailsDescriptionOf(file: string): string {
  const cards: Array<JsxTag> = jsxTagsNamed(parse(file), "ResourceOverview");
  expect(cards).toHaveLength(1);
  return attributeText(cards[0]!, "detailsDescription").replace(/\s+/g, " ");
}

// The English of a `translationKey("...")` the page writes, if it is one.
function translationKeyText(expression: string): string | null {
  const match: RegExpMatchArray | null = expression.match(
    /^\{translationKey\( ?"([^"]+)",? ?\)\}$/,
  );
  return match ? match[1]! : null;
}

describe.each(OVERVIEW_PAGES)(
  "$name Overview's Details card",
  (page: OverviewPage) => {
    const labels: Array<string> = detailRowLabels(page.file);

    test("has rows to read", () => {
      expect(labels.length).toBeGreaterThan(0);
    });

    test("every row's label is Title Case: one casing on every resource's card", () => {
      expect(
        labels.filter((label: string): boolean => {
          return !isTitleCase(label);
        }),
      ).toEqual([]);
    });

    test("every row's label is a key of every language, Persian's included", () => {
      for (const label of labels) {
        expect(untranslatedIn(label)).toEqual([]);
      }
    });

    test("its line says where its rows come from, in the reader's language", () => {
      const description: string = detailsDescriptionOf(page.file);

      if (page.rowsAreResourceAttributes) {
        expect(description).toBe("{RESOURCE_OVERVIEW_DETAILS_DESCRIPTION}");
        return;
      }

      // Never the resource attributes' line, about rows that are not.
      expect(description).not.toContain(
        "RESOURCE_OVERVIEW_DETAILS_DESCRIPTION",
      );
      const english: string | null = translationKeyText(description);
      expect(english).not.toBeNull();
      expect(english).not.toBe(
        "Metadata captured from OpenTelemetry resource attributes.",
      );
      expect(untranslatedIn(english!)).toEqual([]);
    });
  },
);

test("every Overview drawn with ResourceOverview says where its rows come from", () => {
  const component: string = code(
    "Components/TelemetryResource/ResourceOverview.tsx",
  );

  // Required: no page can leave it out and fall back to another's line.
  expect(component).toContain("detailsDescription: string;");
  expect(component).toContain(
    '<Card title="Details" description={props.detailsDescription}',
  );
  expect(component).not.toContain("props.detailsDescription ||");
  expect(
    untranslatedIn("Metadata captured from OpenTelemetry resource attributes."),
  ).toEqual([]);
});

describe("the database's and the queue's own labels", () => {
  test("the database's: Discovered From, Runs On, Engine Metrics, Agent Version", () => {
    const labels: Array<string> = detailRowLabels(
      "Pages/Database/View/Overview.tsx",
    );
    expect(labels).toEqual([
      "Engine (db.system.name)",
      "Version",
      "Discovered From",
      "Endpoints",
      "Runs On",
      "Workload",
      "Engine Metrics",
      "Agent Version",
      "Engine Metrics Last Received",
    ]);
  });

  test("the queue's: no Last Seen row, the hero says when it was last seen", () => {
    const labels: Array<string> = detailRowLabels(
      "Pages/MessageQueue/View/Overview.tsx",
    );
    expect(labels).not.toContain("Last Seen");
    expect(labels).not.toContain("Last seen");
    expect(labels).toEqual(
      expect.arrayContaining([
        "Messaging System",
        "Broker Address",
        "Discovered From",
        "Broker Metrics Last Received",
        "Queue Identifier",
      ]),
    );
  });

  test("the RUM application's: Recording Health, as its other rows", () => {
    expect(detailRowLabels("Pages/Rum/View/Overview.tsx")).toContain(
      "Recording Health",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * The product's own words, in the reader's language
 * ---------------------------------------------------------------------------
 */
describe("the product's words in Details values and the database hero's chips", () => {
  test.each(DATABASE_SERVER_DISCOVERY_SOURCES as Array<string>)(
    "where a database was found (%s) is a key of every language",
    (source: string) => {
      const label: string = getDatabaseServerDiscoverySourceLabel(source);
      expect(label).toBeTruthy();
      expect(untranslatedIn(label)).toEqual([]);
    },
  );

  test.each(MESSAGE_QUEUE_DISCOVERY_SOURCES as Array<string>)(
    "where a queue was found (%s) is a key of every language",
    (source: string) => {
      const label: string = getMessageQueueDiscoverySourceLabel(source);
      expect(label).toBeTruthy();
      expect(untranslatedIn(label)).toEqual([]);
    },
  );

  test.each(Object.values(CLOUD_RESOURCE_CATEGORY_LABELS))(
    "a cloud resource's category %s is a key of every language",
    (category: string) => {
      expect(untranslatedIn(category)).toEqual([]);
    },
  );

  test.each(["Connected", "Disconnected", "Not connected"])(
    "the engine metrics status %s is a key of every language",
    (status: string) => {
      expect(untranslatedIn(status)).toEqual([]);
    },
  );

  test("the extractor reads the words where they are made", () => {
    for (const file of [
      "packages/Common/Types/DatabaseServer/DatabaseServerDiscoverySource.ts",
      "packages/Common/Models/DatabaseModels/MessageQueue.ts",
      "packages/Common/Types/Cloud/CloudResourceCatalog.ts",
    ]) {
      expect(SOURCE_ROOTS).toContainEqual({ directory: file, kind: "keys" });
    }
  });

  test("a database's Overview draws where it was found and its engine metrics in the reader's language, in its chips and its rows", () => {
    const overview: string = code("Pages/Database/View/Overview.tsx");

    expect(overview).toContain(
      "const discoveredFrom: string = translator.translateText(discoverySourceLabel) || discoverySourceLabel;",
    );
    expect(overview).toContain(
      "const engineMetricsWords: string = translator.translateText(engineStatusLabel) || engineStatusLabel;",
    );
    // The chips.
    expect(overview).toContain(
      "{ icon: IconProp.Search, label: discoveredFrom, }",
    );
    expect(overview).toContain(
      'label: translator.translateTemplate("Engine metrics: {{status}}", { status: translatableTerm(engineStatusLabel), }),',
    );
    // The rows.
    expect(overview).toContain(
      '{ label: "Discovered From", value: discoveredFrom, mono: false, }',
    );
    expect(overview).toContain(
      '{ label: "Engine Metrics", value: engineMetricsWords, mono: false, }',
    );
    expect(untranslatedIn("Engine metrics: {{status}}")).toEqual([]);
  });

  test("a queue's Overview draws where it was found in the reader's language", () => {
    const overview: string = code("Pages/MessageQueue/View/Overview.tsx");

    expect(overview).toContain(
      "const discoveryLabel: string = translator.translateText(discoverySourceLabel) || discoverySourceLabel;",
    );
    expect(overview).toContain(
      '{ label: "Discovered From", value: discoveryLabel, mono: false }',
    );
  });

  test("the database and queue lists draw it in the reader's language too", () => {
    expect(code("Pages/Database/Databases.tsx")).toContain(
      "{translator.translateText(discoveredFrom) || discoveredFrom}",
    );
    expect(code("Pages/MessageQueue/MessageQueues.tsx")).toContain(
      "{translator.translateText(discoveredFrom) || discoveredFrom}",
    );
  });

  test("a cloud resource's Overview draws its category in the reader's language", () => {
    expect(code("Pages/Cloud/View/MonitoredResourceOverview.tsx")).toContain(
      "translator.translateText( CLOUD_RESOURCE_CATEGORY_LABELS[descriptor.category], ) || CLOUD_RESOURCE_CATEGORY_LABELS[descriptor.category]",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * TechStackView is gone
 * ---------------------------------------------------------------------------
 */
const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
const TECH_STACK_VIEW_USE: RegExp = /TechStackView|MORE_TECHNOLOGIES_TEMPLATE/;

describe("TechStackView, which nothing drew, is gone", () => {
  test("the file and every use of it", () => {
    expect(
      fs.existsSync(
        path.join(
          DASHBOARD_SRC,
          "Components",
          "TechStack",
          "TechStackView.tsx",
        ),
      ),
    ).toBe(false);

    const users: Array<string> = [];
    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "Locales") {
            walk(full);
          }
        } else if (
          TYPESCRIPT_FILE.test(entry.name) &&
          TECH_STACK_VIEW_USE.test(fs.readFileSync(full, "utf8"))
        ) {
          users.push(path.relative(DASHBOARD_SRC, full));
        }
      }
    };
    walk(DASHBOARD_SRC);

    expect(users).toEqual([]);
  });

  test("and its plural sentence, which only it said, in every language", () => {
    for (const key of [
      "{{count}} more technologies",
      "{{count}} more technologies_one",
    ]) {
      expect(ENGLISH[key]).toBeUndefined();
      for (const language of LANGUAGES) {
        expect({ code: language.code, has: key in language.words }).toEqual({
          code: language.code,
          has: false,
        });
      }
    }
  });
});
