import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Field, {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { computeAccessibleDescription } from "dom-accessibility-api";
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

/*
 * The chips a folded header draws for the fields that are set, as read on
 * screen: "Label: Production".
 */
function setChips(): Array<string> {
  return screen
    .queryAllByTestId("folded-section-item")
    .filter((item: HTMLElement): boolean => {
      return item.getAttribute("data-item-set") === "true";
    })
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

// Every name a folded header lists, set or not.
function listedNames(): Array<string> {
  return screen
    .queryAllByTestId("folded-section-item")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

// What a screen reader reads after the header's name, spaces evened out.
function description(element: HTMLElement): string {
  return computeAccessibleDescription(element)
    .replace(/\s+,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
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
    // Its title says what it holds, so nothing is listed until it is set.
    expect(listedNames()).toEqual([]);
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
    // Folded, what is set shows as chips that say what it is set to.
    expect(setChips()).toEqual([
      "Description: Investigate traffic",
      "Label: Production",
    ]);
    expect(screen.queryByText("Configured")).toBeNull();

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
    // Open, the fields say it themselves.
    expect(setChips()).toEqual([]);

    await user.click(header);

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(setChips()).toEqual(["Description: Existing response instructions"]);
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
 * default. You can expand it and click on those options." And later: "The
 * advanced section in the form should be called something better ... show
 * what things are inside it when collapsed (small summary of things)."
 *
 * A More fields section (getAdvancedFormSection) is folded on Create and on
 * Edit alike, names the fields it holds on its folded header, draws each
 * one that is set as a chip that says what it is set to - worked out from
 * its own fields - and still opens by itself when a field in it fails
 * validation.
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
    return screen.findByRole("button", { name: "More fields" });
  }

  test("starts folded, naming the fields it holds, with nothing set", async () => {
    renderForm({ fields: ADVANCED_FIELDS, initialValues: {} });

    const header: HTMLElement = await advancedButton();

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("field-name")).toBeVisible();
    expect(screen.getByTestId("note")).not.toBeVisible();
    expect(listedNames()).toEqual(["Show on Create", "Auto Resolve", "Note"]);
    // The default-on switch is in its default position: nothing is set.
    expect(setChips()).toEqual([]);
    expect(screen.queryByText("Configured")).toBeNull();
    // Read out with the header.
    expect(description(header)).toBe("Show on Create, Auto Resolve, Note");
    // A tile with the More fields icon, grey while nothing is set.
    expect(screen.getByTestId("folded-section-icon")).toHaveClass(
      "bg-gray-100",
    );
  });

  test("stays folded on an Edit form that has something set, and shows it as a chip", async () => {
    renderForm({
      fields: ADVANCED_FIELDS,
      initialValues: { name: "Region", showOnCreate: true },
    });

    const header: HTMLElement = await advancedButton();

    await waitFor(() => {
      expect(setChips()).toEqual(["Show on Create: On"]);
    });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("note")).not.toBeVisible();
    // The unset ones are still named.
    expect(listedNames()).toEqual([
      "Show on Create: On",
      "Auto Resolve",
      "Note",
    ]);
    expect(screen.getByTestId("folded-section-icon")).toHaveClass(
      "bg-indigo-50",
    );
    expect(screen.queryByText("Configured")).toBeNull();
  });

  test("counts a default-on switch turned off as set", async () => {
    renderForm({
      fields: ADVANCED_FIELDS,
      initialValues: { name: "Region", autoResolve: false },
    });

    await advancedButton();

    await waitFor(() => {
      expect(setChips()).toEqual(["Auto Resolve: Off"]);
    });
  });

  test("opens on a click, keeps what is typed, and shows it as a chip once folded again", async () => {
    const { user, handleSubmit }: RenderFormResult = renderForm({
      fields: ADVANCED_FIELDS,
      initialValues: { name: "Region" },
    });

    const header: HTMLElement = await advancedButton();

    await user.click(header);

    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("note")).toBeVisible();
    // Open, the header lists nothing: the fields say it themselves.
    expect(listedNames()).toEqual([]);

    fireEvent.change(screen.getByTestId("note"), {
      target: { value: "Ask the platform team" },
    });

    await user.click(header);

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(setChips()).toEqual(["Note: Ask the platform team"]);

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

  test("stops showing a field as set when what was set is cleared", async () => {
    const { user }: RenderFormResult = renderForm({
      fields: ADVANCED_FIELDS,
      initialValues: { name: "Region", note: "Old note" },
    });

    const header: HTMLElement = await advancedButton();

    await waitFor(() => {
      expect(setChips()).toEqual(["Note: Old note"]);
    });

    await user.click(header);
    fireEvent.change(screen.getByTestId("note"), { target: { value: "" } });
    await user.click(header);

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(setChips()).toEqual([]);
    expect(listedNames()).toEqual(["Show on Create", "Auto Resolve", "Note"]);
  });

  test("a section whose own rule says it is not configured shows nothing as set", async () => {
    // An escalation rule named after its level: its name is no choice.
    const named: FormFieldCollapsibleSection<JSONObject> =
      getAdvancedFormSection<JSONObject>({
        isConfigured: (values: FormValues<JSONObject>): boolean => {
          return values["note"] !== "Level 2";
        },
      });

    renderForm({
      fields: ADVANCED_FIELDS.map(
        (candidate: Field<JSONObject>): Field<JSONObject> => {
          return candidate.collapsibleSection
            ? { ...candidate, collapsibleSection: named }
            : candidate;
        },
      ),
      initialValues: { name: "Region", note: "Level 2" },
    });

    await advancedButton();

    await waitFor(() => {
      expect(listedNames()).toEqual(["Show on Create", "Auto Resolve", "Note"]);
    });
    expect(setChips()).toEqual([]);
  });

  test("says what its defaults do in a sentence under the fields it names", async () => {
    const withSummary: FormFieldCollapsibleSection<JSONObject> =
      getAdvancedFormSection<JSONObject>({
        getSummary: (values: FormValues<JSONObject>) => {
          return values["note"]
            ? undefined
            : ["The note is left out of the message."];
        },
      });

    renderForm({
      fields: ADVANCED_FIELDS.map(
        (candidate: Field<JSONObject>): Field<JSONObject> => {
          return candidate.collapsibleSection
            ? { ...candidate, collapsibleSection: withSummary }
            : candidate;
        },
      ),
      initialValues: { name: "Region" },
    });

    const header: HTMLElement = await advancedButton();

    expect(listedNames()).toEqual(["Show on Create", "Auto Resolve", "Note"]);
    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      "The note is left out of the message.",
    );
    expect(description(header)).toBe(
      "Show on Create, Auto Resolve, Note The note is left out of the message.",
    );
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
 * the form's values as they are now. A section whose title says what it
 * holds shows the line in place of chips for its set fields, which it shows
 * when there is no line.
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

  test("shows what is set as chips when it has nothing to say", async () => {
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
      expect(setChips()).toEqual(["Reminder: 1 day"]);
    });
    // Its title says what it holds: the unset ones are not listed.
    expect(listedNames()).toEqual(["Reminder: 1 day"]);
    expect(screen.queryByTestId("collapsible-section-summary")).toBeNull();
    expect(screen.queryByText("Configured")).toBeNull();
    // Only More fields wears the icon tile.
    expect(screen.queryByTestId("folded-section-icon")).toBeNull();
  });

  test("says Configured when its own rule says so but no field it shows is set", async () => {
    const configured: FormFieldCollapsibleSection<JSONObject> = {
      ...NOTIFY,
      openWhenConfigured: false,
      isConfigured: (values: FormValues<JSONObject>): boolean => {
        return values["title"] === "Database upgrade";
      },
      getSummary: (): Array<string> => {
        return [];
      },
    };

    renderForm({
      fields: NOTIFY_FIELDS.map(
        (candidate: Field<JSONObject>): Field<JSONObject> => {
          return candidate.collapsibleSection
            ? { ...candidate, collapsibleSection: configured }
            : candidate;
        },
      ),
      initialValues: { title: "Database upgrade" },
    });

    await notifyButton();

    await waitFor(() => {
      expect(screen.getByTestId("folded-section-badge")).toHaveTextContent(
        "Configured",
      );
    });
    expect(setChips()).toEqual([]);
  });
});

