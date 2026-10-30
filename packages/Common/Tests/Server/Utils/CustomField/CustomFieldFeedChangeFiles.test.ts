import { describe, expect, test } from "@jest/globals";
import CustomFieldFeedChange, {
  CustomFieldFeedChangeItem,
} from "../../../../Server/Utils/CustomField/CustomFieldFeedChange";
import { CustomFieldDefinition } from "../../../../Types/CustomField/CustomFieldDefinition";
import { CustomFieldFile } from "../../../../Types/CustomField/CustomFieldFile";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import MimeType from "../../../../Types/File/MimeType";

/*
 * A File or Multiple files field in the incident's feed (and so in its
 * Slack and Microsoft Teams channels): a changed field is listed with its
 * files' names, never their ids or JSON; a field sent back as the dashboard
 * holds it - { _id, name, fileType } for each file the record holds as
 * { fileId, name, fileType, size } - changed nothing; and two different
 * lists of as many files are two values.
 */

const file: (n: number, name: string) => CustomFieldFile = (
  n: number,
  name: string,
): CustomFieldFile => {
  return {
    fileId: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: name,
    fileType: MimeType.pdf,
    size: 1200,
  };
};

const CONTRACT: CustomFieldFile = file(1, "contract.pdf");
const ADDENDUM: CustomFieldFile = file(2, "addendum.pdf");
const DIAGRAM: CustomFieldFile = file(3, "rack-diagram.png");

const DEFINITIONS: Array<CustomFieldDefinition> = [
  { name: "Signed Contract", customFieldType: CustomFieldType.File },
  { name: "Diagrams", customFieldType: CustomFieldType.MultipleFiles },
];

const STORED: Record<string, unknown> = {
  "Signed Contract": CONTRACT,
  Diagrams: [DIAGRAM, ADDENDUM],
};

type AsPickedFunction = (held: CustomFieldFile) => Record<string, unknown>;

// How the dashboard's file picker hands back a file the record holds.
const asPicked: AsPickedFunction = (
  held: CustomFieldFile,
): Record<string, unknown> => {
  return { _id: held.fileId, name: held.name, fileType: held.fileType };
};

function changesOf(written: unknown): Array<CustomFieldFeedChangeItem> {
  return CustomFieldFeedChange.getChanges({
    written: written,
    before: STORED,
    definitions: DEFINITIONS,
  });
}

describe("file fields in the feed", () => {
  test("a bag sent back as the dashboard holds its files changed nothing", () => {
    expect(
      changesOf({
        "Signed Contract": asPicked(CONTRACT),
        Diagrams: [asPicked(ADDENDUM), asPicked(DIAGRAM)],
      }),
    ).toEqual([]);
  });

  test("a replaced file is listed, read by its new name", () => {
    const changes: Array<CustomFieldFeedChangeItem> = changesOf({
      ...STORED,
      "Signed Contract": ADDENDUM,
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]!.name).toBe("Signed Contract");
    expect(
      CustomFieldFeedChange.toReadableValue({
        customFieldType: CustomFieldType.File,
        value: changes[0]!.value,
      }),
    ).toBe("addendum.pdf");
  });

  test("a list of as many different files is a change, not the same value", () => {
    /*
     * Lists were compared entry by entry as text, and every file reads as
     * "[object Object]": swapping one file for another of a two-file list
     * left no trace in the feed.
     */
    const changes: Array<CustomFieldFeedChangeItem> = changesOf({
      ...STORED,
      Diagrams: [DIAGRAM, CONTRACT],
    });

    expect(changes.map((change: CustomFieldFeedChangeItem) => {
      return change.name;
    })).toEqual(["Diagrams"]);
    expect(
      CustomFieldFeedChange.toReadableValue({
        customFieldType: CustomFieldType.MultipleFiles,
        value: changes[0]!.value,
      }),
    ).toBe("rack-diagram.png, contract.pdf");
  });

  test("the same files in another order changed nothing", () => {
    expect(changesOf({ ...STORED, Diagrams: [ADDENDUM, DIAGRAM] })).toEqual(
      [],
    );
  });

  test("a field emptied is listed as cleared", () => {
    expect(changesOf({ ...STORED, Diagrams: [] })).toEqual([
      { name: "Diagrams", value: null },
    ]);
  });

  test("the feed's Markdown names the files", () => {
    const markdown: string = CustomFieldFeedChange.getFeedMarkdown({
      changes: changesOf({ ...STORED, "Signed Contract": ADDENDUM }),
      definitions: DEFINITIONS,
    }).toString();

    expect(markdown.indexOf("addendum.pdf")).not.toBe(-1);
    expect(markdown.indexOf(ADDENDUM.fileId)).toBe(-1);
    expect(markdown.indexOf("fileId")).toBe(-1);
  });
});
