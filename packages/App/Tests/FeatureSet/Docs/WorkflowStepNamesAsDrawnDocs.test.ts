import {
  TRANSLATED_LANGUAGES,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { dashboardLocale } from "./DocsDashboardLabels";
import { prose } from "./DocsTranslationChecks";
import {
  OtherWord,
  WORKFLOW_STEP_NAMES,
  WORKFLOW_STEP_OUTPUTS,
  WORKFLOW_STEP_PAGES,
  WORKFLOW_STEP_TITLES,
  WorkflowStepPage,
  drawnStepName,
  isDrawnOtherwise,
  isLookedUp,
  isStepNameOnPage,
} from "./DocsWorkflowStepNames";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DOCS NAME A WORKFLOW STEP'S OWN NAMES AS EACH LANGUAGE'S DASHBOARD
 * DRAWS THEM (#7511).
 *
 * A step's outputs (Success, Error, Yes, No, Out), its settings (Incident
 * Template, Message Text, Port, Channel), its choices and the values it
 * returns (Request Body, Response Body) were quoted in English on every
 * translated page, as the builder once drew them; the builder draws them
 * in the reader's language now (DocsWorkflowStepNames says where). A German
 * reader was told to follow the Success output the canvas calls Erfolg.
 *
 * These hold every page that walks through workflow steps to the words its
 * language's builder draws:
 *   - no bold name a step defines stays in English where the language's
 *     Dashboard words it, and every one the English page bolds is named as
 *     drawn, in a sentence or a table;
 *   - the diagrams of a workflow's steps label each output, and each step
 *     the Dashboard has a word for, as the canvas draws them;
 *   - what stays as written is listed with why: another product's words
 *     that happen to be a step's name too (OtherWord).
 * And they pin the builder's lookups, so the rule cannot drift from it.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

// A bold span, every time it occurs: boldSpans lists each once.
const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const MERMAID_FENCE: RegExp = /```mermaid[^\n]*\n([\s\S]*?)```/g;
/*
 * An edge's label: |"Success"| or |Success|, or one that starts "Success: "
 * ("Success : " in French).
 */
const EDGE_LABEL: RegExp = /\|"?([^"|]+?)"?\|/g;
// A node's label: ["Log"], {"If / Else"}, (["..."]).
const NODE_LABEL: RegExp = /(?:\[|\{|\(\[)"([^"]+)"(?:\]|\}|\]\))/g;

/*
 * The bold names of a page, in order, every time. A menu path's segments
 * are not among them: a path is a menu's, which the Dashboard's labels
 * already name (another product's, too: Zabbix's Users → User roles), and
 * never a step's own name.
 */
function boldNames(markdown: string): Array<string> {
  return Array.from(prose(markdown).matchAll(BOLD)).map(
    (match: RegExpMatchArray): string => {
      return (match[1] as string).trim();
    },
  );
}

function count(list: Array<string>, item: string): number {
  return list.filter((entry: string): boolean => {
    return entry === item;
  }).length;
}

function otherWordsOf(entry: WorkflowStepPage, name: string): Array<OtherWord> {
  return (entry.otherWords || []).filter((word: OtherWord): boolean => {
    return word.name === name;
  });
}

/*
 * How many of the English page's bold occurrences of a step's name are
 * the step's (the rest are another product's word: OtherWord).
 */
function stepOccurrences(entry: WorkflowStepPage, name: string): number {
  const all: number = count(boldNames(readPage("en", entry.page)), name);
  const others: Array<OtherWord> = otherWordsOf(entry, name);

  if (others.length === 0) {
    return all;
  }

  return others.some((word: OtherWord): boolean => {
    return !word.occurrences;
  })
    ? 0
    : all -
        others.reduce((total: number, word: OtherWord): number => {
          return total + (word.occurrences || []).length;
        }, 0);
}

// The step names an English page bolds: each a name a step defines there.
function stepNamesOn(entry: WorkflowStepPage): Array<string> {
  return Array.from(new Set(boldNames(readPage("en", entry.page)))).filter(
    (name: string): boolean => {
      return (
        isStepNameOnPage(entry.page, name) && stepOccurrences(entry, name) > 0
      );
    },
  );
}

// An edge a workflow's steps take: Success, Error or Out.
const STEP_EDGE: RegExp = /\|"?(Success|Error|Out)("|:|\|)/;

// The diagrams of a workflow's steps: an edge says Success, Error or Out.
function stepDiagramsOf(markdown: string): Array<string | null> {
  return Array.from(markdown.matchAll(MERMAID_FENCE)).map(
    (match: RegExpMatchArray): string | null => {
      const code: string = match[1] as string;

      return STEP_EDGE.test(code) ? code : null;
    },
  );
}

// An edge label's output: "Success" for "Success" and "Success: a 2xx answer".
function edgeOutput(label: string): string {
  const colon: number = label.indexOf(":");

  return colon > 0 ? label.slice(0, colon).trim() : label;
}

function edgeOutputs(code: string): Array<string> {
  return Array.from(code.matchAll(EDGE_LABEL)).map(
    (match: RegExpMatchArray): string => {
      return edgeOutput(match[1] as string);
    },
  );
}

// A diagram's line break (<br/>), which keeps a long label inside the docs column.
const LABEL_BREAK: RegExp = /<br\/>/g;

/*
 * A diagram's node labels, each also as one line: a title broken to fit
 * the column is still the title (" " where the break stands for a space,
 * nothing where a Chinese or Japanese line breaks between characters).
 */
function nodeTitles(code: string): Array<string> {
  return Array.from(code.matchAll(NODE_LABEL)).flatMap(
    (match: RegExpMatchArray): Array<string> => {
      const label: string = match[1] as string;

      return label.includes("<br/>")
        ? [
            label,
            label.replace(LABEL_BREAK, " "),
            label.replace(LABEL_BREAK, ""),
          ]
        : [label];
    },
  );
}

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
}

