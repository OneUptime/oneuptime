import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      getList: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: jest.fn((error: unknown): string => {
        return error instanceof Error ? error.message : "Request failed.";
      }),
    },
  };
});

import CreateDashboardModal from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/CreateDashboardModal";
import { dashboardTemplateOptionDomId } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardTemplatePicker";
import {
  DashboardPickerTemplate,
  getDashboardPickerTemplate,
  getDashboardPickerTemplates,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Dashboard/DashboardTemplatePickerUtil";
import { TemplateCollection } from "../../../../App/FeatureSet/Dashboard/src/Utils/TemplatePicker/TemplatePickerUtil";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import {
  DASHBOARD_TEMPLATE_MISC_DATA_KEY,
  DashboardTemplateCategory,
  DashboardTemplateType,
  RECOMMENDED_DASHBOARD_TEMPLATE_TYPES,
} from "../../../Types/Dashboard/DashboardTemplates";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import { listedNames } from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * Create a dashboard: the wizard Dashboards > Create Dashboard opens.
 *
 * The maintainer: "The workflow templates model is a lot easier to
 * understand and use. Please make the dashboard templates model like
 * workflow templates." Creating a dashboard used to be two dialogs: Create
 * from Template, a wall of sixteen cards where a click on any card went
 * straight on, then Create New Dashboard, with no way back to the cards.
 * These tests hold it to Create a workflow's model (CreateWorkflowModal
 * .test.tsx): one dialog, how to start then a name, Start from scratch
 * first, Use this template only while a template is picked, Back to the
 * picker as it was left, Create Dashboard the one primary button on the
 * last step - and to what creating a dashboard from a template always did:
 * the name filled in and numbered past the project's dashboards, the
 * template named in the create request, the new dashboard opened.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194162001",
);
const DASHBOARD_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162002";

const mockCreate: MockFunction = ModelAPI.create as unknown as MockFunction;
const mockGetList: MockFunction = ModelAPI.getList as unknown as MockFunction;
const mockGetCurrentProjectId: MockFunction =
  ProjectUtil.getCurrentProjectId as unknown as MockFunction;

interface CreateArguments {
  model: Dashboard;
  modelType: typeof Dashboard;
  miscDataProps: JSONObject;
}

interface ListArguments {
  modelType: typeof Dashboard;
  query: JSONObject;
  select: JSONObject;
  limit: number;
  skip: number;
}

// The names the project's dashboards already have.
let existingNames: Array<string> = [];

type NamesAnswerFunction = () => { data: Array<Dashboard>; count: number };

const namesAnswer: NamesAnswerFunction = (): {
  data: Array<Dashboard>;
  count: number;
} => {
  return {
    data: existingNames.map((name: string): Dashboard => {
      const dashboard: Dashboard = new Dashboard();
      dashboard.name = name;
      return dashboard;
    }),
    count: existingNames.length,
  };
};

interface ModalHarness {
  view: RenderResult;
  onClose: MockFunction;
  onCreated: MockFunction;
}

type RenderModalFunction = () => Promise<ModalHarness>;

// Renders the dialog and lets the names lookup it starts land.
const renderModal: RenderModalFunction = async (): Promise<ModalHarness> => {
  const onClose: MockFunction = getJestMockFunction();
  const onCreated: MockFunction = getJestMockFunction();
  const view: RenderResult = render(
    <CreateDashboardModal onClose={onClose} onCreated={onCreated} />,
  );

  await act(async (): Promise<void> => {
    await Promise.resolve();
  });

  return { view: view, onClose: onClose, onCreated: onCreated };
};

type TemplateFunction = (
  type: DashboardTemplateType,
) => DashboardPickerTemplate;

const templateOf: TemplateFunction = (
  type: DashboardTemplateType,
): DashboardPickerTemplate => {
  return getDashboardPickerTemplate(type)!;
};

type ElementFunction = () => HTMLElement;

const getStepContent: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("dashboard-wizard-step-content");
};

const getScratch: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("dashboard-start-from-scratch");
};

const getNameInput: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("dashboard-name-input");
};

type QueryFunction = () => HTMLElement | null;

