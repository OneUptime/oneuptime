import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import FormSummary, {
  getFormSummaryFields,
  isListedInFormSummary,
} from "../../../../UI/Components/Forms/FormSummary";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import { getAdvancedFormSection } from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import { JSONObject } from "../../../../Types/JSON";

/*
 * The review screen. It is the last thing a customer reads before committing
 * a change, so what it leaves OUT matters as much as what it shows: a field
 * hidden by the form but printed here reads as something that is about to be
 * saved, and a step whose fields are all hidden should not leave an empty
 * heading behind claiming there is something under it.
 *
 * The file rendering has its own share of this: an empty file field has to
 * say "No files selected", because a blank row next to a title reads as a
 * file that IS attached and whose name simply failed to render.
 */

interface FileLike {
  name?: string;
  fileName?: string;
  slug?: string;
  _id?: string;
  fileType?: string;
  isPublic?: boolean;
}

function isBrowser(values: FormValues<JSONObject>): boolean {
  return values["keyType"] === "Browser";
}

const STEPS: Array<FormStep<JSONObject>> = [
  { title: "Details", id: "details" },
  { title: "Browser Settings", id: "browser", showIf: isBrowser },
  { title: "Attachments", id: "attachments" },
];

const FIELDS: Fields<JSONObject> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    stepId: "details",
  },
  {
    field: { keyType: true },
    title: "Key Type",
    fieldType: FormFieldSchemaType.Text,
    stepId: "details",
  },
  {
    field: { allowedOrigins: true },
    title: "Allowed Origins",
    fieldType: FormFieldSchemaType.Text,
    stepId: "browser",
    showIf: isBrowser,
  },
  {
    field: { attachments: true },
    title: "Attachments",
    fieldType: FormFieldSchemaType.MultipleFiles,
    stepId: "attachments",
  },
];