describe("the builder draws a step's names in the reader's language", () => {
  it("the canvas looks up a step's title and its outputs, keeping a Switch's cases", () => {
    const canvas: string = source(
      "packages/Common/UI/Components/Workflow/Component.tsx",
    );

    expect(canvas).toContain(
      "translator.translateText(props.data.metadata.title)",
    );
    expect(canvas).toContain("translator.translateText(port.title)");
    expect(canvas).toContain("isOutPortFromSettings");
  });

  it("the settings form titles a setting with its name, which FieldLabel looks up, and ChoiceRows its choices", () => {
    expect(
      source("packages/Common/UI/Components/Workflow/ArgumentsForm.tsx"),
    ).toContain("title: `${arg.name}`");
    expect(
      source("packages/Common/UI/Components/Forms/Fields/FieldLabel.tsx"),
    ).toContain("translateString(props.title)");
    expect(
      source("packages/Common/UI/Components/ChoiceRows/ChoiceRows.tsx"),
    ).toContain("translator.translateText(option.title)");
    expect(
      source("packages/Common/UI/Components/Workflow/RunForm.tsx"),
    ).toContain("title: `${argument.name}`");
  });

  it("the Outputs list and the run log look up a step's outputs", () => {
    expect(
      source("packages/Common/UI/Components/Workflow/ComponentPortViewer.tsx"),
    ).toContain("translator.translateText(port.title)");
    expect(
      source("packages/Common/UI/Components/Workflow/StepTraceViewer.tsx"),
    ).toContain("translator.translateText(props.title)");
  });

  it("the Returns list, the value picker, a chip and the run log name a returned value in the reader's words (#8316)", () => {
    const names: string = source(
      "packages/Common/UI/Components/Workflow/ReturnValueNames.ts",
    );

    expect(names).toContain(
      "translator.translateText(returnValue.name) || returnValue.name",
    );

    for (const file of [
      "packages/Common/UI/Components/Workflow/ComponentReturnValueViewer.tsx",
      "packages/Common/UI/Components/Workflow/ValuePicker/StepValueSource.ts",
      "packages/Common/UI/Components/Workflow/ValuePicker/StepSampleSource.ts",
      "packages/Common/UI/Components/Workflow/ValuePicker/ReferenceDescription.ts",
    ]) {
      expect({
        file,
        reads: source(file).includes("returnValueName("),
      }).toEqual({ file, reads: true });
    }

    expect(
      source("packages/Common/UI/Components/Workflow/StepTraceViewer.tsx"),
    ).toContain("translator.translateText(row.name) || row.name");
  });
});

