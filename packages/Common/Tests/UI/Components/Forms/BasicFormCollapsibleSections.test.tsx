import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";
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

/*
 * "There should be an advanced section, which should be collapsed by
 * default. You can expand it and click on those options." An Advanced
 * section (getAdvancedFormSection) is folded on Create and on Edit alike,
 * says "Configured" while anything in it is set - worked out from its own
 * fields - and still opens by itself when a field in it fails validation.
 */
describe("BasicForm Advanced sections", () => {
  afterEach(() => {
    cleanup();
  });

  const advanced: FormFieldCollapsibleSection<JSONObject> =
    getAdvancedFormSection<JSONObject>();

  const ADVANCED_FIELDS: Fields<JSONObject> = [
    {
      field: { name: true },
      title: "Field Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      dataTestId: "field-name",
    },
    {
      field: { showOnCreate: true },
      title: "Show on Create",
      fieldType: FormFieldSchemaType.Toggle,
      collapsibleSection: advanced,
    },
    {
      field: { autoResolve: true },
      title: "Auto Resolve",
      fieldType: FormFieldSchemaType.Toggle,
      defaultValue: true,
      collapsibleSection: advanced,
    },
    {
      field: { note: true },
      title: "Note",
      fieldType: FormFieldSchemaType.Text,
      dataTestId: "note",
      collapsibleSection: advanced,
    },
  ];

  async function advancedButton(): Promise<HTMLElement> {
    return screen.findByRole("button", { name: "Advanced" });
  }

  test("starts folded with nothing set, and says nothing on its header", async () => {
    renderForm({ fields: ADVANCED_FIELDS, initialValues: {} });

    const header: HTMLElement = await advancedButton();

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("field-name")).toBeVisible();
    expect(screen.getByTestId("note")).not.toBeVisible();
    // The default-on switch is in its default position: nothing is set.
    expect(screen.queryByText("Configured")).toBeNull();
  });

  test("stays folded on an Edit form that has something set, and says Configured", async () => {
    renderForm({
      fields: ADVANCED_FIELDS,
      initialValues: { name: "Region", showOnCreate: true },
    });

    const header: HTMLElement = await advancedButton();

    await waitFor(() => {
      expect(screen.getByText("Configured")).toBeVisible();
    });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("note")).not.toBeVisible();
  });

  test("counts a default-on switch turned off as set", async () => {
    renderForm({
      fields: ADVANCED_FIELDS,
      initialValues: { name: "Region", autoResolve: false },
    });

    await advancedButton();

    await waitFor(() => {
      expect(screen.getByText("Configured")).toBeVisible();
    });
  });

  test("opens on a click, keeps what is typed, and says Configured once folded again", async () => {
    const { user, handleSubmit }: RenderFormResult = renderForm({
      fields: ADVANCED_FIELDS,
      initialValues: { name: "Region" },
    });

    const header: HTMLElement = await advancedButton();

    await user.click(header);

    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("note")).toBeVisible();
    // Open, the header has no badge: the fields say it themselves.
    expect(screen.queryByText("Configured")).toBeNull();

    fireEvent.change(screen.getByTestId("note"), {
      target: { value: "Ask the platform team" },
    });

    await user.click(header);

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Configured")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Save Rule" }));

    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Region",
        note: "Ask the platform team",
        // An untouched switch is submitted off.
        showOnCreate: false,
      }),
      expect.any(Function),
    );
  });

  test("stops saying Configured when what was set is cleared", async () => {
    const { user }: RenderFormResult = renderForm({
      fields: ADVANCED_FIELDS,
      initialValues: { name: "Region", note: "Old note" },
    });

    const header: HTMLElement = await advancedButton();

    await waitFor(() => {
      expect(screen.getByText("Configured")).toBeVisible();
    });

    await user.click(header);
    fireEvent.change(screen.getByTestId("note"), { target: { value: "" } });
    await user.click(header);

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Configured")).toBeNull();
  });

  test("opens by itself when a field in it fails validation", async () => {
    const fields: Fields<JSONObject> = ADVANCED_FIELDS.map(
      (candidate: Field<JSONObject>): Field<JSONObject> => {
        return candidate.dataTestId === "note"
          ? { ...candidate, required: true }
          : candidate;
      },
    );

    const { user, handleSubmit }: RenderFormResult = renderForm({
      fields,
      initialValues: { name: "Region" },
    });

    const header: HTMLElement = await advancedButton();

    expect(header).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "Save Rule" }));

    await waitFor(() => {
      expect(header).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Note is required.")).toBeVisible();
    });
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  test("leaves a section that opens on a value (no openWhenConfigured: false) as it was", async () => {
    renderForm({
      initialValues: {
        title: "Existing rule",
        description: "Existing response instructions",
      },
    });

    // The SECTION above: a section of details someone wrote opens to show them.
    expect(await sectionButton()).toHaveAttribute("aria-expanded", "true");
  });
});

