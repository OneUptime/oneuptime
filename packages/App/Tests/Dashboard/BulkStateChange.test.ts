import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  BulkStateChangeNoteTemplate,
  BulkStateChangeNoteType,
  BulkStateChangeSkipDecision,
  buildBulkStateChangeMiscDataProps,
  getBulkStateChangeNoteFieldKey,
  getBulkStateChangeNoteTemplateFieldKey,
  getBulkStateChangeSkipDecision,
  getNoteFromTemplate,
} from "../../FeatureSet/Dashboard/src/Utils/BulkStateChange";

/*
 * The note a user writes in a bulk "Change State" modal rides along with each
 * state timeline create under `miscDataProps`. The timeline services key off
 * the exact field name, so these tests pin the names down as well as the
 * "an untouched textbox writes nothing" rule.
 */

const TEMPLATES: Array<BulkStateChangeNoteTemplate> = [
  {
    id: "019acd20-1111-4111-8111-111111111111",
    templateName: "Mitigation started",
    note: "We have started mitigating this.",
  },
  {
    id: "019acd20-2222-4222-8222-222222222222",
    templateName: "Empty template",
    note: "",
  },
];

describe("bulk state change note field keys", () => {
  test("a public note travels under publicNote", () => {
    expect(getBulkStateChangeNoteFieldKey(BulkStateChangeNoteType.Public)).toBe(
      "publicNote",
    );
    expect(
      getBulkStateChangeNoteTemplateFieldKey(BulkStateChangeNoteType.Public),
    ).toBe("publicNoteTemplate");
  });

  test("a private note travels under privateNote", () => {
    expect(
      getBulkStateChangeNoteFieldKey(BulkStateChangeNoteType.Private),
    ).toBe("privateNote");
    expect(
      getBulkStateChangeNoteTemplateFieldKey(BulkStateChangeNoteType.Private),
    ).toBe("privateNoteTemplate");
  });
});

describe("getNoteFromTemplate", () => {
  test("returns the note body of the selected template", () => {
    expect(getNoteFromTemplate(TEMPLATES, TEMPLATES[0]!.id)).toBe(
      "We have started mitigating this.",
    );
  });

  test("returns an empty string when no template is selected", () => {
    expect(getNoteFromTemplate(TEMPLATES, undefined)).toBe("");
    expect(getNoteFromTemplate(TEMPLATES, null)).toBe("");
    expect(getNoteFromTemplate(TEMPLATES, "")).toBe("");
  });

  test("returns an empty string for an unknown template id", () => {
    expect(getNoteFromTemplate(TEMPLATES, "not-a-template")).toBe("");
  });

  test("returns an empty string when the matched template has no body", () => {
    expect(getNoteFromTemplate(TEMPLATES, TEMPLATES[1]!.id)).toBe("");
  });

  test("returns an empty string when there are no templates at all", () => {
    expect(getNoteFromTemplate([], TEMPLATES[0]!.id)).toBe("");
  });
});

describe("buildBulkStateChangeMiscDataProps", () => {
  test("sends a public note under publicNote", () => {
    const miscDataProps: JSONObject = buildBulkStateChangeMiscDataProps({
      noteType: BulkStateChangeNoteType.Public,
      note: "Rolled back the bad deploy.",
    });

    expect(miscDataProps).toEqual({
      publicNote: "Rolled back the bad deploy.",
    });
  });

  test("sends a private note under privateNote", () => {
    const miscDataProps: JSONObject = buildBulkStateChangeMiscDataProps({
      noteType: BulkStateChangeNoteType.Private,
      note: "Mapped to Dynamics case 4821.",
    });

    expect(miscDataProps).toEqual({
      privateNote: "Mapped to Dynamics case 4821.",
    });
  });

  test("sends nothing when the note is missing, empty or only whitespace", () => {
    expect(
      buildBulkStateChangeMiscDataProps({
        noteType: BulkStateChangeNoteType.Public,
      }),
    ).toEqual({});

    expect(
      buildBulkStateChangeMiscDataProps({
        noteType: BulkStateChangeNoteType.Public,
        note: "",
      }),
    ).toEqual({});

    expect(
      buildBulkStateChangeMiscDataProps({
        noteType: BulkStateChangeNoteType.Private,
        note: "   \n\t  ",
      }),
    ).toEqual({});
  });

  test("keeps the note body byte for byte so markdown survives", () => {
    const note: string = "## Heading\n\n- item one\n- item two\n";

    expect(
      buildBulkStateChangeMiscDataProps({
        noteType: BulkStateChangeNoteType.Public,
        note: note,
      }),
    ).toEqual({
      publicNote: note,
    });
  });
});

describe("getBulkStateChangeSkipDecision", () => {
  test("moves an event forward when it is behind the target state", () => {
    const decision: BulkStateChangeSkipDecision =
      getBulkStateChangeSkipDecision({
        currentOrder: 1,
        targetOrder: 3,
        currentStateName: "Created",
        targetStateName: "Resolved",
      });

    expect(decision.shouldSkip).toBe(false);
    expect(decision.skippedMessage).toBeUndefined();
  });

  test("skips an event that is already at the target state", () => {
    const decision: BulkStateChangeSkipDecision =
      getBulkStateChangeSkipDecision({
        currentOrder: 3,
        targetOrder: 3,
        currentStateName: "Resolved",
        targetStateName: "Resolved",
      });

    expect(decision.shouldSkip).toBe(true);
    expect(decision.skippedMessage).toBe(
      'Skipped: Already at "Resolved" (at or past "Resolved")',
    );
  });

  test("skips an event that is past the target state", () => {
    const decision: BulkStateChangeSkipDecision =
      getBulkStateChangeSkipDecision({
        currentOrder: 5,
        targetOrder: 2,
        currentStateName: "Resolved",
        targetStateName: "Acknowledged",
      });

    expect(decision.shouldSkip).toBe(true);
    expect(decision.skippedMessage).toBe(
      'Skipped: Already at "Resolved" (at or past "Acknowledged")',
    );
  });

  test("falls back to Unknown when a state name could not be loaded", () => {
    const decision: BulkStateChangeSkipDecision =
      getBulkStateChangeSkipDecision({
        currentOrder: 2,
        targetOrder: 2,
      });

    expect(decision.shouldSkip).toBe(true);
    expect(decision.skippedMessage).toBe(
      'Skipped: Already at "Unknown" (at or past "Unknown")',
    );
  });
});
