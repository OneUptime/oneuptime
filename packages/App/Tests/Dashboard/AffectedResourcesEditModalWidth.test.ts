import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every modal that edits affected resources must be at least Medium wide.
 *
 * The Affected Resources cards on the incident, alert and scheduled
 * maintenance pages (and on both kinds of template) opened their Edit modal
 * at the default width: ModelFormModal falls back to ModalWidth.Normal, 512px,
 * for a form without steps. The picker's placeholder names every resource
 * type the page offers - eleven to thirteen of them - and the chips, the
 * search input and the results panel all had about 464px to share, so the
 * placeholder was cut off and the modal looked cramped next to the Create
 * page's full-width picker.
 *
 * How the results panel escapes the modal's scrolling body is covered where
 * it can render:
 *   Common/Tests/App/Dashboard/AffectedResourcesPickerDropdownPlacement.test.tsx
 * This App suite has no renderer, so the width is pinned by reading the
 * sources (comment-stripped, whitespace-squashed). The scan follows every
 * picker editor to the component whose form it is in, rather than naming the
 * five cards, so a new Affected Resources modal joins the check on its own.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BLOCK_COMMENT_PATTERN: RegExp = /\/\*[\s\S]*?\*\//g;
// A `//` that is not part of a URL (`https://`) or inside a quote.
const LINE_COMMENT_PATTERN: RegExp = /(^|[^:"'`])\/\/.*$/gm;
const WHITESPACE_PATTERN: RegExp = /\s+/g;

/*
 * The components a picker editor's form can belong to. CardModelDetail and
 * ModelTable edit in a ModelFormModal sized by `createEditModalWidth`;
 * ModelForm is a full-page form (the Create wizards), where no modal width
 * comes into it.
 */
const MODAL_FORM_OWNERS: Array<string> = ["CardModelDetail", "ModelTable"];
const PAGE_FORM_OWNERS: Array<string> = ["ModelForm"];
const FORM_OWNERS: Array<string> = [...MODAL_FORM_OWNERS, ...PAGE_FORM_OWNERS];

const WIDE_ENOUGH_WIDTHS: Array<string> = [
  "ModalWidth.Medium",
  "ModalWidth.Large",
];

interface SourceFile {
  // Relative to the Dashboard's src folder.
  file: string;
  source: string;
}

interface OpeningTag {
  component: string;
  start: number;
  end: number;
  source: string;
}

interface PickerEditorUsage {
  // The file the owning component is rendered in.
  file: string;
  component: string;
  // The owner's whole opening tag: every prop it is given.
  ownerTag: string;
  // "inline", or the name of the function that builds the form fields.
  via: string;
  width: string | undefined;
}

interface ScanResult {
  usages: Array<PickerEditorUsage>;
  // Pickers whose form this scan could not trace to an owner.
  unclassified: Array<string>;
}

function normalizeSource(text: string): string {
  return text
    .replace(BLOCK_COMMENT_PATTERN, " ")
    .replace(LINE_COMMENT_PATTERN, "$1 ")
    .replace(WHITESPACE_PATTERN, " ");
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];
  const sourceFilePattern: RegExp = /\.tsx$/;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (sourceFilePattern.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

/*
 * Where the JSX opening tag that starts at `start` ends. Braces are counted so
 * the `>` of an arrow function or of JSX inside a prop does not end it, a
 * generic argument (`<CardModelDetail<Incident>`) is skipped, and a quoted
 * prop is skipped whole - the templates table is named
 * "Settings > Scheduled Maintenance Templates".
 */
function openingTagEnd(source: string, start: number, name: string): number {
  let index: number = start + 1 + name.length;

  if (source[index] === "<") {
    let angleDepth: number = 0;
    for (; index < source.length; index++) {
      if (source[index] === "<") {
        angleDepth++;
      } else if (source[index] === ">") {
        angleDepth--;
        if (angleDepth === 0) {
          index++;
          break;
        }
      }
    }
  }

  let braceDepth: number = 0;
  for (; index < source.length; index++) {
    const char: string = source[index]!;
    if (braceDepth === 0 && char === '"') {
      index = source.indexOf('"', index + 1);
      if (index < 0) {
        break;
      }
      continue;
    }
    if (char === "{") {
      braceDepth++;
    } else if (char === "}") {
      braceDepth--;
    } else if (braceDepth === 0 && char === ">") {
      return index + 1;
    }
  }

  throw new Error(`Unterminated <${name} opening tag`);
}

function openingTags(source: string): Array<OpeningTag> {
  const tags: Array<OpeningTag> = [];
  const tagPattern: RegExp = new RegExp(
    `<(${FORM_OWNERS.join("|")})(?=[\\s<>/])`,
    "g",
  );

  for (const match of source.matchAll(tagPattern)) {
    const start: number = match.index!;
    const component: string = match[1]!;
    const end: number = openingTagEnd(source, start, component);
    tags.push({
      component,
      start,
      end,
      source: source.slice(start, end),
    });
  }

  return tags;
}

/*
 * Every picker that edits: a `<AffectedResourcesPicker` whose nearest
 * preceding render hook is `getCustomElement` (one inside
 * `getSummaryElement` is a wizard's summary), and that is not read-only.
 */
function pickerEditorIndexes(source: string): Array<number> {
  const indexes: Array<number> = [];
  let from: number = 0;

  for (;;) {
    const at: number = source.indexOf("<AffectedResourcesPicker", from);
    if (at < 0) {
      break;
    }
    from = at + 1;

    const editorHook: number = source.lastIndexOf("getCustomElement:", at);
    const summaryHook: number = source.lastIndexOf("getSummaryElement:", at);
    const element: string = source.slice(at, source.indexOf("/>", at) + 2);
    if (
      editorHook < 0 ||
      summaryHook > editorHook ||
      element.includes("readOnly={true}")
    ) {
      continue;
    }
    indexes.push(at);
  }

  return indexes;
}

function widthOf(ownerTag: string): string | undefined {
  return ownerTag.match(/createEditModalWidth=\{(ModalWidth\.\w+)\}/)?.[1];
}

// The argument list of the call that opens at `openParen`.
function callArguments(source: string, openParen: number): string {
  let depth: number = 0;
  for (let index: number = openParen; index < source.length; index++) {
    if (source[index] === "(") {
      depth++;
    } else if (source[index] === ")") {
      depth--;
      if (depth === 0) {
        return source.slice(openParen + 1, index);
      }
    }
  }
  throw new Error("Unbalanced call");
}

/*
 * A picker outside any owner's tag is in a function that builds the form
 * fields, which owners call as `formFields={builder(...)}` - in the same file
 * or in a file that imports it. An owner that passes
 * `excludeAffectedResources: true` gets the fields without the picker, which
 * the builder honours with `if (!data.excludeAffectedResources)`.
 */
function builderConsumers(
  builder: string,
  builderFile: SourceFile,
  files: Array<SourceFile>,
): Array<PickerEditorUsage> {
  const usages: Array<PickerEditorUsage> = [];
  const builderModule: string = path.basename(builderFile.file, ".tsx");
  const importPattern: RegExp = new RegExp(
    `import [^;]*\\b${builder}\\b[^;]* from "[^"]*/${builderModule}"`,
  );
  const callNeedle: string = `formFields={${builder}(`;

  for (const candidate of files) {
    if (
      candidate.file !== builderFile.file &&
      !importPattern.test(candidate.source)
    ) {
      continue;
    }

    for (const tag of openingTags(candidate.source)) {
      const callAt: number = tag.source.indexOf(callNeedle);
      if (callAt < 0) {
        continue;
      }
      const args: string = callArguments(
        tag.source,
        callAt + callNeedle.length - 1,
      );
      if (
        args.includes("excludeAffectedResources: true") &&
        builderFile.source.includes("if (!data.excludeAffectedResources)")
      ) {
        continue;
      }
      usages.push({
        file: candidate.file,
        component: tag.component,
        ownerTag: tag.source,
        via: builder,
        width: widthOf(tag.source),
      });
    }
  }

  return usages;
}

function scan(files: Array<SourceFile>): ScanResult {
  const usages: Array<PickerEditorUsage> = [];
  const unclassified: Array<string> = [];

  const builderNames: Set<string> = new Set();
  for (const entry of files) {
    for (const match of entry.source.matchAll(
      /formFields=\{([A-Za-z_$][\w$]*)\(/g,
    )) {
      builderNames.add(match[1]!);
    }
  }

  for (const entry of files) {
    const tags: Array<OpeningTag> = openingTags(entry.source);
    const buildersSeen: Set<string> = new Set();

    for (const pickerAt of pickerEditorIndexes(entry.source)) {
      // The innermost owner whose opening tag holds the picker.
      const owner: OpeningTag | undefined = tags
        .filter((tag: OpeningTag) => {
          return tag.start < pickerAt && pickerAt < tag.end;
        })
        .sort((a: OpeningTag, b: OpeningTag) => {
          return b.start - a.start;
        })[0];

      if (owner) {
        usages.push({
          file: entry.file,
          component: owner.component,
          ownerTag: owner.source,
          via: "inline",
          width: widthOf(owner.source),
        });
        continue;
      }

      const declarations: Array<RegExpMatchArray> = Array.from(
        entry.source
          .slice(0, pickerAt)
          .matchAll(/(?:const|function) ([A-Za-z_$][\w$]*)\b/g),
      ).filter((match: RegExpMatchArray) => {
        return builderNames.has(match[1]!);
      });
      const builder: string | undefined =
        declarations[declarations.length - 1]?.[1];

      if (!builder) {
        unclassified.push(entry.file);
        continue;
      }
      if (buildersSeen.has(builder)) {
        continue;
      }
      buildersSeen.add(builder);

      const consumers: Array<PickerEditorUsage> = builderConsumers(
        builder,
        entry,
        files,
      );
      if (consumers.length === 0) {
        unclassified.push(entry.file);
      }
      usages.push(...consumers);
    }
  }

  return { usages, unclassified };
}

const describeUsage: (usage: PickerEditorUsage) => string = (
  usage: PickerEditorUsage,
): string => {
  return `${usage.file} <${usage.component}> (${usage.via})`;
};

const ALL_FILES: Array<SourceFile> = listSourceFiles(DASHBOARD_SRC).map(
  (file: string): SourceFile => {
    return {
      file: path.relative(DASHBOARD_SRC, file),
      source: normalizeSource(fs.readFileSync(file, "utf8")),
    };
  },
);

const RESULT: ScanResult = scan(ALL_FILES);

const MODAL_USAGES: Array<PickerEditorUsage> = RESULT.usages.filter(
  (usage: PickerEditorUsage) => {
    return MODAL_FORM_OWNERS.includes(usage.component);
  },
);

const AFFECTED_RESOURCES_CARDS: Array<string> = [
  path.join("Pages", "Incidents", "View", "Index.tsx"),
  path.join("Pages", "Alerts", "View", "Index.tsx"),
  path.join("Pages", "ScheduledMaintenanceEvents", "View", "Index.tsx"),
  path.join("Pages", "Incidents", "Settings", "IncidentTemplatesView.tsx"),
  path.join(
    "Pages",
    "ScheduledMaintenanceEvents",
    "Settings",
    "ScheduledMaintenanceTemplateView.tsx",
  ),
];

describe("the scan itself", () => {
  /*
   * A scan that finds nothing passes every check below, so its moving parts
   * are pinned on small sources first.
   */
  const scanOne: (source: string) => ScanResult = (
    source: string,
  ): ScanResult => {
    return scan([
      { file: path.join("Pages", "Fake.tsx"), source: normalizeSource(source) },
    ]);
  };

  const cardWithPicker: (widthProp: string) => string = (
    widthProp: string,
  ): string => {
    return `
      <CardModelDetail<Incident>
        name="Affected Resources"
        cardProps={{ title: "Affected Resources" }}
        ${widthProp}
        isEditable={true}
        formFields={[
          {
            field: { monitors: true },
            getCustomElement: (values: FormValues<Incident>) => {
              return (
                <AffectedResourcesPicker
                  monitors={values.monitors as Array<Monitor>}
                  onChange={(payload: unknown) => {
                    return payload;
                  }}
                />
              );
            },
          },
        ]}
        modelDetailProps={{ modelType: Incident }}
      />`;
  };

  test("finds a card's width however far after the picker it is", () => {
    const result: ScanResult = scanOne(
      cardWithPicker("").replace(
        "modelDetailProps",
        "createEditModalWidth={ModalWidth.Medium} modelDetailProps",
      ),
    );

    expect(result.unclassified).toEqual([]);
    expect(result.usages).toHaveLength(1);
    expect(result.usages[0]!.component).toBe("CardModelDetail");
    expect(result.usages[0]!.width).toBe("ModalWidth.Medium");
  });

  test("reports a card with no width", () => {
    const result: ScanResult = scanOne(cardWithPicker(""));

    expect(result.usages).toHaveLength(1);
    expect(result.usages[0]!.width).toBeUndefined();
  });

  test("gives the width to the card that holds the picker, not its neighbour", () => {
    const result: ScanResult = scanOne(`
      <CardModelDetail<Incident>
        name="Incident Details"
        createEditModalWidth={ModalWidth.Large}
        formFields={[{ field: { title: true } }]}
      />
      ${cardWithPicker("")}`);

    expect(result.usages).toHaveLength(1);
    expect(result.usages[0]!.ownerTag).toContain('name="Affected Resources"');
    expect(result.usages[0]!.width).toBeUndefined();
  });

  test("skips a summary picker and a read-only one", () => {
    const result: ScanResult = scanOne(`
      <ModelForm<Alert>
        fields={[
          {
            getSummaryElement: (item: FormValues<Alert>) => {
              return <AffectedResourcesPicker readOnly={true} />;
            },
          },
          {
            getCustomElement: (values: FormValues<Alert>) => {
              return <AffectedResourcesPicker readOnly={true} />;
            },
          },
        ]}
      />`);

    expect(result.usages).toEqual([]);
    expect(result.unclassified).toEqual([]);
  });

  test("a picker in no form it can trace is reported, not skipped", () => {
    const result: ScanResult = scanOne(`
      const Anywhere = () => {
        return {
          getCustomElement: () => {
            return <AffectedResourcesPicker onChange={() => {}} />;
          },
        };
      };`);

    expect(result.unclassified).toEqual([path.join("Pages", "Fake.tsx")]);
  });
});

describe("modals that edit affected resources", () => {
  test("the scan finds every one of them, and the full-page Create forms", () => {
    // A floor, not the full list: a new picker modal joins the checks on its own.
    expect(
      MODAL_USAGES.filter((usage: PickerEditorUsage) => {
        return usage.component === "CardModelDetail";
      }).map((usage: PickerEditorUsage) => {
        return usage.file;
      }),
    ).toEqual(expect.arrayContaining(AFFECTED_RESOURCES_CARDS));

    expect(
      MODAL_USAGES.filter((usage: PickerEditorUsage) => {
        return usage.component === "ModelTable";
      }).map(describeUsage),
    ).toEqual(
      expect.arrayContaining([
        `${path.join("Pages", "Incidents", "Settings", "IncidentTemplates.tsx")} <ModelTable> (inline)`,
        `${path.join("Pages", "ScheduledMaintenanceEvents", "Settings", "ScheduledMaintenanceTemplates.tsx")} <ModelTable> (getTemplateFormFields)`,
      ]),
    );

    expect(
      RESULT.usages
        .filter((usage: PickerEditorUsage) => {
          return PAGE_FORM_OWNERS.includes(usage.component);
        })
        .map((usage: PickerEditorUsage) => {
          return usage.file;
        }),
    ).toEqual(
      expect.arrayContaining([
        path.join("Pages", "Alerts", "Create.tsx"),
        path.join("Pages", "Incidents", "Create.tsx"),
        path.join("Pages", "ScheduledMaintenanceEvents", "Create.tsx"),
      ]),
    );
  });

  test("every picker editor is in a form the scan can trace", () => {
    expect(RESULT.unclassified).toEqual([]);
  });

  test("every one of them is at least Medium wide", () => {
    const tooNarrow: Array<string> = MODAL_USAGES.filter(
      (usage: PickerEditorUsage) => {
        return !usage.width || !WIDE_ENOUGH_WIDTHS.includes(usage.width);
      },
    ).map((usage: PickerEditorUsage) => {
      return `${describeUsage(usage)}: ${usage.width || "default (Normal)"}`;
    });

    expect(tooNarrow).toEqual([]);
  });

  test.each(AFFECTED_RESOURCES_CARDS)(
    "%s: the Affected Resources card is the one that opens Medium",
    (file: string) => {
      const cards: Array<PickerEditorUsage> = MODAL_USAGES.filter(
        (usage: PickerEditorUsage) => {
          return (
            usage.file === file &&
            usage.component === "CardModelDetail" &&
            usage.ownerTag.includes('name="Affected Resources"')
          );
        },
      );

      /*
       * One card, however many pickers it holds: an incident template's
       * monitors have a picker of their own, above the one for the rest.
       */
      expect(
        new Set(
          cards.map((usage: PickerEditorUsage): string => {
            return usage.ownerTag;
          }),
        ).size,
      ).toBe(1);
      expect(cards[0]!.width).toBe("ModalWidth.Medium");
    },
  );

  test("a template details card that leaves the picker out is not counted", () => {
    /*
     * The scheduled maintenance template page builds its details card from the
     * same field builder as the templates table, with the affected resources
     * excluded - that card has no picker, so its width is not this suite's
     * business.
     */
    const viewPage: string = path.join(
      "Pages",
      "ScheduledMaintenanceEvents",
      "Settings",
      "ScheduledMaintenanceTemplateView.tsx",
    );
    const viewPageSource: string = ALL_FILES.find((entry: SourceFile) => {
      return entry.file === viewPage;
    })!.source;

    expect(viewPageSource).toContain("excludeAffectedResources: true");
    expect(
      MODAL_USAGES.filter((usage: PickerEditorUsage) => {
        return usage.file === viewPage;
      }).map((usage: PickerEditorUsage) => {
        return usage.via;
      }),
    ).toEqual(["inline"]);
  });
});