// The picker's way on, Use this template: a plain button, not the action.
const queryUseTemplate: QueryFunction = (): HTMLElement | null => {
  return screen.queryByTestId("modal-footer-next-button");
};

// The dialog's action, Create Dashboard, on the Name step only.
const queryCreate: QueryFunction = (): HTMLElement | null => {
  return screen.queryByTestId("modal-footer-submit-button");
};

type ShowViewFunction = (view: string) => void;

const showView: ShowViewFunction = (view: string): void => {
  fireEvent.change(screen.getByTestId("dashboard-template-view-select"), {
    target: { value: view },
  });
};

type PickFunction = (type: DashboardTemplateType) => void;

/** Click a template's row, opening All templates first when it is not listed. */
const pick: PickFunction = (type: DashboardTemplateType): void => {
  if (!screen.queryByTestId(dashboardTemplateOptionDomId(type))) {
    showView(TemplateCollection.All);
  }

  fireEvent.click(screen.getByTestId(dashboardTemplateOptionDomId(type)));
};

type UseFunction = (type: DashboardTemplateType) => void;

/** Pick a template and use it: the wizard moves on to Name. */
const useTemplate: UseFunction = (type: DashboardTemplateType): void => {
  pick(type);
  fireEvent.click(queryUseTemplate()!);
};

type StepFunction = () => string | null;

const currentStep: StepFunction = (): string | null => {
  return getStepContent().getAttribute("data-step");
};

type TypeFunction = (element: HTMLElement, value: string) => void;

const typeInto: TypeFunction = (element: HTMLElement, value: string): void => {
  fireEvent.change(element, { target: { value: value } });
};

type CreatesFunction = () => Array<CreateArguments>;

const creates: CreatesFunction = (): Array<CreateArguments> => {
  return mockCreate.mock.calls.map((call: Array<unknown>): CreateArguments => {
    return call[0] as CreateArguments;
  });
};

type NamesRequestsFunction = () => Array<ListArguments>;

const namesRequests: NamesRequestsFunction = (): Array<ListArguments> => {
  return mockGetList.mock.calls.map((call: Array<unknown>): ListArguments => {
    return call[0] as ListArguments;
  });
};

type PressCreateFunction = () => Promise<void>;

const pressCreate: PressCreateFunction = async (): Promise<void> => {
  await act(async (): Promise<void> => {
    fireEvent.click(queryCreate()!);
    await Promise.resolve();
  });
};

type CreatedDashboardFunction = (name: string) => Dashboard;

const createdDashboard: CreatedDashboardFunction = (
  name: string,
): Dashboard => {
  const dashboard: Dashboard = new Dashboard();
  dashboard._id = DASHBOARD_ID;
  dashboard.name = name;
  return dashboard;
};

// Named: eslint's wrap-regex and prettier disagree on a bare /re/.test().
const FILLED: RegExp = /\bbg-indigo-(?:5|6|7)00\b/;

beforeEach(() => {
  jest.clearAllMocks();
  existingNames = [];
  mockGetCurrentProjectId.mockReturnValue(PROJECT_ID);
  mockGetList.mockImplementation((): Promise<unknown> => {
    return Promise.resolve(namesAnswer());
  });
  mockCreate.mockImplementation((data: unknown): Promise<unknown> => {
    return Promise.resolve({
      data: createdDashboard((data as CreateArguments).model.name || ""),
    });
  });
  Element.prototype.scrollIntoView = getJestMockFunction() as unknown as (
    arg?: boolean | ScrollIntoViewOptions,
  ) => void;
});

afterEach(() => {
  cleanup();
});