function renderSummary(data: {
  values: JSONObject;
  fields?: Fields<JSONObject>;
  steps?: Array<FormStep<JSONObject>> | undefined;
}): void {
  render(
    <FormSummary<JSONObject>
      formValues={data.values as FormValues<JSONObject>}
      formFields={data.fields || FIELDS}
      formSteps={"steps" in data ? data.steps : STEPS}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("FormSummary: steps", () => {
  test("prints a heading and the values for each visible step", () => {
    renderSummary({
      values: {
        keyType: "Browser",
        name: "Storefront key",
        allowedOrigins: '["https://app.example.com"]',
        attachments: [],
      },
    });

    expect(
      screen.getByRole("heading", { name: "Details" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Browser Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Storefront key")).toBeInTheDocument();
    expect(screen.getByText('["https://app.example.com"]')).toBeInTheDocument();
  });

  /*
   * A step the form skipped must not appear here. Printing it would tell the
   * customer they are about to save settings the form never collected.
   */
  test("omits a step whose showIf is false, and the fields under it", () => {
    renderSummary({
      values: {
        keyType: "Server",
        name: "Collector key",
        allowedOrigins: '["https://app.example.com"]',
        attachments: [],
      },
    });

    expect(
      screen.queryByRole("heading", { name: "Browser Settings" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('["https://app.example.com"]'),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Collector key")).toBeInTheDocument();
  });

  /*
   * A step can survive its own showIf and still have nothing to say, because
   * every field under it is hidden. A bare heading with nothing beneath it
   * reads as a section that failed to render.
   */
  test("renders nothing at all for a step whose fields are all hidden", () => {
    const steps: Array<FormStep<JSONObject>> = [
      { title: "Details", id: "details" },
      { title: "Advanced", id: "advanced" },
    ];

    const fields: Fields<JSONObject> = [
      {
        field: { name: true },
        title: "Name",
        fieldType: FormFieldSchemaType.Text,
        stepId: "details",
      },
      {
        field: { secret: true },
        title: "Secret",
        fieldType: FormFieldSchemaType.Text,
        stepId: "advanced",
        showIf: (): boolean => {
          return false;
        },
      },
    ];

    renderSummary({
      values: { name: "Only me", secret: "hunter2" },
      fields: fields,
      steps: steps,
    });

    expect(
      screen.queryByRole("heading", { name: "Advanced" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("hunter2")).not.toBeInTheDocument();
  });

  test("renders nothing for a step no field is assigned to", () => {
    renderSummary({
      values: { keyType: "Server", name: "Collector key" },
      fields: [
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          stepId: "details",
        },
      ],
      steps: [
        { title: "Details", id: "details" },
        { title: "Billing", id: "billing" },
      ],
    });

    expect(
      screen.queryByRole("heading", { name: "Billing" }),
    ).not.toBeInTheDocument();
  });

  test("keeps the steps in the order the form declared them", () => {
    renderSummary({
      values: {
        keyType: "Browser",
        name: "Storefront key",
        allowedOrigins: "[]",
        attachments: [],
      },
    });

    const headings: Array<string> = screen
      .getAllByRole("heading")
      .map((heading: HTMLElement): string => {
        return heading.textContent || "";
      });

    expect(headings).toEqual(["Details", "Browser Settings", "Attachments"]);
  });
});

describe("FormSummary: no steps", () => {
  test("prints every field flat, with no step headings", () => {
    renderSummary({
      values: { name: "Storefront key", keyType: "Server" },
      fields: [
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
        },
        {
          field: { keyType: true },
          title: "Key Type",
          fieldType: FormFieldSchemaType.Text,
        },
      ],
      steps: undefined,
    });

    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.getByText("Storefront key")).toBeInTheDocument();
    expect(screen.getByText("Server")).toBeInTheDocument();
  });

  test("treats an empty step list the same as none", () => {
    renderSummary({
      values: { name: "Storefront key" },
      fields: [
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
        },
      ],
      steps: [],
    });

    expect(screen.getByText("Storefront key")).toBeInTheDocument();
  });
});

describe("FormSummary: files", () => {
  function renderFiles(value: unknown): void {
    renderSummary({
      values: { attachments: value } as JSONObject,
      fields: [
        {
          field: { attachments: true },
          title: "Attachments",
          fieldType: FormFieldSchemaType.MultipleFiles,
        },
      ],
      steps: undefined,
    });
  }

  /*
   * A blank row next to a title reads as a file that IS attached and whose
   * name failed to render. Saying so explicitly is the difference between
   * "nothing is attached" and "something went wrong".
   */
  test.each([
    ["an empty list", []],
    ["null", null],
    ["undefined", undefined],
  ])("says so when %s is attached", (_name: string, value: unknown) => {
    renderFiles(value);

    expect(screen.getByText("No files selected.")).toBeInTheDocument();
  });

  test("lists each attached file by name", () => {
    renderFiles([
      { name: "runbook.pdf", _id: "1" },
      { name: "diagram.png", _id: "2" },
    ] as Array<FileLike>);

    expect(screen.getByText("runbook.pdf")).toBeInTheDocument();
    expect(screen.getByText("diagram.png")).toBeInTheDocument();
  });

  test("accepts a single file that is not in a list", () => {
    renderFiles({ name: "runbook.pdf", _id: "1" } as FileLike);

    expect(screen.getByText("runbook.pdf")).toBeInTheDocument();
  });

  test("accepts a file given as a bare name", () => {
    renderFiles(["runbook.pdf"]);

    expect(screen.getByText("runbook.pdf")).toBeInTheDocument();
  });

  /*
   * Whatever the upload left behind, the row has to say SOMETHING a person
   * can match against what they picked - falling back through the fields
   * most likely to be human-readable before giving up on a position.
   */
  test.each([
    [{ name: "by-name", fileName: "by-file-name", slug: "by-slug" }, "by-name"],
    [{ fileName: "by-file-name", slug: "by-slug" }, "by-file-name"],
    [{ slug: "by-slug", _id: "by-id" }, "by-slug"],
    [{ _id: "by-id" }, "by-id"],
    [{ fileType: "image/png" }, "File 1"],
  ])("names %j as %s", (file: FileLike, expected: string) => {
    renderFiles([file]);

    /*
     * The displayed name is the row's first paragraph. Matched positionally
     * because the same string can legitimately appear twice in one row - a
     * file with only a slug is NAMED by its slug and also lists it in the
     * subtitle beneath.
     */
    const row: HTMLElement = screen.getByRole("listitem");

    expect(row.querySelector("p")?.textContent).toBe(expected);
  });

  test("numbers an unnameable file by its position in the list", () => {
    renderFiles([{ name: "first.pdf" }, { fileType: "image/png" }]);

    expect(screen.getByText("File 2")).toBeInTheDocument();
  });

  test("shows the file type and slug under the name", () => {
    renderFiles([
      { name: "runbook.pdf", fileType: "application/pdf", slug: "runbook" },
    ]);

    expect(screen.getByText("application/pdf • runbook")).toBeInTheDocument();
  });

  test("shows only what it has when there is no slug", () => {
    renderFiles([{ name: "runbook.pdf", fileType: "application/pdf" }]);

    expect(screen.getByText("application/pdf")).toBeInTheDocument();
  });

  /*
   * Whether an attachment is world-readable is exactly the kind of thing a
   * customer should be told BEFORE saving, not discover afterwards.
   */
  test.each([
    [true, "Public"],
    [false, "Private"],
  ])("labels isPublic=%s as %s", (isPublic: boolean, expected: string) => {
    renderFiles([{ name: "runbook.pdf", isPublic: isPublic }]);

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  test("says nothing about access when the file does not declare it", () => {
    renderFiles([{ name: "runbook.pdf" }]);

    expect(screen.queryByText("Public")).not.toBeInTheDocument();
    expect(screen.queryByText("Private")).not.toBeInTheDocument();
  });

  test("lets a field's own summary element win over the file rendering", () => {
    renderSummary({
      values: { attachments: [{ name: "runbook.pdf" }] } as JSONObject,
      fields: [
        {
          field: { attachments: true },
          title: "Attachments",
          fieldType: FormFieldSchemaType.MultipleFiles,
          getSummaryElement: (): ReactElement => {
            return <span>2 files, 4.1 MB</span>;
          },
        },
      ],
      steps: undefined,
    });

    expect(screen.getByText("2 files, 4.1 MB")).toBeInTheDocument();
    expect(screen.queryByText("runbook.pdf")).not.toBeInTheDocument();
  });

  test("does not apply the file rendering to a field that is not a file field", () => {
    renderSummary({
      values: { name: "" } as JSONObject,
      fields: [
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
        },
      ],
      steps: undefined,
    });

    expect(screen.queryByText("No files selected.")).not.toBeInTheDocument();
  });
});

describe("FormSummary: titles and descriptions", () => {
  test("prints each field's title and description", () => {
    renderSummary({
      values: { name: "Storefront key" },
      fields: [
        {
          field: { name: true },
          title: "Name",
          description: "Give this key a name you will recognize later.",
          fieldType: FormFieldSchemaType.Text,
        },
      ],
      steps: undefined,
    });

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(
      screen.getByText("Give this key a name you will recognize later."),
    ).toBeInTheDocument();
  });

  test("groups a field under the step it belongs to", () => {
    renderSummary({
      values: {
        keyType: "Browser",
        name: "Storefront key",
        allowedOrigins: "[]",
      },
    });

    const browserHeading: HTMLElement = screen.getByRole("heading", {
      name: "Browser Settings",
    });
    const browserSection: HTMLElement =
      browserHeading.parentElement as HTMLElement;

    expect(
      within(browserSection).getByText("Allowed Origins"),
    ).toBeInTheDocument();
    expect(
      within(browserSection).queryByText("Storefront key"),
    ).not.toBeInTheDocument();
  });
});

/*
 * A dropdown's form value is only the chosen ID. The Create Alert summary
 * printed a blank "Alert Severity" row for a severity that had been picked,
 * because the options that map the ID back to its name never reached the
 * summary. ModelForm has already fetched them onto the field by this point.
 */
describe("FormSummary: dropdowns", () => {
  const CRITICAL_ID: string = "11111111-1111-4111-8111-111111111111";
  const MINOR_ID: string = "22222222-2222-4222-8222-222222222222";
  const LABEL_A_ID: string = "33333333-3333-4333-8333-333333333333";
  const LABEL_B_ID: string = "44444444-4444-4444-8444-444444444444";

  const DROPDOWN_FIELDS: Fields<JSONObject> = [
    {
      field: { alertSeverity: true },
      title: "Alert Severity",
      fieldType: FormFieldSchemaType.Dropdown,
      placeholder: "Alert Severity",
      dropdownOptions: [
        { label: "Critical", value: CRITICAL_ID },
        { label: "Minor", value: MINOR_ID },
      ],
    },
    {
      field: { labels: true },
      title: "Labels",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownOptions: [
        { label: "Production", value: LABEL_A_ID },
        { label: "EU West", value: LABEL_B_ID },
      ],
    },
  ];

  test("a single select shows the chosen option's name, not a blank row", () => {
    renderSummary({
      values: { alertSeverity: CRITICAL_ID },
      fields: DROPDOWN_FIELDS,
      steps: undefined,
    });

    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.queryByText("Minor")).toBeNull();
    expect(screen.queryByText(CRITICAL_ID)).toBeNull();
  });

  test("a multi select shows every chosen option by name, never its ID", () => {
    renderSummary({
      values: { labels: [LABEL_A_ID, LABEL_B_ID] },
      fields: DROPDOWN_FIELDS,
      steps: undefined,
    });

    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("EU West")).toBeInTheDocument();
    expect(screen.queryByText(LABEL_A_ID)).toBeNull();
    expect(screen.queryByText(LABEL_B_ID)).toBeNull();
  });

  test("options grouped under headings are matched too", () => {
    renderSummary({
      values: { alertSeverity: MINOR_ID },
      fields: [
        {
          field: { alertSeverity: true },
          title: "Alert Severity",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: [
            {
              label: "Low",
              options: [{ label: "Minor", value: MINOR_ID }],
            },
          ],
        },
      ],
      steps: undefined,
    });

    expect(screen.getByText("Minor")).toBeInTheDocument();
  });

  test("a field's own summary element still wins over the options", () => {
    renderSummary({
      values: { alertSeverity: CRITICAL_ID },
      fields: [
        {
          ...DROPDOWN_FIELDS[0]!,
          getSummaryElement: (): ReactElement => {
            return <span>Custom severity summary</span>;
          },
        },
      ],
      steps: undefined,
    });

    expect(screen.getByText("Custom severity summary")).toBeInTheDocument();
    expect(screen.queryByText("Critical")).toBeNull();
  });

  /*
   * Detail prints a dropdown's placeholder whenever no option matches, and
   * any empty field's placeholder in its place. Passed through, "Alert
   * Severity" would read as the chosen value of an optional dropdown left
   * empty. The title is "Alert Severity" too, so exactly one match means the
   * placeholder stayed out.
   */
  test.each([
    ["nothing is chosen", {}],
    ["the chosen ID is not among the options", { alertSeverity: MINOR_ID }],
  ])(
    "the field's placeholder is not printed as a value when %s",
    (_case: string, values: JSONObject) => {
      renderSummary({
        values,
        fields: [
          {
            ...DROPDOWN_FIELDS[0]!,
            dropdownOptions: [{ label: "Critical", value: CRITICAL_ID }],
          },
        ],
        steps: undefined,
      });

      expect(screen.getAllByText("Alert Severity")).toHaveLength(1);
    },
  );
});

/*
 * Declare Incident folds the options most declarations never touch -
 * Declared At, Initial State, Labels, Private Incident - under one Advanced
 * header. The review step listed every one of them anyway: four rows nobody
 * touched ("No labels assigned.", "No"...), on the one screen meant to
 * confirm what was chosen. A field folded into a section is now listed only
 * when it holds something of the user's: a value other than empty or its
 * default, a switch off its default. Fields outside a section are listed as
 * before, set or not.
 */
describe("FormSummary: folded sections", () => {
  const ADVANCED: FormFieldCollapsibleSection<JSONObject> =
    getAdvancedFormSection<JSONObject>();

  // Declared At starts at the moment the form opened.
  const OPENED_AT: Date = new Date("2026-10-03T09:30:00.000Z");

  const FOLDED_STEPS: Array<FormStep<JSONObject>> = [
    { title: "Incident Details", id: "details" },
    { title: "On-Call & Roles", id: "on-call" },
  ];

  const TITLE: Field<JSONObject> = {
    field: { title: true },
    title: "Title",
    fieldType: FormFieldSchemaType.Text,
    stepId: "details",
  };

  const DECLARED_AT: Field<JSONObject> = {
    field: { declaredAt: true },
    title: "Declared At",
    fieldType: FormFieldSchemaType.DateTime,
    stepId: "details",
    defaultValue: OPENED_AT,
    collapsibleSection: ADVANCED,
  };

  const LABELS: Field<JSONObject> = {
    field: { labels: true },
    title: "Labels",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    stepId: "details",
    collapsibleSection: ADVANCED,
    getSummaryElement: (item: FormValues<JSONObject>): ReactElement => {
      return (
        <span data-testid="labels-summary">
          {((item["labels"] as Array<string>) || []).join(", ")}
        </span>
      );
    },
  };

  const PRIVATE: Field<JSONObject> = {
    field: { isPrivate: true },
    title: "Private Incident",
    fieldType: FormFieldSchemaType.Checkbox,
    stepId: "details",
    defaultValue: false,
    collapsibleSection: ADVANCED,
  };

  /*
   * A folded custom element that keeps its value elsewhere - a switch and
   * its minutes in two columns - says itself whether it is set
   * (Field.getFoldedValue): its own value is a carrier, always there.
   */
  const REOPEN: Field<JSONObject> = {
    overrideFieldKey: "reopenWindowSetting",
    title: "Reopen recently resolved episodes",
    fieldType: FormFieldSchemaType.CustomComponent,
    stepId: "details",
    getDefaultValue: (): boolean => {
      return true;
    },
    getFoldedValue: (values: FormValues<JSONObject>): string | null => {
      return values["enableReopenWindow"] === true ? "30 minutes" : null;
    },
    collapsibleSection: ADVANCED,
  };

  const ON_CALL: Field<JSONObject> = {
    field: { onCallDutyPolicies: true },
    title: "On-Call Policy",
    fieldType: FormFieldSchemaType.Text,
    stepId: "on-call",
    getSummaryElement: (): ReactElement => {
      return <span>No on-call policies.</span>;
    },
  };

  const FOLDED_FIELDS: Fields<JSONObject> = [
    TITLE,
    DECLARED_AT,
    LABELS,
    PRIVATE,
    ON_CALL,
  ];

  // The values a declaration nobody opened Advanced on submits.
  const UNTOUCHED: JSONObject = {
    title: "Checkout is down",
    declaredAt: OPENED_AT,
    isPrivate: false,
  };

  function renderFolded(values: JSONObject): void {
    renderSummary({
      values,
      fields: FOLDED_FIELDS,
      steps: FOLDED_STEPS,
    });
  }

  test("leaves out every folded field nobody touched", () => {
    renderFolded(UNTOUCHED);

    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Checkout is down")).toBeInTheDocument();

    for (const title of ["Declared At", "Labels", "Private Incident"]) {
      expect(screen.queryByText(title)).toBeNull();
    }
    expect(screen.queryByTestId("labels-summary")).toBeNull();
  });

  test("lists each folded field that holds something of the user's", () => {
    renderFolded({
      ...UNTOUCHED,
      declaredAt: "2026-10-03T08:15",
      labels: ["Payments", "EU"],
      isPrivate: true,
    });

    for (const title of ["Declared At", "Labels", "Private Incident"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByTestId("labels-summary")).toHaveTextContent(
      "Payments, EU",
    );
  });

  test("lists only the folded fields that are set, under their own step", () => {
    renderFolded({ ...UNTOUCHED, labels: ["Payments"] });

    const details: HTMLElement = screen.getByRole("heading", {
      name: "Incident Details",
    }).parentElement as HTMLElement;

    expect(within(details).getByText("Labels")).toBeInTheDocument();
    expect(within(details).queryByText("Declared At")).toBeNull();
    expect(within(details).queryByText("Private Incident")).toBeNull();
  });

  test("a field outside any section is listed whether it is set or not", () => {
    renderFolded(UNTOUCHED);

    expect(
      screen.getByRole("heading", { name: "On-Call & Roles" }),
    ).toBeInTheDocument();
    expect(screen.getByText("On-Call Policy")).toBeInTheDocument();
    expect(screen.getByText("No on-call policies.")).toBeInTheDocument();
  });

  test("a step whose fields are all folded and untouched leaves no heading behind", () => {
    renderSummary({
      values: UNTOUCHED,
      fields: [TITLE, { ...LABELS, stepId: "on-call" }],
      steps: FOLDED_STEPS,
    });

    expect(
      screen.queryByRole("heading", { name: "On-Call & Roles" }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Incident Details" }),
    ).toBeInTheDocument();
  });

  test("a set folded field the form hides stays hidden", () => {
    renderSummary({
      values: { ...UNTOUCHED, labels: ["Payments"] },
      fields: [
        TITLE,
        {
          ...LABELS,
          showIf: (): boolean => {
            return false;
          },
        },
      ],
      steps: FOLDED_STEPS,
    });

    expect(screen.queryByText("Labels")).toBeNull();
  });

  test("a form without steps follows the same rule", () => {
    renderSummary({
      values: { ...UNTOUCHED, isPrivate: true },
      fields: [TITLE, DECLARED_AT, LABELS, PRIVATE].map(
        (field: Field<JSONObject>): Field<JSONObject> => {
          return { ...field, stepId: undefined };
        },
      ),
      steps: undefined,
    });

    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Private Incident")).toBeInTheDocument();
    expect(screen.queryByText("Declared At")).toBeNull();
    expect(screen.queryByText("Labels")).toBeNull();
  });

  test.each([
    ["an open field, empty", true, TITLE, {}],
    ["an open field, filled in", true, TITLE, { title: "x" }],
    ["a folded date at its default", false, DECLARED_AT, UNTOUCHED],
    [
      "a folded date someone changed",
      true,
      DECLARED_AT,
      { declaredAt: "2026-10-03T08:15" },
    ],
    ["a folded list left empty", false, LABELS, { labels: [] }],
    ["a folded list with an entry", true, LABELS, { labels: ["EU"] }],
    ["a folded switch at its default", false, PRIVATE, { isPrivate: false }],
    ["a folded switch never touched", false, PRIVATE, {}],
    ["a folded switch turned on", true, PRIVATE, { isPrivate: true }],
    [
      "a folded custom setting that says it is off",
      false,
      REOPEN,
      { reopenWindowSetting: true, enableReopenWindow: false },
    ],
    [
      "a folded custom setting that says it is on",
      true,
      REOPEN,
      { reopenWindowSetting: true, enableReopenWindow: true },
    ],
    [
      "an open field the form hides",
      false,
      {
        ...TITLE,
        showIf: (): boolean => {
          return false;
        },
      },
      { title: "x" },
    ],
  ] as Array<[string, boolean, Field<JSONObject>, JSONObject]>)(
    "isListedInFormSummary: %s -> %s",
    (
      _case: string,
      listed: boolean,
      field: Field<JSONObject>,
      values: JSONObject,
    ) => {
      expect(
        isListedInFormSummary(field, values as FormValues<JSONObject>),
      ).toBe(listed);
    },
  );
});

/*
 * Declare Incident folds "Notify Status Page Subscribers" under More fields
 * ("Limit to these status pages and notifiy subscribers should be in
 * advanced" - the maintainer), but it starts ticked, and whether
 * subscribers are emailed is the one default to read before declaring: its
 * review row says who will be emailed and previews what. A folded field
 * marked alwaysInSummary is listed whatever it holds; every other folded
 * field keeps the rule above.
 */
describe("FormSummary: a folded default to read before saving", () => {
  const ADVANCED: FormFieldCollapsibleSection<JSONObject> =
    getAdvancedFormSection<JSONObject>();

  const STEPS_WITH_RESOURCES: Array<FormStep<JSONObject>> = [
    { title: "Resources Affected", id: "resources" },
  ];

  const MONITORS: Field<JSONObject> = {
    field: { monitors: true },
    title: "Monitors",
    fieldType: FormFieldSchemaType.Text,
    stepId: "resources",
  };

  const STATUS_PAGES: Field<JSONObject> = {
    field: { statusPages: true },
    title: "Limit to these status pages",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    stepId: "resources",
    collapsibleSection: ADVANCED,
  };

  const NOTIFY: Field<JSONObject> = {
    field: { notify: true },
    title: "Notify Status Page Subscribers",
    fieldType: FormFieldSchemaType.Checkbox,
    stepId: "resources",
    defaultValue: true,
    collapsibleSection: ADVANCED,
    alwaysInSummary: true,
    getSummaryElement: (item: FormValues<JSONObject>): ReactElement => {
      return (
        <span data-testid="notify-summary">
          {item["notify"] === false ? "No" : "Yes - Will notify: Site 03"}
        </span>
      );
    },
  };

  const FIELDS_WITH_NOTIFY: Fields<JSONObject> = [
    MONITORS,
    STATUS_PAGES,
    NOTIFY,
  ];

  function renderWithNotify(values: JSONObject): void {
    renderSummary({
      values,
      fields: FIELDS_WITH_NOTIFY,
      steps: STEPS_WITH_RESOURCES,
    });
  }

  test("lists the folded switch left at its default, with what it will do", () => {
    renderWithNotify({ monitors: "Checkout API", notify: true });

    expect(
      screen.getByText("Notify Status Page Subscribers"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("notify-summary")).toHaveTextContent(
      "Yes - Will notify: Site 03",
    );
  });

  test("lists it never touched, as the form starts it", () => {
    renderWithNotify({ monitors: "Checkout API" });

    expect(screen.getByTestId("notify-summary")).toHaveTextContent("Yes");
  });

  test("lists it switched off, too", () => {
    renderWithNotify({ monitors: "Checkout API", notify: false });

    expect(screen.getByTestId("notify-summary")).toHaveTextContent("No");
  });

  test("leaves out the other folded field nobody touched", () => {
    renderWithNotify({ monitors: "Checkout API", notify: true });

    expect(screen.queryByText("Limit to these status pages")).toBeNull();
    // ...and lists it once it is set.
    cleanup();
    renderWithNotify({ statusPages: ["Site 03"], notify: true });
    expect(screen.getByText("Limit to these status pages")).toBeInTheDocument();
  });

  test("a field the form hides stays hidden, always on the review or not", () => {
    renderSummary({
      values: { notify: true },
      fields: [
        MONITORS,
        {
          ...NOTIFY,
          showIf: (): boolean => {
            return false;
          },
        },
      ],
      steps: STEPS_WITH_RESOURCES,
    });

    expect(screen.queryByTestId("notify-summary")).toBeNull();
    expect(screen.queryByText("Notify Status Page Subscribers")).toBeNull();
  });

  test.each([
    ["folded, at its default", true, NOTIFY, { notify: true }],
    ["folded, never touched", true, NOTIFY, {}],
    ["folded, switched off", true, NOTIFY, { notify: false }],
    [
      "folded but hidden by its showIf",
      false,
      {
        ...NOTIFY,
        showIf: (): boolean => {
          return false;
        },
      },
      { notify: true },
    ],
    [
      "the same switch without the flag, at its default",
      false,
      { ...NOTIFY, alwaysInSummary: undefined },
      { notify: true },
    ],
    [
      "the flag turned off, at its default",
      false,
      { ...NOTIFY, alwaysInSummary: false },
      { notify: true },
    ],
  ] as Array<[string, boolean, Field<JSONObject>, JSONObject]>)(
    "isListedInFormSummary with alwaysInSummary: %s -> %s",
    (
      _case: string,
      listed: boolean,
      field: Field<JSONObject>,
      values: JSONObject,
    ) => {
      expect(
        isListedInFormSummary(field, values as FormValues<JSONObject>),
      ).toBe(listed);
    },
  );

  test("a section reviewed by its own line still stands in for its fields", () => {
    const SAYS_WHAT_IT_HOLDS: FormFieldCollapsibleSection<JSONObject> =
      getAdvancedFormSection<JSONObject>({
        getSummary: (): Array<string> => {
          return ["Subscribers are notified."];
        },
      });

    const rows: Fields<JSONObject> = getFormSummaryFields(
      [
        MONITORS,
        { ...STATUS_PAGES, collapsibleSection: SAYS_WHAT_IT_HOLDS },
        { ...NOTIFY, collapsibleSection: SAYS_WHAT_IT_HOLDS },
      ],
      { notify: true } as FormValues<JSONObject>,
    );

    expect(
      rows.map((row: Field<JSONObject>): string | undefined => {
        return row.title;
      }),
    ).toEqual(["Monitors", "More fields"]);
  });
});

/*
 * Scheduling maintenance folds the three subscriber switches and the
 * reminders into a Subscriber Notifications section that says in a line
 * what will happen (FormFieldCollapsibleSection.getSummary). Left at their
 * defaults they are exactly what someone confirming the form needs to read -
 * who is told, and when - so the review shows that line: one row, titled
 * with the section, in place of the section's fields, defaults included.
 */
describe("FormSummary: sections that say what they hold", () => {
  const NOTIFY: FormFieldCollapsibleSection<JSONObject> = {
    id: "subscriber-notifications",
    title: "Subscriber Notifications",
    getSummary: (values: FormValues<JSONObject>): Array<string> => {
      const sentences: Array<string> = [
        values["whenStarted"] === false
          ? "Subscribers are not told when it starts."
          : "Subscribers are told when it starts.",
      ];

      if (values["reminder"]) {
        sentences.push("They get a reminder.");
      }

      return sentences;
    },
  };

  const NOTIFY_STEPS: Array<FormStep<JSONObject>> = [
    { title: "Event", id: "event" },
    { title: "Resources Affected", id: "resources" },
  ];

  const SUMMARISED_FIELDS: Fields<JSONObject> = [
    {
      field: { title: true },
      title: "Title",
      fieldType: FormFieldSchemaType.Text,
      stepId: "event",
    },
    {
      field: { statusPages: true },
      title: "Status Pages",
      fieldType: FormFieldSchemaType.Text,
      stepId: "resources",
    },
    {
      field: { whenStarted: true },
      title: "When it starts",
      fieldType: FormFieldSchemaType.Checkbox,
      defaultValue: true,
      stepId: "resources",
      collapsibleSection: NOTIFY,
    },
    // A field the form hides does not split the section in two.
    {
      field: { hiddenRegistration: true },
      title: "",
      fieldType: FormFieldSchemaType.Text,
      stepId: "resources",
      collapsibleSection: NOTIFY,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: { reminder: true },
      title: "Reminder",
      fieldType: FormFieldSchemaType.Text,
      stepId: "resources",
      collapsibleSection: NOTIFY,
    },
    {
      field: { changeMonitorStatusTo: true },
      title: "Change Monitor Status to",
      fieldType: FormFieldSchemaType.Text,
      stepId: "resources",
      collapsibleSection: getAdvancedFormSection<JSONObject>(),
    },
  ];

  function rowTitles(values: JSONObject): Array<string> {
    return getFormSummaryFields(
      SUMMARISED_FIELDS,
      values as FormValues<JSONObject>,
    ).map((field: Field<JSONObject>): string => {
      return field.title || "";
    });
  }

  test("reviews the section by its line, in place of its fields, defaults included", () => {
    renderSummary({
      values: { title: "Database upgrade", whenStarted: true },
      fields: SUMMARISED_FIELDS,
      steps: NOTIFY_STEPS,
    });

    const summaries: Array<HTMLElement> = screen.getAllByTestId(
      "form-summary-section-summary",
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toHaveTextContent(
      "Subscribers are told when it starts.",
    );
    expect(screen.getByText("Subscriber Notifications")).toBeInTheDocument();
    expect(screen.queryByText("When it starts")).toBeNull();
    expect(screen.queryByText("Reminder")).toBeNull();
  });

  test("follows what is set, one sentence after another", () => {
    renderSummary({
      values: {
        title: "Database upgrade",
        whenStarted: false,
        reminder: "1 day",
      },
      fields: SUMMARISED_FIELDS,
      steps: NOTIFY_STEPS,
    });

    expect(
      screen.getByTestId("form-summary-section-summary"),
    ).toHaveTextContent(
      "Subscribers are not told when it starts. They get a reminder.",
    );
  });

  test("keeps every other row where it was: open fields listed, untouched Advanced ones left out", () => {
    expect(rowTitles({ title: "Database upgrade" })).toEqual([
      "Title",
      "Status Pages",
      "Subscriber Notifications",
    ]);
    expect(
      rowTitles({ title: "Database upgrade", changeMonitorStatusTo: "x" }),
    ).toEqual([
      "Title",
      "Status Pages",
      "Subscriber Notifications",
      "Change Monitor Status to",
    ]);
  });

  test("falls back to its fields when the section has nothing to say", () => {
    const quiet: FormFieldCollapsibleSection<JSONObject> = {
      ...NOTIFY,
      getSummary: (): Array<string> => {
        return [" "];
      },
    };

    const rows: Fields<JSONObject> = getFormSummaryFields(
      SUMMARISED_FIELDS.map((field: Field<JSONObject>): Field<JSONObject> => {
        return field.collapsibleSection === NOTIFY
          ? { ...field, collapsibleSection: quiet }
          : field;
      }),
      {
        title: "Database upgrade",
        reminder: "1 day",
      } as FormValues<JSONObject>,
    );

    // Folded fields are then listed when they hold something of the user's.
    expect(
      rows.map((field: Field<JSONObject>): string => {
        return field.title || "";
      }),
    ).toEqual(["Title", "Status Pages", "Reminder"]);
  });

  test("works on a form without steps too", () => {
    renderSummary({
      values: { title: "Database upgrade" },
      fields: SUMMARISED_FIELDS,
      steps: undefined,
    });

    expect(
      screen.getByTestId("form-summary-section-summary"),
    ).toHaveTextContent("Subscribers are told when it starts.");
  });
});
