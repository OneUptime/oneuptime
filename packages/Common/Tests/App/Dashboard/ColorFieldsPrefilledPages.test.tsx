import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

configure({ asyncUtilTimeout: 15000 });

/*
 * "Please also find similar issues across the project and fix them as well.
 * The idea is to make software as simple as possible to use and reduce
 * decision paralysis." - the maintainer.
 *
 * Creating a label, a state, a severity or a monitor status opened on an
 * empty colour picker that blocked Create: the colour was required, with
 * nothing in it. Now the Create form opens with a colour already picked - one
 * the rows of the table it was opened from do not use yet - and Create works
 * straight away. Edit shows the row's own colour.
 *
 * The real pages, their ModelTable, BaseModelTable and ModelFormModal, with
 * only the API, the permissions and the signed-in user stubbed.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return {
          _type: "UserTenantAccessPermission",
          permissions: permissionsForTest.map((permission: unknown) => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          }),
        };
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

import LabelsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Labels";
import IncidentStatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentState";
import IncidentSeveritiesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentSeverity";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import {
  Amber600,
  Green,
  Indigo500,
  Moroon500,
  Pink500,
  Purple500,
  Red,
  Teal600,
  Yellow,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { areSimilarColors } from "../../../Utils/DistinctColor";
import { colorOf } from "../../UI/Components/ColorPicker/ColorPickerDriver";

interface Row {
  _id: string;
  name: string;
  color: Color;
  order?: number;
  isCreatedState?: boolean;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}

let rows: Array<Row> = [];
let saved: Array<{ formType: unknown; model: BaseModel }> = [];

const toModel: <T extends BaseModel>(
  modelType: { new (): T },
  row: Row,
) => T = <T extends BaseModel>(modelType: { new (): T }, row: Row): T => {
  const model: T = new modelType();
  const record: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;

  record["_id"] = row._id;
  record["name"] = row.name;
  record["description"] = "";
  record["color"] = new Color(row.color.toString());

  for (const key of [
    "order",
    "isCreatedState",
    "isAcknowledgedState",
    "isResolvedState",
  ] as Array<keyof Row>) {
    if (row[key] !== undefined) {
      record[key] = row[key];
    }
  }

  return model;
};

const row: (
  index: number,
  name: string,
  color: Color,
  extra?: Partial<Row>,
) => Row = (
  index: number,
  name: string,
  color: Color,
  extra?: Partial<Row>,
): Row => {
  return {
    _id: `00000000-0000-4000-8000-00000000000${index}`,
    name,
    color,
    order: index,
    ...extra,
  };
};

const renderPage: (
  Page: React.FunctionComponent<PageComponentProps>,
  path: string,
) => Promise<void> = async (
  Page: React.FunctionComponent<PageComponentProps>,
  path: string,
): Promise<void> => {
  window.history.replaceState(window.history.state, "", path);

  render(
    <Page
      pageRoute={new Route(path)}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  if (rows.length > 0) {
    await screen.findByText(rows[0]!.name);
  } else {
    await waitFor(() => {
      expect(
        screen.getAllByRole("button").some((button: HTMLElement): boolean => {
          return button.getAttribute("data-testid") === "card-button";
        }),
      ).toBe(true);
    });
  }
};

const dialog: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("dialog");
};

const openCreate: (buttonName: string) => Promise<void> = async (
  buttonName: string,
): Promise<void> => {
  const create: HTMLElement | undefined = screen
    .getAllByRole("button", { name: buttonName })
    .find((button: HTMLElement) => {
      return button.getAttribute("data-testid") === "card-button";
    });

  expect(create).toBeDefined();
  fireEvent.click(create!);

  await within(dialog()).findByRole("button", {
    name: buttonName,
  });
};

/*
 * The color the dialog's color field holds, once the form has filled it in:
 * the swatch ticked among the palette's, its code in the field's data-value.
 */
const pickedColor: () => Promise<string> = async (): Promise<string> => {
  const field: HTMLElement =
    await within(dialog()).findByTestId("color-picker");

  // The form fills its fields in once it has worked them out.
  await waitFor(() => {
    expect(colorOf(field)).not.toBe("");
  });

  return colorOf(field);
};

const submitDialog: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
};

