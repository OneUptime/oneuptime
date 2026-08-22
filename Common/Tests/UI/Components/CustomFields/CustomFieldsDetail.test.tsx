import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * CustomFieldsDetail used to have exactly one caller per resource: a dedicated
 * "Custom Fields" page reached from the side menu, where a card that says "no
 * custom fields have been added" is the whole point of the page.
 *
 * It is now also mounted on every resource OVERVIEW page, where that same
 * card would be noise on a page nobody opened to look at custom fields - and
 * where a failed schema read (custom fields are gated on both a permission
 * and a billing plan) would staple an error the operator can do nothing about
 * onto every incident they open.
 *
 * `hideIfEmpty` is what separates the two, so most of what follows pins the
 * difference between the two call sites rather than the rendering itself.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so naming the mocks directly would capture them before their
 * initializers have run.
 */
/*
 * The button is now gated on the viewer's permissions, so the tests have to
 * say who is looking at the card. Without a permission snapshot the component
 * cannot tell "not allowed" from "not loaded yet" and offers no button at all
 * - which is correct, and is covered in the permission gating suites.
 */
jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectOwner"] };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

import CustomFieldsDetail from "../../../../UI/Components/CustomFields/CustomFieldsDetail";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../../Models/DatabaseModels/IncidentCustomField";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const NO_FIELDS_MESSAGE: RegExp = /No custom fields have been added/i;

interface SchemaFieldInput {
  name: string;
  description?: string | undefined;
  customFieldType?: CustomFieldType | undefined;
  dropdownOptions?: string | undefined;
}

type BuildSchemaFunction = (
  fields: Array<SchemaFieldInput>,
) => Array<IncidentCustomField>;

const buildSchema: BuildSchemaFunction = (
  fields: Array<SchemaFieldInput>,
): Array<IncidentCustomField> => {
  return fields.map((field: SchemaFieldInput) => {
    const schemaItem: IncidentCustomField = new IncidentCustomField();
    schemaItem.name = field.name;
    schemaItem.description = field.description || "";
    schemaItem.customFieldType = field.customFieldType || CustomFieldType.Text;

    if (field.dropdownOptions) {
      schemaItem.dropdownOptions = field.dropdownOptions;
    }

    return schemaItem;
  });
};

type BuildIncidentFunction = (customFields: JSONObject | undefined) => Incident;

const buildIncident: BuildIncidentFunction = (
  customFields: JSONObject | undefined,
): Incident => {
  const incident: Incident = new Incident();
  incident.id = INCIDENT_ID;

  if (customFields) {
    incident.customFields = customFields;
  }

  return incident;
};

/*
 * The component fires both requests from the same effect. Resolving them from
 * a queue rather than a fixed value keeps each test able to say "the schema
 * loads but the record does not" without reaching into call ordering.
 */
type ResolveListFunction = (data: Array<BaseModel>) => void;

const resolveListWith: ResolveListFunction = (data: Array<BaseModel>): void => {
  getListMock.mockResolvedValue({
    data: data,
    count: data.length,
    skip: 0,
    limit: data.length,
  } as never);
};

interface RenderOptions {
  hideIfEmpty?: boolean | undefined;
  isEditable?: boolean | undefined;
}

type RenderCardFunction = (options?: RenderOptions) => void;

const renderCard: RenderCardFunction = (options?: RenderOptions): void => {
  render(
    <CustomFieldsDetail
      title="Custom Fields"
      description="Custom fields for this incident."
      modelType={Incident}
      customFieldType={IncidentCustomField}
      name="Incident Custom Fields"
      projectId={PROJECT_ID}
      modelId={INCIDENT_ID}
      hideIfEmpty={options?.hideIfEmpty}
      isEditable={options?.isEditable}
    />,
  );
};

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  updateByIdMock.mockReset();
});