/*
 * A custom element that keeps what it edits in other form values - a
 * grouping rule's "Reopen recently resolved episodes" switch and its
 * minutes, kept in two of the rule's columns - says itself what it is set
 * to (Field.getFoldedValue). The folded header follows the values it edits,
 * never its own carrier value, so turning it on draws a chip and turning it
 * off again takes the chip away, on Create and on Edit alike.
 */
describe("BasicForm More fields with a custom element that keeps its value elsewhere", () => {
  afterEach(() => {
    cleanup();
  });

  const advanced: FormFieldCollapsibleSection<JSONObject> =
    getAdvancedFormSection<JSONObject>();

  interface ReopenValue {
    enabled: boolean;
    minutes: number;
  }

  const REOPEN_FIELDS: Fields<JSONObject> = [
    {
      field: { name: true },
      title: "Rule Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      dataTestId: "rule-name",
    },
    {
      field: { reopenSetting: true },
      title: "Reopen recently resolved episodes",
      fieldType: FormFieldSchemaType.CustomComponent,
      customElementDrawsOwnLabel: true,
      collapsibleSection: advanced,
      // A carrier: there from the start, so the field's own check runs.
      getDefaultValue: (): boolean => {
        return true;
      },
      getFoldedValue: (values: FormValues<JSONObject>): string | null => {
        return values["enableReopen"] === true
          ? `${String(values["reopenMinutes"])} minutes`
          : null;
      },
      onChange: (
        value: ReopenValue,
        currentValues: FormValues<JSONObject>,
        setNewFormValues: (values: FormValues<JSONObject>) => void,
      ): void => {
        setNewFormValues({
          ...currentValues,
          enableReopen: value.enabled,
          reopenMinutes: value.minutes,
        });
      },
      getCustomElement: (
        values: FormValues<JSONObject>,
        props: CustomElementProps,
      ): ReactElement => {
        const enabled: boolean = values["enableReopen"] === true;

        return (
          <button
            type="button"
            data-testid="reopen-toggle"
            onClick={(): void => {
              props.onChange?.({ enabled: !enabled, minutes: 30 });
            }}
          >
            {enabled ? "Reopen: on" : "Reopen: off"}
          </button>
        );
      },
    },
    {
      field: { note: true },
      title: "Note",
      fieldType: FormFieldSchemaType.Text,
      dataTestId: "note",
      collapsibleSection: advanced,
    },
  ];

  async function moreFieldsButton(): Promise<HTMLElement> {
    return screen.findByRole("button", { name: "More fields" });
  }

  test("names it, unset, on a new form, though its carrier value is there", async () => {
    renderForm({ fields: REOPEN_FIELDS, initialValues: { name: "Storms" } });

    await moreFieldsButton();

    expect(listedNames()).toEqual([
      "Reopen recently resolved episodes",
      "Note",
    ]);
    expect(setChips()).toEqual([]);
    expect(screen.queryByText("Configured")).toBeNull();
  });

  test("draws a chip that says what it edits once it is turned on, and takes it away when turned off", async () => {
    const { user, handleSubmit }: RenderFormResult = renderForm({
      fields: REOPEN_FIELDS,
      initialValues: { name: "Storms" },
    });

    const header: HTMLElement = await moreFieldsButton();

    await user.click(header);
    await user.click(screen.getByTestId("reopen-toggle"));
    expect(screen.getByTestId("reopen-toggle")).toHaveTextContent("Reopen: on");

    await user.click(header);
    expect(setChips()).toEqual([
      "Reopen recently resolved episodes: 30 minutes",
    ]);
    expect(screen.getByTestId("folded-section-icon")).toHaveClass(
      "bg-indigo-50",
    );

    /*
     * Off again: its carrier now holds what the control handed over last,
     * but the values it edits say it is off - no chip.
     */
    await user.click(header);
    await user.click(screen.getByTestId("reopen-toggle"));
    await user.click(header);
    expect(setChips()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Save Rule" }));

    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Storms",
        enableReopen: false,
        reopenMinutes: 30,
      }),
      expect.any(Function),
    );
  });

  test("stays folded on an Edit form that has it on, its chip saying what it is set to", async () => {
    renderForm({
      fields: REOPEN_FIELDS,
      initialValues: { name: "Storms", enableReopen: true, reopenMinutes: 45 },
    });

    const header: HTMLElement = await moreFieldsButton();

    await waitFor(() => {
      expect(setChips()).toEqual([
        "Reopen recently resolved episodes: 45 minutes",
      ]);
    });
    expect(header).toHaveAttribute("aria-expanded", "false");
    // Read out with the header, set and unset alike.
    expect(description(header)).toBe(
      "Reopen recently resolved episodes: 45 minutes, Note",
    );
  });
});