describe("the names a step defines", () => {
  it("are the catalogue's: its outputs, settings, choices and values, with keys the docs read", () => {
    for (const name of [
      "Success",
      "Error",
      "Yes",
      "No",
      "Out",
      "Default",
      "Incident Template",
      "Message Text",
      "Port",
      "Channel",
      "Request Body",
      "Response Body",
      "Responders",
      "Value to check",
      "is equal to",
      "Fields to pass on",
    ]) {
      expect({ name, defined: WORKFLOW_STEP_NAMES.has(name) }).toEqual({
        name,
        defined: true,
      });
    }

    expect(WORKFLOW_STEP_OUTPUTS.has("Success")).toBe(true);
    expect(WORKFLOW_STEP_TITLES.has("Log")).toBe(true);
    expect(isLookedUp("Success")).toBe(true);
    // Every name of the step catalogue is a key since #8359.
    expect(isLookedUp("Send Message to Slack")).toBe(true);
    expect(
      Array.from(WORKFLOW_STEP_NAMES).filter((name: string): boolean => {
        return !isLookedUp(name);
      }),
    ).toEqual([]);
  });

  it("are drawn in German and Persian as the locales word them", () => {
    expect(drawnStepName("de", "Success")).toBe(
      dashboardLocale("de")["Success"],
    );
    expect(drawnStepName("de", "Success")).toBe("Erfolg");
    expect(drawnStepName("fa", "Success")).toBe("موفق");
    expect(drawnStepName("fa", "Incident Template")).toBe("قالب حادثه");
    expect(drawnStepName("de", "Response Body")).toBe("Antworttext");
    // Drawn in English in every language until #8359 gave them keys.
    expect(drawnStepName("de", "Send Message to Slack")).toBe(
      "Nachricht an Slack senden",
    );
    expect(drawnStepName("de", "Response Status")).toBe("Antwortstatus");
    expect(drawnStepName("fa", "IRC Server")).toBe("سرور IRC");
    expect(isDrawnOtherwise("de", "Send Message to Slack")).toBe(true);
    expect(isDrawnOtherwise("de", "Success")).toBe(true);
    /*
     * A record step's title is built from its model's name, from a sentence
     * every language words (#8642): drawn as that sentence, the model by
     * the language's word for it.
     */
    expect(dashboardLocale("en")["On Create Incident"]).toBeUndefined();
    expect(isLookedUp("On Create Incident")).toBe(true);
    expect(drawnStepName("de", "On Create Incident")).toBe(
      "Bei Erstellung: Vorfall",
    );
    expect(drawnStepName("de", "Find One Incident")).toBe(
      "Vorfall finden (einzeln)",
    );
    expect(drawnStepName("fa", "On Create Incident")).toBe("هنگام ساخت حادثه");
    expect(drawnStepName("ar", "Update One Alert")).toBe(
      "تحديث تنبيه (سجل واحد)",
    );
    expect(drawnStepName("en", "On Create Incident")).toBe(
      "On Create Incident",
    );
    expect(isDrawnOtherwise("de", "On Create Incident")).toBe(true);
    // The docs' trigger of any model reads as the same sentence, X its name.
    expect(drawnStepName("de", "On Create X")).toBe("Bei Erstellung: X");
    expect(drawnStepName("fr", "On Create or Update X")).toBe(
      "À la création ou à la mise à jour : X",
    );
    // A product's name is kept as written, on the same-as-English list.
    expect(isDrawnOtherwise("de", "Zabbix 6.0")).toBe(false);
  });

  it("are quoted as drawn on a translated page: the IRC step's settings in German, #8359's example", () => {
    const page: string = readPage("de", "integrations/irc");

    for (const name of [
      "Nachricht an IRC senden",
      "IRC-Server",
      "SASL-Benutzername",
      "Ohne Beitritt senden",
    ]) {
      expect(boldNames(page)).toContain(name);
    }

    for (const name of ["Send Message to IRC", "IRC Server", "SASL Username"]) {
      expect(boldNames(page)).not.toContain(name);
    }
  });
});

describe("the pages this test reads", () => {
  it.each(WORKFLOW_STEP_PAGES)(
    "$page names several of a step's names, and its other words are on it",
    (entry: WorkflowStepPage) => {
      const english: Array<string> = boldNames(readPage("en", entry.page));

      expect(stepNamesOn(entry).length).toBeGreaterThan(0);

      for (const word of entry.otherWords || []) {
        const occurrences: number = count(english, word.name);

        expect({
          page: entry.page,
          word: word.name,
          on: occurrences > 0,
        }).toEqual({ page: entry.page, word: word.name, on: true });
        expect(WORKFLOW_STEP_NAMES.has(word.name)).toBe(true);
        expect(word.why.length).toBeGreaterThan(10);

        for (const index of word.occurrences || []) {
          expect(index).toBeLessThan(occurrences);
        }
      }
    },
  );

  it("cover the workflow pages and every page that walks through a step", () => {
    const pages: Array<string> = WORKFLOW_STEP_PAGES.map(
      (entry: WorkflowStepPage): string => {
        return entry.page;
      },
    );

    for (const page of [
      "workflows/index",
      "workflows/components",
      "integrations/irc",
      "integrations/jira",
      "incidents/settings",
      "incidents/declaring-incidents",
      "incidents/notes-owners-and-feed",
    ]) {
      expect(pages).toContain(page);
    }
  });
});

