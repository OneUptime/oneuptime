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
  SKIPPED_SOURCE_FILES,
  SOURCE_ROOTS,
  SourceKind,
  SourceScanResult,
  toRepositoryPath,
  USER_FACING_PROPS,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  FormColumnDescription,
  FormColumnDescriptionFinder,
  FormColumnSourceReader,
} from "../../FeatureSet/Dashboard/scripts/i18n/FormColumnDescriptions";
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
  kind?: SourceKind,
) => SourceScanResult = (
  source: string,
  file: string = "packages/App/FeatureSet/Dashboard/src/Pages/Example.tsx",
  kind: SourceKind = "ui",
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

  /*
   * A term is translated with the sentence it fills, by looking its text up,
   * so a literal one must be in en.json even when nothing else uses it.
   */
  test("takes the text a translatableTerm puts in a sentence", () => {
    const result: SourceScanResult = scan(`
      const a = translator.translateTemplate("Instrument {{function}}.", {
        function: fn.name || translatableTerm("this function"),
      });
      const b = translatableTerm("authenticator app", { inSentence: true });
      const c = translatableTerm(isAlert ? "Alert" : "Incident");
      const d = translatableTerm(model.singularName || "item");
      const e = translatableTerm(model.pluralName, { inSentence: true });
      const f = translatableTerm(state?.name || "");
    `);

    expect(textsOf(result)).toEqual([
      "Instrument {{function}}.",
      "this function",
      "authenticator app",
      "Alert",
      "Incident",
      "item",
    ]);
    expect(kindOf(result, "this function")).toBe("call");
    expect(hardcodedOf(result)).toEqual([]);
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

  /*
   * A .ts module marks its words as keys, the PluralTemplates among them.
   * Read only as two keys, the template had no "_one" sentence, so its
   * translation could not be written: a count of one would have read the
   * "other" sentence ("1 Anfragen"), and the Campaigns page's counts stayed
   * English in every language.
   */
  test("a template whose forms are marked as keys is one too, with its one form", () => {
    const result: SourceScanResult = scan(`
      export const REQUESTS_COUNT: PluralTemplate = {
        one: translationKey("{{count}} request"),
        other: translationKey("{{count}} requests"),
      };
    `);

    expect(
      result.strings.filter((entry: ExtractedString): boolean => {
        return entry.kind === "plural";
      }),
    ).toEqual([
      expect.objectContaining({
        text: "{{count}} requests",
        pluralOne: "{{count}} request",
        kind: "plural",
      }),
    ]);
    expect(getEnglishEntries(result.strings)).toEqual(
      expect.objectContaining({
        "{{count}} requests": "{{count}} requests",
        "{{count}} requests_one": "{{count}} request",
      }),
    );
  });

  test("a keys root reads a template only when both its forms are marked", () => {
    const marked: SourceScanResult = scan(
      `const A = { one: translationKey("{{count}} span"), other: translationKey("{{count}} spans") };`,
      "packages/Common/Types/Telemetry/Example.ts",
      "keys",
    );
    const plain: SourceScanResult = scan(
      `const B = { one: "{{count}} trace", other: "{{count}} traces" };`,
      "packages/Common/Types/Telemetry/Example.ts",
      "keys",
    );

    expect(getEnglishEntries(marked.strings)).toEqual({
      "{{count}} span": "{{count}} span",
      "{{count}} spans": "{{count}} spans",
      "{{count}} spans_one": "{{count}} span",
    });
    expect(plain.strings).toEqual([]);
  });

  test("a form marked by another call, or not a string, is no template", () => {
    expect(
      scan(`
        const a = { one: translateText("{{count}} row"), other: translationKey("{{count}} rows") };
        const b = { one: translationKey(ROW), other: translationKey("{{count}} rows") };
      `).strings.filter((entry: ExtractedString): boolean => {
        return entry.kind === "plural";
      }),
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

  /*
   * The "What AI may do" building blocks look up these props themselves,
   * like Card and Pill look up theirs, so a page hands them English.
   */
  test("reads the AI access building blocks' own copy props", () => {
    expect(
      textsOf(
        scan(`
          const a = (
            <>
              <AiAccessRow sentence="AI never proposes or runs a fix." />
              <AiAccessPermissionNote
                canText="You can lower fixes."
                cannotText="Turning fixes on needs an admin."
              />
              <AiAccessAllowlist editText="Edit" />
            </>
          );
        `),
      ),
    ).toEqual([
      "AI never proposes or runs a fix.",
      "You can lower fixes.",
      "Turning fixes on needs an admin.",
      "Edit",
    ]);
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
      "identifierLabel",
      "statusDescription",
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

/*
 * A page's breadcrumbs are a list of titles that Breadcrumbs translates when
 * it draws them. They were not keys, so every title no other place happened
 * to use - "View Runbook", "Pod Detail", "View MCP Server" - read in English
 * in every language (#5042, #5112, #5150).
 */
describe("titles a call draws from a list (a page's breadcrumbs)", () => {
  test("takes every title of a page's trail, and nothing else of the call", () => {
    const result: SourceScanResult = scan(`
      const links = {
        ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOK_VIEW, [
          "Project",
          "Runbooks",
          "View Runbook",
        ]),
        ...BuildBreadcrumbLinksByTitles(PageMap.KUBERNETES_POD, [
          "Project",
          "Kubernetes",
          "Pod Detail",
        ]),
      };
    `);

    expect(textsOf(result)).toEqual([
      "Project",
      "Runbooks",
      "View Runbook",
      "Project",
      "Kubernetes",
      "Pod Detail",
    ]);
    expect(kindOf(result, "View Runbook")).toBe("prop");
    expect(kindOf(result, "Pod Detail")).toBe("prop");
  });

  test("takes the titles written out beside a spread, and skips what is not a literal", () => {
    const result: SourceScanResult = scan(`
      BuildBreadcrumbLinksByTitles(PageMap.X, [...parentTitles, "Node Detail"]);
      BuildBreadcrumbLinksByTitles(PageMap.Y, titles);
      BuildBreadcrumbLinksByTitles(PageMap.Z, [childTitle, ("Wrapped Title")]);
      BuildBreadcrumbLinksByTitles(PageMap.W);
    `);

    expect(textsOf(result)).toEqual(["Node Detail", "Wrapped Title"]);
  });

  test("reads only the call it knows, and only its list of titles", () => {
    const result: SourceScanResult = scan(`
      BuildBreadcrumbLinksByTitles("PAGE_KEY", ["Shown Title"]);
      buildSomethingElse(PageMap.X, ["Not a title"]);
      const keys = ["NOT_SHOWN", "ALSO_NOT_SHOWN"];
      toString(PageMap.X, ["Neither"]);
    `);

    expect(textsOf(result)).toEqual(["Shown Title"]);
    expect(textsOf(result)).not.toContain("PAGE_KEY");
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

/*
 * A "keys" root gives the locales only what it marks with a translation
 * call. TraceSpanType's choices keep their names as written in every
 * language ("Entry spans", as the translated docs quote them), while what
 * each one is reads in the reader's: read as a "ui" root, its `label:`
 * properties would have become keys too.
 */
describe("a root that marks its keys", () => {
  const KEYS_FILE: string = "packages/Common/Types/Example.tsx";

  test("takes the text of its translation calls, and nothing else", () => {
    const result: SourceScanResult = scan(
      `
      const translationKey = (text: string): string => text;
      export const OPTIONS = [
        {
          value: "entry",
          label: "Entry spans",
          title: "Not marked",
          description: translationKey("Where a request or message enters a service."),
        },
        { value: "root", label: "Root spans", description: "Unmarked description" },
      ];
      export const AGAIN: string = translateText("A looked-up sentence");
      export const PLURAL = { one: "{{count}} span", other: "{{count}} spans" };
      export const Element = () => <p title="A title">Text between tags</p>;
      setErrorMessage("A message for a setter");
    `,
      KEYS_FILE,
      "keys",
    );

    expect(textsOf(result)).toEqual([
      "Where a request or message enters a service.",
      "A looked-up sentence",
    ]);
    expect(
      result.strings.every((entry: ExtractedString): boolean => {
        return entry.kind === "call" && entry.file === KEYS_FILE;
      }),
    ).toBe(true);
    // Its other words are drawn as written on purpose: not work left to do.
    expect(result.hardcoded).toEqual([]);
  });

  /*
   * The monitor engine stores what an evaluation found as a sentence the
   * Dashboard words in each reader's language (issue #6542): its template
   * is a key, read from the server file as a translation call, while the
   * file's other English - its logs, its stored text - is never a key.
   */
  test("takes the template of a sentence the monitor engine stores", () => {
    const result: SourceScanResult = scan(
      `
      const found = translatableSentence("Response Status Code was {{code}}.", {
        code: String(responseCode),
      });
      const online = translatableSentence(
        isOnline
          ? "Monitor reported online status at {{time}}."
          : "Monitor reported offline status at {{time}}.",
        { time: evaluationTime(at) },
      );
      const readings = translatablePluralSentence(
        {
          one: translationKey("{{count}} reading"),
          other: translationKey("{{count}} readings"),
        },
        count,
      );
      const asGiven = translatableSentence(input.resolvedMessage);
      logger.debug("Probe agreement not met. Skipping status change.");
      const stored: string = "Monitor status updated";
    `,
      "packages/Common/Server/Utils/Monitor/Example.ts",
      "keys",
    );

    expect(
      result.strings.map(
        (entry: ExtractedString): [string, string, string | undefined] => {
          return [entry.text, entry.kind, entry.pluralOne];
        },
      ),
    ).toEqual([
      ["Response Status Code was {{code}}.", "call", undefined],
      ["Monitor reported online status at {{time}}.", "call", undefined],
      ["Monitor reported offline status at {{time}}.", "call", undefined],
      ["{{count}} readings", "plural", "{{count}} reading"],
      // Each marked form is a key of its own too, as in every keys root.
      ["{{count}} reading", "call", undefined],
      ["{{count}} readings", "call", undefined],
    ]);
    expect(result.hardcoded).toEqual([]);
  });

  test("the same file read as a ui root takes every name too", () => {
    expect(
      textsOf(
        scan(
          `export const OPTIONS = [{ label: "Entry spans", description: translationKey("Where a trace starts.") }];`,
          KEYS_FILE,
          "ui",
        ),
      ),
    ).toEqual(["Entry spans", "Where a trace starts."]);
  });

  test("a count's two sentences, both marked, are one plural", () => {
    const result: SourceScanResult = scan(
      `
      const translationKey = (text: string): string => text;
      export const MISSCHEDULED = {
        one: translationKey("Runs on {{count}} node it should not"),
        other: translationKey("Runs on {{count}} nodes it should not"),
      };
      // Half marked: the marked sentence is a key of its own, no plural.
      export const HALF = { one: "{{count}} pod", other: translationKey("{{count}} pods") };
      // Three properties: not a count's sentences.
      export const THREE = {
        one: translationKey("One way"),
        other: translationKey("Other way"),
        hint: translationKey("A hint"),
      };
    `,
      KEYS_FILE,
      "keys",
    );

    expect(
      result.strings.map(
        (entry: ExtractedString): [string, string, string | undefined] => {
          return [entry.text, entry.kind, entry.pluralOne];
        },
      ),
    ).toEqual([
      [
        "Runs on {{count}} nodes it should not",
        "plural",
        "Runs on {{count}} node it should not",
      ],
      // Each marked sentence is a key of its own too, as in every keys root.
      ["Runs on {{count}} node it should not", "call", undefined],
      ["Runs on {{count}} nodes it should not", "call", undefined],
      ["{{count}} pods", "call", undefined],
      ["One way", "call", undefined],
      ["Other way", "call", undefined],
      ["A hint", "call", undefined],
    ]);
    // en.json carries the plural as every other plural: the key, and its _one.
    expect(getEnglishEntries(result.strings)).toEqual(
      expect.objectContaining({
        "Runs on {{count}} nodes it should not":
          "Runs on {{count}} nodes it should not",
        "Runs on {{count}} nodes it should not_one":
          "Runs on {{count}} node it should not",
      }),
    );
    // HALF is no plural: no _one for its marked sentence.
    expect(Object.keys(getEnglishEntries(result.strings))).not.toContain(
      "{{count}} pods_one",
    );
  });

  test("KubernetesHealth gives the locales its words, each count as a plural, and none of Kubernetes' reasons", () => {
    const file: string = "packages/Common/Types/Kubernetes/KubernetesHealth.ts";
    const result: SourceScanResult = scanSourceRoots(
      [{ directory: file, kind: "keys" }],
      path.join(__dirname, "..", "..", "..", ".."),
    );
    const plurals: Record<string, string | undefined> = {};

    for (const entry of result.strings) {
      if (entry.kind === "plural") {
        plurals[entry.text] = entry.pluralOne;
      }
    }

    expect(plurals).toEqual({
      "Runs on {{count}} nodes it should not":
        "Runs on {{count}} node it should not",
      "At its maximum of {{count}} replicas":
        "At its maximum of {{count}} replica",
    });
    expect(textsOf(result)).toEqual(
      expect.arrayContaining([
        "{{available}} of {{desired}} available",
        "Ready on {{ready}} of {{desired}} nodes",
        "Last restart: {{reason}}, exit code {{code}}",
        "Memory pressure",
      ]),
    );
    // Kubernetes' own words are drawn as written, never looked up.
    for (const reason of [
      "CrashLoopBackOff",
      "OOMKilled",
      "ImagePullBackOff",
    ]) {
      expect(textsOf(result)).not.toContain(reason);
    }
    expect(result.hardcoded).toEqual([]);
    expect(
      SOURCE_ROOTS.find((root: { directory: string }): boolean => {
        return root.directory === file;
      })?.kind,
    ).toBe("keys");
  });

  test("the guided setups' status page records give the locales the name a page starts with, and nothing else (#7247)", () => {
    const file: string =
      "packages/Common/Utils/GuidedSetup/StatusPageRecords.ts";
    const result: SourceScanResult = scanSourceRoots(
      [{ directory: file, kind: "keys" }],
      path.join(__dirname, "..", "..", "..", ".."),
    );

    // The guided setup and Ask AI both name a page with it, in the reader's language.
    expect(textsOf(result)).toEqual(["{{project}} Status"]);
    expect(result.hardcoded).toEqual([]);
    expect(
      SOURCE_ROOTS.find((root: { directory: string }): boolean => {
        return root.directory === file;
      })?.kind,
    ).toBe("keys");
  });

  test("HostHealth gives the locales its words, each count as a plural, and nothing else", () => {
    const file: string = "packages/Common/Types/Host/HostHealth.ts";
    const result: SourceScanResult = scanSourceRoots(
      [{ directory: file, kind: "keys" }],
      path.join(__dirname, "..", "..", "..", ".."),
    );
    const plurals: Record<string, string | undefined> = {};

    for (const entry of result.strings) {
      if (entry.kind === "plural") {
        plurals[entry.text] = entry.pluralOne;
      }
    }

    expect(plurals).toEqual({
      "15-minute load {{load}} on {{count}} cores":
        "15-minute load {{load}} on {{count}} core",
      "{{count}} failed systemd units": "{{count}} failed systemd unit",
    });
    expect(textsOf(result)).toEqual(
      expect.arrayContaining([
        "Healthy",
        "Degraded",
        "Unhealthy",
        "Not reporting",
        "Starting",
        "No data yet",
        "Reporting",
        "{{percent}} full",
        "{{mount}} {{percent}} full",
        "{{percent}} of inodes used",
        "{{mount}}: {{percent}} of inodes used",
        "Memory {{percent}} used",
        "Swap {{percent}} used",
        "Failed",
        "Config failed",
        "Collector config failed",
        "Collector error",
      ]),
    );
    // Only what the file marks: no state names, no mount points.
    for (const unmarked of ["critical", "warning", "filesystem", "host"]) {
      expect(textsOf(result)).not.toContain(unmarked);
    }
    expect(result.hardcoded).toEqual([]);
    expect(
      SOURCE_ROOTS.find((root: { directory: string }): boolean => {
        return root.directory === file;
      })?.kind,
    ).toBe("keys");
  });

  test("DatabaseHealth gives the locales its words, each count as a plural, and none of its template ids or units", () => {
    const file: string =
      "packages/Common/Types/DatabaseServer/DatabaseHealth.ts";
    const result: SourceScanResult = scanSourceRoots(
      [{ directory: file, kind: "keys" }],
      path.join(__dirname, "..", "..", "..", ".."),
    );
    const plurals: Record<string, string | undefined> = {};

    for (const entry of result.strings) {
      if (entry.kind === "plural") {
        plurals[entry.text] = entry.pluralOne;
      }
    }

    expect(plurals).toEqual({
      "{{count}} sessions waiting on locks":
        "{{count}} session waiting on a lock",
      "{{count}} threads running": "{{count}} thread running",
      "{{count}} clients connected": "{{count}} client connected",
      "{{count}} blocked sessions": "{{count}} blocked session",
      "{{count}} queries waiting for memory":
        "{{count}} query waiting for memory",
      "{{count}} cluster tasks pending": "{{count}} cluster task pending",
    });
    expect(textsOf(result)).toEqual(
      expect.arrayContaining([
        "Healthy",
        "Degraded",
        "Unhealthy",
        "Engine metrics stopped",
        "No engine metrics",
        "Reporting",
        // The categories a database's Needs attention groups its rows by.
        "Availability",
        "Connections",
        "Replication",
        "Memory",
        "Performance",
        "Storage",
        // Each duration with its unit inside, so a language words it its way.
        "A replica {{seconds}} s behind",
        "A replica {{minutes}} min behind",
        "A replica {{hours}} h behind",
        "A transaction open for {{hours}} h",
        "Restarted {{minutes}} min ago",
        "Restarted less than a minute ago",
        "Connections at {{percent}} of max_connections",
        "Transaction IDs at {{percent}} of wraparound",
        "Memory at {{percent}} of maxmemory",
        "Cluster health red",
        "Requests averaging {{seconds}} s",
      ]),
    );
    // Only what the file marks: no template ids, units or state names.
    for (const unmarked of [
      "database-postgresql-restarted",
      "database-postgresql-sessions-waiting-on-locks",
      "TB",
      "GB",
      "ms",
      "critical",
      "warning",
      "not-connected",
    ]) {
      expect(textsOf(result)).not.toContain(unmarked);
    }
    expect(result.hardcoded).toEqual([]);
    expect(
      SOURCE_ROOTS.find((root: { directory: string }): boolean => {
        return root.directory === file;
      })?.kind,
    ).toBe("keys");
  });

  /*
   * Issue #6191: a RUM application's pill says what is true - Receiving
   * data, No recent traffic, Waiting for data - and its tooltip what that
   * means, in the reader's language. The stored values the status is read
   * from ("connected", "disconnected") are never words a reader sees.
   */
  test("RumApplicationStatus gives the locales its three statuses and what each means, and none of its stored values", () => {
    const file: string = "packages/Common/Types/Rum/RumApplicationStatus.ts";
    const result: SourceScanResult = scanSourceRoots(
      [{ directory: file, kind: "keys" }],
      path.join(__dirname, "..", "..", "..", ".."),
    );

    expect([...textsOf(result)].sort()).toEqual(
      [
        "Receiving data",
        "No recent traffic",
        "Waiting for data",
        "Data has arrived from this application in the last 15 minutes.",
        "Nothing has arrived in the last 15 minutes. An application sends data only while people use it, so this is normal when nobody is, for example overnight. If people are using it right now, its Overview lists what to check.",
        "Nothing has arrived from this application yet. Add the OpenTelemetry SDK or the Session Replay snippet to your app; its Documentation tab shows how.",
      ].sort(),
    );
    for (const unmarked of [
      "connected",
      "disconnected",
      "active",
      "Disconnected",
      "receiving-data",
      "no-recent-traffic",
      "waiting-for-data",
      "positive",
      "neutral",
    ]) {
      expect(textsOf(result)).not.toContain(unmarked);
    }
    expect(result.hardcoded).toEqual([]);
    expect(
      SOURCE_ROOTS.find((root: { directory: string }): boolean => {
        return root.directory === file;
      })?.kind,
    ).toBe("keys");
  });

  /*
   * Issues #6269 and #6270: a serverless function's pill and a service's
   * say what is true - Receiving data, No recent invocations or No recent
   * data, Waiting for data - and their tooltips what that means, in the
   * reader's language. The values they are read from ("connected",
   * "disconnected") and the statuses' own names are never words a reader
   * sees.
   */
  test("ServerlessFunctionStatus gives the locales its three statuses and what each means, and none of its stored values", () => {
    const file: string =
      "packages/Common/Types/Serverless/ServerlessFunctionStatus.ts";
    const result: SourceScanResult = scanSourceRoots(
      [{ directory: file, kind: "keys" }],
      path.join(__dirname, "..", "..", "..", ".."),
    );

    expect([...textsOf(result)].sort()).toEqual(
      [
        "Receiving data",
        "No recent invocations",
        "Waiting for data",
        "Data has arrived from this function in the last 15 minutes.",
        "Nothing has arrived in the last 15 minutes. A function sends data only while it runs, so this is normal when nothing has invoked it, for example between scheduled runs. If it should be running, its Overview lists what to check.",
        "Nothing has arrived from this function yet. Add the OpenTelemetry SDK to it and invoke it once; its Documentation tab shows how.",
      ].sort(),
    );
    for (const unmarked of [
      "connected",
      "disconnected",
      "active",
      "Disconnected",
      "receiving-data",
      "no-recent-invocations",
      "waiting-for-data",
      "positive",
      "neutral",
    ]) {
      expect(textsOf(result)).not.toContain(unmarked);
    }
    expect(result.hardcoded).toEqual([]);
    expect(
      SOURCE_ROOTS.find((root: { directory: string }): boolean => {
        return root.directory === file;
      })?.kind,
    ).toBe("keys");
  });

  test("ServiceTelemetryStatus gives the locales its three statuses and what each means, and none of its names", () => {
    const file: string =
      "packages/Common/Types/Service/ServiceTelemetryStatus.ts";
    const result: SourceScanResult = scanSourceRoots(
      [{ directory: file, kind: "keys" }],
      path.join(__dirname, "..", "..", "..", ".."),
    );

    expect([...textsOf(result)].sort()).toEqual(
      [
        "Receiving data",
        "No recent data",
        "Waiting for data",
        "Data has arrived from this service in the last 30 minutes.",
        "Nothing has arrived in the last 30 minutes. A service that sends data only while it handles requests is quiet when nobody calls it. If it should be busy, check that it is running and still sends its telemetry to OneUptime with this service.name.",
        "Nothing has arrived from this service yet. Send its OpenTelemetry data with service.name set to exactly this service's name.",
      ].sort(),
    );
    for (const unmarked of [
      "receiving-data",
      "no-recent-data",
      "waiting-for-data",
      "positive",
      "neutral",
    ]) {
      expect(textsOf(result)).not.toContain(unmarked);
    }
    expect(result.hardcoded).toEqual([]);
    expect(
      SOURCE_ROOTS.find((root: { directory: string }): boolean => {
        return root.directory === file;
      })?.kind,
    ).toBe("keys");
  });

  test("TraceSpanType gives the locales its sentences and none of its names", () => {
    const file: string = "packages/Common/Types/Telemetry/TraceSpanType.ts";
    const result: SourceScanResult = scanSourceRoots(
      [{ directory: file, kind: "keys" }],
      path.join(__dirname, "..", "..", "..", ".."),
    );

    expect(textsOf(result)).toEqual([
      "Where a request or message enters a service.",
      "Where a trace starts.",
      "Every operation, including database calls and internal steps.",
      // The traces explorer's chart, titled for the span type it counts.
      "Traces over time",
      "Spans over time",
      // What its list says when a choice leaves it empty.
      "No root spans found",
      "No entry spans found",
    ]);
    expect(result.hardcoded).toEqual([]);
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
    write(
      "packages/Common/Models/DatabaseModels/EnterpriseLicense.ts",
      `@TableMetadata({ singularName: "License Row", pluralName: "License Rows" }) class EnterpriseLicense {}`,
    );
    write(
      "packages/Common/Models/DatabaseModels/Monitor.ts",
      `@TableMetadata({ singularName: "Monitor", pluralName: "Monitors" }) class Monitor {}`,
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

  test("a root that is one source file lists that file alone", () => {
    expect(
      listSourceFiles(path.join(repository, "ui/Pages/A.tsx")).map(
        (file: string) => {
          return toRepositoryPath(file, repository);
        },
      ),
    ).toEqual(["ui/Pages/A.tsx"]);
  });

  test("a root that is one file lists nothing when it is no source: a test, a declaration, a locale file", () => {
    for (const name of [
      "ui/Pages/A.test.tsx",
      "ui/Types.d.ts",
      "ui/Locales/en.json",
    ]) {
      expect(listSourceFiles(path.join(repository, name))).toEqual([]);
    }
  });

  test("scans a root that is one file", () => {
    const result: SourceScanResult = scanSourceRoots(
      [{ directory: "ui/Components/Z.ts", kind: "ui" }],
      repository,
    );

    expect(
      result.strings.map((entry: ExtractedString): string => {
        return `${entry.file}:${entry.line} ${entry.text}`;
      }),
    ).toEqual(["ui/Components/Z.ts:1 A label"]);
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

  test("leaves out the files no frontend shows: the license server's own table", () => {
    const result: SourceScanResult = scanSourceRoots(
      [{ directory: "packages/Common/Models/DatabaseModels", kind: "models" }],
      repository,
    );

    expect(
      result.strings.map((entry: ExtractedString): string => {
        return `${entry.file} ${entry.text}`;
      }),
    ).toEqual([
      "packages/Common/Models/DatabaseModels/Monitor.ts Monitor",
      "packages/Common/Models/DatabaseModels/Monitor.ts Monitors",
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
  test("cover the Dashboard, the shared UI, the data models, the vCenter collection errors, the security case and playbook catalogs, the AI and cloud connections' catalogs, the shared monitor helpers, the monitor type cards, a new monitor's default criteria words, the name a guided setup's status page starts with, a monitor template's sync fields, the cron schedule words and its common schedules, what each Setup health finding says, why an email was not sent when the server has no email set up, the placeholders of a playbook's message, what is wrong with a detection rule exception, what is wrong with a watchlist or one of its values, what is wrong with a hunt or why its run could not be made, the Hunt Library's starters, a security connector's Data to import choices, what each of the traces explorer's span types is, an audit log entry's action and a workflow run's status, a naming rule's placeholders and what is wrong with its pattern or lookup table, why Add or Delete is locked on the Global User Overrides page, what a user override overlaps and why an edit of one is refused, what a dashboard template's chart says while it draws its fallback query, how a change OneUptime AI proposes went before, a cloud change in plain words, a Kubernetes object's status by the cluster's rules, a database's status by its engine's alert lines, what a custom domain's DNS check found and what the server still needs before a custom domain works, what an error nobody explained says to do and where to look, why a RUM application's session recordings are missing, the dashboard SLO widgets' labels and lines, what each managed app platform is, a cloud resource's status by its key metrics and the kinds of saving the clouds recommend, a resource's right-sizing from OneUptime's own readings, what an AI action's approval card says and the kinds of resource it names, how an AI remediation round reads, the curated metrics' names, what a monitor's evaluation says and the checks it names, and the checks a table's columns call for", () => {
    expect(
      SOURCE_ROOTS.map((root: { directory: string; kind: string }) => {
        return `${root.kind} ${root.directory}`;
      }),
    ).toEqual([
      "ui packages/App/FeatureSet/Dashboard/src",
      "ui packages/Common/UI",
      "models packages/Common/Models/DatabaseModels",
      "models packages/Common/Models/AnalyticsModels",
      // What a failed vCenter collection means and what fixes it.
      "ui packages/Common/Types/VMware",
      "ui packages/Common/Types/OpenStack",
      // What a case's verdicts mean and what each playbook action does.
      "ui packages/Common/Types/SecurityCase",
      "ui packages/Common/Types/SecurityPlaybook",
      // Each AI connection's title, what arrives, its hint and its fields.
      "ui packages/Common/Types/LlmObservability",
      // Each cloud's title, its sign in methods, its shell and its fields.
      "ui packages/Common/Types/CloudConnection",
      // The monitor pages' shared helpers: hero, uptime, metric groups.
      "ui packages/Common/Utils/Monitor",
      // Create Monitor's type cards: each type's title and what it alerts on.
      "ui packages/Common/Types/Monitor/MonitorType.ts",
      // A new monitor's default criteria: names, descriptions, what they open.
      "keys packages/Common/Types/Monitor/MonitorCriteriaInstance.ts",
      // The name a guided setup's status page starts with (#7247).
      "keys packages/Common/Utils/GuidedSetup/StatusPageRecords.ts",
      // A template's sync fields: each one's name, and what it keeps together.
      "keys packages/Common/Types/Monitor/MonitorTemplateSyncField.ts",
      // A cron schedule in words.
      "ui packages/Common/Utils/CronScheduleText.ts",
      // What each Setup health finding says.
      "ui packages/Common/Types/SetupHealth/SetupHealth.ts",
      "ui packages/Common/Types/ServerSending/ServerSendingWords.ts",
      // The common schedules a workflow's Schedule trigger offers.
      "ui packages/Common/Utils/CronTab.ts",
      // What each placeholder of a playbook's note or message stands for.
      "ui packages/Common/Utils/SecurityCase/SecurityCaseMarkdown.ts",
      // What is wrong with a detection rule exception, field by field.
      "ui packages/Common/Types/SecurityEvent/DetectionRuleException.ts",
      // What is wrong with a watchlist or one of its values.
      "ui packages/Common/Types/SecurityEvent/SecurityWatchlist.ts",
      // What is wrong with a monitor's watchlist filters.
      "ui packages/Common/Types/SecurityEvent/SecurityWatchlistFilter.ts",
      // What is wrong with a hunt, and why its scheduled run could not be made.
      "ui packages/Common/Types/SecurityEvent/SecurityHunt.ts",
      "ui packages/Common/Types/SecurityEvent/SecurityHuntLibrary.ts",
      // A connector's Data to import choices - its marked labels, not its fields.
      "keys packages/Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog.ts",
      // What each span type is - its marked sentences, not its choices' names.
      "keys packages/Common/Types/Telemetry/TraceSpanType.ts",
      // An audit log entry's action and a workflow run's status - not their stored values.
      "keys packages/Common/Types/AuditLog/AuditLogActionLabel.ts",
      "keys packages/Common/Types/Workflow/WorkflowStatus.ts",
      // A naming rule's placeholders and what is wrong with a pattern or table.
      "keys packages/Common/Utils/NetworkDevice/Naming/NamePattern.ts",
      "keys packages/Common/Utils/NetworkDevice/Naming/NamingLookup.ts",
      // Why Add or Delete is locked on the Global User Overrides page.
      "keys packages/Common/Types/OnCallDutyPolicy/GlobalUserOverrideAccess.ts",
      // What a user override overlaps, and why an edit of one is refused.
      "keys packages/Common/Types/OnCallDutyPolicy/UserOverrideOverlap.ts",
      "keys packages/Common/Types/OnCallDutyPolicy/UserOverrideEdit.ts",
      // Why a template's chart draws its fallback query, and where the fix is.
      "keys packages/Common/Types/Dashboard/DashboardTemplateFallbackHints.ts",
      // How a change OneUptime AI proposes went before, where it ran.
      "ui packages/Common/Types/AutoRemediation/RemediationTrackRecordWords.ts",
      // A cloud change in plain words, read from its command.
      "ui packages/Common/Utils/AiRemediation/CloudChangeWords.ts",
      // A Kubernetes object's status and reasons - not Kubernetes' own words.
      "keys packages/Common/Types/Kubernetes/KubernetesHealth.ts",
      // A host's status and reasons - not its mount points or unit names.
      "keys packages/Common/Types/Host/HostHealth.ts",
      // A database's status and reasons - not its alert templates' ids.
      "keys packages/Common/Types/DatabaseServer/DatabaseHealth.ts",
      // A custom domain's DNS check, and what a server needs before one works.
      "keys packages/Common/Types/CustomDomain/DnsRecordCheckWords.ts",
      "keys packages/Common/Types/CustomDomain/CustomDomainServerReadiness.ts",
      // An error nobody explained: what happened, what to do, where to look.
      "keys packages/Common/Types/Exception/UnexplainedError.ts",
      // A RUM application's status and what each means - not its stored values.
      "keys packages/Common/Types/Rum/RumApplicationStatus.ts",
      "keys packages/Common/Utils/SessionReplay/SessionReplayHealth.ts",
      // A dashboard's SLO widgets' labels and lines - not the worker's metric names.
      "keys packages/Common/Utils/Slo/SloWidgetFormat.ts",
      "keys packages/Common/Utils/Slo/SloListWidgetFormat.ts",
      // A serverless function's and a service's status - not their stored values.
      "keys packages/Common/Types/Serverless/ServerlessFunctionStatus.ts",
      "keys packages/Common/Types/Service/ServiceTelemetryStatus.ts",
      // Where a database or a queue was found, and what kind of cloud resource one is.
      "keys packages/Common/Types/DatabaseServer/DatabaseServerDiscoverySource.ts",
      "keys packages/Common/Models/DatabaseModels/MessageQueue.ts",
      "keys packages/Common/Types/Cloud/CloudResourceCatalog.ts",
      // What each managed app platform is, under its name in the environment guide's picker.
      "keys packages/Common/Types/Cloud/CloudPlatform.ts",
      // A cloud resource's status by its key metrics, and the kinds of saving the clouds recommend.
      "keys packages/Common/Types/Cloud/CloudResourceHealth.ts",
      "keys packages/Common/Types/Cloud/CloudCost.ts",
      // What each cloud calls its commitments, on the Commitments card.
      "keys packages/Common/Types/Cloud/CloudCommitments.ts",
      // A resource's right-sizing from OneUptime's own readings: its verdict and why.
      "keys packages/Common/Types/Cloud/CloudRightSizing.ts",
      // A cloud change's title in the reader's language - only its frame.
      "keys packages/Common/Utils/Telemetry/CloudChangeTitle.ts",
      // A health event's description: OneUptime's sentences, never the provider's words.
      "keys packages/Common/Utils/Telemetry/CloudHealthDescription.ts",
      // The column titles of OneUptime AI's tables - not its prompts.
      "keys packages/Common/Server/Utils/AI/Toolbox",
      // What an AI action's approval card says, and the kinds of resource it names.
      "keys packages/Common/Types/AI/AIActionWords.ts",
      "keys packages/Common/Types/AI/AiAffectedResources.ts",
      // Why OneUptime AI did not start a run someone asked for, by its code.
      "keys packages/Common/Types/AI/AiRunRefusal.ts",
      // How an AI remediation round reads on the Remediation step.
      "keys packages/Common/Types/AutoRemediation/RemediationRoundName.ts",
      /*
       * The curated metrics' names: a database's engine charts, a queue's
       * Broker health, the storage array, Proxmox, OpenStack and Ceph metric
       * pickers.
       */
      "keys packages/Common/Types/DatabaseServer/DatabaseServerMetricCatalog.ts",
      "keys packages/Common/Types/MessageQueue/MessageQueueMetricCatalog.ts",
      "keys packages/Common/Types/Monitor/StorageArrayMetricCatalog.ts",
      "keys packages/Common/Types/Monitor/ProxmoxMetricCatalog.ts",
      "keys packages/Common/Types/Monitor/OpenStackMetricCatalog.ts",
      "keys packages/Common/Types/Monitor/CephMetricCatalog.ts",
      // What a monitor's evaluation says, worded for each reader (#6542).
      "keys packages/Common/Types/Monitor/CriteriaFilterTerms.ts",
      "keys packages/Common/Server/Utils/Monitor/Criteria/CompareCriteria.ts",
      "keys packages/Common/Server/Utils/Monitor/Criteria/APIRequestCriteria.ts",
      "keys packages/Common/Server/Utils/Monitor/MonitorCriteriaExpectationBuilder.ts",
      "keys packages/Common/Server/Utils/Monitor/MonitorCriteriaMessageBuilder.ts",
      "keys packages/Common/Server/Utils/Monitor/MonitorCriteriaObservationBuilder.ts",
      "keys packages/Common/Server/Utils/Monitor/EvaluationEventText.ts",
      "keys packages/Common/Server/Utils/Monitor/MonitorResource.ts",
      "keys packages/Common/Server/Utils/Monitor/MonitorIncident.ts",
      "keys packages/Common/Server/Utils/Monitor/MonitorAlert.ts",
      "keys packages/Common/Server/Utils/Monitor/MonitorMaintenanceSuppression.ts",
      "keys packages/Common/Server/Utils/Monitor/MonitorDependencySuppression.ts",
      "keys packages/Common/Server/Utils/Monitor/LogGroupCriteriaFanOut.ts",
      // The checks a table's columns call for, worded for each reader (#7221).
      "keys packages/Common/Types/DataObservability/DataCheckSuggestions.ts",
    ]);
  });

  test("name directories and files that exist", () => {
    const repositoryRoot: string = path.join(__dirname, "..", "..", "..", "..");

    for (const root of SOURCE_ROOTS) {
      expect(fs.existsSync(path.join(repositoryRoot, root.directory))).toBe(
        true,
      );
    }
  });

  /*
   * A skipped file that is renamed or moved would be extracted again under
   * its new name: the license server's enterprise-only column titles would
   * reach every locale file, which a test in ee/ refuses, and so would the
   * instance's backups (#5241), which only the Enterprise Admin Dashboard
   * shows, in words of its own (ee/AdminDashboard/Backups), and what people
   * told the server (#6832), which only the Admin Dashboard's Feedback page
   * shows, in words of its own.
   */
  test("skip only the license server's own table, the instance's backups and what people told the server, by paths that exist", () => {
    expect([...SKIPPED_SOURCE_FILES]).toEqual([
      "packages/Common/Models/DatabaseModels/EnterpriseLicense.ts",
      "packages/Common/Models/DatabaseModels/BackupSetting.ts",
      "packages/Common/Models/DatabaseModels/BackupRun.ts",
      "packages/Common/Models/DatabaseModels/ProductFeedback.ts",
    ]);

    for (const file of SKIPPED_SOURCE_FILES) {
      expect([
        file,
        fs.existsSync(path.join(__dirname, "..", "..", "..", "..", file)),
      ]).toEqual([file, true]);
    }
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

/*
 * A form field with no description of its own shows its model column's
 * (BasicModelForm), so the extractor takes those descriptions - and only
 * those: a model's column descriptions are written for the API reference,
 * thousands of sentences no page shows (FormColumnDescriptions, #5292).
 */
describe("the column descriptions a form draws", () => {
  const ROOT: string = path.join(path.sep, "repository");
  const MODEL_FILE: string = path.join(
    ROOT,
    "packages/Common/Models/DatabaseModels/Widget.ts",
  );
  const PAGE_FILE: string = path.join(
    ROOT,
    "packages/App/FeatureSet/Dashboard/src/Pages/Widgets.tsx",
  );

  const WIDGET: string = `
    export default class Widget extends BaseModel {
      @TableColumn({ title: "Name", description: "Any friendly name of this object" })
      public name?: string = undefined;

      @TableColumn({ title: "Pattern", description: "Regex matched against the widget name. Leave empty to match any name." })
      public pattern?: string = undefined;

      @TableColumn({ title: "Color", description: "Color in Hex (#32a852 for example)" })
      public color?: string = undefined;

      @TableColumn({ title: "Notes", description: "What the notes are for." })
      public notes?: string = undefined;

      @TableColumn({ title: "Size", description: SIZE_DESCRIPTION })
      public size?: number = undefined;
    }
  `;

  const IMPORTS: string = `import Widget from "Common/Models/DatabaseModels/Widget";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";`;

  const memoryReader: (
    files: Record<string, string>,
  ) => FormColumnSourceReader = (
    files: Record<string, string>,
  ): FormColumnSourceReader => {
    return {
      read: (file: string): string | null => {
        const text: string | undefined = files[file];

        return text === undefined ? null : text;
      },
    };
  };

  const finder: () => FormColumnDescriptionFinder =
    (): FormColumnDescriptionFinder => {
      return new FormColumnDescriptionFinder(
        ROOT,
        memoryReader({ [MODEL_FILE]: WIDGET }),
      );
    };

  const find: (page: string) => Array<string> = (
    page: string,
  ): Array<string> => {
    return finder()
      .find(PAGE_FILE, page)
      .map((field: FormColumnDescription): string => {
        return `${field.model}.${field.column}: ${field.text}`;
      });
  };

  test("a field with no description of its own draws its column's", () => {
    expect(
      finder().find(
        PAGE_FILE,
        `${IMPORTS}
const page = (
  <ModelTable
    modelType={Widget}
    formFields={[
      {
        field: { pattern: true },
        title: "Pattern",
        fieldType: FormFieldSchemaType.Text,
      },
    ]}
  />
);`,
      ),
    ).toEqual([
      {
        text: "Regex matched against the widget name. Leave empty to match any name.",
        file: "packages/App/FeatureSet/Dashboard/src/Pages/Widgets.tsx",
        line: 7,
        model: "Widget",
        column: "pattern",
      },
    ]);
  });

  test("words of its own, a hidden column description, a color or a restating description draw none", () => {
    expect(
      find(`${IMPORTS}
      const page = (
        <ModelTable
          modelType={Widget}
          formFields={[
            { field: { notes: true }, fieldType: FormFieldSchemaType.LongText, description: "Its own words." },
            { field: { notes: true }, fieldType: FormFieldSchemaType.LongText, hideColumnDescription: true },
            { field: { color: true }, fieldType: FormFieldSchemaType.Color },
            { field: { name: true }, fieldType: FormFieldSchemaType.Text },
            { field: { notes: true }, fieldType: FormFieldSchemaType.LongText, hideColumnDescription: false },
          ]}
        />
      );`),
    ).toEqual(["Widget.notes: What the notes are for."]);
  });

  test("a field needs a form field type and a column, and a description written out", () => {
    expect(
      find(`${IMPORTS}
      const page = (
        <ModelTable
          modelType={Widget}
          columns={[{ field: { notes: true }, type: FieldType.Text }]}
          formFields={[
            { field: { size: true }, fieldType: FormFieldSchemaType.Number },
            { fieldType: FormFieldSchemaType.Text },
            { field: notesField, fieldType: FormFieldSchemaType.Text },
          ]}
        />
      );`),
    ).toEqual([]);
  });

  test("its model is the nearest element's modelType, or a CardModelDetail's modelDetailProps", () => {
    expect(
      find(`${IMPORTS}
      const page = (
        <CardModelDetail
          modelDetailProps={{ modelType: Widget, fields: [] }}
          formFields={[{ field: { notes: true }, fieldType: FormFieldSchemaType.LongText }]}
        />
      );`),
    ).toEqual(["Widget.notes: What the notes are for."]);
  });

  test("or the model a typed list of fields names, and never a type parameter", () => {
    expect(
      find(`${IMPORTS}
      const fields: Fields<Widget> = [
        { field: { pattern: true }, fieldType: FormFieldSchemaType.Text },
      ];
      function generic<TBaseModel>(): Fields<TBaseModel> {
        return [{ field: { notes: true }, fieldType: FormFieldSchemaType.LongText }];
      }`),
    ).toEqual([
      "Widget.pattern: Regex matched against the widget name. Leave empty to match any name.",
    ]);
  });

  /*
   * A rule form's match conditions on a rule model are drawn as one
   * conditions builder (Common/UI/Components/RuleCriteria/
   * RuleCriteriaModelForm), which names each condition by its title alone:
   * none of those fields draws its column's description, so none is a key
   * to translate. 179 of the 288 sentences the first column pass took were
   * such fields' (#5512).
   */
  describe("a rule's match conditions draw none", () => {
    const RULE_FILE: string = path.join(
      ROOT,
      "packages/Common/Models/DatabaseModels/WidgetRule.ts",
    );
    const ON_CALL_RULE_FILE: string = path.join(
      ROOT,
      "packages/Common/Models/DatabaseModels/WidgetOnCallRule.ts",
    );
    const ON_CALL_BASE_FILE: string = path.join(
      ROOT,
      "packages/Common/Models/DatabaseModels/DatabaseBaseModel/OnCallRuleBaseModel.ts",
    );
    const RULE_COLUMNS: string = `
      @TableColumn({ title: "Monitors", description: "Only trigger for widgets from these monitors. Leave empty to match any monitor." })
      public monitors?: Array<Monitor> = undefined;

      @TableColumn({ title: "Note", description: "What the rule's note is for." })
      public note?: string = undefined;
    `;

    const ruleFinder: () => FormColumnDescriptionFinder =
      (): FormColumnDescriptionFinder => {
        return new FormColumnDescriptionFinder(
          ROOT,
          memoryReader({
            [MODEL_FILE]: WIDGET,
            [RULE_FILE]: `import RuleBaseModel from "./DatabaseBaseModel/RuleBaseModel";
export default class WidgetRule extends RuleBaseModel {${RULE_COLUMNS}}`,
            [ON_CALL_RULE_FILE]: `import OnCallRuleBaseModel from "./DatabaseBaseModel/OnCallRuleBaseModel";
export default class WidgetOnCallRule extends OnCallRuleBaseModel {${RULE_COLUMNS}}`,
            [ON_CALL_BASE_FILE]: `import RuleBaseModel from "./RuleBaseModel";
export default class OnCallRuleBaseModel extends RuleBaseModel {}`,
          }),
        );
      };

    const findIn: (model: string, fields: string) => Array<string> = (
      model: string,
      fields: string,
    ): Array<string> => {
      return ruleFinder()
        .find(
          PAGE_FILE,
          `import ${model} from "Common/Models/DatabaseModels/${model}";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
const page = <ModelTable modelType={${model}} formFields={[${fields}]} />;`,
        )
        .map((field: FormColumnDescription): string => {
          return `${field.model}.${field.column}: ${field.text}`;
        });
    };

    test("a rule model's match-criteria field is drawn by the builder; its other steps' fields still draw theirs", () => {
      expect(
        findIn(
          "WidgetRule",
          `{ field: { monitors: true }, stepId: "match-criteria", fieldType: FormFieldSchemaType.MultiSelectDropdown },
           { field: { note: true }, stepId: "details", fieldType: FormFieldSchemaType.LongText },
           { field: { monitors: true }, fieldType: FormFieldSchemaType.MultiSelectDropdown }`,
        ),
      ).toEqual([
        "WidgetRule.note: What the rule's note is for.",
        "WidgetRule.monitors: Only trigger for widgets from these monitors. Leave empty to match any monitor.",
      ]);
    });

    test("through a rule base of its own, and with the step named by its constant", () => {
      expect(
        findIn(
          "WidgetOnCallRule",
          `{ field: { monitors: true }, stepId: MATCH_CRITERIA_STEP_ID, fieldType: FormFieldSchemaType.MultiSelectDropdown },
           { field: { note: true }, stepId: 'match-criteria', fieldType: FormFieldSchemaType.LongText }`,
        ),
      ).toEqual([]);
    });

    test("a model that is no rule draws its match step's descriptions: no builder replaces them", () => {
      expect(
        findIn(
          "Widget",
          `{ field: { notes: true }, stepId: "match-criteria", fieldType: FormFieldSchemaType.LongText }`,
        ),
      ).toEqual(["Widget.notes: What the notes are for."]);
    });
  });

  test("the model is read from a models directory only, through the Common alias or a relative path", () => {
    const field: string = `
      const page = (
        <ModelTable
          modelType={Widget}
          formFields={[{ field: { notes: true }, fieldType: FormFieldSchemaType.LongText }]}
        />
      );`;

    expect(
      find(
        `import Widget from "../../../../../Common/Models/DatabaseModels/Widget";${field}`,
      ),
    ).toEqual(["Widget.notes: What the notes are for."]);
    expect(find(`import Widget from "../Types/Widget";${field}`)).toEqual([]);
    expect(
      find(
        `import Widget from "Common/Models/DatabaseModels/MissingWidget";${field}`,
      ),
    ).toEqual([]);
  });

  describe("in a scan of the source roots", () => {
    let repository: string = "";

    beforeAll(() => {
      repository = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-columns-"));

      const write: (relativePath: string, content: string) => void = (
        relativePath: string,
        content: string,
      ): void => {
        const filePath: string = path.join(repository, relativePath);

        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
      };

      write("packages/Common/Models/DatabaseModels/Widget.ts", WIDGET);
      write(
        "ui/Pages/Widgets.tsx",
        `${IMPORTS}
const page = (
  <ModelTable
    modelType={Widget}
    formFields={[{ field: { notes: true }, fieldType: FormFieldSchemaType.LongText }]}
  />
);`,
      );
      write(
        "keys/Widgets.tsx",
        `${IMPORTS}
const page = (
  <ModelTable
    modelType={Widget}
    formFields={[{ field: { pattern: true }, fieldType: FormFieldSchemaType.Text }]}
  />
);`,
      );
    });

    afterAll(() => {
      fs.rmSync(repository, { recursive: true, force: true });
    });

    test("a ui root's forms give their columns' descriptions, of the column kind; a keys root's do not", () => {
      const result: SourceScanResult = scanSourceRoots(
        [
          { directory: "ui", kind: "ui" },
          { directory: "keys", kind: "keys" },
          {
            directory: "packages/Common/Models/DatabaseModels",
            kind: "models",
          },
        ],
        repository,
      );

      expect(
        result.strings
          .filter((entry: ExtractedString): boolean => {
            return entry.kind === "column";
          })
          .map((entry: ExtractedString): string => {
            return `${entry.file}:${entry.line} ${entry.text}`;
          }),
      ).toEqual(["ui/Pages/Widgets.tsx:6 What the notes are for."]);

      // A model gives its column titles, never its column descriptions.
      expect(textsOf(result)).toEqual(
        expect.arrayContaining(["Name", "Pattern", "Notes", "Size"]),
      );
      expect(textsOf(result)).not.toContain(
        "Regex matched against the widget name. Leave empty to match any name.",
      );
    });
  });
});
