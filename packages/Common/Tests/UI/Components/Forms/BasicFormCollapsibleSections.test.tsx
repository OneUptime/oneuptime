import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

const SECTION: FormFieldCollapsibleSection<JSONObject> = {
  id: "details",
  title: "Description and labels",
  description: "Add context to help responders.",
  isConfigured: (values: FormValues<JSONObject>): boolean => {
    return Boolean(values["description"] || values["label"]);
  },
};

const FIELDS: Fields<JSONObject> = [
  {
    field: { title: true },
    title: "Incident Title",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    dataTestId: "incident-title",
  },
  {
    field: { description: true },
    title: "Description",
    fieldType: FormFieldSchemaType.Text,
    dataTestId: "description",
    collapsibleSection: SECTION,
  },
  {
    field: { label: true },
    title: "Label",
    fieldType: FormFieldSchemaType.Text,
    dataTestId: "label",
    collapsibleSection: SECTION,
    footerElement: <span>Label guidance</span>,
    getFooterElement: (
      values: FormValues<JSONObject>,
      error?: string,
    ): ReactElement => {
      return <span>{error || `Selected: ${values["label"] || "none"}`}</span>;
    },
  },
];

interface RenderFormOptions {
  fields?: Fields<JSONObject>;
  initialValues?: FormValues<JSONObject>;
}

interface RenderFormResult {
  handleSubmit: MockFunction;
  user: UserEvent;
}

function renderForm(options: RenderFormOptions = {}): RenderFormResult {
  const handleSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="collapsible-form"
      fields={options.fields || FIELDS}
      initialValues={options.initialValues || { title: "High burn rate" }}
      showAsColumns={2}
      disableAutofocus={true}
      onSubmit={handleSubmit}
      submitButtonText="Save Rule"
    />,
  );

  return { handleSubmit, user: userEvent.setup({ delay: null }) };
}

async function sectionButton(): Promise<HTMLElement> {
  return screen.findByRole("button", { name: SECTION.title });
}

describe("BasicForm collapsible sections", () => {
  afterEach(() => {
    cleanup();
  });

  test("groups optional fields in a collapsed full-row section and keeps ordinary fields visible", async () => {
    const { user }: RenderFormResult = renderForm();
    const header: HTMLElement = await sectionButton();

    expect(screen.getByTestId("incident-title")).toBeVisible();
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header.parentElement).toHaveClass("md:col-span-2");
    expect(screen.getByTestId("description")).not.toBeVisible();
    expect(screen.getByTestId("label")).not.toBeVisible();
    expect(screen.queryByRole("textbox", { name: /^Description/ })).toBeNull();
    expect(screen.queryByText("Configured")).toBeNull();

    await user.click(header);

    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("description")).toBeVisible();
    expect(screen.getByTestId("label")).toBeVisible();
    expect(screen.getByText(SECTION.description!)).toBeVisible();
    expect(screen.getByText("Label guidance")).toBeVisible();
    expect(screen.getByText("Selected: none")).toBeVisible();
  });

  test("retains mounted controls and values when closing, reopening, and submitting", async () => {
    const { user, handleSubmit }: RenderFormResult = renderForm();
    const header: HTMLElement = await sectionButton();
    await user.click(header);
    const description: HTMLElement = screen.getByTestId("description");

    fireEvent.change(description, { target: { value: "Investigate traffic" } });
    fireEvent.change(screen.getByTestId("label"), {
      target: { value: "Production" },
    });
    await user.click(header);

    expect(description).not.toBeVisible();
    expect(screen.getByTestId("description")).toBe(description);
    expect(screen.getByText("Configured")).toBeVisible();

    await user.click(header);

    expect(screen.getByTestId("description")).toBe(description);
    expect(description).toHaveValue("Investigate traffic");
    expect(screen.getByTestId("label")).toHaveValue("Production");
    expect(screen.getByText("Selected: Production")).toBeVisible();

    await user.click(header);
    await user.click(screen.getByRole("button", { name: "Save Rule" }));

    expect(handleSubmit).toHaveBeenCalledWith(
      {
        title: "High burn rate",
        description: "Investigate traffic",
        label: "Production",
      },
      expect.any(Function),
    );
  });

  test("opens configured sections when editing existing values", async () => {
    const { user }: RenderFormResult = renderForm({
      initialValues: {
        title: "Existing rule",
        description: "Existing response instructions",
      },
    });
    const header: HTMLElement = await sectionButton();

    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("description")).toBeVisible();
    expect(screen.getByTestId("description")).toHaveValue(
      "Existing response instructions",
    );
    expect(screen.queryByText("Configured")).toBeNull();

    await user.click(header);

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Configured")).toBeVisible();
  });

  test("supports keyboard toggles and skips collapsed fields in the tab order", async () => {
    const { user }: RenderFormResult = renderForm();
    const header: HTMLElement = await sectionButton();

    header.focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Save Rule" })).toHaveFocus();

    header.focus();
    await user.keyboard("{Enter}");
    expect(header).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  test("opens configured defaults after fields initialize without reopening a manually closed section", async () => {
    const fields: Fields<JSONObject> = FIELDS.map(
      (field: Field<JSONObject>): Field<JSONObject> => {
        return field.dataTestId === "description"
          ? { ...field, defaultValue: "Default response instructions" }
          : field;
      },
    );
    const { user }: RenderFormResult = renderForm({ fields });
    const header: HTMLElement = await sectionButton();

    await waitFor(() => {
      expect(header).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("description")).toHaveValue(
        "Default response instructions",
      );
    });
    await user.click(header);
    fireEvent.change(screen.getByTestId("incident-title"), {
      target: { value: "Updated rule" },
    });

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("description")).not.toBeVisible();
  });

  test("opens a collapsed section for validation errors on every submit attempt", async () => {
    const fields: Fields<JSONObject> = FIELDS.map(
      (field: Field<JSONObject>): Field<JSONObject> => {
        return field.dataTestId === "description"
          ? { ...field, required: true }
          : field;
      },
    );
    const { user, handleSubmit }: RenderFormResult = renderForm({ fields });
    const header: HTMLElement = await sectionButton();

    // Untouched required fields do not force optional sections open on mount.
    expect(header).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Save Rule" }));

    await waitFor(() => {
      expect(header).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Description is required.")).toBeVisible();
    });
    expect(handleSubmit).not.toHaveBeenCalled();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Save Rule" }));
    await waitFor(() => {
      expect(header).toHaveAttribute("aria-expanded", "true");
    });

    fireEvent.change(screen.getByTestId("description"), {
      target: { value: "Add response context" },
    });
    await user.click(screen.getByRole("button", { name: "Save Rule" }));
    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });

  test("preserves ordinary section headings, descriptions, and full-row fields", async () => {
    renderForm({
      fields: [
        {
          field: { title: true },
          title: "Incident Title",
          fieldType: FormFieldSchemaType.Text,
          dataTestId: "incident-title",
          sectionTitle: "Incident details",
          sectionDescription:
            "Fields without collapsible metadata stay visible.",
          spanFullRow: true,
          footerElement: <span>Title guidance</span>,
        },
      ],
    });

    const title: HTMLElement = await screen.findByTestId("incident-title");
    expect(title).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Incident details" }),
    ).toBeVisible();
    expect(
      screen.getByText("Fields without collapsible metadata stay visible."),
    ).toBeVisible();
    expect(screen.getByText("Title guidance").parentElement).toHaveClass(
      "md:col-span-2",
    );
    expect(screen.queryByRole("button", { name: SECTION.title })).toBeNull();
  });
});
