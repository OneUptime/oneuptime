// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_RESOURCE_TYPES,
  CloudResourceTypeDescriptor,
  NAMED_ONLY_RESOURCE_TYPES,
  getCloudResourceTypeText,
} from "../../../Types/Cloud/CloudResourceCatalog";
import { Translator } from "../../../Types/Translator";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { getCloudResourceTypeOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceTypeOptions";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A CLOUD RESOURCE TYPE IS NAMED ONE WAY ON EVERY PAGE (#7659).
 *
 * The cloud resource catalog's labels are the clouds' product names -
 * "Virtual Machine", "EC2 Instance", "Cloud Run Service" - and every page
 * draws them as written, in every language, as the docs' tables list them
 * and as a resource's name carries them ("web-01 (Virtual Machine)"). Only
 * a named only type's label ("Subnet", "Security Group") is a common noun,
 * drawn in the reader's language (getCloudResourceTypeText). A few labels
 * are keys of the locale files for words of their own elsewhere ("Virtual
 * Machine" names a vCenter's machines), so a page that looked a label up
 * drew "Máquina virtual" where the next drew "Virtual Machine": a
 * resource's Connected Resources and an account's Type filter did, and
 * that filter's chip and rows did not.
 *
 * Every file of the Dashboard that reads the catalog's names is listed here
 * with how it draws them, so a new page says which rule it keeps or fails
 * here; no file looks a type's name up, and a Type filter's options are
 * getCloudResourceTypeOptions', drawn as written.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

// The Dashboard, and the Common components it draws with.
const SCANNED_FOLDERS: ReadonlyArray<string> = [
  DASHBOARD,
  "packages/Common/UI",
];

const SKIPPED_FOLDER_NAMES: ReadonlyArray<string> = ["node_modules", "Locales"];

const SOURCE_FILE: RegExp = /\.tsx?$/;

// What the catalog names a type by: its labels, its lists and its lookups.
const NAMING_EXPORTS: ReadonlyArray<string> = [
  "AWS_RESOURCE_TYPES",
  "AZURE_RESOURCE_TYPES",
  "CLOUD_RESOURCE_TYPES",
  "GCP_MONITORED_RESOURCE_RULES",
  "INVENTORY_ONLY_RESOURCE_TYPES",
  "NAMED_ONLY_RESOURCE_TYPES",
  "getCloudResourceTypeDescriptor",
  "getCloudResourceTypeDisplayName",
  "getCloudResourceTypeLabel",
  "getCloudResourceTypeText",
  "getReadableCloudResourceType",
];

const CATALOG_IMPORT: RegExp =
  /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"[^"]*Types\/Cloud\/CloudResourceCatalog"/g;

// The calls that look a word up in the reader's language.
const LOOKUP_CALL: string =
  "\\b(?:translateText|translateTerm|translateString|translatableTerm|tx)\\(\\s*";

// A call that draws a site's names, in the file it is in.
interface NameDrawing {
  file: string;
  call: RegExp;
}

type NameSite =
  | { asWritten: string; drawnBy?: ReadonlyArray<NameDrawing> }
  | { inReadersLanguage: string; drawnBy: ReadonlyArray<NameDrawing> }
  | { asOptions: string; drawnBy: ReadonlyArray<NameDrawing> };

const SITES: Readonly<Record<string, NameSite>> = {
  [`${DASHBOARD}/Components/Cloud/CloudResourceInventoryCards.tsx`]: {
    inReadersLanguage:
      "A connected resource's kind on Connected Resources - the one page that names a named only type, which reads in the reader's language - through getCloudResourceTypeText, drawn as it comes.",
    drawnBy: [
      {
        file: `${DASHBOARD}/Components/Cloud/CloudResourceInventoryCards.tsx`,
        call: /getCloudResourceTypeText\(\s*provider,\s*relationship\.otherType,\s*translator,?\s*\)/,
      },
      {
        file: `${DASHBOARD}/Components/Cloud/CloudResourceInventoryCards.tsx`,
        call: /<bdi>\{typeLabel\}<\/bdi>/,
      },
    ],
  },
  [`${DASHBOARD}/Components/Cloud/CloudResourceTypeOptions.ts`]: {
    asOptions:
      "The Type filters' options, an account's and All Resources': the menu draws them as written (isUserContent), as the chip above the table and the rows do.",
    drawnBy: [
      {
        file: `${DASHBOARD}/Components/Cloud/CloudResourceTypeOptions.ts`,
        call: /isUserContent: true/,
      },
      {
        file: `${DASHBOARD}/Pages/Cloud/Accounts/View/Resources.tsx`,
        call: /getCloudResourceTypeOptions\(provider\)/,
      },
      {
        file: `${DASHBOARD}/Pages/Cloud/MonitoredResources.tsx`,
        call: /getCloudResourceTypeOptions\(null\)/,
      },
    ],
  },
  [`${DASHBOARD}/Components/Cloud/CloudResourceAttention.ts`]: {
    asWritten:
      "The kind on a Needs attention row, which the card draws as written (kindAsWritten).",
    drawnBy: [
      {
        file: `${DASHBOARD}/Components/Cloud/CloudResourceAttention.ts`,
        call: /kindAsWritten: true/,
      },
      {
        file: `${DASHBOARD}/Components/ResourcePart/NeedsAttentionCard.tsx`,
        call: /item\.kindAsWritten \? \(\s*<bdi>\{item\.kind\}<\/bdi>/,
      },
    ],
  },
  [`${DASHBOARD}/Components/Cloud/Connect/CloudConnectionWords.ts`]: {
    asWritten:
      'A connection\'s resources by service ("Virtual Machine 12"), each a chip of CloudResourceGroups.',
    drawnBy: [
      {
        file: `${DASHBOARD}/Components/Cloud/Connect/CloudResourceGroups.tsx`,
        call: /<span className="truncate">\{label\}<\/span>/,
      },
    ],
  },
  [`${DASHBOARD}/Components/Monitor/Overview/MonitorCloudLinkSuggestions.tsx`]:
    {
      asWritten:
        "A cloud resource a monitor could be linked to: its kind beside its name.",
    },
  [`${DASHBOARD}/Components/Recommendations/CloudAccountRecommendationPlan.ts`]:
    {
      asWritten:
        "A type's group of recommended monitors and a resource left without one, set apart in their lines (IsolatedText) and given to their sentences as values.",
      drawnBy: [
        {
          file: `${DASHBOARD}/Components/Recommendations/CloudAccountMonitorRecommendations.tsx`,
          call: /<IsolatedText text=\{group\.label\} \/>/,
        },
        {
          file: `${DASHBOARD}/Components/Recommendations/CloudAccountMonitorRecommendations.tsx`,
          call: /<IsolatedText text=\{gap\.typeLabel\} \/>/,
        },
      ],
    },
  [`${DASHBOARD}/Components/Recommendations/RecommendationResourceRegistry.ts`]:
    {
      asWritten:
        'The type in "OneUptime has no recommended monitors for {{type}} yet", a value its sentence takes as it is.',
    },
  [`${DASHBOARD}/Components/ResourceTopology/Builders/CloudAccountTopology.ts`]:
    {
      asWritten:
        "A resource's card on the account's topology: the line under its name (a node's context, which is never looked up), and its name when it has none.",
    },
  [`${DASHBOARD}/Pages/Cloud/Accounts/View/Overview.tsx`]: {
    asWritten:
      "Resources by Type: a ranked row each, whose label RankedBars draws as it comes.",
  },
  [`${DASHBOARD}/Pages/Cloud/Accounts/View/Resources.tsx`]: {
    asWritten:
      "The type under each resource's name, in the line that says where it is.",
  },
  [`${DASHBOARD}/Pages/Cloud/Archived.tsx`]: {
    asWritten: "The Type column of archived resources.",
  },
  [`${DASHBOARD}/Pages/Cloud/MonitoredResources.tsx`]: {
    asWritten:
      "The type under each resource's name on All Resources, beside its service model's pill.",
  },
  [`${DASHBOARD}/Pages/Cloud/View/MonitoredResourceOverview.tsx`]: {
    asWritten:
      "A resource's own page: its type under its name, and its name when it has none (ResourceOverview draws both as they come).",
  },
};

function sourceFiles(folder: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(path.join(REPOSITORY_ROOT, folder), {
    withFileTypes: true,
  })) {
    const relative: string = `${folder}/${entry.name}`;

    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDER_NAMES.includes(entry.name)) {
        files.push(...sourceFiles(relative));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(relative);
    }
  }

  return files;
}

