import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import BasicFormModal from "../../../UI/Components/FormModal/BasicFormModal";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormStep from "../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";
import MonitorTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplates";
import MonitorTemplatesView from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplatesView";
import { MONITOR_TYPE_CATALOG } from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorTypeFormField";

/*
 * The monitor template forms draw Create Monitor's type picker
 * (MonitorTypeFormField), so issue #5364 was theirs too: "More monitor
 * types" went once pressed, and Change on a type it holds opened the whole
 * catalog with no way to fold it. Here the forms' own fields - captured
 * from the real pages, not rebuilt - are drawn by the real form in a
 * dialog, as the pages draw them, and the picker is driven there:
 *
 *   - a new template's form (Settings > Monitor Templates > Create), on
 *     its Monitor Defaults step;
 *   - a template's Monitor Defaults card, Edit (the template's page),
 *     opening on a type More holds back.
 *
 * In a dialog, too, Escape while changing the type keeps the type picked
 * and leaves the dialog open.
 */

interface CapturedTable {
  formFields: Array<Field<MonitorTemplate>>;
  formSteps: Array<FormStep<MonitorTemplate>>;
}

interface CapturedDetail {
  name: string;
  formFields?: Array<Field<MonitorTemplate>> | undefined;
}

let capturedTables: Array<CapturedTable> = [];
let capturedDetails: Array<CapturedDetail> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable) => {
      capturedTables.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: CapturedDetail) => {
      capturedDetails.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/CustomFields/CustomFieldsDetail", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

// The criteria editor is the next step's: not drawn on Monitor Defaults.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000001";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new (
          jest.requireActual("../../../Types/ObjectID") as {
            default: typeof ObjectID;
          }
        ).default("10000000-0000-4000-8000-000000000001");
      },
      getCurrentProject: () => {
        return {
          id: new (
            jest.requireActual("../../../Types/ObjectID") as {
              default: typeof ObjectID;
            }
          ).default("10000000-0000-4000-8000-000000000001"),
        };
      },
      getCurrentPlan: () => {
        return null;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

const COMMON_TYPES: Array<string> = [
  ...MONITOR_TYPE_CATALOG.commonOptionValues,
];

beforeEach(() => {
  capturedTables = [];
  capturedDetails = [];
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(TEMPLATE_ID));
  jest.spyOn(ModelAPI, "count").mockResolvedValue(0);
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function shownTypes(): Array<string> {
  return screen.queryAllByRole("radio").map((radio: HTMLElement): string => {
    return radio.getAttribute("data-card-select-value") || "";
  });
}

function more(): HTMLElement {
  return screen.getByTestId("card-select-more");
}

function monitorTypeFieldOf(
  fields: Array<Field<MonitorTemplate>>,
): Field<MonitorTemplate> {
  const field: Field<MonitorTemplate> | undefined = fields.find(
    (candidate: Field<MonitorTemplate>): boolean => {
      return Boolean(
        (candidate.field as Record<string, unknown> | undefined)?.[
          "monitorType"
        ],
      );
    },
  );

  expect(field).toBeDefined();

  return field!;
}

describe("a new template's form", () => {
  function captureCreateForm(): CapturedTable {
    render(
      <MonitorTemplates
        pageRoute={new Route("/dashboard/monitors/settings/templates")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );

    expect(capturedTables.length).toBeGreaterThan(0);

    const table: CapturedTable = capturedTables[capturedTables.length - 1]!;

    cleanup();

    return table;
  }

  async function openOnMonitorDefaults(data: {
    onClose: MockFunction;
    onSubmit: MockFunction;
  }): Promise<void> {
    const table: CapturedTable = captureCreateForm();

    render(
      <BasicFormModal<FormValues<MonitorTemplate>>
        title="Create Monitor Template"
        submitButtonText="Create Monitor Template"
        onClose={data.onClose}
        onSubmit={data.onSubmit}
        formProps={{
          id: "monitor-template-create-form",
          disableAutofocus: true,
          steps: table.formSteps,
          fields: table.formFields,
        }}
      />,
    );

    fireEvent.change(
      await screen.findByPlaceholderText("Production API Health"),
      {
        target: { value: "Production API Health" },
      },
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-next-button"));
    });

    await screen.findByTestId("card-select-common");
  }

  test("takes its Monitor Type field from the shared helper: the catalog and its More", () => {
    const table: CapturedTable = captureCreateForm();
    const field: Field<MonitorTemplate> = monitorTypeFieldOf(table.formFields);

    expect(field.cardSelectCatalog).toBe(MONITOR_TYPE_CATALOG);
    expect(field.cardSelectCatalog!.moreOptionsText).toBe("More monitor types");
    expect(field.stepId).toBe("monitor-defaults");
  });

  test("Monitor Defaults opens on the six common types, More folded", async () => {
    await openOnMonitorDefaults({
      onClose: getJestMockFunction(),
      onSubmit: getJestMockFunction(),
    });

    expect(shownTypes()).toEqual(COMMON_TYPES);
    expect(more()).toHaveAttribute("aria-expanded", "false");
    expect(
      within(screen.getByTestId("modal")).getByTestId("card-select-more"),
    ).toBe(more());
  });

  test("More opens the long tail in the dialog and folds it again, focus kept, the dialog open", async () => {
    const onClose: MockFunction = getJestMockFunction();

    await openOnMonitorDefaults({ onClose, onSubmit: getJestMockFunction() });

    fireEvent.click(more());

    expect(more()).toHaveAttribute("aria-expanded", "true");
    expect(
      within(
        screen.getByTestId("card-select-group-Infrastructure"),
      ).getByTestId(`card-select-option-${MonitorType.Kubernetes}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`card-select-option-${MonitorType.IP}`),
    ).toHaveFocus();

    fireEvent.click(more());

    expect(more()).toHaveAttribute("aria-expanded", "false");
    expect(more()).toHaveFocus();
    expect(shownTypes()).toEqual(COMMON_TYPES);
    expect(screen.getByTestId("modal")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a type from the long tail, then Change: More is open on it, folds it, and Escape keeps it in the dialog", async () => {
    const onClose: MockFunction = getJestMockFunction();

    await openOnMonitorDefaults({ onClose, onSubmit: getJestMockFunction() });

    fireEvent.click(more());
    fireEvent.click(
      screen.getByTestId(`card-select-option-${MonitorType.Kubernetes}`),
    );

    expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
      "data-card-select-value",
      MonitorType.Kubernetes,
    );

    fireEvent.click(screen.getByTestId("card-select-change"));

    expect(more()).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByTestId(`card-select-option-${MonitorType.Kubernetes}`),
    ).toHaveAttribute("aria-checked", "true");

    fireEvent.click(more());

    expect(shownTypes()).toEqual(COMMON_TYPES);

    fireEvent.keyDown(more(), { key: "Escape" });

    expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
      "data-card-select-value",
      MonitorType.Kubernetes,
    );
    expect(screen.getByTestId("modal")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a template's Monitor Defaults, edited", () => {
  function captureEditFields(): Array<Field<MonitorTemplate>> {
    render(
      <MonitorTemplatesView
        pageRoute={
          new Route(`/dashboard/monitors/settings/templates/${TEMPLATE_ID}`)
        }
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );

    const card: CapturedDetail | undefined = capturedDetails.find(
      (detail: CapturedDetail): boolean => {
        return detail.name === "Monitor Defaults";
      },
    );

    expect(card).toBeDefined();

    cleanup();

    return card!.formFields || [];
  }

  async function openEdit(data: {
    monitorType: MonitorType;
    onSubmit: MockFunction;
  }): Promise<void> {
    const fields: Array<Field<MonitorTemplate>> = captureEditFields();

    render(
      <BasicFormModal<FormValues<MonitorTemplate>>
        title="Edit Monitor Defaults"
        submitButtonText="Save"
        onClose={getJestMockFunction()}
        onSubmit={data.onSubmit}
        formProps={{
          id: "monitor-template-defaults-form",
          disableAutofocus: true,
          fields: fields,
          initialValues: {
            monitorType: data.monitorType,
            monitorName: "Checkout",
          } as FormValues<MonitorTemplate>,
        }}
      />,
    );

    await screen.findByTestId("card-select-summary");
  }

  test("takes its Monitor Type field from the shared helper", () => {
    const field: Field<MonitorTemplate> =
      monitorTypeFieldOf(captureEditFields());

    expect(field.cardSelectCatalog).toBe(MONITOR_TYPE_CATALOG);
  });

  test("a template of a type More holds back: Change opens it, More open, and More folds it", async () => {
    await openEdit({
      monitorType: MonitorType.Ceph,
      onSubmit: getJestMockFunction(),
    });

    fireEvent.click(screen.getByTestId("card-select-change"));

    expect(
      screen.getByTestId(`card-select-option-${MonitorType.Ceph}`),
    ).toHaveAttribute("aria-checked", "true");
    expect(more()).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(more());

    expect(more()).toHaveAttribute("aria-expanded", "false");
    expect(shownTypes()).toEqual(COMMON_TYPES);
    expect(more()).toHaveFocus();
  });

  test("a common type picked after folding is what the form saves", async () => {
    const onSubmit: MockFunction = getJestMockFunction();

    await openEdit({ monitorType: MonitorType.Ceph, onSubmit });

    fireEvent.click(screen.getByTestId("card-select-change"));
    fireEvent.click(more());
    fireEvent.click(
      screen.getByTestId(`card-select-option-${MonitorType.Ping}`),
    );

    expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
      "data-card-select-value",
      MonitorType.Ping,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });

    const values: FormValues<MonitorTemplate> = onSubmit.mock
      .calls[0]![0] as FormValues<MonitorTemplate>;

    expect(values.monitorType).toBe(MonitorType.Ping);
  });

  test("the ids above are real ObjectIDs", () => {
    for (const id of [PROJECT_ID, TEMPLATE_ID]) {
      expect(new ObjectID(id).toString()).toBe(id);
    }
  });
});
