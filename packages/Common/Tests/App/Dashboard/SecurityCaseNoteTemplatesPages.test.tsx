import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

/*
 * Security Events > Settings > Note Templates and a template's own page:
 * the ready-made text a team writes on case after case, picked from the
 * Templates menu of a case's note composer (SecurityCaseNoteKind). The
 * list, the template's two cards and its Delete are stubbed and their props
 * recorded - what each page hands them is the page's contract; the create
 * dialog itself is drawn in ShortFormsOnePage and MarkdownTemplateDialogsWide,
 * and Delete in ListDeleteEveryList.
 */

const TEMPLATE_ID: string = "62000000-0000-4000-8000-000000000007";

const received: Record<string, Array<Record<string, unknown>>> = {};

function record(name: string, props: Record<string, unknown>): void {
  (received[name] ||= []).push(props);
}

function allProps(name: string): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = received[name] || [];

  expect({ name, drawn: calls.length > 0 }).toEqual({ name, drawn: true });

  return calls;
}

function lastProps(name: string): Record<string, unknown> {
  const calls: Array<Record<string, unknown>> = allProps(name);

  return calls[calls.length - 1]!;
}

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      record("ModelTable", props);
      return React.createElement("div", { "data-testid": "model-table" });
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      record("CardModelDetail", props);
      return React.createElement("div", { "data-testid": "card" });
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      record("ModelDelete", props);
      return React.createElement("div", { "data-testid": "delete" });
    },
  };
});

import SecurityCaseNoteTemplatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Settings/NoteTemplates";
import SecurityCaseNoteTemplateViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Settings/NoteTemplateView";
import { SECURITY_CASE_NOTE_TEMPLATES_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/NoteTemplates/SecurityCaseNoteTemplatesCopy";
import NoteTemplateFormCopy from "../../../../App/FeatureSet/Dashboard/src/Components/NoteTemplate/NoteTemplateFormCopy";
import { getSecurityCaseNoteKind } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseNoteKind";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import SecurityCaseNoteTemplate from "../../../Models/DatabaseModels/SecurityCaseNoteTemplate";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { PageBreadcrumbsContext } from "../../../UI/Components/Page/Page";
import FieldType from "../../../UI/Components/Types/FieldType";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/:projectId/security-events"),
} as unknown as PageComponentProps;

interface RecordedFormField {
  field: Record<string, unknown>;
  title?: string;
  description?: string;
  fieldType?: FormFieldSchemaType;
  required?: boolean;
  placeholder?: string;
}

interface RecordedField {
  field: Record<string, unknown>;
  title?: string;
  fieldType?: FieldType;
  type?: FieldType;
}

function keyOf(item: { field: Record<string, unknown> }): string {
  return Object.keys(item.field)[0]!;
}

const LIST_ROUTE: () => string = (): string => {
  return routeFor(PageMap.SECURITY_EVENTS_SETTINGS_NOTE_TEMPLATES);
};