describe("CustomFieldsDetail - rendering the values", () => {
  test("shows every defined field with the value stored on the record", async () => {
    resolveListWith(
      buildSchema([
        { name: "Customer", description: "Who reported this" },
        { name: "Ticket Number", customFieldType: CustomFieldType.Number },
      ]),
    );
    getItemMock.mockResolvedValue(
      buildIncident({ Customer: "Acme Corp", "Ticket Number": 4711 }) as never,
    );

    renderCard();

    expect(await screen.findByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("Who reported this")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Ticket Number")).toBeInTheDocument();
    expect(screen.getByText("4711")).toBeInTheDocument();
  });

  test("shows the placeholder for a defined field the record never filled in", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(buildIncident({}) as never);

    renderCard();

    expect(await screen.findByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("No data entered")).toBeInTheDocument();
  });

  test("renders a record whose customFields column was never written", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(buildIncident(undefined) as never);

    renderCard();

    expect(await screen.findByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("No data entered")).toBeInTheDocument();
  });

  test("reads the schema for the project it was given, and the record by id", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(buildIncident({}) as never);

    renderCard();

    await screen.findByText("Customer");

    const listArgs: JSONObject = getListMock.mock.calls[0]![0] as JSONObject;
    expect(listArgs["modelType"]).toBe(IncidentCustomField);
    expect((listArgs["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);

    const itemArgs: JSONObject = getItemMock.mock.calls[0]![0] as JSONObject;
    expect(itemArgs["modelType"]).toBe(Incident);
    expect(itemArgs["id"]).toBe(INCIDENT_ID);
    expect((itemArgs["select"] as JSONObject)["customFields"]).toBe(true);
  });

  test("renders a dropdown value as its configured option", async () => {
    resolveListWith(
      buildSchema([
        {
          name: "Impact",
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: JSON.stringify([
            { value: "Low", color: "#22c55e" },
            { value: "High", color: "#ef4444" },
          ]),
        },
      ]),
    );
    getItemMock.mockResolvedValue(buildIncident({ Impact: "High" }) as never);

    renderCard();

    expect(await screen.findByText("Impact")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
  });

  test("renders every selection of a multi-select dropdown", async () => {
    resolveListWith(
      buildSchema([
        {
          name: "Regions",
          customFieldType: CustomFieldType.MultiSelectDropdown,
          dropdownOptions: "us-east\nus-west\neu-central",
        },
      ]),
    );
    getItemMock.mockResolvedValue(
      buildIncident({ Regions: ["us-east", "eu-central"] }) as never,
    );

    renderCard();

    expect(await screen.findByText("Regions")).toBeInTheDocument();
    expect(screen.getByText("us-east")).toBeInTheDocument();
    expect(screen.getByText("eu-central")).toBeInTheDocument();
    expect(screen.queryByText("us-west")).not.toBeInTheDocument();
  });
});

describe("CustomFieldsDetail - the dedicated page (no hideIfEmpty)", () => {
  test("explains that the project has defined no fields", async () => {
    resolveListWith([]);
    getItemMock.mockResolvedValue(buildIncident({}) as never);

    renderCard();

    expect(await screen.findByText(NO_FIELDS_MESSAGE)).toBeInTheDocument();
  });

  test("surfaces a failed schema read instead of hiding it", async () => {
    getListMock.mockRejectedValue(new Error("Plan does not include this"));
    getItemMock.mockResolvedValue(buildIncident({}) as never);

    renderCard();

    expect(
      await screen.findByText(/Plan does not include this/i),
    ).toBeInTheDocument();
  });

  test("says the record is missing once the fetch settles with nothing", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(null as never);

    renderCard();

    expect(await screen.findByText("Item not found")).toBeInTheDocument();
  });

  /*
   * `model` is null on the very first render too. Announcing "Item not found"
   * then reads as a broken record rather than a pending one, and it flashed on
   * every load before the guard was tightened.
   */
  test("does not claim the record is missing while the fetch is in flight", async () => {
    let resolveItem: (value: Incident) => void = (): void => {};
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockReturnValue(
      new Promise<Incident>((resolve: (value: Incident) => void) => {
        resolveItem = resolve;
      }) as never,
    );

    renderCard();

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });
    expect(screen.queryByText("Item not found")).not.toBeInTheDocument();

    resolveItem(buildIncident({ Customer: "Acme Corp" }));

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.queryByText("Item not found")).not.toBeInTheDocument();
  });
});