function readSource(file: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

// The catalog's names a file imports.
function namingImports(source: string): Array<string> {
  const names: Array<string> = [];

  for (const match of source.matchAll(CATALOG_IMPORT)) {
    for (const part of (match[1] || "").split(",")) {
      const name: string = part.trim().split(/\s+as\s+/)[0] || "";

      if (NAMING_EXPORTS.includes(name)) {
        names.push(name);
      }
    }
  }

  return names;
}

// Every file that reads the catalog's names, with the names it reads.
const NAMING_FILES: Map<string, Array<string>> = new Map<
  string,
  Array<string>
>();

for (const folder of SCANNED_FOLDERS) {
  for (const file of sourceFiles(folder)) {
    const names: Array<string> = namingImports(readSource(file));

    if (names.length > 0) {
      NAMING_FILES.set(file, names);
    }
  }
}

/*
 * What a file looks up that holds a type's name: a name call or a
 * descriptor's label put straight into a lookup, or a variable a name call
 * filled ("const typeLabel: string = getCloudResourceTypeDisplayName(...)").
 */
function lookedUpNames(source: string): Array<string> {
  const found: Array<string> = [];
  const direct: RegExp = new RegExp(
    `${LOOKUP_CALL}(?:getCloudResourceType\\w*\\(|\\w*[dD]escriptor\\??\\.label\\b)`,
    "g",
  );

  for (const match of source.matchAll(direct)) {
    found.push(match[0]);
  }

  const filled: RegExp =
    /(?:const|let)\s+(\w+)\s*(?::\s*string)?\s*=\s*[^;]*?\bgetCloudResourceType(?:DisplayName|Label|Text)\(/g;

  for (const match of source.matchAll(filled)) {
    const variable: string = match[1] || "";
    const lookup: RegExp = new RegExp(`${LOOKUP_CALL}${variable}\\b`, "g");

    for (const used of source.matchAll(lookup)) {
      found.push(used[0]);
    }
  }

  return found;
}

describe("a cloud resource type's name, as a page draws it", () => {
  // The labels a language has words of its own for, as other keys.
  const keyedLabels: Array<string> = Array.from(
    new Set(
      CLOUD_RESOURCE_TYPES.map(
        (descriptor: CloudResourceTypeDescriptor): string => {
          return descriptor.label;
        },
      ),
    ),
  ).filter((label: string): boolean => {
    return readDashboardLocale("es")[label] !== undefined;
  });

  test("a few of the catalog's labels are keys the locales word their own way", () => {
    expect(keyedLabels).toEqual(
      expect.arrayContaining(["Virtual Machine", "Load Balancer"]),
    );
    expect(readDashboardLocale("es")["Virtual Machine"]).not.toBe(
      "Virtual Machine",
    );
  });

  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "%s draws every listed type by its label, as written",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const redrawn: Array<string> = CLOUD_RESOURCE_TYPES.filter(
        (descriptor: CloudResourceTypeDescriptor): boolean => {
          return (
            getCloudResourceTypeText(
              descriptor.provider,
              descriptor.type,
              translator,
            ) !== descriptor.label
          );
        },
      ).map((descriptor: CloudResourceTypeDescriptor): string => {
        return `${descriptor.provider} ${descriptor.type}`;
      });

      expect(redrawn).toEqual([]);
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s draws a named only type in its own words, but never one a listed type is called",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const listed: Set<string> = new Set(
        CLOUD_RESOURCE_TYPES.map(
          (descriptor: CloudResourceTypeDescriptor): string => {
            return descriptor.label;
          },
        ),
      );

      for (const named of NAMED_ONLY_RESOURCE_TYPES) {
        const drawn: string = getCloudResourceTypeText(
          named.provider,
          named.type,
          translator,
        );

        expect({ type: named.type, drawn }).toEqual({
          type: named.type,
          drawn: listed.has(named.label)
            ? named.label
            : readDashboardLocale(language)[named.label],
        });
      }
    },
  );

  test("in Spanish: a subnet is a subred, a Google Cloud instance group an Instance Group either way", () => {
    const spanish: Translator = dashboardTranslator("es");

    expect(
      getCloudResourceTypeText(CloudProvider.AWS, "AWS::EC2::Subnet", spanish),
    ).toBe(readDashboardLocale("es")["Subnet"]);
    expect(readDashboardLocale("es")["Subnet"]).not.toBe("Subnet");

    // Held by OneUptime (a type the catalog lists), or only linked to.
    for (const type of [
      "instance_group",
      "compute.googleapis.com/InstanceGroup",
    ]) {
      expect(getCloudResourceTypeText(CloudProvider.GCP, type, spanish)).toBe(
        "Instance Group",
      );
    }

    // A type the catalog does not know, in words.
    expect(
      getCloudResourceTypeText(
        CloudProvider.AWS,
        "AWS::EC2::TransitGatewayAttachment",
        spanish,
      ),
    ).toBe("Transit Gateway Attachment (EC2)");
  });
});