describe("Create a dashboard's dialog", () => {
  test("is called Create a dashboard, at the width of Create a workflow, with nothing under its title", async () => {
    await renderModal();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Create a dashboard",
    );
    expect(screen.queryByTestId("modal-description")).toBeNull();
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "Create a dashboard",
    );
  });

  test("has no progress rail beside its steps, on either step", async () => {
    await renderModal();

    expect(screen.queryByRole("navigation", { name: "Progress" })).toBeNull();
    fireEvent.click(getScratch());
    expect(screen.queryByRole("navigation", { name: "Progress" })).toBeNull();
  });

  test("opens on how to start: Start from scratch first, and focused", async () => {
    await renderModal();

    expect(currentStep()).toBe("pick-template");
    expect(getScratch()).toHaveFocus();
    expect(
      within(getStepContent()).getByTestId("dashboard-template-picker"),
    ).toBeInTheDocument();
  });

  test("opens on the six recommended templates, none picked", async () => {
    await renderModal();

    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return option.getAttribute("data-testid") || "";
        }),
    ).toEqual(
      RECOMMENDED_DASHBOARD_TEMPLATE_TYPES.map((type: string): string => {
        return dashboardTemplateOptionDomId(type);
      }),
    );
    expect(screen.queryByTestId("dashboard-template-details")).toBeNull();
  });
});

describe("the footer", () => {
  test("holds only Cancel until a template is picked", async () => {
    await renderModal();

    expect(queryUseTemplate()).toBeNull();
    expect(queryCreate()).toBeNull();
    expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
      "Cancel",
    );
  });

  test("picking a template brings Use this template into it, plain: nothing on the picker is primary", async () => {
    await renderModal();
    pick(DashboardTemplateType.Kubernetes);

    const use: HTMLElement = queryUseTemplate()!;

    expect(use).toHaveTextContent("Use this template");
    expect(use.className).not.toMatch(FILLED);
    expect(queryCreate()).toBeNull();
  });

  test("Create Dashboard, on the Name step, is the one primary button, beside Back and Cancel", async () => {
    await renderModal();
    useTemplate(DashboardTemplateType.Kubernetes);

    expect(queryCreate()).toHaveTextContent("Create Dashboard");
    expect(queryCreate()!.className).toMatch(FILLED);
    expect(queryUseTemplate()).toBeNull();
    expect(screen.getByTestId("dashboard-wizard-back")).toHaveTextContent(
      "Back",
    );
  });

  test("a search that matches nothing takes Use this template away again", async () => {
    await renderModal();
    fireEvent.change(screen.getByTestId("dashboard-template-search"), {
      target: { value: "k8s" },
    });
    expect(queryUseTemplate()).not.toBeNull();

    fireEvent.change(screen.getByTestId("dashboard-template-search"), {
      target: { value: "zzzzzz" },
    });
    expect(queryUseTemplate()).toBeNull();
  });
});