describe("CustomFieldsDetail - hideIfEmpty, as the overview pages mount it", () => {
  test("renders nothing at all when the project defined no fields", async () => {
    resolveListWith([]);
    getItemMock.mockResolvedValue(buildIncident({}) as never);

    const { container } = render(
      <CustomFieldsDetail
        title="Custom Fields"
        description="Custom fields for this incident."
        modelType={Incident}
        customFieldType={IncidentCustomField}
        name="Incident Custom Fields"
        projectId={PROJECT_ID}
        modelId={INCIDENT_ID}
        hideIfEmpty={true}
      />,
    );

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });

    expect(screen.queryByText(NO_FIELDS_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText("Custom Fields")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing while the schema is still loading, so nothing flashes", () => {
    getListMock.mockReturnValue(new Promise<never>(() => {}) as never);
    getItemMock.mockReturnValue(new Promise<never>(() => {}) as never);

    const { container } = render(
      <CustomFieldsDetail
        title="Custom Fields"
        description="Custom fields for this incident."
        modelType={Incident}
        customFieldType={IncidentCustomField}
        name="Incident Custom Fields"
        projectId={PROJECT_ID}
        modelId={INCIDENT_ID}
        hideIfEmpty={true}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  /*
   * Reading the custom field schema is gated on a billing plan as well as a
   * permission, so a project below that plan fails this request on every
   * resource it opens. On the overview that has to be silent.
   */
  test("renders nothing when the schema read fails", async () => {
    getListMock.mockRejectedValue(new Error("Plan does not include this"));
    getItemMock.mockResolvedValue(buildIncident({}) as never);

    const { container } = render(
      <CustomFieldsDetail
        title="Custom Fields"
        description="Custom fields for this incident."
        modelType={Incident}
        customFieldType={IncidentCustomField}
        name="Incident Custom Fields"
        projectId={PROJECT_ID}
        modelId={INCIDENT_ID}
        hideIfEmpty={true}
      />,
    );

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(
      screen.queryByText(/Plan does not include this/i),
    ).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  /*
   * The overview page is right there displaying the record, so a card telling
   * the reader it does not exist is a contradiction rather than information.
   */
  test("renders nothing when the record itself comes back empty", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(null as never);

    const { container } = render(
      <CustomFieldsDetail
        title="Custom Fields"
        description="Custom fields for this incident."
        modelType={Incident}
        customFieldType={IncidentCustomField}
        name="Incident Custom Fields"
        projectId={PROJECT_ID}
        modelId={INCIDENT_ID}
        hideIfEmpty={true}
      />,
    );

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Item not found")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  test("shows the card as normal once the project has a field", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(
      buildIncident({ Customer: "Acme Corp" }) as never,
    );

    renderCard({ hideIfEmpty: true });

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Custom Fields")).toBeInTheDocument();
  });
});

describe("CustomFieldsDetail - editing", () => {
  test("offers the edit button by default", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(buildIncident({}) as never);

    renderCard();

    expect(await screen.findByText("Edit Fields")).toBeInTheDocument();
  });

  test("withholds the edit button when the card is read only", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(buildIncident({}) as never);

    renderCard({ isEditable: false });

    expect(await screen.findByText("Customer")).toBeInTheDocument();
    expect(screen.queryByText("Edit Fields")).not.toBeInTheDocument();
  });

  /*
   * The button used to render from the very first paint, before either
   * request had come back. Clicking it then threw reading customFields off a
   * null record and took the card down with it - reachable by anyone who
   * clicked as the page settled.
   */
  test("withholds the edit button for the whole first load", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    let resolveItem: (value: Incident) => void = (): void => {};
    getItemMock.mockReturnValue(
      new Promise<Incident>((resolve: (value: Incident) => void) => {
        resolveItem = resolve;
      }) as never,
    );

    renderCard();

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });
    expect(screen.queryByText("Edit Fields")).not.toBeInTheDocument();

    resolveItem(buildIncident({ Customer: "Acme Corp" }));

    expect(await screen.findByText("Edit Fields")).toBeInTheDocument();
  });

  /*
   * The schema and the record are stored together at the end of onLoad, so
   * the test above cannot tell the "no fields yet" guard apart from the "no
   * record yet" one. This is the case that isolates the record: fields are
   * defined, the fetch has settled, and it settled with nothing. Without that
   * guard the card offers an edit modal over a record that is not there.
   */
  test("withholds the edit button when the record could not be found", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(null as never);

    renderCard();

    expect(await screen.findByText("Item not found")).toBeInTheDocument();
    expect(screen.queryByText("Edit Fields")).not.toBeInTheDocument();
  });

  /* And this is the case that isolates the in-flight guard on its own. */
  test("withholds the edit button while a save is still in flight", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(
      buildIncident({ Customer: "Acme Corp" }) as never,
    );
    let finishSave: () => void = (): void => {};
    updateByIdMock.mockReturnValue(
      new Promise<void>((resolve: () => void) => {
        finishSave = resolve;
      }) as never,
    );

    renderCard();

    fireEvent.click(await screen.findByText("Edit Fields"));
    fireEvent.click(await screen.findByText("Save"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalled();
    });
    expect(screen.queryByText("Edit Fields")).not.toBeInTheDocument();

    finishSave();

    expect(await screen.findByText("Edit Fields")).toBeInTheDocument();
  });

  test("withholds the edit button when there are no fields to edit", async () => {
    resolveListWith([]);
    getItemMock.mockResolvedValue(buildIncident({}) as never);

    renderCard();

    expect(await screen.findByText(NO_FIELDS_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText("Edit Fields")).not.toBeInTheDocument();
  });

  test("writes the edited values back under customFields and reloads", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(
      buildIncident({ Customer: "Acme Corp" }) as never,
    );
    updateByIdMock.mockResolvedValue(undefined as never);

    renderCard();

    fireEvent.click(await screen.findByText("Edit Fields"));

    const input: HTMLInputElement = (await screen.findByDisplayValue(
      "Acme Corp",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Globex" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalled();
    });

    const updateArgs: JSONObject = updateByIdMock.mock
      .calls[0]![0] as JSONObject;
    expect(updateArgs["modelType"]).toBe(Incident);
    expect(updateArgs["id"]).toBe(INCIDENT_ID);
    expect((updateArgs["data"] as JSONObject)["customFields"]).toEqual({
      Customer: "Globex",
    });

    // the card re-reads rather than trusting its own local copy.
    await waitFor(() => {
      expect(getItemMock.mock.calls.length).toBeGreaterThan(1);
    });
  });
});

