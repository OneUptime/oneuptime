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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Incidents → Settings → Incident Templates: a new template no longer
 * starts with a state picked. The page looked up the first incident state
 * by order and put it in Initial Incident State - racing the form's first
 * render, not always the state the server starts an incident in (a custom
 * state can be dragged above the created state), and saved on every new
 * template whether or not anyone chose it. Left empty, an incident declared
 * from the template starts where every new incident does: IncidentService
 * picks the project's created state when none is given.
 *
 * So, as on Declare Incident, the field starts empty, says what empty means
 * ("The usual starting state"), and folds under More fields with the
 * template's owners and labels - on the create wizard and on the template's
 * Edit form alike. The template's details card says the same of a template
 * saved without one. A template saved with a state keeps it.
 *
 * The table and the cards are stubbed and their props recorded.
 */

const recordedTables: Array<Record<string, unknown>> = [];
const recordedCards: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div", { "data-testid": "table" });
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedCards.push(props);
      return React.createElement("div", { "data-testid": "card" });
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", { "data-testid": "model-delete" });
    },
  };
});

jest.mock("../../../UI/Components/CustomFields/CustomFieldsDetail", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", { "data-testid": "custom-fields" });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Owners/OwnersCard",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return React.createElement("div", { "data-testid": "owners-card" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldSettingsCard",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return React.createElement("div", {
          "data-testid": "custom-field-settings-card",
        });
      },
    };
  },
);

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 0;
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: { default: { new (id: string): unknown } } =
          jest.requireActual("../../../Types/ObjectID") as {
            default: { new (id: string): unknown };
          };
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import IncidentTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentTemplates";
import IncidentTemplatesView from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentTemplatesView";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { ADVANCED_FORM_SECTION_ID } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import Navigation from "../../../UI/Utils/Navigation";

const TEMPLATE_ID: string = "a1b2c3d4-0000-4000-8000-0000000000aa";

const HELP: string =
  "Incidents declared from this template start in this state. Leave it empty for the usual starting state. An incident that starts acknowledged or resolved pages no one.";

const PLACEHOLDER: string = "The usual starting state";

type RecordedField = {
  field?: Record<string, unknown>;
  title?: string;
  description?: string;
  placeholder?: string;
  stepId?: string;
  required?: boolean;
  defaultValue?: unknown;
  getDefaultValue?: unknown;
  showIf?: (values: Record<string, unknown>) => boolean;
  collapsibleSection?: { id: string; title: string };
  dropdownModal?: { type: unknown; sort?: Record<string, unknown> };
};

type RecordedDetailField = {
  field?: Record<string, unknown>;
  title?: string;
  getElement?: (item: Record<string, unknown>) => ReactElement;
};

function keyOf(field: RecordedField): string {
  return Object.keys(field.field || {})[0] || "";
}

function fieldNamed(fields: Array<RecordedField>, key: string): RecordedField {
  const found: Array<RecordedField> = fields.filter(
    (field: RecordedField): boolean => {
      return keyOf(field) === key;
    },
  );

  expect(found).toHaveLength(1);

  return found[0]!;
}

// The fields a step shows: hidden registrations (showIf () => false) aside.
function shownOn(
  fields: Array<RecordedField>,
  stepId: string,
): Array<RecordedField> {
  return fields.filter((field: RecordedField): boolean => {
    return (
      field.stepId === stepId && (!field.showIf || field.showIf({}) !== false)
    );
  });
}

function stateReads(): Array<Array<unknown>> {
  return getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return (
      (call[0] as { modelType?: unknown } | undefined)?.modelType ===
      IncidentState
    );
  });
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(TEMPLATE_ID);
    });
});

afterEach(() => {
  cleanup();
  recordedTables.length = 0;
  recordedCards.length = 0;
  jest.restoreAllMocks();
});

async function renderTemplatesPage(): Promise<Record<string, unknown>> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <IncidentTemplates
          pageRoute={new Route("/settings/incident-templates")}
          currentProject={null}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
  });

  // Let anything the page starts on mount finish.
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });

  const tables: Array<Record<string, unknown>> = recordedTables.filter(
    (props: Record<string, unknown>) => {
      return props["modelType"] === IncidentTemplate;
    },
  );

  expect(tables.length).toBeGreaterThan(0);

  return tables[tables.length - 1]!;
}

async function renderTemplateDetails(): Promise<Record<string, unknown>> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <IncidentTemplatesView
          pageRoute={new Route("/settings/incident-templates/view")}
          currentProject={null}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
  });

  const cards: Array<Record<string, unknown>> = recordedCards.filter(
    (props: Record<string, unknown>) => {
      return props["name"] === "Incident Template Details";
    },
  );

  expect(cards.length).toBeGreaterThan(0);

  return cards[cards.length - 1]!;
}

