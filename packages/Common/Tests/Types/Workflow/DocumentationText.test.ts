/*
 * The three marks a step's help may use - **name**, `literal` and
 * [label](https://...) - and nothing else. The point of keeping it this small
 * is that a literal can hold anything: Slack's *bold*, a {{...}} reference, a
 * JSON document. These pin that.
 */

import {
  DocumentationTextPart,
  DocumentationTextPartType,
  documentationTextToPlain,
  getDocumentationTextNames,
  parseDocumentationText,
} from "../../../Types/Workflow/Documentation/DocumentationText";
import { describe, expect, test } from "@jest/globals";

type PartsFunction = (text: string) => Array<[string, string]>;

// The parts as [type, text] pairs, which read better in a failure.
const parts: PartsFunction = (text: string): Array<[string, string]> => {
  return parseDocumentationText(text).map(
    (part: DocumentationTextPart): [string, string] => {
      return [part.type, part.text];
    },
  );
};

describe("parseDocumentationText", () => {
  test("plain text is one text part", () => {
    expect(parts("Connect the next step.")).toEqual([
      [DocumentationTextPartType.Text, "Connect the next step."],
    ]);
  });

  test("an empty string has no parts", () => {
    expect(parseDocumentationText("")).toEqual([]);
  });

  test("**name** is a name, with the text around it kept", () => {
    expect(parts("Connect **Success** to the next step.")).toEqual([
      [DocumentationTextPartType.Text, "Connect "],
      [DocumentationTextPartType.Name, "Success"],
      [DocumentationTextPartType.Text, " to the next step."],
    ]);
  });

  test("`literal` is a literal", () => {
    expect(parts("The ID is `_id`.")).toEqual([
      [DocumentationTextPartType.Text, "The ID is "],
      [DocumentationTextPartType.Literal, "_id"],
      [DocumentationTextPartType.Text, "."],
    ]);
  });

  test("a literal keeps formatting marks as they are", () => {
    // Slack's own bold and italic, which the old Markdown viewer reformatted.
    expect(parts("Use `*bold*` and `_italic_`.")).toEqual([
      [DocumentationTextPartType.Text, "Use "],
      [DocumentationTextPartType.Literal, "*bold*"],
      [DocumentationTextPartType.Text, " and "],
      [DocumentationTextPartType.Literal, "_italic_"],
      [DocumentationTextPartType.Text, "."],
    ]);
  });

  test("a literal can hold a reference with underscores and a double asterisk", () => {
    expect(
      parts(
        "Read `{{local.variables.my_var}}` or `**bold**` exactly as written.",
      ),
    ).toEqual([
      [DocumentationTextPartType.Text, "Read "],
      [DocumentationTextPartType.Literal, "{{local.variables.my_var}}"],
      [DocumentationTextPartType.Text, " or "],
      [DocumentationTextPartType.Literal, "**bold**"],
      [DocumentationTextPartType.Text, " exactly as written."],
    ]);
  });

  test("a link carries its label and its https URL", () => {
    const result: Array<DocumentationTextPart> = parseDocumentationText(
      "Create one ([Slack's guide](https://api.slack.com/messaging/webhooks)).",
    );

    expect(result).toEqual([
      { type: DocumentationTextPartType.Text, text: "Create one (" },
      {
        type: DocumentationTextPartType.Link,
        text: "Slack's guide",
        url: "https://api.slack.com/messaging/webhooks",
      },
      { type: DocumentationTextPartType.Text, text: ")." },
    ]);
  });

  test("only https links are links; anything else stays text", () => {
    for (const text of [
      "[a link](http://example.com)",
      "[a link](javascript:alert(1))",
      "[a link](/relative/path)",
    ]) {
      expect(
        parseDocumentationText(text).every((part: DocumentationTextPart) => {
          return part.type === DocumentationTextPartType.Text;
        }),
      ).toBe(true);
      expect(documentationTextToPlain(text)).toBe(text);
    }
  });

  test("a mark that is never closed shows as itself", () => {
    expect(parts("Multiply 2 * 3, or type a ` on its own.")).toEqual([
      [
        DocumentationTextPartType.Text,
        "Multiply 2 * 3, or type a ` on its own.",
      ],
    ]);
    expect(parts("An **unfinished name")).toEqual([
      [DocumentationTextPartType.Text, "An **unfinished name"],
    ]);
  });

  test("empty marks are not marks", () => {
    expect(parts("``")).toEqual([[DocumentationTextPartType.Text, "``"]]);
    expect(parts("****")).toEqual([[DocumentationTextPartType.Text, "****"]]);
  });

  test("marks side by side", () => {
    expect(parts("**Yes**`/`**No**")).toEqual([
      [DocumentationTextPartType.Name, "Yes"],
      [DocumentationTextPartType.Literal, "/"],
      [DocumentationTextPartType.Name, "No"],
    ]);
  });

  test("a name may hold punctuation, such as If / Else or an arrow", () => {
    expect(
      getDocumentationTextNames(
        "Use an **If / Else** step, under **Project Settings → AI → LLM Providers**.",
      ),
    ).toEqual(["If / Else", "Project Settings → AI → LLM Providers"]);
  });
});

describe("getDocumentationTextNames", () => {
  test("lists every name in order, and only names", () => {
    expect(
      getDocumentationTextNames(
        "Connect **Success**, and **Error** for `anything` else ([guide](https://example.com)).",
      ),
    ).toEqual(["Success", "Error"]);
  });

  test("a name inside a literal is not a name", () => {
    expect(getDocumentationTextNames("Type `**bold**` in Discord.")).toEqual(
      [],
    );
  });
});

describe("documentationTextToPlain", () => {
  test("drops the marks and keeps the words", () => {
    expect(
      documentationTextToPlain(
        "Connect **Success** to `next-step` ([guide](https://example.com)).",
      ),
    ).toBe("Connect Success to next-step (guide).");
  });
});