describe("going on with a template", () => {
  test("Use this template goes on to Name: the template at the top, its name filled in", async () => {
    await renderModal();
    useTemplate(DashboardTemplateType.Kubernetes);

    expect(currentStep()).toBe("name");
    const chosen: HTMLElement = screen.getByTestId("dashboard-template-chosen");

    expect(chosen).toHaveTextContent(
      templateOf(DashboardTemplateType.Kubernetes).name,
    );
    expect(chosen).toHaveTextContent(
      templateOf(DashboardTemplateType.Kubernetes).description,
    );
    expect(getNameInput()).toHaveValue("Kubernetes Dashboard");
    expect(getNameInput()).toHaveFocus();
  });

  test("the name is numbered past the dashboards the project has, archived ones included", async () => {
    existingNames = [
      "Kubernetes Dashboard",
      "kubernetes dashboard 2",
      "Kubernetes Cost Dashboard",
    ];
    await renderModal();
    useTemplate(DashboardTemplateType.Kubernetes);

    expect(getNameInput()).toHaveValue("Kubernetes Dashboard 3");
    // Every dashboard the user can read, archived ones too, in one request.
    expect(namesRequests()).toHaveLength(1);
    expect(namesRequests()[0]).toEqual(
      expect.objectContaining({
        modelType: Dashboard,
        query: {},
        select: { name: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      }),
    );
  });

  test("Enter after a search takes its best match", async () => {
    await renderModal();
    const search: HTMLElement = screen.getByTestId("dashboard-template-search");

    fireEvent.change(search, { target: { value: "servers" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(currentStep()).toBe("name");
    expect(getNameInput()).toHaveValue("Hosts Dashboard");
  });

  test("a double-click on a template uses it", async () => {
    await renderModal();
    fireEvent.doubleClick(
      screen.getByTestId(dashboardTemplateOptionDomId("Incident")),
    );

    expect(currentStep()).toBe("name");
    expect(getNameInput()).toHaveValue("Incident Dashboard");
  });

  test("the description waits under More fields, folded", async () => {
    await renderModal();
    useTemplate(DashboardTemplateType.Monitor);

    const moreFields: HTMLElement = within(getStepContent()).getByRole(
      "button",
      { name: /More fields/ },
    );

    expect(moreFields).toHaveAttribute("aria-expanded", "false");
    // The folded line names what it holds: "More fields · Description".
    expect(listedNames(getStepContent())).toEqual(["Description"]);
    // Folded: mounted, but out of sight and out of the keyboard's way.
    expect(
      screen.getByTestId("dashboard-description-input").closest(".invisible"),
    ).not.toBeNull();

    fireEvent.click(moreFields);

    expect(moreFields).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByTestId("dashboard-description-input").closest(".invisible"),
    ).toBeNull();
  });
});

describe("Back", () => {
  test("finds the picker as it was left: the same search, category and template", async () => {
    await renderModal();
    showView(DashboardTemplateCategory.Infrastructure);
    pick(DashboardTemplateType.Ceph);
    fireEvent.click(queryUseTemplate()!);

    fireEvent.click(screen.getByTestId("dashboard-wizard-back"));

    expect(currentStep()).toBe("pick-template");
    expect(screen.getByTestId("dashboard-template-view-select")).toHaveValue(
      DashboardTemplateCategory.Infrastructure,
    );
    expect(
      screen.getByTestId(dashboardTemplateOptionDomId("Ceph")),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("listbox")).toHaveFocus();
  });

  test("a template taken by Enter after a search is still the one picked after Back", async () => {
    await renderModal();
    const search: HTMLElement = screen.getByTestId("dashboard-template-search");

    fireEvent.change(search, { target: { value: "vsphere" } });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.click(screen.getByTestId("dashboard-wizard-back"));

    expect(screen.getByTestId("dashboard-template-search")).toHaveValue(
      "vsphere",
    );
    expect(
      screen.getByTestId(dashboardTemplateOptionDomId("VMware")),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("taking the same template again keeps the name typed for it", async () => {
    await renderModal();
    useTemplate(DashboardTemplateType.Host);
    typeInto(getNameInput(), "EU hosts");

    fireEvent.click(screen.getByTestId("dashboard-wizard-back"));
    fireEvent.click(queryUseTemplate()!);

    expect(getNameInput()).toHaveValue("EU hosts");
  });

  test("taking another template starts from that template's own name", async () => {
    await renderModal();
    useTemplate(DashboardTemplateType.Host);
    typeInto(getNameInput(), "EU hosts");

    fireEvent.click(screen.getByTestId("dashboard-wizard-back"));
    useTemplate(DashboardTemplateType.Alert);

    expect(getNameInput()).toHaveValue("Alert Dashboard");
  });

  test("after Start from scratch, Back shows it as the start chosen, with the focus on it", async () => {
    await renderModal();
    fireEvent.click(getScratch());
    fireEvent.click(screen.getByTestId("dashboard-wizard-back"));

    expect(getScratch()).toHaveAttribute("aria-current", "true");
    expect(getScratch()).toHaveFocus();
  });
});

describe("Start from scratch", () => {
  test("moves on to Name with nothing filled in, and no template at the top", async () => {
    await renderModal();
    fireEvent.click(getScratch());

    expect(currentStep()).toBe("name");
    expect(getNameInput()).toHaveValue("");
    expect(getNameInput()).toHaveAttribute(
      "placeholder",
      "What should this dashboard be called?",
    );
    expect(screen.queryByTestId("dashboard-template-chosen")).toBeNull();
  });

  test("a name shorter than two letters is refused, says why, and creates nothing", async () => {
    await renderModal();
    fireEvent.click(getScratch());
    typeInto(getNameInput(), "x");

    await pressCreate();

    expect(
      screen.getByText(
        "Please give this dashboard a name of at least 2 letters.",
      ),
    ).toBeInTheDocument();
    expect(creates()).toHaveLength(0);

    // The message goes as soon as the name is changed.
    typeInto(getNameInput(), "xy");
    expect(
      screen.queryByText(
        "Please give this dashboard a name of at least 2 letters.",
      ),
    ).toBeNull();
  });

  test("creates an empty dashboard: its name, the project, and no template", async () => {
    const harness: ModalHarness = await renderModal();
    fireEvent.click(getScratch());
    typeInto(getNameInput(), "  Checkout on-call  ");

    await pressCreate();

    expect(creates()).toHaveLength(1);
    expect(creates()[0]!.modelType).toBe(Dashboard);
    expect(creates()[0]!.model.name).toBe("Checkout on-call");
    expect(creates()[0]!.model.projectId?.toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(creates()[0]!.miscDataProps).toEqual({});
    await waitFor(() => {
      expect(harness.onCreated).toHaveBeenCalledTimes(1);
    });
    expect((harness.onCreated.mock.calls[0]![0] as Dashboard)._id).toBe(
      DASHBOARD_ID,
    );
  });

  test("is always one click away, with a template picked too, and lets the template go", async () => {
    await renderModal();
    pick(DashboardTemplateType.Monitor);
    fireEvent.click(getScratch());
    typeInto(getNameInput(), "Mine");

    await pressCreate();

    expect(creates()[0]!.miscDataProps).not.toHaveProperty(
      DASHBOARD_TEMPLATE_MISC_DATA_KEY,
    );
  });
});

describe("Create Dashboard", () => {
  test("sends the filled-in name and names the template, then hands over the new dashboard", async () => {
    const harness: ModalHarness = await renderModal();
    useTemplate(DashboardTemplateType.Kubernetes);

    await pressCreate();

    expect(creates()).toHaveLength(1);
    expect(creates()[0]!.model.name).toBe("Kubernetes Dashboard");
    expect(creates()[0]!.miscDataProps).toEqual({
      [DASHBOARD_TEMPLATE_MISC_DATA_KEY]: DashboardTemplateType.Kubernetes,
    });
    await waitFor(() => {
      expect(harness.onCreated).toHaveBeenCalledTimes(1);
    });
  });

  test("sends a name typed over the filled-in one, and a description typed under More fields", async () => {
    await renderModal();
    useTemplate(DashboardTemplateType.Host);
    typeInto(getNameInput(), "EU hosts");
    fireEvent.click(
      within(getStepContent()).getByRole("button", { name: /More fields/ }),
    );
    typeInto(
      screen.getByTestId("dashboard-description-input"),
      "For the on-call standup",
    );

    await pressCreate();

    expect(creates()[0]!.model.name).toBe("EU hosts");
    expect(creates()[0]!.model.description).toBe("For the on-call standup");
    expect(creates()[0]!.miscDataProps[DASHBOARD_TEMPLATE_MISC_DATA_KEY]).toBe(
      DashboardTemplateType.Host,
    );
  });

  test("leaves the description out when none was typed", async () => {
    await renderModal();
    useTemplate(DashboardTemplateType.Alert);

    await pressCreate();

    expect(creates()[0]!.model.description).toBeUndefined();
  });

  /*
   * Two people creating "Kubernetes Dashboard" at once both get it filled
   * in; the server takes the first. The second sees why, on the Name step,
   * can change the name there - and the retry still builds the template.
   */
  test("a name taken meanwhile is refused on the Name step, and the retry still builds the template", async () => {
    mockCreate.mockImplementationOnce((): Promise<unknown> => {
      return Promise.reject(
        new BadDataException("Dashboard with the same name already exists."),
      );
    });
    const harness: ModalHarness = await renderModal();
    useTemplate(DashboardTemplateType.Kubernetes);

    await pressCreate();

    expect(
      await screen.findByText("Dashboard with the same name already exists."),
    ).toBeVisible();
    expect(currentStep()).toBe("name");
    expect(harness.onCreated).not.toHaveBeenCalled();

    typeInto(getNameInput(), "Kubernetes Dashboard 2");
    await pressCreate();

    expect(creates()).toHaveLength(2);
    expect(creates()[1]!.model.name).toBe("Kubernetes Dashboard 2");
    expect(creates()[1]!.miscDataProps[DASHBOARD_TEMPLATE_MISC_DATA_KEY]).toBe(
      DashboardTemplateType.Kubernetes,
    );
    await waitFor(() => {
      expect(harness.onCreated).toHaveBeenCalledTimes(1);
    });
  });

  test("a plan that allows no more dashboards says so, and nothing is handed over", async () => {
    mockCreate.mockImplementation((): Promise<unknown> => {
      return Promise.reject(
        new BadDataException(
          "Free plan can only have 1 dashboard. Please upgrade your plan.",
        ),
      );
    });
    const harness: ModalHarness = await renderModal();
    useTemplate(DashboardTemplateType.Monitor);

    await pressCreate();

    expect(
      await screen.findByText(
        "Free plan can only have 1 dashboard. Please upgrade your plan.",
      ),
    ).toBeVisible();
    expect(harness.onCreated).not.toHaveBeenCalled();
  });

  test.each(
    getDashboardPickerTemplates().map((template: DashboardPickerTemplate) => [
      template.type,
    ]),
  )(
    "%s: creates a dashboard named after it and built from it",
    async (type: string) => {
      existingNames = [templateOf(type as DashboardTemplateType).name];
      await renderModal();
      useTemplate(type as DashboardTemplateType);

      await pressCreate();

      expect(creates()).toHaveLength(1);
      expect(creates()[0]!.model.name).toBe(
        `${templateOf(type as DashboardTemplateType).name} 2`,
      );
      expect(creates()[0]!.miscDataProps).toEqual({
        [DASHBOARD_TEMPLATE_MISC_DATA_KEY]: type,
      });
    },
  );
});

describe("the names the project has", () => {
  test("are looked up once, as the dialog opens", async () => {
    await renderModal();
    useTemplate(DashboardTemplateType.Monitor);
    fireEvent.click(screen.getByTestId("dashboard-wizard-back"));
    useTemplate(DashboardTemplateType.Alert);

    expect(namesRequests()).toHaveLength(1);
  });

  test("a lookup that fails still fills in the template's own name", async () => {
    mockGetList.mockImplementation((): Promise<unknown> => {
      return Promise.reject(new Error("Network error"));
    });
    await renderModal();
    useTemplate(DashboardTemplateType.Alert);

    expect(getNameInput()).toHaveValue("Alert Dashboard");
  });

  describe("while they are on the way", () => {
    let resolveNames: (() => void) | null = null;

    beforeEach(() => {
      resolveNames = null;
      mockGetList.mockImplementation((): Promise<unknown> => {
        return new Promise((resolve: (value: unknown) => void): void => {
          resolveNames = (): void => {
            resolve(namesAnswer());
          };
        });
      });
    });

    test("a template taken waits for them, its row busy and Use this template waiting too", async () => {
      existingNames = ["SLO Dashboard"];
      await renderModal();
      useTemplate(DashboardTemplateType.Slo);

      expect(currentStep()).toBe("pick-template");
      expect(
        screen.getByTestId(dashboardTemplateOptionDomId("Slo")),
      ).toHaveAttribute("aria-busy", "true");
      expect(queryUseTemplate()).toBeDisabled();

      await act(async (): Promise<void> => {
        resolveNames?.();
      });

      expect(currentStep()).toBe("name");
      expect(getNameInput()).toHaveValue("SLO Dashboard 2");
    });

    test("the last template taken is the one that goes on", async () => {
      await renderModal();
      useTemplate(DashboardTemplateType.Proxmox);
      fireEvent.doubleClick(
        screen.getByTestId(dashboardTemplateOptionDomId("VMware")),
      );

      expect(
        screen.getByTestId(dashboardTemplateOptionDomId("Proxmox")),
      ).not.toHaveAttribute("aria-busy");

      await act(async (): Promise<void> => {
        resolveNames?.();
      });

      expect(getNameInput()).toHaveValue("VMware Dashboard");
      await pressCreate();
      expect(
        creates()[0]!.miscDataProps[DASHBOARD_TEMPLATE_MISC_DATA_KEY],
      ).toBe(DashboardTemplateType.VMware);
    });

    test("Start from scratch does not wait for them, and lets a waiting template go", async () => {
      await renderModal();
      useTemplate(DashboardTemplateType.Metrics);
      fireEvent.click(getScratch());

      expect(currentStep()).toBe("name");
      expect(getNameInput()).toHaveValue("");

      await act(async (): Promise<void> => {
        resolveNames?.();
      });

      // The waiting template did not take over once they arrived.
      expect(getNameInput()).toHaveValue("");
      expect(screen.queryByTestId("dashboard-template-chosen")).toBeNull();
    });

    test("closing the dialog meanwhile leaves nothing behind", async () => {
      const harness: ModalHarness = await renderModal();
      useTemplate(DashboardTemplateType.Ceph);
      harness.view.unmount();

      await act(async (): Promise<void> => {
        resolveNames?.();
      });

      expect(creates()).toHaveLength(0);
      expect(harness.onCreated).not.toHaveBeenCalled();
    });
  });
});

describe("Create a dashboard in German", () => {
  const LOCALE_PATH: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
  );
  const german: Record<string, string> = JSON.parse(
    fs.readFileSync(LOCALE_PATH, "utf8"),
  ) as Record<string, string>;
  const instance: i18n = createInstance();

  beforeAll(async () => {
    await instance.init({
      lng: "de",
      fallbackLng: "de",
      resources: { de: { translation: german } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  type DeFunction = (english: string) => string;

  // The German wording, checked to be a translation and not the English.
  const de: DeFunction = (english: string): string => {
    const value: string | undefined = german[english];

    expect({ english: english, translated: value !== english }).toEqual({
      english: english,
      translated: true,
    });

    return value as string;
  };

  type RenderGermanFunction = () => Promise<void>;

  const renderGerman: RenderGermanFunction = async (): Promise<void> => {
    render(
      <I18nextProvider i18n={instance}>
        <CreateDashboardModal
          onClose={getJestMockFunction()}
          onCreated={getJestMockFunction()}
        />
      </I18nextProvider>,
    );

    await act(async (): Promise<void> => {
      await Promise.resolve();
    });
  };

  test("the first step: title, Start from scratch, the heading and the categories", async () => {
    await renderGerman();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      de("Create a dashboard"),
    );
    expect(getScratch()).toHaveTextContent(
      `${de("Start from scratch")}${de(
        "Begin with an empty dashboard and add your own widgets.",
      )}`,
    );
    expect(
      screen.getByRole("heading", { name: de("Or start from a template") }),
    ).toBeInTheDocument();
    expect(
      Array.from(
        (
          screen.getByTestId(
            "dashboard-template-view-select",
          ) as HTMLSelectElement
        ).options,
      ).map((option: HTMLOptionElement): string => {
        return option.textContent || "";
      }),
    ).toEqual([
      de("Recommended"),
      de("Monitoring & APM"),
      de("Incident Response"),
      de("Infrastructure"),
      de("All templates"),
    ]);
  });

  test("a picked template's details and Use this template", async () => {
    await renderGerman();
    pick(DashboardTemplateType.Kubernetes);

    const details: HTMLElement = screen.getByTestId(
      "dashboard-template-details",
    );

    // German writes Widgets as English does: the word it uses.
    expect(details).toHaveTextContent(german["Widgets"] as string);
    expect(details).toHaveTextContent(de("Variables"));
    expect(details).toHaveTextContent(de("Chart"));
    expect(queryUseTemplate()).toHaveTextContent(de("Use this template"));
  });

  test("the Name step: its help, its prompts, its message and its button", async () => {
    await renderGerman();
    fireEvent.click(getScratch());

    expect(getStepContent()).toHaveTextContent(
      de("Dashboard names are unique within a project."),
    );
    expect(getNameInput()).toHaveAttribute(
      "placeholder",
      de("What should this dashboard be called?"),
    );
    expect(screen.getByTestId("dashboard-description-input")).toHaveAttribute(
      "placeholder",
      de("What is this dashboard for?"),
    );
    expect(queryCreate()).toHaveTextContent(
      german["Create Dashboard"] as string,
    );

    await pressCreate();

    expect(
      screen.getByText(
        de("Please give this dashboard a name of at least 2 letters."),
      ),
    ).toBeInTheDocument();
  });
});