beforeEach(() => {
  for (const name of Object.keys(received)) {
    delete received[name];
  }
  goTo(`/dashboard/${PROJECT_ID}/security-events/settings/note-templates`);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(TEMPLATE_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function draw(page: ReactElement): Promise<void> {
  await act(async () => {
    render(<MemoryRouter>{page}</MemoryRouter>);
  });
}

describe("Security Events > Settings > Note Templates", () => {
  test("lists the project's case note templates, named as its title is", async () => {
    await draw(<SecurityCaseNoteTemplatesPage {...PAGE_PROPS} />);

    const table: Record<string, unknown> = lastProps("ModelTable");

    expect(table["modelType"]).toBe(SecurityCaseNoteTemplate);
    expect(table["id"]).toBe("security-case-note-templates-table");
    expect(String(table["name"])).toBe(
      "Security Events > Settings > Note Templates",
    );
    expect(
      (
        (table["query"] as Record<string, unknown>)["projectId"] as ObjectID
      ).toString(),
    ).toBe(PROJECT_ID);
    // One template and several, under the page's title: never the model's name.
    expect(table["singularName"]).toBe("Note Template");
    expect(table["pluralName"]).toBe("Note Templates");
    expect(table["cardProps"]).toEqual({
      title: "Case Note Templates",
      description:
        "Ready-made text for the notes your team writes on its cases. Pick one in a case's note composer and edit it before posting.",
    });
    expect(table["noItemsMessage"]).toBe("No note templates yet.");
  });

  test("creates, opens and deletes a template; it is edited on its own page", async () => {
    await draw(<SecurityCaseNoteTemplatesPage {...PAGE_PROPS} />);

    const table: Record<string, unknown> = lastProps("ModelTable");

    expect(table["isCreateable"]).toBe(true);
    expect(table["isViewable"]).toBe(true);
    expect(table["isDeleteable"]).toBe(true);
    expect(table["isEditable"]).toBe(false);
    // A row opens the template's page, below this list's address.
    expect(String(table["viewPageRoute"])).toBe(LIST_ROUTE());
    expect(LIST_ROUTE()).toBe(
      `/dashboard/${PROJECT_ID}/security-events/settings/note-templates`,
    );
  });

  test("asks for a name, what it is for, then the note, on one page", async () => {
    await draw(<SecurityCaseNoteTemplatesPage {...PAGE_PROPS} />);

    const table: Record<string, unknown> = lastProps("ModelTable");
    const fields: Array<RecordedFormField> = table[
      "formFields"
    ] as Array<RecordedFormField>;

    expect(fields.map(keyOf)).toEqual([
      "templateName",
      "templateDescription",
      "note",
    ]);
    expect(table["formSteps"]).toBeUndefined();

    const [name, description, note] = fields as [
      RecordedFormField,
      RecordedFormField,
      RecordedFormField,
    ];

    expect(name).toMatchObject({
      title: "Template Name",
      description:
        "What people pick the template by in a case's note composer.",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Containment checklist",
    });
    // What it is for is the template's own business: not asked for.
    expect(description).toMatchObject({
      title: "Template Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "What was contained, how, and what is still open.",
    });
    expect(note).toMatchObject({
      title: NoteTemplateFormCopy.noteFieldTitle,
      description: NoteTemplateFormCopy.noteFieldDescription,
      fieldType: FormFieldSchemaType.Markdown,
      required: true,
    });
  });

  test("its columns and filters are the template's name and description", async () => {
    await draw(<SecurityCaseNoteTemplatesPage {...PAGE_PROPS} />);

    const table: Record<string, unknown> = lastProps("ModelTable");
    const columns: Array<RecordedField> = table[
      "columns"
    ] as Array<RecordedField>;
    const filters: Array<RecordedField> = table[
      "filters"
    ] as Array<RecordedField>;

    expect(
      columns.map((column: RecordedField): [string, string | undefined] => {
        return [keyOf(column), column.title];
      }),
    ).toEqual([
      ["templateName", "Name"],
      ["templateDescription", "Description"],
    ]);
    expect(
      filters.map((filter: RecordedField): [string, string | undefined] => {
        return [keyOf(filter), filter.title];
      }),
    ).toEqual([
      ["templateName", "Template Name"],
      ["templateDescription", "Template Description"],
    ]);
  });

  test("is where a case's note composer sends a person to manage them", () => {
    const kind: ReturnType<typeof getSecurityCaseNoteKind> =
      getSecurityCaseNoteKind({
        securityCaseId: new ObjectID("20000000-0000-4000-8000-000000000142"),
      });

    expect(kind.templates?.modelType).toBe(SecurityCaseNoteTemplate);
    expect(String(kind.templates?.settingsRoute)).toBe(LIST_ROUTE());
  });
});

describe("a case note template's page", () => {
  test("shows its name and what it is for, then its note as it reads, each card edited on its own", async () => {
    await draw(<SecurityCaseNoteTemplateViewPage {...PAGE_PROPS} />);

    const cards: Array<Record<string, unknown>> = allProps("CardModelDetail");

    expect(cards).toHaveLength(2);

    const [details, note] = cards as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    const detailsProps: Record<string, unknown> = details[
      "modelDetailProps"
    ] as Record<string, unknown>;
    const noteProps: Record<string, unknown> = note[
      "modelDetailProps"
    ] as Record<string, unknown>;

    expect(details["cardProps"]).toEqual({
      title: "Template Details",
      description: "The name people pick this template by, and what it is for.",
    });
    expect(details["isEditable"]).toBe(true);
    expect(details["editButtonText"]).toBe("Edit Details");
    expect(detailsProps["modelType"]).toBe(SecurityCaseNoteTemplate);
    expect((detailsProps["modelId"] as ObjectID).toString()).toBe(TEMPLATE_ID);
    expect((detailsProps["fields"] as Array<RecordedField>).map(keyOf)).toEqual(
      ["templateName", "templateDescription"],
    );
    expect(
      (details["formFields"] as Array<RecordedFormField>).map(keyOf),
    ).toEqual(["templateName", "templateDescription"]);

    expect(note["cardProps"]).toEqual({
      title: "Note Template",
      description: NoteTemplateFormCopy.noteFieldDescription,
    });
    expect(note["isEditable"]).toBe(true);
    expect(note["editButtonText"]).toBe("Edit Note Template");
    expect(noteProps["modelType"]).toBe(SecurityCaseNoteTemplate);
    expect((noteProps["modelId"] as ObjectID).toString()).toBe(TEMPLATE_ID);
    // The note drawn as it reads in a case, not as its Markdown source.
    expect(noteProps["fields"]).toEqual([
      {
        field: { note: true },
        title: NoteTemplateFormCopy.noteFieldTitle,
        fieldType: FieldType.Markdown,
      },
    ]);
    expect((note["formFields"] as Array<RecordedFormField>).map(keyOf)).toEqual(
      ["note"],
    );
  });

  /*
   * Its two cards' Edit dialogs name the template as the list, its Create
   * and its Delete do - "Edit Note Template" - not by the model's longer
   * name ("Edit Security Case Note Template").
   */
  test("names a template as the list does in both cards' edit dialogs", async () => {
    await draw(<SecurityCaseNoteTemplateViewPage {...PAGE_PROPS} />);

    const cards: Array<Record<string, unknown>> = allProps("CardModelDetail");

    expect(
      cards.map((card: Record<string, unknown>): unknown => {
        return card["singularName"];
      }),
    ).toEqual([
      SECURITY_CASE_NOTE_TEMPLATES_COPY.singularName,
      SECURITY_CASE_NOTE_TEMPLATES_COPY.singularName,
    ]);
    expect(SECURITY_CASE_NOTE_TEMPLATES_COPY.singularName).toBe(
      "Note Template",
    );
  });

  /*
   * The trail and the browser's tab name the template once it is read -
   * "Note Templates > Containment checklist" - as a hunt's, a watchlist's
   * and a playbook's pages in Security Events do, and follow a rename.
   * Before the read, the layout's own trail stands.
   */
  test("names the template in its trail once it is read, and after a rename", async () => {
    goTo(
      `/dashboard/${PROJECT_ID}/security-events/settings/note-templates/${TEMPLATE_ID}`,
    );
    const trails: Array<Array<Link> | null> = [];
    const setLinks: (links: Array<Link> | null) => void = (
      links: Array<Link> | null,
    ): void => {
      trails.push(links);
    };

    await act(async () => {
      render(
        <MemoryRouter>
          <PageBreadcrumbsContext.Provider value={setLinks}>
            <SecurityCaseNoteTemplateViewPage {...PAGE_PROPS} />
          </PageBreadcrumbsContext.Provider>
        </MemoryRouter>,
      );
    });

    // Not read yet: the layout's trail, "Note Template", stays.
    expect(trails[trails.length - 1]).toBeNull();

    const details: Record<string, unknown> = allProps("CardModelDetail")[0]!;
    const onItemLoaded: (item: SecurityCaseNoteTemplate) => void = (
      details["modelDetailProps"] as Record<string, unknown>
    )["onItemLoaded"] as (item: SecurityCaseNoteTemplate) => void;

    const read: (name: string) => Promise<Array<Link>> = async (
      name: string,
    ): Promise<Array<Link>> => {
      const template: SecurityCaseNoteTemplate = new SecurityCaseNoteTemplate(
        new ObjectID(TEMPLATE_ID),
      );
      template.templateName = name;

      await act(async () => {
        onItemLoaded(template);
      });

      const trail: Array<Link> | null = trails[trails.length - 1] || null;

      expect(trail).not.toBeNull();

      return trail!;
    };

    const named: Array<Link> = await read("Containment checklist");

    expect(
      named.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual([
      "Project",
      "Security Events",
      "Settings",
      "Note Templates",
      "Note Template",
    ]);
    // The template's own crumb carries its name; the list's is the list's.
    expect(named[named.length - 1]!.recordName).toBe("Containment checklist");
    expect(String(named[named.length - 2]!.to)).toBe(LIST_ROUTE());

    const renamed: Array<Link> = await read("Eradication summary");

    expect(renamed[renamed.length - 1]!.recordName).toBe("Eradication summary");
  });

  test("Delete removes the template and goes back to the list", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        // Recorded, not followed.
      });

    await draw(<SecurityCaseNoteTemplateViewPage {...PAGE_PROPS} />);

    const remove: Record<string, unknown> = lastProps("ModelDelete");

    expect(remove["modelType"]).toBe(SecurityCaseNoteTemplate);
    expect((remove["modelId"] as ObjectID).toString()).toBe(TEMPLATE_ID);
    // "Delete Note Template", as the list and the trail name one.
    expect(remove["singularName"]).toBe("Note Template");

    (remove["onDeleteSuccess"] as () => void)();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]?.[0])).toBe(LIST_ROUTE());
  });
});

describe("the words the pages say", () => {
  test("are the copy's, each an English key of the Dashboard's locale files", () => {
    // Every value is a sentence or a name: none is left empty.
    for (const [key, value] of Object.entries(
      SECURITY_CASE_NOTE_TEMPLATES_COPY,
    )) {
      expect({ key, value: value.trim().length > 0 }).toEqual({
        key,
        value: true,
      });
    }
  });
});
