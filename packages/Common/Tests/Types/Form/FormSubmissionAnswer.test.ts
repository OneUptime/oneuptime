import {
  PublicFormField,
  PublicFormFieldType,
} from "../../../Types/Form/FormPublic";
import {
  FORM_ANSWER_NO,
  FORM_ANSWER_YES,
  FormSubmissionAnswer,
  getFormAnswerDisplayValue,
  getFormSubmissionAnswers,
  readFormSubmissionAnswers,
} from "../../../Types/Form/FormSubmissionAnswer";
import { describe, expect, test } from "@jest/globals";

/*
 * FormSubmission.answers: every answer a submission gave, as the dashboard's
 * Submissions page lists them - by question, with the value as stored and
 * the words to show for it (an option's label, Yes or No).
 */

const MONITOR_API: string = "0b0b0b0b-0000-4000-8000-000000000001";
const MONITOR_WEB: string = "0b0b0b0b-0000-4000-8000-000000000002";

const FIELDS: Array<PublicFormField> = [
  {
    id: "title",
    label: "What is wrong?",
    type: PublicFormFieldType.Text,
    isRequired: true,
  },
  {
    id: "checked",
    label: "I checked the status page",
    type: PublicFormFieldType.Boolean,
    isRequired: false,
  },
  {
    id: "monitors",
    label: "Affected Monitors",
    type: PublicFormFieldType.MultiSelectDropdown,
    isRequired: false,
    options: [
      { value: MONITOR_API, label: "API" },
      { value: MONITOR_WEB, label: "Website" },
    ],
  },
  {
    id: "office",
    label: "Office",
    type: PublicFormFieldType.Dropdown,
    isRequired: false,
    options: [
      { value: "Berlin", label: "Berlin" },
      { value: "", label: "" },
    ],
  },
  {
    id: "impact",
    label: "Impact",
    type: PublicFormFieldType.Number,
    isRequired: false,
  },
];

type FieldFunction = (id: string) => PublicFormField;

const field: FieldFunction = (id: string): PublicFormField => {
  return FIELDS.find((candidate: PublicFormField): boolean => {
    return candidate.id === id;
  })!;
};

describe("getFormAnswerDisplayValue: the words for an answer", () => {
  test("a checkbox reads Yes or No", () => {
    expect(FORM_ANSWER_YES).toBe("Yes");
    expect(FORM_ANSWER_NO).toBe("No");
    expect(getFormAnswerDisplayValue(field("checked"), true)).toBe("Yes");
    expect(getFormAnswerDisplayValue(field("checked"), false)).toBe("No");
  });

  test("a choice of records reads as the records' names, not their ids", () => {
    expect(
      getFormAnswerDisplayValue(field("monitors"), [MONITOR_WEB, MONITOR_API]),
    ).toBe("Website, API");
    expect(getFormAnswerDisplayValue(field("monitors"), MONITOR_API)).toBe(
      "API",
    );
  });

  test("an option no longer listed reads as its value", () => {
    expect(getFormAnswerDisplayValue(field("office"), "London")).toBe("London");
    expect(
      getFormAnswerDisplayValue(field("monitors"), ["gone", MONITOR_API]),
    ).toBe("gone, API");
  });

  test("anything else reads as itself", () => {
    expect(getFormAnswerDisplayValue(field("title"), "Down")).toBe("Down");
    expect(getFormAnswerDisplayValue(field("impact"), 42)).toBe("42");
    expect(getFormAnswerDisplayValue(field("title"), null)).toBe("");
  });
});

describe("getFormSubmissionAnswers: what a submission keeps", () => {
  test("every answered question, in the form's order, with its label", () => {
    expect(
      getFormSubmissionAnswers({
        fields: FIELDS,
        answers: {
          monitors: [MONITOR_API],
          title: "Down",
          checked: false,
        },
      }),
    ).toEqual([
      {
        fieldId: "title",
        label: "What is wrong?",
        value: "Down",
        displayValue: "Down",
      },
      {
        fieldId: "checked",
        label: "I checked the status page",
        value: false,
        displayValue: "No",
      },
      {
        fieldId: "monitors",
        label: "Affected Monitors",
        value: [MONITOR_API],
        displayValue: "API",
      },
    ]);
  });

  test("an unanswered question is left out, and so is an answer to none", () => {
    expect(
      getFormSubmissionAnswers({
        fields: FIELDS,
        answers: { unknown: "x" },
      }),
    ).toEqual([]);
  });

  test("an answer is read as the answers object's own, never its prototype's", () => {
    const answers: Record<string, unknown> = Object.create({
      title: "inherited",
    });

    expect(
      getFormSubmissionAnswers({
        fields: FIELDS,
        answers: answers as never,
      }),
    ).toEqual([]);
  });
});

describe("readFormSubmissionAnswers: what is stored, as the page reads it", () => {
  test.each([[undefined], [null], ["x"], [{}], [7]])(
    "reads %p as no answers",
    (value: unknown) => {
      expect(readFormSubmissionAnswers(value)).toEqual([]);
    },
  );

  test("keeps rows with a question id, filling in what is missing", () => {
    expect(
      readFormSubmissionAnswers([
        {
          fieldId: "title",
          label: "What is wrong?",
          value: "Down",
          displayValue: "Down",
        },
        { fieldId: "impact", value: 42 },
        { fieldId: "empty" },
        { label: "No id", value: "x" },
        null,
        ["row"],
        "row",
      ]),
    ).toEqual([
      {
        fieldId: "title",
        label: "What is wrong?",
        value: "Down",
        displayValue: "Down",
      },
      { fieldId: "impact", label: "", value: 42, displayValue: "42" },
      { fieldId: "empty", label: "", value: null, displayValue: "" },
    ]);
  });

  test("a round trip through storage changes nothing", () => {
    const answers: Array<FormSubmissionAnswer> = getFormSubmissionAnswers({
      fields: FIELDS,
      answers: { title: "Down", monitors: [MONITOR_WEB], impact: 3 },
    });

    expect(
      readFormSubmissionAnswers(JSON.parse(JSON.stringify(answers))),
    ).toEqual(answers);
  });
});
