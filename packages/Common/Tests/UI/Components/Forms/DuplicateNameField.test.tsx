import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  isUniqueColumnNameRefusal,
  withDuplicateNameNotice,
} from "../../../../UI/Components/Forms/Utils/DuplicateNameField";
import { DUPLICATE_NAME_NOTICE_TEST_ID } from "../../../../UI/Components/Forms/DuplicateNameNotice";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import UniqueNamesApi from "../../../../UI/Utils/UniqueNamesApi";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import TableView from "../../../../Models/DatabaseModels/TableView";
import Incident from "../../../../Models/DatabaseModels/Incident";
import { getProjectNameRule } from "../../../../Types/Database/ProjectNameRule";
import {
  getRequiredUniqueNameTakenRefusal,
  getTeamNameTakenRefusal,
} from "../../../../Types/Database/UniqueName";
import ObjectID from "../../../../Types/ObjectID";
import { getJestSpyOn } from "../../../Spy";

/*
 * EVERY MODEL FORM'S NAME FIELD, FOR A KIND WITH A NAME OF ITS OWN IN A
 * PROJECT (#10761, Forms/Utils/DuplicateNameField).
 *
 * ModelForm hands its fields to withDuplicateNameNotice, which gives the
 * field holding the kind's name - and only it - a warning under it as it
 * takes another record's name, and says the server's refusal of a taken
 * name under it rather than above the form. A kind whose names repeat, and
 * a form outside a project (the Admin Dashboard), keep their fields as
 * they are.
 */

const MONITOR_ID: string = "cccccccc-0000-4000-8000-000000010761";

function textField<T extends BaseModel>(
  column: string,
  extra: Partial<Field<T>> = {},
): Field<T> {
  return {
    field: { [column]: true } as Field<T>["field"],
    title: column,
    fieldType: FormFieldSchemaType.Text,
    required: false,
    ...extra,
  };
}

