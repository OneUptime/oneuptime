import { describe, expect, test } from "@jest/globals";
import readHelpDocument, {
  HelpDocument,
  HelpSection,
  findHelpHeadings,
  getHelpHeadingText,
  trimHelpText,
} from "../../../../UI/Components/Help/HelpDocument";
import {
  getHelpFeedbackTopic,
  HELP_FEEDBACK_TOPIC_PREFIX,
} from "../../../../UI/Components/Help/HelpContent";

/*
 * A help document read as what it says in short and its topics (#8889):
 * the help dialog lists the topics and opens each on its own, so where one
 * topic ends and the next begins decides what a person sees.
 */

const titlesOf: (document: HelpDocument) => Array<string> = (
  document: HelpDocument,
): Array<string> => {
  return document.sections.map((section: HelpSection): string => {
    return section.title;
  });
};

describe("a help document's lead and topics", () => {
  test("the lead is what comes before the first topic, and each ## heading is a topic", () => {
    const document: HelpDocument = readHelpDocument(`
An SLO is a reliability target.

It has an error budget.

## Set Up an SLO

1. Create it.
2. Attach monitors.

## Statuses

| Status | Meaning |
|--------|---------|
| Healthy | Fine |
`);

    expect(document.summary).toBe(
      "An SLO is a reliability target.\n\nIt has an error budget.",
    );
    expect(titlesOf(document)).toEqual(["Set Up an SLO", "Statuses"]);
    expect(document.sections[0]!.markdown).toBe(
      "1. Create it.\n2. Attach monitors.",
    );
    expect(document.sections[1]!.markdown).toContain("| Healthy | Fine |");
  });

  test("deeper headings stay inside their topic", () => {
    const document: HelpDocument = readHelpDocument(`Lead.

## Processors

### Grok Parser

Parses text.

### Severity Remapper

Sets the severity.

## Order

Processors run in order.
`);

    expect(titlesOf(document)).toEqual(["Processors", "Order"]);
    expect(document.sections[0]!.markdown).toBe(
      "### Grok Parser\n\nParses text.\n\n### Severity Remapper\n\nSets the severity.",
    );
  });

  test("an older document of ### headings reads its ### headings as topics", () => {
    const document: HelpDocument = readHelpDocument(`
### How SLOs Work

A target.

---

### Archiving

Archive an SLO.
`);

    expect(document.summary).toBe("");
    expect(titlesOf(document)).toEqual(["How SLOs Work", "Archiving"]);
  });

  test("the lines drawn between topics go, and a line inside a topic stays", () => {
    const document: HelpDocument = readHelpDocument(`Lead.

---

## First

Above.

***

Below.

---

## Second

Text.

___
`);

    expect(document.summary).toBe("Lead.");
    expect(document.sections[0]!.markdown).toBe("Above.\n\n***\n\nBelow.");
    expect(document.sections[1]!.markdown).toBe("Text.");
  });

  test("a heading inside a fenced code block is code, not a topic", () => {
    const document: HelpDocument = readHelpDocument(`Lead.

## Install

\`\`\`bash
# install the agent
curl -sSL https://example.com/install.sh | bash
\`\`\`

~~~yaml
## not a heading either
key: value
~~~

## Verify

Check the host.
`);

    expect(titlesOf(document)).toEqual(["Install", "Verify"]);
    expect(document.sections[0]!.markdown).toContain("# install the agent");
    expect(document.sections[0]!.markdown).toContain("## not a heading either");
  });

  test("a fence closes only on the same character, at least as long", () => {
    const document: HelpDocument = readHelpDocument(`Lead.

## One

\`\`\`\`
\`\`\`
## still code
\`\`\`\`

## Two

Text.
`);

    expect(titlesOf(document)).toEqual(["One", "Two"]);
    expect(document.sections[0]!.markdown).toContain("## still code");
  });

  test("a document with no headings is all lead, with no topics", () => {
    const document: HelpDocument = readHelpDocument(
      "\n\nWhat a monitor is.\n\n",
    );

    expect(document).toEqual({ summary: "What a monitor is.", sections: [] });
  });

  test("an empty or missing document reads as nothing", () => {
    expect(readHelpDocument("")).toEqual({ summary: "", sections: [] });
    expect(readHelpDocument(undefined as unknown as string)).toEqual({
      summary: "",
      sections: [],
    });
  });

  test("a heading with nothing under it has nothing to open, so it is left out", () => {
    const document: HelpDocument = readHelpDocument(`Lead.

## Empty

---

## Full

Text.
`);

    expect(titlesOf(document)).toEqual(["Full"]);
  });

  test("Windows line endings read as any others", () => {
    const document: HelpDocument = readHelpDocument(
      "Lead.\r\n\r\n## Topic\r\n\r\nText.\r\n",
    );

    expect(document.summary).toBe("Lead.");
    expect(document.sections).toEqual([
      { id: "topic", title: "Topic", markdown: "Text." },
    ]);
  });

  test("a heading's closing hashes and markdown are not part of its title", () => {
    const document: HelpDocument = readHelpDocument(`Lead.

## **Match** \`Criteria\` ##

Text.

## [Docs](https://oneuptime.com/docs) and *more*

Text.
`);

    expect(titlesOf(document)).toEqual(["Match Criteria", "Docs and more"]);
  });
});