describe("a Type filter's options", () => {
  test.each([...Object.values(CloudProvider), null])(
    "%s: every option is a type's label, drawn as written",
    (provider: CloudProvider | null) => {
      const options: Array<DropdownOption> =
        getCloudResourceTypeOptions(provider);
      const types: Array<CloudResourceTypeDescriptor> =
        CLOUD_RESOURCE_TYPES.filter(
          (descriptor: CloudResourceTypeDescriptor): boolean => {
            return provider === null || descriptor.provider === provider;
          },
        );

      expect(options.length).toBe(types.length);

      for (const option of options) {
        const descriptor: CloudResourceTypeDescriptor | undefined = types.find(
          (type: CloudResourceTypeDescriptor): boolean => {
            return type.type === option.value;
          },
        );

        expect({
          option: option.value,
          isUserContent: option.isUserContent,
        }).toEqual({ option: option.value, isUserContent: true });
        expect(option.label.startsWith(descriptor?.label || "?")).toBe(true);
      }
    },
  );
});

describe("every file of the Dashboard that names a type says how it draws it", () => {
  test("is listed here", () => {
    const unlisted: Array<string> = Array.from(NAMING_FILES.entries())
      .filter(([file]: [string, Array<string>]): boolean => {
        return !Object.prototype.hasOwnProperty.call(SITES, file);
      })
      .map(([file, names]: [string, Array<string>]): string => {
        return `${file}: ${names.join(", ")}`;
      });

    expect(unlisted).toEqual([]);
  });

  test("and every file listed still names one", () => {
    expect(
      Object.keys(SITES).filter((file: string): boolean => {
        return !NAMING_FILES.has(file);
      }),
    ).toEqual([]);
  });

  test("none looks a type's name up", () => {
    const lookups: Array<string> = [];

    for (const file of NAMING_FILES.keys()) {
      for (const lookup of lookedUpNames(readSource(file))) {
        lookups.push(`${file}: ${lookup}`);
      }
    }

    expect(lookups).toEqual([]);
  });

  test("and each draws them in the calls named", () => {
    const missing: Array<string> = [];

    for (const [file, site] of Object.entries(SITES)) {
      for (const drawing of site.drawnBy || []) {
        if (!drawing.call.test(readSource(drawing.file))) {
          missing.push(`${file}: ${drawing.file} ${String(drawing.call)}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("a look-up is found where one is written", () => {
    expect(
      lookedUpNames(
        "const typeLabel: string = getCloudResourceTypeDisplayName(provider, type);\nreturn <bdi>{translator.translateText(typeLabel) || typeLabel}</bdi>;",
      ),
    ).toEqual(["translateText(typeLabel"]);
    expect(lookedUpNames("label: tx(descriptor.label),")).toEqual([
      "tx(descriptor.label",
    ]);
    expect(
      lookedUpNames(
        "kind: translator.translateText(getCloudResourceTypeDisplayName(p, t)),",
      ),
    ).toEqual(["translateText(getCloudResourceTypeDisplayName("]);
  });
});