beforeEach(() => {
  getJestSpyOn(UniqueNamesApi, "check").mockResolvedValue({
    isRequired: true,
    takenBy: { id: MONITOR_ID, name: "API Health Check", isArchived: false },
    isTakenByUnreadable: false,
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("which forms change", () => {
  test("a kind whose names may repeat keeps its fields as they are", () => {
    // A table's saved view: kept for one page, its names repeat by design.
    expect(getProjectNameRule(new TableView())).toBeNull();

    const fields: Fields<TableView> = [textField<TableView>("name")];

    expect(
      withDuplicateNameNotice({
        fields,
        model: new TableView(),
        isInProject: true,
      }),
    ).toBe(fields);
  });

  test("an event repeats its title by design: an incident's form is kept as it is", () => {
    expect(getProjectNameRule(new Incident())).toBeNull();

    const fields: Fields<Incident> = [textField<Incident>("title")];

    expect(
      withDuplicateNameNotice({
        fields,
        model: new Incident(),
        isInProject: true,
      }),
    ).toBe(fields);
  });

  test("outside a project - the Admin Dashboard - no form changes", () => {
    const fields: Fields<Monitor> = [textField<Monitor>("name")];

    expect(
      withDuplicateNameNotice({
        fields,
        model: new Monitor(),
        isInProject: false,
      }),
    ).toBe(fields);
  });

  test("a kind held by the setting: its name field changes, and no other", () => {
    expect(getProjectNameRule(new Monitor())).toEqual({
      column: "name",
      isAlwaysUnique: false,
    });

    const name: Field<Monitor> = textField<Monitor>("name");
    const description: Field<Monitor> = textField<Monitor>("description");

    const changed: Fields<Monitor> = withDuplicateNameNotice({
      fields: [name, description],
      model: new Monitor(),
      isInProject: true,
    });

    expect(changed).toHaveLength(2);
    expect(changed[0]).not.toBe(name);
    expect(changed[0]!.getFooterElement).toBeDefined();
    expect(changed[0]!.ownsServerError).toBeDefined();
    // The rest of the field is kept.
    expect(changed[0]!.title).toBe("name");
    expect(changed[0]!.field).toEqual({ name: true });
    expect(changed[1]).toBe(description);
  });

  test("a kind unique always (labels) gets the same warning on its name field", () => {
    expect(getProjectNameRule(new Label())).toEqual({
      column: "name",
      isAlwaysUnique: true,
    });

    const name: Field<Label> = textField<Label>("name");

    const changed: Fields<Label> = withDuplicateNameNotice({
      fields: [name],
      model: new Label(),
      isInProject: true,
    });

    expect(changed[0]).not.toBe(name);
    expect(changed[0]!.getFooterElement).toBeDefined();
  });
});

describe("the server's refusal of a taken name, said under the name field", () => {
  function nameFieldOf(extra: Partial<Field<Monitor>> = {}): Field<Monitor> {
    return withDuplicateNameNotice({
      fields: [textField<Monitor>("name", extra)],
      model: new Monitor(),
      isInProject: true,
    })[0]!;
  }

  test("the refusal of a project that requires unique names", () => {
    const field: Field<Monitor> = nameFieldOf();

    expect(
      field.ownsServerError!(
        getRequiredUniqueNameTakenRefusal({
          kindLabel: "Monitor",
          name: "API Health Check",
          isArchived: false,
        }),
      ),
    ).toBe(true);
    expect(
      field.ownsServerError!(
        getRequiredUniqueNameTakenRefusal({
          kindLabel: "Monitor",
          name: "API Health Check",
          isArchived: true,
        }),
      ),
    ).toBe(true);
  });

  test("the refusals of names unique always: a team's, and a kind's own words", () => {
    const field: Field<Monitor> = nameFieldOf();

    expect(field.ownsServerError!(getTeamNameTakenRefusal("Tenants"))).toBe(
      true,
    );
    expect(
      field.ownsServerError!("Monitor with the same name already exists."),
    ).toBe(true);
  });

  test("any other answer stays above the form", () => {
    const field: Field<Monitor> = nameFieldOf();

    expect(field.ownsServerError!("Server error. Please try again.")).toBe(
      false,
    );
    expect(
      field.ownsServerError!("Status Page with the same name already exists."),
    ).toBe(false);
  });

  test("the field's own server errors are kept", () => {
    const field: Field<Monitor> = nameFieldOf({
      ownsServerError: (message: string): boolean => {
        return message.startsWith("Names cannot");
      },
    });

    expect(field.ownsServerError!("Names cannot start with a dash.")).toBe(
      true,
    );
    expect(field.ownsServerError!("Server error. Please try again.")).toBe(
      false,
    );
  });

  test("the words a kind unique always refuses with, by its singular name", () => {
    expect(
      isUniqueColumnNameRefusal(
        "Status Page with the same name already exists.",
        "Status Page",
      ),
    ).toBe(true);
    expect(
      isUniqueColumnNameRefusal(
        "  Status Page with the same name already exists. It is archived.",
        "Status Page",
      ),
    ).toBe(true);
    expect(
      isUniqueColumnNameRefusal(
        "Status Page with the same name already exists.",
        "Monitor",
      ),
    ).toBe(false);
    expect(
      isUniqueColumnNameRefusal(
        "Status Page with the same name already exists.",
        undefined,
      ),
    ).toBe(false);
    expect(isUniqueColumnNameRefusal("", "Status Page")).toBe(false);
  });
});

describe("under the name field", () => {
  function Footer(props: {
    field: Field<Monitor>;
    values: FormValues<Monitor>;
    error?: string;
  }): ReactElement {
    return (
      <div>{props.field.getFooterElement!(props.values, props.error)}</div>
    );
  }

  test("the field's own footer is kept, and the warning comes after it", async () => {
    const field: Field<Monitor> = withDuplicateNameNotice({
      fields: [
        textField<Monitor>("name", {
          getFooterElement: (): ReactElement => {
            return <p data-testid="own-footer">Shown on the status page.</p>;
          },
        }),
      ],
      model: new Monitor(),
      isInProject: true,
    })[0]!;

    render(
      <Footer
        field={field}
        values={{ name: "API Health Check" } as FormValues<Monitor>}
      />,
    );

    const own: HTMLElement = screen.getByTestId("own-footer");
    const notice: HTMLElement = await screen.findByTestId(
      DUPLICATE_NAME_NOTICE_TEST_ID,
      {},
      { timeout: 5000 },
    );

    expect(
      own.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(notice).toHaveTextContent(
      "Another monitor is already called API Health Check.",
    );
  });

  test("an edit asks about the name the form holds, leaving the record out", async () => {
    const editedId: ObjectID = new ObjectID(
      "dddddddd-0000-4000-8000-000000010761",
    );
    const field: Field<Monitor> = withDuplicateNameNotice({
      fields: [textField<Monitor>("name")],
      model: new Monitor(),
      isInProject: true,
      modelIdToEdit: editedId,
      originalName: "Old name",
    })[0]!;

    render(
      <Footer
        field={field}
        values={{ name: "API Health Check" } as FormValues<Monitor>}
      />,
    );

    await screen.findByTestId(
      DUPLICATE_NAME_NOTICE_TEST_ID,
      {},
      { timeout: 5000 },
    );

    const check: jest.SpyInstance<any, any> =
      UniqueNamesApi.check as unknown as jest.SpyInstance<any, any>;
    const asked: { tableName: string; name: string; exceptId: ObjectID } = check
      .mock.calls[0]![0] as {
      tableName: string;
      name: string;
      exceptId: ObjectID;
    };

    expect(asked.tableName).toBe("Monitor");
    expect(asked.name).toBe("API Health Check");
    expect(asked.exceptId.toString()).toBe(editedId.toString());
  });

  test("a field showing the server's refusal hides the warning: one message under the field", async () => {
    const field: Field<Monitor> = withDuplicateNameNotice({
      fields: [textField<Monitor>("name")],
      model: new Monitor(),
      isInProject: true,
    })[0]!;

    render(
      <Footer
        field={field}
        values={{ name: "API Health Check" } as FormValues<Monitor>}
        error="Another monitor in this project is already called API Health Check, and the project requires unique names. Pick another name."
      />,
    );

    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 600);
      });
    });

    expect(screen.queryByTestId(DUPLICATE_NAME_NOTICE_TEST_ID)).toBeNull();
  });
});