/*
 * A rejected save is the operator's own edit coming back refused - no update
 * permission on the column, a server validation error, a dropped connection.
 * It is nothing like a failed schema read, which hideIfEmpty is allowed to
 * swallow, and the two used to share one `error` slot. That made a failed
 * save on an overview page delete the entire card, taking the edit and any
 * explanation with it.
 */
describe("CustomFieldsDetail - a rejected save", () => {
  type FailTheSaveFunction = () => Promise<void>;

  const editAndFailTheSave: FailTheSaveFunction = async (): Promise<void> => {
    fireEvent.click(await screen.findByText("Edit Fields"));

    const input: HTMLInputElement = (await screen.findByDisplayValue(
      "Acme Corp",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Globex" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalled();
    });
  };

  test("is reported on the dedicated page, over the unchanged values", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(
      buildIncident({ Customer: "Acme Corp" }) as never,
    );
    updateByIdMock.mockRejectedValue(new Error("Permission denied"));

    renderCard();
    await editAndFailTheSave();

    expect(await screen.findByText(/Permission denied/i)).toBeInTheDocument();
    // what is on screen is still what is stored.
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });

  test("is reported on an overview page rather than hiding the card", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(
      buildIncident({ Customer: "Acme Corp" }) as never,
    );
    updateByIdMock.mockRejectedValue(new Error("Permission denied"));

    renderCard({ hideIfEmpty: true });
    await editAndFailTheSave();

    expect(await screen.findByText(/Permission denied/i)).toBeInTheDocument();
    expect(screen.getByText("Custom Fields")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });

  /*
   * Telling someone their save failed while removing the only control that
   * would let them try again is worse than saying nothing.
   */
  test("leaves the edit button in place so the save can be retried", async () => {
    resolveListWith(buildSchema([{ name: "Customer" }]));
    getItemMock.mockResolvedValue(
      buildIncident({ Customer: "Acme Corp" }) as never,
    );
    updateByIdMock.mockRejectedValue(new Error("Permission denied"));

    renderCard();
    await editAndFailTheSave();

    await screen.findByText(/Permission denied/i);
    expect(screen.getByText("Edit Fields")).toBeInTheDocument();

    updateByIdMock.mockResolvedValue(undefined as never);

    fireEvent.click(screen.getByText("Edit Fields"));
    fireEvent.click(await screen.findByText("Save"));

    await waitFor(() => {
      expect(updateByIdMock.mock.calls.length).toBe(2);
    });

    // and the failure notice goes away once the retry lands.
    await waitFor(() => {
      expect(screen.queryByText(/Permission denied/i)).not.toBeInTheDocument();
    });
  });

  /*
   * The read failure keeps its old behaviour on both call sites: hidden on an
   * overview, reported on the dedicated page. Pinned next to the save cases
   * so the asymmetry is deliberate rather than accidental.
   */
  test("a failed read still hides the card on an overview", async () => {
    getListMock.mockRejectedValue(new Error("Upgrade your plan"));
    getItemMock.mockResolvedValue(buildIncident({}) as never);

    const { container } = render(
      <CustomFieldsDetail
        title="Custom Fields"
        description="Custom fields for this incident."
        modelType={Incident}
        customFieldType={IncidentCustomField}
        name="Incident Custom Fields"
        projectId={PROJECT_ID}
        modelId={INCIDENT_ID}
        hideIfEmpty={true}
      />,
    );

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(container).toBeEmptyDOMElement();
  });
});