describe("a topic's id", () => {
  test("is made from its title, once per document", () => {
    const document: HelpDocument = readHelpDocument(`Lead.

## Match Criteria

A.

## Match Criteria

B.

## Match Criteria

C.
`);

    expect(
      document.sections.map((section: HelpSection): string => {
        return section.id;
      }),
    ).toEqual(["match-criteria", "match-criteria-2", "match-criteria-3"]);
  });

  test("keeps letters of every script, and drops accents", () => {
    const document: HelpDocument = readHelpDocument(`Lead.

## Règles d'étiquettes

A.

## 監視ルール

B.

## !!!

C.
`);

    expect(
      document.sections.map((section: HelpSection): string => {
        return section.id;
      }),
    ).toEqual(["regles-d-etiquettes", "監視ルール", "topic-3"]);
  });
});

describe("the pieces the reader is made of", () => {
  test("findHelpHeadings names each heading's line and level", () => {
    expect(
      findHelpHeadings(["Lead", "", "## One", "text", "### Two", "#NoSpace"]),
    ).toEqual([
      { index: 2, level: 2, text: "One" },
      { index: 4, level: 3, text: "Two" },
    ]);
  });

  test("getHelpHeadingText reads a heading's words as they are drawn", () => {
    expect(getHelpHeadingText("Set Up **an** SLO")).toBe("Set Up an SLO");
    expect(getHelpHeadingText("The `Labels to Add` Field")).toBe(
      "The Labels to Add Field",
    );
    expect(getHelpHeadingText("snake_case_name stays")).toBe(
      "snake_case_name stays",
    );
  });

  test("trimHelpText drops blank lines and drawn lines at both ends only", () => {
    expect(
      trimHelpText(["", "---", "Text", "", "---", "More", "***", ""]),
    ).toBe("Text\n\n---\nMore");
  });
});

describe("where Was this clear? files a help dialog's answers", () => {
  test("under its English title, as a word the code chose", () => {
    expect(getHelpFeedbackTopic("How SLOs Work")).toBe("help.how_slos_work");
    expect(getHelpFeedbackTopic("How On-Call Policy Owner Rules Work")).toBe(
      "help.how_on-call_policy_owner_rules_work",
    );
    expect(
      getHelpFeedbackTopic("Copying custom field values (from a resource)"),
    ).toBe("help.copying_custom_field_values_from_a_resource");
    expect(
      getHelpFeedbackTopic("How SLOs Work").startsWith(
        HELP_FEEDBACK_TOPIC_PREFIX,
      ),
    ).toBe(true);
  });
});
