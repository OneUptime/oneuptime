import {
  cleanJsxText,
  decodeHtmlEntities,
  ExtractedString,
  getEnglishEntries,
  getNestedEnglishEntries,
  HardcodedString,
  isTranslatableText,
  listSourceFiles,
  NestedEnglishEntry,
  scanSourceRoots,
  scanSourceText,
  SOURCE_ROOTS,
  SourceScanResult,
  toRepositoryPath,
  USER_FACING_PROPS,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The Dashboard's string extractor (npm run i18n:extract) reads the source's
 * syntax tree and decides which strings a person reads. These pin each kind
 * of string it takes, the ones it must leave alone, what it reports as still
 * hard-coded, and that the result never depends on the order files are found
 * in. The fixtures are inline sources, so nothing here needs to compile.
 */

const scan: (
  source: string,
  file?: string,
  kind?: "ui" | "models",
) => SourceScanResult = (
  source: string,
  file: string = "packages/App/FeatureSet/Dashboard/src/Pages/Example.tsx",
  kind: "ui" | "models" = "ui",
): SourceScanResult => {
  return scanSourceText(file, source, { kind: kind });
};

const textsOf: (result: SourceScanResult) => Array<string> = (
  result: SourceScanResult,
): Array<string> => {
  return result.strings.map((entry: ExtractedString): string => {
    return entry.text;
  });
};

const kindOf: (result: SourceScanResult, text: string) => string | undefined = (
  result: SourceScanResult,
  text: string,
): string | undefined => {
  return result.strings.find((entry: ExtractedString): boolean => {
    return entry.text === text;
  })?.kind;
};

const hardcodedOf: (
  result: SourceScanResult,
) => Array<{ text: string; reason: string }> = (
  result: SourceScanResult,
): Array<{ text: string; reason: string }> => {
  return result.hardcoded.map(
    (entry: HardcodedString): { text: string; reason: string } => {
      return { text: entry.text, reason: entry.reason };
    },
  );
};

describe("translation calls", () => {
  test("takes the key of every translation helper", () => {
    const result: SourceScanResult = scan(`
      const a = t("Save changes");
      const b = tx("Draft with AI");
      const c = translateString("Not fetched yet");
      const d = translateValue("Open");
      const e = translator.translateText("Rows per page");
      const f = translator.translateTemplate("Page {{page}} of {{pageCount}}", { page: 1 });
      const g = translationKey("Create {{itemName}}");
      const h = translateTemplate("Remove {{name}}?", { name });
      const i = translateGroupingRuleText("Match every incident");
    `);

    expect(textsOf(result)).toEqual([
      "Save changes",
      "Draft with AI",
      "Not fetched yet",
      "Open",
      "Rows per page",
      "Page {{page}} of {{pageCount}}",
      "Create {{itemName}}",
      "Remove {{name}}?",
      "Match every incident",
    ]);
    expect(
      result.strings.every((entry: ExtractedString): boolean => {
        return entry.kind === "call";
      }),
    ).toBe(true);
  });

  test("takes both branches of a choice and the fallback of an ||", () => {
    const result: SourceScanResult = scan(`
      const a = tx(isOpen ? "Hide details" : "Show details");
      const b = translateString(props.title || "Untitled");
      const c = translateString(props.title ?? "No title");
    `);

    expect(textsOf(result)).toEqual([
      "Hide details",
      "Show details",
      "Untitled",
      "No title",
    ]);
  });

  test("reads the template, not the translate function, of translateInterpolated", () => {
    const result: SourceScanResult = scan(`
      const a = translateInterpolated(translateString, count === 1 ? "~{{count}} fetch" : "~{{count}} fetches", { count });
    `);

    expect(textsOf(result)).toEqual(["~{{count}} fetch", "~{{count}} fetches"]);
  });

  test("reads the template of translateNamedAction", () => {
    const result: SourceScanResult = scan(`
      const a = translateNamedAction(translator, {
        template: isCreate ? "Create New {{itemName}}" : "Edit {{itemName}}",
        itemName: model.singularName,
      });
    `);

    expect(textsOf(result)).toEqual([
      "Create New {{itemName}}",
      "Edit {{itemName}}",
    ]);
  });

  test("ignores calls to functions that do not translate", () => {
    const result: SourceScanResult = scan(`
      const a = format("Some text here");
      const b = console.log("Debug message here");
      const c = transform("Not a translation");
    `);

    expect(textsOf(result)).toEqual([]);
  });

  test("a translation key with no letters is not a key", () => {
    expect(
      textsOf(scan(`const a = t("{{count}}"); const b = tx("—");`)),
    ).toEqual([]);
  });
});

describe("nested keys read with t()", () => {
  test("a dotted key with an English default becomes a nested entry", () => {
    const result: SourceScanResult = scan(`
      const a = t("commandPalette.actions.logOut", "Log out");
      const b = t("commandPalette.categories.account", { defaultValue: "Account" });
    `);

    expect(result.strings).toEqual([
      expect.objectContaining({
        text: "Log out",
        nestedPath: ["commandPalette", "actions", "logOut"],
      }),
      expect.objectContaining({
        text: "Account",
        nestedPath: ["commandPalette", "categories", "account"],
      }),
    ]);
    expect(result.nestedKeyReferences).toEqual([]);
  });

  test("a dotted key with no default is reported, not added", () => {
    const result: SourceScanResult = scan(
      `const a = t("navbar.items.formsTitle");`,
    );

    expect(result.strings).toEqual([]);
    expect(result.nestedKeyReferences).toEqual([
      expect.objectContaining({
        path: ["navbar", "items", "formsTitle"],
        line: 1,
      }),
    ]);
  });

  test("other helpers look a sentence with dots up whole", () => {
    expect(
      textsOf(
        scan(
          `const a = translateString("Loading..."); const b = tx("Node.js");`,
        ),
      ),
    ).toEqual(["Loading...", "Node.js"]);
  });
});

describe("plural templates", () => {
  test("an object with one and other is a count-dependent template", () => {
    const result: SourceScanResult = scan(`
      const ROWS: PluralTemplate = {
        one: "{{count}} row",
        other: "{{count}} rows",
      };
    `);

    expect(result.strings).toEqual([
      expect.objectContaining({
        text: "{{count}} rows",
        pluralOne: "{{count}} row",
        kind: "plural",
      }),
    ]);
  });

  test("an object with more than one and other is not", () => {
    expect(
      textsOf(scan(`const a = { one: "a", other: "b", third: "c" };`)),
    ).toEqual([]);
  });
});

describe("user-facing properties and attributes", () => {
  test("takes copy from JSX attributes whose name says they are shown", () => {
    const result: SourceScanResult = scan(`
      const a = (
        <Card
          title="Incident Grouping Rules"
          description="Define rules to group related incidents."
          id="incident-grouping-rules-table"
          name="Settings > Incident Grouping Rules"
          className="mt-4 flex"
          data-testid="grouping-card"
          userPreferencesKey="incident-grouping-rules-table"
        />
      );
    `);

    expect(textsOf(result)).toEqual([
      "Incident Grouping Rules",
      "Define rules to group related incidents.",
    ]);
  });

  test("takes copy from object properties", () => {
    const result: SourceScanResult = scan(`
      const columns = [
        { field: { name: true }, title: "Name", type: FieldType.Text },
        { title: "Time Window (min)", description: "How long to keep grouping." },
        { placeholder: "Select a team", id: "team-dropdown", key: "team" },
      ];
    `);

    expect(textsOf(result)).toEqual([
      "Name",
      "Time Window (min)",
      "How long to keep grouping.",
      "Select a team",
    ]);
    expect(kindOf(result, "Name")).toBe("prop");
  });

  test("a tab's name is copy, a name elsewhere is not", () => {
    const result: SourceScanResult = scan(`
      const a = <Tabs tabs={[{ name: "Overview", children: <div /> }, { name: "Settings" }]} />;
      const b = { tabs: [{ name: "Logs" }] };
      const c = { name: "create-on-call-policy-log" };
    `);

    expect(textsOf(result)).toEqual(["Overview", "Settings", "Logs"]);
  });

  test("decodes HTML entities in an attribute the way React does", () => {
    expect(textsOf(scan(`const a = <Button title="Next &rarr;" />;`))).toEqual([
      "Next →",
    ]);
  });

  test("takes both branches of a conditional attribute", () => {
    expect(
      textsOf(
        scan(
          `const a = <Pill text={item.isEnabled ? "Enabled" : "Disabled"} />;`,
        ),
      ),
    ).toEqual(["Enabled", "Disabled"]);
  });

  test("reads a TranslatedSentence's template", () => {
    expect(
      textsOf(
        scan(
          `const a = <TranslatedSentence template="{{field}} is {{value}}" slots={{}} />;`,
        ),
      ),
    ).toEqual(["{{field}} is {{value}}"]);
  });

  test("leaves the template attribute of other components alone", () => {
    expect(
      textsOf(
        scan(`const a = <MonitorForm template="incident-template-1" />;`),
      ),
    ).toEqual([]);
  });

  test("lists the names it treats as copy", () => {
    for (const name of [
      "title",
      "description",
      "placeholder",
      "label",
      "noItemsMessage",
      "submitButtonText",
      "aria-label",
      "singularName",
      "pluralName",
    ]) {
      expect([name, USER_FACING_PROPS.has(name)]).toEqual([name, true]);
    }

    for (const name of ["id", "name", "key", "className", "type", "value"]) {
      expect([name, USER_FACING_PROPS.has(name)]).toEqual([name, false]);
    }
  });
});

describe("element text", () => {
  test("takes the whole text of an element and reports it as hard-coded", () => {
    const result: SourceScanResult = scan(`
      const a = (
        <div>
          <p>No grouping rules yet.</p>
          <span>
            Rules are evaluated from top to bottom.
          </span>
        </div>
      );
    `);

    expect(textsOf(result)).toEqual([
      "No grouping rules yet.",
      "Rules are evaluated from top to bottom.",
    ]);
    expect(kindOf(result, "No grouping rules yet.")).toBe("jsx-text");
    expect(hardcodedOf(result)).toEqual([
      { text: "No grouping rules yet.", reason: "jsx-text" },
      { text: "Rules are evaluated from top to bottom.", reason: "jsx-text" },
    ]);
  });

  test("joins text that spans lines with single spaces", () => {
    expect(
      textsOf(
        scan(`
          const a = (
            <p>
              Please wait while the bulk action
              is being performed.
            </p>
          );
        `),
      ),
    ).toEqual(["Please wait while the bulk action is being performed."]);
  });

  test("text with values or markup in it is a sentence to compose, not a key", () => {
    const result: SourceScanResult = scan(`
      const a = <p>Showing {count} incidents</p>;
      const b = <p>Click <a href="/x">here</a> to continue.</p>;
    `);

    // The link's own text is whole; the sentence around it is in pieces.
    expect(textsOf(result)).toEqual(["here"]);
    expect(hardcodedOf(result)).toEqual([
      { text: "Showing", reason: "composed" },
      { text: "incidents", reason: "composed" },
      { text: "Click", reason: "composed" },
      { text: "here", reason: "jsx-text" },
      { text: "to continue.", reason: "composed" },
    ]);
  });

  test("a comment beside the text does not make it a fragment", () => {
    expect(
      textsOf(scan(`const a = <p>{/* why */}Nothing to show.</p>;`)),
    ).toEqual(["Nothing to show."]);
  });

  test("code and key names are not copy", () => {
    const result: SourceScanResult = scan(`
      const a = (
        <div>
          <code>npm install</code>
          <pre>kubectl get pods</pre>
          <InlineCode>docker ps</InlineCode>
          <kbd>Esc</kbd>
        </div>
      );
    `);

    expect(textsOf(result)).toEqual([]);
    expect(result.hardcoded).toEqual([]);
  });

  test("a string literal standing in for element text is taken too", () => {
    const result: SourceScanResult = scan(`
      const a = <p>{isEmpty ? "Nothing here yet." : "Loading…"}</p>;
      const b = <p>{"Plain literal"}</p>;
      const c = <p>{isError && "Something went wrong."}</p>;
    `);

    expect(textsOf(result)).toEqual([
      "Nothing here yet.",
      "Loading…",
      "Plain literal",
      "Something went wrong.",
    ]);
  });

  test("decodes entities and drops pure punctuation", () => {
    const result: SourceScanResult = scan(`
      const a = <button>&hellip;</button>;
      const b = <p>Loading&hellip;</p>;
      const c = <span>·</span>;
    `);

    expect(textsOf(result)).toEqual(["Loading…"]);
  });
});

describe("what is still hard-coded", () => {
  test("text attributes of plain HTML elements are reported", () => {
    const result: SourceScanResult = scan(`
      const a = (
        <div>
          <button title="Clear search" aria-label="Clear search">x</button>
          <input placeholder="Search monitors" />
          <img alt="OneUptime logo" />
          <Button title="Save" />
        </div>
      );
    `);

    expect(
      hardcodedOf(result).filter((entry: { text: string; reason: string }) => {
        return entry.reason === "html-attribute";
      }),
    ).toEqual([
      { text: "Clear search", reason: "html-attribute" },
      { text: "Clear search", reason: "html-attribute" },
      { text: "Search monitors", reason: "html-attribute" },
      { text: "OneUptime logo", reason: "html-attribute" },
    ]);
  });

  test("a sentence glued from pieces in a copy position is reported", () => {
    const result: SourceScanResult = scan(`
      const a = <Modal title={\`Delete \${model.singularName}\`} />;
      const b = { description: "Are you sure you want to delete " + name + "?" };
      const c = <p>{\`\${count} incidents\`}</p>;
      const d = <div className={\`flex \${extra}\`} />;
      const e = <Modal title={\`\${a}-\${b}\`} />;
    `);

    expect(textsOf(result)).toEqual([]);
    expect(hardcodedOf(result)).toEqual([
      { text: "`Delete ${model.singularName}`", reason: "composed" },
      {
        text: '"Are you sure you want to delete " + name + "?"',
        reason: "composed",
      },
      { text: "`${count} incidents`", reason: "composed" },
    ]);
  });
});

describe("message setters", () => {
  test("takes the message a state setter shows", () => {
    const result: SourceScanResult = scan(`
      setError("The selected phone number could not be found.");
      setModalTitle("Status Message");
      setEmptyStateMessage("No rows match.");
      setIsLoading("not a message");
      setValue("not a message either");
    `);

    expect(textsOf(result)).toEqual([
      "The selected phone number could not be found.",
      "Status Message",
      "No rows match.",
    ]);
    expect(kindOf(result, "Status Message")).toBe("setter");
  });
});

describe("model metadata", () => {
  const MODEL_FILE: string = "packages/Common/Models/DatabaseModels/Example.ts";

  test("takes a model's names, description and column titles - not column descriptions", () => {
    const result: SourceScanResult = scan(
      `
      @TableMetadata({
        tableName: "IncidentGroupingRule",
        singularName: "Incident Grouping Rule",
        pluralName: "Incident Grouping Rules",
        icon: IconProp.Layers,
        tableDescription: "Group related incidents into episodes",
      })
      export default class Example extends BaseModel {
        @TableColumn({
          type: TableColumnType.ShortText,
          title: "Time Window",
          description: "The API docs say this; the dashboard does not.",
          example: "30",
        })
        public timeWindow?: number = undefined;
      }
    `,
      MODEL_FILE,
      "models",
    );

    expect(textsOf(result)).toEqual([
      "Incident Grouping Rule",
      "Incident Grouping Rules",
      "Group related incidents into episodes",
      "Time Window",
    ]);
    expect(
      result.strings.every((entry: ExtractedString): boolean => {
        return entry.kind === "model" && entry.file === MODEL_FILE;
      }),
    ).toBe(true);
  });

  test("reads analytics models' columns and names too", () => {
    const result: SourceScanResult = scan(
      `
      export default class Log extends AnalyticsBaseModel {
        public constructor() {
          const column = new AnalyticsTableColumn({
            key: "severityText",
            title: "Severity Text",
            description: "Log Severity Text",
          });
          super({ singularName: "Log", pluralName: "Logs", tableColumns: [column] });
        }
      }
    `,
      "packages/Common/Models/AnalyticsModels/Log.ts",
      "models",
    );

    expect(textsOf(result)).toEqual(["Severity Text", "Log", "Logs"]);
  });

  test("a model file is not scanned for page copy", () => {
    expect(
      textsOf(
        scan(`const a = { title: "Not a column" };`, "Model.ts", "models"),
      ),
    ).toEqual([]);
  });
});

describe("isTranslatableText", () => {
  test.each([
    ["Name", true],
    ["alerts", true],
    ["on-call", true],
    ["Loading...", true],
    ["e.g. 5m", true],
    ["{{count}} rows", true],
    ["Search {{itemsName}}… (try @ for labels)", true],
    ["", false],
    ["   ", false],
    ["{{count}}", false],
    ["—", false],
    ["123", false],
    ["createdAt", false],
    ["incident_grouping_rule", false],
    ["incident-grouping-rules-table", false],
    ["resource.ceph.cluster.name", false],
    ["https://oneuptime.com/docs", false],
    ["/dashboard/incidents", false],
    ["#6366f1", false],
    ["flex items-center gap-2", false],
    ["hover:bg-gray-50 text-sm", false],
    ["hidden sm:block", false],
    ["on-call duty policies", true],
    ["to select", true],
    ["font size", true],
    ["props.value()", false],
    ["# Heading\n\nA paragraph.", false],
    ["```bash\nnpm i\n```", false],
  ])("%j -> %s", (text: string, expected: boolean) => {
    expect(isTranslatableText(text, "prop")).toBe(expected);
  });

  test("an explicit translation key is trusted with anything that has a letter", () => {
    expect(isTranslatableText("createdAt", "call")).toBe(true);
    expect(isTranslatableText("# Heading\n\nText", "call")).toBe(true);
    expect(isTranslatableText("{{count}}", "call")).toBe(false);
    expect(isTranslatableText("42", "plural")).toBe(false);
  });
});

describe("cleanJsxText and decodeHtmlEntities", () => {
  test("trims lines where they meet a line break and joins them", () => {
    expect(cleanJsxText("\n   Hello\n   world  \n  ")).toBe("Hello world");
    expect(cleanJsxText("  same line  ")).toBe("  same line  ");
    expect(cleanJsxText("a\n\n\nb")).toBe("a b");
    expect(cleanJsxText("\tTabbed\n")).toBe(" Tabbed");
  });

  test("decodes named and numeric entities and keeps unknown ones", () => {
    expect(decodeHtmlEntities("a &amp; b &lt;c&gt; &quot;d&quot;")).toBe(
      'a & b <c> "d"',
    );
    expect(decodeHtmlEntities("&#169; &#x2192; &nbsp;")).toBe("© →  ");
    expect(decodeHtmlEntities("&unknownentity; stays")).toBe(
      "&unknownentity; stays",
    );
  });
});

describe("en.json entries", () => {
  test("each text maps to itself and a plural adds its one form", () => {
    const strings: Array<ExtractedString> = [
      { text: "Save", kind: "call", file: "a.tsx", line: 1 },
      {
        text: "{{count}} rows",
        pluralOne: "{{count}} row",
        kind: "plural",
        file: "a.tsx",
        line: 2,
      },
      {
        text: "Log out",
        nestedPath: ["commandPalette", "logOut"],
        kind: "call",
        file: "a.tsx",
        line: 3,
      },
    ];

    expect(getEnglishEntries(strings)).toEqual({
      Save: "Save",
      "{{count}} rows": "{{count}} rows",
      "{{count}} rows_one": "{{count}} row",
    });
  });

  test("nested entries come from t() defaults, the first call winning", () => {
    const entries: Array<NestedEnglishEntry> = getNestedEnglishEntries([
      {
        text: "Log out",
        nestedPath: ["commandPalette", "logOut"],
        kind: "call",
        file: "a.tsx",
        line: 1,
      },
      {
        text: "Sign out",
        nestedPath: ["commandPalette", "logOut"],
        kind: "call",
        file: "b.tsx",
        line: 9,
      },
      { text: "Save", kind: "call", file: "a.tsx", line: 2 },
    ]);

    expect(entries).toEqual([
      { path: ["commandPalette", "logOut"], value: "Log out" },
    ]);
  });
});

describe("scanning a source tree", () => {
  let repository: string = "";

  const write: (relativePath: string, content: string) => void = (
    relativePath: string,
    content: string,
  ): void => {
    const filePath: string = path.join(repository, relativePath);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  };

  beforeAll(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-extract-"));

    write("ui/Pages/B.tsx", `const b = <p>Second page</p>;`);
    write("ui/Pages/A.tsx", `const a = <Card title="First page" />;`);
    write("ui/Components/Z.ts", `export const z = { label: "A label" };`);
    write("ui/Locales/en.json", `{"Not": "scanned"}`);
    write("ui/Locales/Skip.ts", `const s = <p>In a Locales folder</p>;`);
    write("ui/node_modules/x/Index.tsx", `const n = <p>A dependency</p>;`);
    write("ui/Types.d.ts", `declare const d: string;`);
    write("ui/Pages/A.test.tsx", `const t = <p>A test</p>;`);
    write(
      "models/Thing.ts",
      `@TableMetadata({ singularName: "Thing", pluralName: "Things" }) class Thing {}`,
    );
  });

  afterAll(() => {
    fs.rmSync(repository, { recursive: true, force: true });
  });

  test("lists source files sorted, without dependencies, declarations or tests", () => {
    expect(
      listSourceFiles(path.join(repository, "ui")).map((file: string) => {
        return toRepositoryPath(file, repository);
      }),
    ).toEqual(["ui/Components/Z.ts", "ui/Pages/A.tsx", "ui/Pages/B.tsx"]);
  });

  test("a missing directory has no files", () => {
    expect(listSourceFiles(path.join(repository, "nowhere"))).toEqual([]);
  });

  test("scans every root, in file order, with repository-relative names", () => {
    const result: SourceScanResult = scanSourceRoots(
      [
        { directory: "ui", kind: "ui" },
        { directory: "models", kind: "models" },
      ],
      repository,
    );

    expect(
      result.strings.map((entry: ExtractedString): string => {
        return `${entry.file}:${entry.line} ${entry.text}`;
      }),
    ).toEqual([
      "ui/Components/Z.ts:1 A label",
      "ui/Pages/A.tsx:1 First page",
      "ui/Pages/B.tsx:1 Second page",
      "models/Thing.ts:1 Thing",
      "models/Thing.ts:1 Things",
    ]);
  });

  test("gives the same result every time", () => {
    const first: string = JSON.stringify(
      scanSourceRoots([{ directory: "ui", kind: "ui" }], repository),
    );
    const second: string = JSON.stringify(
      scanSourceRoots([{ directory: "ui", kind: "ui" }], repository),
    );

    expect(second).toBe(first);
  });
});

