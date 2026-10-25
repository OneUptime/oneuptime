import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  BulkStateChangeNoteTemplate,
  BulkStateChangeNoteType,
  IncidentBulkStateChange,
  buildBulkStateChangeMiscDataProps,
  buildIncidentBulkStateChange,
  getBulkStateChangeNoteFieldKey,
  getBulkStateChangeNoteTemplateFieldKey,
  getNoteFromTemplate,
  toBulkStateChangeNoteTemplate,
} from "../../FeatureSet/Dashboard/src/Utils/BulkStateChange";
import ObjectID from "Common/Types/ObjectID";

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

/*
 * Which records a move leaves alone, and why, is EventStateMoves' now - the
 * state timeline's own rule (Common/Utils/StateMove), in the reader's
 * language: EventStateMoves.test.ts.
 */

/*
 * Every state change dialog - the single-event ones in the event headers
 * and the bulk one - offers the project's note templates in the same
 * picker, so a template row from the API is turned into the picker's
 * option the same way everywhere.
 */
describe("a note template row as the picker offers it", () => {
  test("keeps the template's id, name and note", () => {
    expect(
      toBulkStateChangeNoteTemplate({
        id: new ObjectID("019acd20-1111-4111-8111-111111111111"),
        templateName: "Mitigation started",
        note: "We have started mitigating this.",
      }),
    ).toEqual({
      id: "019acd20-1111-4111-8111-111111111111",
      templateName: "Mitigation started",
      note: "We have started mitigating this.",
    });
  });

  test("never shows a missing name or note as undefined", () => {
    expect(
      toBulkStateChangeNoteTemplate({
        id: new ObjectID("019acd20-2222-4222-8222-222222222222"),
      }),
    ).toEqual({
      id: "019acd20-2222-4222-8222-222222222222",
      templateName: "",
      note: "",
    });
    expect(toBulkStateChangeNoteTemplate({ id: null })).toEqual({
      id: "",
      templateName: "",
      note: "",
    });
  });

  test("a converted template is found again by the id the picker hands back", () => {
    const templates: Array<BulkStateChangeNoteTemplate> = [
      toBulkStateChangeNoteTemplate({
        id: new ObjectID("019acd20-3333-4333-8333-333333333333"),
        templateName: "Resolved",
        note: "All clear.",
      }),
    ];

    expect(
      getNoteFromTemplate(templates, "019acd20-3333-4333-8333-333333333333"),
    ).toBe("All clear.");
  });
});

/*
 * The incidents table's bulk Change State writes one public note for every
 * incident it moves, with "Notify Status Page Subscribers". A private
 * incident takes no public notes and reaches no subscriber
 * (Common/Types/StatusPage/PrivateRecordPublicNotes) - the server refuses a
 * change that comes with a public note on one - so each incident's change is
 * built on its own: a private one gets the same note as a private note
 * (`privateNote`, which the incident state timeline posts), and notifies
 * nobody.
 */
describe("an incident's bulk state change", () => {
  test("an incident that is not private gets the public note, and the box as it was ticked", () => {
    expect(
      buildIncidentBulkStateChange({
        isPrivate: false,
        note: "Fixed by rolling back deploy 42.",
        shouldStatusPageSubscribersBeNotified: true,
      }),
    ).toEqual({
      miscDataProps: { publicNote: "Fixed by rolling back deploy 42." },
      shouldStatusPageSubscribersBeNotified: true,
    });

    expect(
      buildIncidentBulkStateChange({
        isPrivate: false,
        note: "Fixed.",
        shouldStatusPageSubscribersBeNotified: false,
      }).shouldStatusPageSubscribersBeNotified,
    ).toBe(false);
  });

  test("a private incident gets the same note as a private note, and notifies nobody", () => {
    const change: IncidentBulkStateChange = buildIncidentBulkStateChange({
      isPrivate: true,
      note: "Fixed by rolling back deploy 42.",
      shouldStatusPageSubscribersBeNotified: true,
    });

    expect(change).toEqual({
      miscDataProps: { privateNote: "Fixed by rolling back deploy 42." },
      shouldStatusPageSubscribersBeNotified: false,
    });
    expect(change.miscDataProps).not.toHaveProperty("publicNote");
  });

  test("an untouched note writes nothing, private incident or not", () => {
    for (const isPrivate of [true, false]) {
      for (const note of [undefined, "", "   \n  "]) {
        expect(
          buildIncidentBulkStateChange({
            isPrivate: isPrivate,
            note: note,
            shouldStatusPageSubscribersBeNotified: true,
          }).miscDataProps,
        ).toEqual({});
      }
    }
  });

  test("a box the dialog did not send notifies, as it always has, on an incident that is not private", () => {
    expect(
      buildIncidentBulkStateChange({ isPrivate: false, note: "Fixed." })
        .shouldStatusPageSubscribersBeNotified,
    ).toBe(true);
    expect(
      buildIncidentBulkStateChange({ isPrivate: true, note: "Fixed." })
        .shouldStatusPageSubscribersBeNotified,
    ).toBe(false);
  });

  test("the private note travels under the key the incident state timeline reads", () => {
    expect(
      Object.keys(
        buildIncidentBulkStateChange({ isPrivate: true, note: "Fixed." })
          .miscDataProps,
      ),
    ).toEqual([
      getBulkStateChangeNoteFieldKey(BulkStateChangeNoteType.Private),
    ]);
  });
});
