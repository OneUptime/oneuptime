import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import FormSummary from "../../../../UI/Components/Forms/FormSummary";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
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