describe("a new incident template", () => {
  test("starts with no state picked: the page looks no state up and seeds no values", async () => {
    const table: Record<string, unknown> = await renderTemplatesPage();

    expect(table["createInitialValues"]).toBeUndefined();
    expect(stateReads()).toEqual([]);
    // Every table render saw the same: nothing arrived a moment later.
    for (const props of recordedTables) {
      expect(props["createInitialValues"]).toBeUndefined();
    }
  });

  test("asks for Initial Incident State empty, saying what empty means", async () => {
    const fields: Array<RecordedField> = (await renderTemplatesPage())[
      "formFields"
    ] as Array<RecordedField>;
    const state: RecordedField = fieldNamed(fields, "initialIncidentState");

    expect(state.title).toBe("Initial Incident State");
    expect(state.description).toBe(HELP);
    expect(state.placeholder).toBe(PLACEHOLDER);
    expect(state.required).toBe(false);
    expect(state.defaultValue).toBeUndefined();
    expect(state.getDefaultValue).toBeUndefined();
    // In the order an incident moves through its states, each in its colour.
    expect(state.dropdownModal?.type).toBe(IncidentState);
    expect(state.dropdownModal?.sort).toEqual({ order: SortOrder.Ascending });
  });

  test("folds Initial Incident State under More fields, with the owners and the labels, last on Incident Details", async () => {
    const fields: Array<RecordedField> = (await renderTemplatesPage())[
      "formFields"
    ] as Array<RecordedField>;
    const shown: Array<RecordedField> = shownOn(fields, "incident-details");

    expect(shown.map(keyOf)).toEqual([
      "title",
      "description",
      "incidentSeverity",
      "initialIncidentState",
      "owners",
      "labels",
    ]);

    const section: RecordedField["collapsibleSection"] = fieldNamed(
      fields,
      "initialIncidentState",
    ).collapsibleSection;

    expect(section?.id).toBe(ADVANCED_FORM_SECTION_ID);

    // One section: the same object on the three folded fields.
    for (const field of shown.slice(3)) {
      expect(field.collapsibleSection).toBe(section);
    }

    for (const field of shown.slice(0, 3)) {
      expect(field.collapsibleSection).toBeUndefined();
    }
  });
});

describe("an existing incident template", () => {
  test("its Edit form folds Initial Incident State beside the labels, with the same words", async () => {
    const fields: Array<RecordedField> = (await renderTemplateDetails())[
      "formFields"
    ] as Array<RecordedField>;
    const shown: Array<RecordedField> = shownOn(fields, "incident-details");

    expect(shown.map(keyOf)).toEqual([
      "title",
      "description",
      "incidentSeverity",
      "initialIncidentState",
      "labels",
    ]);

    const state: RecordedField = fieldNamed(fields, "initialIncidentState");

    expect(state.description).toBe(HELP);
    expect(state.placeholder).toBe(PLACEHOLDER);
    expect(state.required).toBe(false);
    expect(state.collapsibleSection?.id).toBe(ADVANCED_FORM_SECTION_ID);
    expect(fieldNamed(fields, "labels").collapsibleSection).toBe(
      state.collapsibleSection,
    );
  });

  test("its details card says a template saved without a state uses the usual starting state", async () => {
    const card: Record<string, unknown> = await renderTemplateDetails();
    const detailFields: Array<RecordedDetailField> = (
      card["modelDetailProps"] as { fields: Array<RecordedDetailField> }
    ).fields;
    const state: RecordedDetailField | undefined = detailFields.find(
      (field: RecordedDetailField): boolean => {
        return Object.keys(field.field || {})[0] === "initialIncidentState";
      },
    );

    expect(state?.title).toBe("Initial Incident State");

    cleanup();
    render(state!.getElement!({}));

    expect(screen.getByText("The usual starting state.")).toBeInTheDocument();
    expect(screen.queryByText(/Created/)).toBeNull();
  });

  test("its details card shows a state the template was saved with", async () => {
    const card: Record<string, unknown> = await renderTemplateDetails();
    const detailFields: Array<RecordedDetailField> = (
      card["modelDetailProps"] as { fields: Array<RecordedDetailField> }
    ).fields;
    const state: RecordedDetailField | undefined = detailFields.find(
      (field: RecordedDetailField): boolean => {
        return Object.keys(field.field || {})[0] === "initialIncidentState";
      },
    );

    const saved: IncidentState = new IncidentState();
    saved.name = "Investigating";

    cleanup();
    render(state!.getElement!({ initialIncidentState: saved }));

    expect(screen.getByText("Investigating")).toBeInTheDocument();
    expect(screen.queryByText("The usual starting state.")).toBeNull();
  });
});