/*
 * "Subscribers are notified when the event is scheduled, starts and ends" -
 * a section whose defaults suit most people folds to the line that says
 * what they are (FormFieldCollapsibleSection.getSummary), worked out from
 * the form's values as they are now. The line takes the place of the
 * "Configured" badge, which shows as before when there is no line.
 */
describe("BasicForm section summaries", () => {
  afterEach(() => {
    cleanup();
  });

  const NOTIFY: FormFieldCollapsibleSection<JSONObject> = {
    id: "notify",
    title: "Subscriber Notifications",
    description: "Who hears about it.",
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

  const NOTIFY_FIELDS: Fields<JSONObject> = [
    {
      field: { title: true },
      title: "Title",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      dataTestId: "title",
    },
    {
      field: { whenStarted: true },
      title: "When it starts",
      fieldType: FormFieldSchemaType.Checkbox,
      defaultValue: true,
      collapsibleSection: NOTIFY,
    },
    {
      field: { reminder: true },
      title: "Reminder",
      fieldType: FormFieldSchemaType.Text,
      dataTestId: "reminder",
      collapsibleSection: NOTIFY,
    },
  ];

  async function notifyButton(): Promise<HTMLElement> {
    return screen.findByRole("button", { name: "Subscriber Notifications" });
  }

  test("folds to its line while what it holds is the default", async () => {
    renderForm({ fields: NOTIFY_FIELDS, initialValues: {} });

    const header: HTMLElement = await notifyButton();

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      "Subscribers are told when it starts.",
    );
    expect(header).toHaveAccessibleDescription(
      "Subscribers are told when it starts.",
    );
    expect(screen.queryByText("Configured")).toBeNull();
  });

  test("follows what is set, one sentence after another, and never says Configured", async () => {
    const { user }: RenderFormResult = renderForm({
      fields: NOTIFY_FIELDS,
      initialValues: {},
    });

    const header: HTMLElement = await notifyButton();

    await user.click(header);
    // Open, the fields and the description say it.
    expect(screen.queryByTestId("collapsible-section-summary")).toBeNull();
    expect(screen.getByText("Who hears about it.")).toBeVisible();

    await user.click(screen.getByRole("checkbox", { name: "When it starts" }));
    fireEvent.change(screen.getByTestId("reminder"), {
      target: { value: "1 day before" },
    });
    await user.click(header);

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      "Subscribers are not told when it starts. They get a reminder.",
    );
    expect(screen.queryByText("Configured")).toBeNull();
  });

  test("opens by itself on a form that starts away from the defaults, like any section", async () => {
    renderForm({
      fields: NOTIFY_FIELDS,
      initialValues: { title: "Database upgrade", whenStarted: false },
    });

    const header: HTMLElement = await notifyButton();

    await waitFor(() => {
      expect(header).toHaveAttribute("aria-expanded", "true");
    });
    expect(
      screen.getByRole("checkbox", { name: "When it starts" }),
    ).not.toBeChecked();
  });

  test("says Configured as before when it has nothing to say", async () => {
    const quiet: FormFieldCollapsibleSection<JSONObject> = {
      ...NOTIFY,
      openWhenConfigured: false,
      getSummary: (): Array<string> => {
        return [];
      },
    };

    renderForm({
      fields: NOTIFY_FIELDS.map(
        (candidate: Field<JSONObject>): Field<JSONObject> => {
          return candidate.collapsibleSection
            ? { ...candidate, collapsibleSection: quiet }
            : candidate;
        },
      ),
      initialValues: { title: "Database upgrade", reminder: "1 day" },
    });

    await notifyButton();

    await waitFor(() => {
      expect(screen.getByText("Configured")).toBeVisible();
    });
    expect(screen.queryByTestId("collapsible-section-summary")).toBeNull();
  });
});