let listedModelType: { new (): BaseModel } = Label;

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  rows = [];
  saved = [];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: { new (): BaseModel };
  }) => {
    if (args.modelType !== listedModelType) {
      return { data: [], count: 0, skip: 0, limit: 10 };
    }

    return {
      data: rows.map((item: Row) => {
        return toModel(listedModelType, item);
      }),
      count: rows.length,
      skip: 0,
      limit: 50,
    } as ListResult<BaseModel>;
  }) as never);

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async (args: {
    id: { toString: () => string };
  }) => {
    const found: Row | undefined = rows.find((candidate: Row) => {
      return candidate._id === args.id.toString();
    });

    return found ? toModel(listedModelType, found) : null;
  }) as never);

  jest.spyOn(ModelAPI, "createOrUpdate").mockImplementation((async (args: {
    model: BaseModel;
    formType: unknown;
  }) => {
    saved.push({ formType: args.formType, model: args.model });

    return { data: args.model } as never;
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Settings > Labels", () => {
  beforeEach(() => {
    listedModelType = Label;
  });

  test("a project's first label starts with the palette's first colour", async () => {
    await renderPage(LabelsPage, "/dashboard/project/settings/labels");
    await openCreate("Create Label");

    expect(await pickedColor()).toBe(Indigo500.toString());
  });

  test("a new label starts with a colour no listed label has, and Create works without touching it", async () => {
    rows = [
      row(1, "production", Indigo500),
      row(2, "staging", Amber600),
      row(3, "payments", new Color("#0d9488")),
    ];

    await renderPage(LabelsPage, "/dashboard/project/settings/labels");
    await openCreate("Create Label");

    const picked: string = await pickedColor();

    for (const listed of rows) {
      expect(areSimilarColors(picked, listed.color)).toBe(false);
    }

    fireEvent.change(
      within(dialog()).getByPlaceholderText("internal-service"),
      { target: { value: "internal-service" } },
    );
    await submitDialog();

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });

    const color: unknown = (saved[0]!.model as Label).color;

    expect(color).toBeInstanceOf(Color);
    expect(String(color)).toBe(picked);
    // The fourth colour of the palette, after the three the rows use.
    expect(picked).toBe(Pink500.toString());
  });

  test("Edit shows the label's own colour, not a pick", async () => {
    rows = [row(1, "production", new Color("#ef4444"))];

    await renderPage(LabelsPage, "/dashboard/project/settings/labels");

    fireEvent.click(
      within(screen.getByText("production").closest("tr")!).getByRole(
        "button",
        { name: "Edit" },
      ),
    );

    expect(await pickedColor()).toBe("#ef4444");
  });
});

describe("the state and severity pages", () => {
  test("a new incident state starts with a colour none of the project's states looks like", async () => {
    listedModelType = IncidentState;
    rows = [
      row(1, "Identified", Red, { isCreatedState: true }),
      row(2, "Investigating", Purple500),
      row(3, "Acknowledged", Yellow, { isAcknowledgedState: true }),
      row(4, "Resolved", Green, { isResolvedState: true }),
    ];

    await renderPage(
      IncidentStatesPage,
      "/dashboard/project/incidents/settings/state",
    );
    await openCreate("Create Incident State");

    const picked: string = await pickedColor();

    expect(picked).toBe(Indigo500.toString());

    for (const listed of rows) {
      expect(areSimilarColors(picked, listed.color)).toBe(false);
    }

    fireEvent.change(within(dialog()).getByPlaceholderText("Investigating"), {
      target: { value: "Mitigated" },
    });
    await submitDialog();

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });

    expect(String((saved[0]!.model as IncidentState).color)).toBe(
      Indigo500.toString(),
    );
  });

  test("a new severity skips the colours the severities already use", async () => {
    listedModelType = IncidentSeverity;
    rows = [
      row(1, "Critical Incident", Moroon500),
      row(2, "Major Incident", Red),
      row(3, "Minor Incident", Yellow),
      row(4, "Cosmetic", Indigo500),
    ];

    await renderPage(
      IncidentSeveritiesPage,
      "/dashboard/project/incidents/settings/severity",
    );
    await openCreate("Create Incident Severity");

    const picked: string = await pickedColor();

    // Indigo is taken and amber reads as the yellow above: teal.
    expect(picked).toBe(Teal600.toString());
  });
});