describe("the real source roots", () => {
  test("cover the Dashboard, the shared UI and the data models", () => {
    expect(
      SOURCE_ROOTS.map((root: { directory: string; kind: string }) => {
        return `${root.kind} ${root.directory}`;
      }),
    ).toEqual([
      "ui packages/App/FeatureSet/Dashboard/src",
      "ui packages/Common/UI",
      "models packages/Common/Models/DatabaseModels",
      "models packages/Common/Models/AnalyticsModels",
    ]);
  });

  test("the shared components' own sentences are found where they are written", () => {
    const bulkUpdateForm: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "UI",
        "Components",
        "BulkUpdate",
        "BulkUpdateForm.tsx",
      ),
      "utf8",
    );
    const result: SourceScanResult = scan(
      bulkUpdateForm,
      "packages/Common/UI/Components/BulkUpdate/BulkUpdateForm.tsx",
    );

    expect(result.strings).toEqual(
      expect.arrayContaining([
        // A count-dependent sentence kept in a constant.
        expect.objectContaining({
          text: "{{count}} {{itemsName}} Selected",
          pluralOne: "{{count}} {{itemName}} Selected",
          kind: "plural",
        }),
        // Both templates a translateTemplate() call can pick.
        expect.objectContaining({
          text: "Select All {{itemsName}}",
          kind: "call",
        }),
        expect.objectContaining({
          text: "Selecting All {{itemsName}}...",
          kind: "call",
        }),
        expect.objectContaining({ text: "Clear Selection", kind: "call" }),
      ]),
    );
  });
});