describe.each(TRANSLATED_LANGUAGES)("%s", (language: string) => {
  describe.each(WORKFLOW_STEP_PAGES)("$page", (entry: WorkflowStepPage) => {
    const english: string = readPage("en", entry.page);

    it("is translated", () => {
      expect(hasPage(language, entry.page)).toBe(true);
    });

    it("keeps no step's name in English where this language's Dashboard words it", () => {
      const translated: Array<string> = boldNames(
        readPage(language, entry.page),
      );
      const left: Array<string> = stepNamesOn(entry)
        .filter((name: string): boolean => {
          return isDrawnOtherwise(language, name);
        })
        .filter((name: string): boolean => {
          // Another product's word, kept as written, is not counted.
          const kept: number =
            count(boldNames(english), name) - stepOccurrences(entry, name);

          return count(translated, name) > kept;
        })
        .map((name: string): string => {
          return `${name} -> ${drawnStepName(language, name)}`;
        });

      expect(left).toEqual([]);
    });

    it("names every step's name the English page bolds as this language's Dashboard draws it", () => {
      const translated: Array<string> = boldNames(
        readPage(language, entry.page),
      );
      const missing: Array<string> = stepNamesOn(entry)
        .filter((name: string): boolean => {
          return !translated.includes(drawnStepName(language, name));
        })
        .map((name: string): string => {
          return `${name} -> ${drawnStepName(language, name)}`;
        });

      expect(missing).toEqual([]);
    });

    it("labels the outputs and the steps of a workflow's diagrams as the canvas draws them", () => {
      const englishDiagrams: Array<string | null> = stepDiagramsOf(english);
      const translatedDiagrams: Array<string> = Array.from(
        readPage(language, entry.page).matchAll(MERMAID_FENCE),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      englishDiagrams.forEach((code: string | null, index: number) => {
        if (code === null) {
          return;
        }

        const translated: string = translatedDiagrams[index] || "";

        expect(edgeOutputs(translated).length).toBe(edgeOutputs(code).length);

        edgeOutputs(code).forEach((output: string, at: number) => {
          if (!WORKFLOW_STEP_OUTPUTS.has(output)) {
            return;
          }

          expect({ index, at, output: edgeOutputs(translated)[at] }).toEqual({
            index,
            at,
            output: drawnStepName(language, output),
          });
        });

        const titles: Array<string> = nodeTitles(translated);

        for (const title of nodeTitles(code)) {
          if (WORKFLOW_STEP_TITLES.has(title) && isLookedUp(title)) {
            expect({
              index,
              title: titles.includes(drawnStepName(language, title)),
            }).toEqual({ index, title: true });
          }
        }
      });
    });
  });
});

describe("the guard itself", () => {
  it("finds a step's name put back in English on a German page", () => {
    const page: string = readPage("de", "workflows/components");
    const reverted: string = page.replace("**Erfolg**", "**Success**");

    expect(reverted).not.toBe(page);
    expect(boldNames(reverted)).toContain("Success");
    expect(isDrawnOtherwise("de", "Success")).toBe(true);
  });

  it("finds a record step's title put back in English on a German page (#8708)", () => {
    const page: string = readPage("de", "integrations/irc");
    const reverted: string = page
      .split("**Bei Erstellung: Vorfall**")
      .join("**On Create Incident**");

    expect(reverted).not.toBe(page);
    expect(boldNames(page)).not.toContain("On Create Incident");
    expect(boldNames(reverted)).toContain("On Create Incident");
    expect(isStepNameOnPage("integrations/irc", "On Create Incident")).toBe(
      true,
    );
    expect(isDrawnOtherwise("de", "On Create Incident")).toBe(true);
    // Every model's record steps are named, X standing for any model's.
    expect(WORKFLOW_STEP_TITLES.has("On Create Alert")).toBe(true);
    expect(WORKFLOW_STEP_TITLES.has("Find Many Monitors")).toBe(true);
    expect(WORKFLOW_STEP_TITLES.has("On Create X")).toBe(true);
  });

  it("reads a page's bold names, a path whole, and a diagram's outputs", () => {
    expect(
      boldNames("**Users → User roles**, **Erfolg** and **Erfolg**"),
    ).toEqual(["Users → User roles", "Erfolg", "Erfolg"]);
    expect(
      edgeOutputs('a -->|"Success: a 2xx answer"| b\nb -->|Yes| c'),
    ).toEqual(["Success", "Yes"]);
    expect(nodeTitles('a["Log"] --> b{"If / Else"}')).toEqual([
      "Log",
      "If / Else",
    ]);
    // A title broken to fit the column is still the title.
    expect(nodeTitles('t["Bei Erstellung:<br/>Vorfall"]')).toContain(
      "Bei Erstellung: Vorfall",
    );
    expect(nodeTitles('t["创建<br/>事件时"]')).toContain("创建事件时");
    expect(scanMarkdown("```mermaid\nflowchart TB\n```\n").fences.length).toBe(
      1,
    );
  });
});
