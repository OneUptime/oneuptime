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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A scheduled maintenance template asks for its affected resources the way
 * Create Scheduled Maintenance Event does: its monitors in a picker of their
 * own, then "Change Monitor Status to" right under them, then the other
 * resources - on its create wizard and on its Affected Resources card alike.
 *
 * Unlike an event, a template asks for the status with no monitor picked
 * too: the status also applies to the monitors picked when an event is
 * scheduled from it (where the create form shows it once the first monitor
 * is picked), and to the events a recurring template schedules by itself.
 *
 * The wizard is drawn through the real ModelForm and BasicForm, as the
 * templates table's Create dialog draws it, for a project owner; the
 * template page's cards are stubbed and their props recorded, and each
 * picker's write-back is driven with the payload the picker hands it.
 */

configure({ asyncUtilTimeout: 15000 });

jest.mock("../../../UI/Utils/Permission", () => {
  const actualPermission: Record<string, unknown> = jest.requireActual(
    "../../../Types/Permission",
  ) as Record<string, unknown>;
  const PermissionEnum: Record<string, string> = actualPermission[
    "default"
  ] as Record<string, string>;
  const granted: Array<string> = [
    PermissionEnum["ProjectOwner"]!,
    PermissionEnum["User"]!,
    PermissionEnum["Public"]!,
  ];

  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return granted;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: granted };
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

const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const recordedCards: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

// The template's page: its cards record what they are handed.
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedCards.push(props);
      return React.createElement("div", { "data-testid": "card" });
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

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", { "data-testid": "model-delete" });
    },
  };
});

import AffectedResourcesPicker from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import ScheduledMaintenanceTemplateView from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplateView";
import {
  getFormSteps,
  getTemplateFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Service from "../../../Models/DatabaseModels/Service";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import { ModalWidth } from "../../../UI/Components/Modal/Modal";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const TEMPLATE_ID: string = "a1b2c3d4-0000-4000-8000-0000000000aa";
const MONITOR_ID: string = "33333333-3333-4333-8333-000000000001";
const HOST_ID: string = "44444444-4444-4444-8444-000000000001";
const SERVICE_ID: string = "45444444-4444-4444-8444-000000000001";
const UNDER_MAINTENANCE_ID: string = "55555555-5555-4555-8555-000000000001";

const FORM_ID: string = "create-template-form";

const TEMPLATE_STATUS_DESCRIPTION: string =
  "Events scheduled from this template change their monitors to this status while they are ongoing - the monitors picked here and any picked when the event is scheduled.";

// The template's own relations: a template holds these five besides monitors.
const TEMPLATE_OTHER_TYPES: Array<string> = [
  "Host",
  "KubernetesCluster",
  "DockerHost",
  "PodmanHost",
  "Service",
];

function named<T extends BaseModel>(
  modelType: { new (): T },
  id: string,
  name: string,
): T {
  const model: T = new modelType();
  model._id = id;
  (model as unknown as Record<string, unknown>)["name"] = name;
  return model;
}

function projectRecords(modelType: unknown): Array<BaseModel> {
  if (modelType === Monitor) {
    return [named(Monitor, MONITOR_ID, "Checkout API")];
  }

  if (modelType === Host) {
    return [named(Host, HOST_ID, "db-primary")];
  }

  if (modelType === Service) {
    return [named(Service, SERVICE_ID, "checkout-api")];
  }

  if (modelType === MonitorStatus) {
    return [named(MonitorStatus, UNDER_MAINTENANCE_ID, "Under Maintenance")];
  }

  return [];
}

async function answerList(request: {
  modelType: unknown;
  query?: Record<string, unknown>;
}): Promise<unknown> {
  const records: Array<BaseModel> = projectRecords(request.modelType);
  const idQuery: unknown = request.query?.["_id"];
  const data: Array<BaseModel> =
    idQuery instanceof Includes
      ? records.filter((record: BaseModel): boolean => {
          return idQuery.values
            .map((value: unknown): string => {
              return String(value);
            })
            .includes(String(record._id));
        })
      : records;

  return { data: data, count: data.length, skip: 0, limit: 100 };
}

function listedModels(): Array<unknown> {
  return getListMock.mock.calls.map((call: Array<unknown>): unknown => {
    return (call[0] as { modelType: unknown }).modelType;
  });
}

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  getListMock.mockReset().mockImplementation(answerList as never);
  createOrUpdateMock.mockReset().mockImplementation((async (data: {
    model: ScheduledMaintenanceTemplate;
  }): Promise<unknown> => {
    return {
      data: BaseModel.toJSON(data.model, ScheduledMaintenanceTemplate),
    };
  }) as never);

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(TEMPLATE_ID);
    });
});

afterEach(() => {
  cleanup();
  recordedCards.length = 0;
  jest.restoreAllMocks();
});

/*
 * The create wizard, drawn through the real ModelForm and BasicForm.
 */
describe("Create Scheduled Maintenance Template: Resources Affected", () => {
  function form(): HTMLElement {
    return document.getElementById(FORM_ID)!;
  }

  function renderTemplateForm(): UserEvent {
    render(
      <MemoryRouter>
        <ModelForm<ScheduledMaintenanceTemplate>
          modelType={ScheduledMaintenanceTemplate}
          id={FORM_ID}
          name="Create Scheduled Maintenance Template"
          formType={FormType.Create}
          steps={getFormSteps({ isViewPage: false })}
          fields={getTemplateFormFields({ isViewPage: false })}
          submitButtonText="Create Template"
          onSuccess={(): void => {}}
        />
      </MemoryRouter>,
    );

    return userEvent.setup({ delay: null });
  }

  function currentStepTitle(): string {
    return (
      screen
        .getByRole("navigation", { name: "Progress" })
        .querySelector("[aria-current='step']")?.textContent || ""
    ).trim();
  }

  async function goToNextStep(expectedTitle: string): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: "Next", exact: true }));

    await waitFor(() => {
      expect(currentStepTitle()).toBe(expectedTitle);
    });
  }

  function labelledControl(labelText: string): HTMLInputElement {
    const label: HTMLLabelElement | undefined = Array.from(
      form().querySelectorAll("label"),
    ).find((candidate: HTMLLabelElement): boolean => {
      return (candidate.textContent || "").trim().startsWith(labelText);
    });

    expect(`${labelText}: ${Boolean(label)}`).toBe(`${labelText}: true`);

    return form().querySelector(
      `[id="${label!.getAttribute("for")}"]`,
    ) as HTMLInputElement;
  }

  // Template Info and the event's title, then on to Resources Affected.
  async function openResourcesAffected(): Promise<void> {
    await screen.findByRole("navigation", { name: "Progress" });
    await waitFor(() => {
      expect(
        Array.from(form().querySelectorAll("label")).some(
          (label: HTMLLabelElement): boolean => {
            return (label.textContent || "").startsWith("Template Name");
          },
        ),
      ).toBe(true);
    });
    // The form starts from its defaults in an effect after they are drawn.
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });

    fireEvent.change(labelledControl("Template Name"), {
      target: { value: "Weekly database patching" },
    });
    fireEvent.change(labelledControl("Template Description"), {
      target: { value: "Used for the Sunday patch window." },
    });
    await act(async () => {});
    await goToNextStep("Event");

    fireEvent.change(labelledControl("Title"), {
      target: { value: "Database maintenance" },
    });
    await act(async () => {});
    await goToNextStep("Resources Affected");
  }

  function monitorsPicker(): HTMLElement {
    return screen.getByRole("combobox", { name: /^Monitors/ });
  }

  function otherResourcesPicker(): HTMLElement {
    return screen.getByRole("combobox", { name: /^Other Affected Resources/ });
  }

  function fieldOf(control: HTMLElement): HTMLElement {
    const labelId: string | null = control.getAttribute("aria-labelledby");

    expect(labelId).toBeTruthy();

    return document.getElementById(labelId!)!.parentElement as HTMLElement;
  }

  function statusDropdown(): HTMLElement {
    return screen.getByRole("combobox", { name: /^Change Monitor Status to/ });
  }

  function isBefore(first: Node, second: Node): boolean {
    return Boolean(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  }

  async function pickResource(
    user: UserEvent,
    picker: HTMLElement,
    name: string,
  ): Promise<void> {
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: name }));
    await screen.findByRole("button", { name: `Remove ${name}` });
  }

  async function pickStatus(user: UserEvent, name: string): Promise<void> {
    await user.click(statusDropdown());
    const options: Array<HTMLElement> = await screen.findAllByText(name, {
      exact: true,
    });
    await user.click(options[options.length - 1]!);
  }

  async function createTemplate(): Promise<ScheduledMaintenanceTemplate> {
    await goToNextStep("Recurring");

    fireEvent.click(screen.getByRole("button", { name: "Create Template" }));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    return (
      createOrUpdateMock.mock.calls[0]![0] as {
        model: ScheduledMaintenanceTemplate;
      }
    ).model;
  }

  function idsOf(items: unknown): Array<string> {
    return Array.isArray(items)
      ? items.map((item: unknown): string => {
          return typeof item === "string"
            ? item
            : String((item as { _id?: unknown })._id || "");
        })
      : [];
  }

  test("asks for the monitors, the status they change to - with no monitor picked too - and the other resources, in that order", async () => {
    renderTemplateForm();
    await openResourcesAffected();

    const monitors: HTMLElement = fieldOf(monitorsPicker());
    const status: HTMLElement = fieldOf(statusDropdown());
    const others: HTMLElement = fieldOf(otherResourcesPicker());

    expect(isBefore(monitors, status)).toBe(true);
    expect(isBefore(status, others)).toBe(true);
    // No monitor picked, and still asked: it applies to those picked later.
    expect(statusDropdown()).toBeVisible();
    expect(
      within(status).getByText(TEMPLATE_STATUS_DESCRIPTION),
    ).toBeVisible();
    expect(monitorsPicker()).toHaveAttribute(
      "placeholder",
      "Search monitors...",
    );
    // Nothing is folded under More fields on this step any more.
    expect(screen.queryByRole("button", { name: "More fields" })).toBeNull();
  });

  test("the Monitors picker lists monitors alone; the other picker the template's other relations, never monitors or sites", async () => {
    const user: UserEvent = renderTemplateForm();

    await openResourcesAffected();

    getListMock.mockClear();
    await user.click(monitorsPicker());
    await screen.findByRole("option", { name: "Checkout API" });

    expect(new Set(listedModels())).toEqual(new Set([Monitor]));

    await user.keyboard("{Escape}");
    getListMock.mockClear();
    await user.click(otherResourcesPicker());
    await screen.findByRole("option", { name: "db-primary" });

    expect(new Set(listedModels())).toEqual(
      new Set([Host, KubernetesCluster, DockerHost, PodmanHost, Service]),
    );
    expect(listedModels()).not.toContain(NetworkSite);
  });

  test("a monitor, a status and a host: the template is created with each where it always was", async () => {
    const user: UserEvent = renderTemplateForm();

    await openResourcesAffected();
    await pickResource(user, monitorsPicker(), "Checkout API");
    await pickStatus(user, "Under Maintenance");
    await pickResource(user, otherResourcesPicker(), "db-primary");
    await pickResource(user, otherResourcesPicker(), "checkout-api");

    const template: ScheduledMaintenanceTemplate = await createTemplate();

    expect(template.templateName).toBe("Weekly database patching");
    expect(idsOf(template.monitors)).toEqual([MONITOR_ID]);
    expect(idsOf(template.hosts)).toEqual([HOST_ID]);
    expect(idsOf(template.services)).toEqual([SERVICE_ID]);
    expect(idsOf(template.kubernetesClusters)).toEqual([]);
    expect(idsOf(template.dockerHosts)).toEqual([]);
    expect(idsOf(template.podmanHosts)).toEqual([]);
    expect(
      template.changeMonitorStatusTo?._id?.toString() ||
        template.changeMonitorStatusToId?.toString(),
    ).toBe(UNDER_MAINTENANCE_ID);
  });

  test("a status with no monitor is kept: it applies to the monitors picked when an event is scheduled", async () => {
    const user: UserEvent = renderTemplateForm();

    await openResourcesAffected();
    await pickStatus(user, "Under Maintenance");

    const template: ScheduledMaintenanceTemplate = await createTemplate();

    expect(idsOf(template.monitors)).toEqual([]);
    expect(
      template.changeMonitorStatusTo?._id?.toString() ||
        template.changeMonitorStatusToId?.toString(),
    ).toBe(UNDER_MAINTENANCE_ID);
  });
});

/*
 * The template page's Affected Resources card: its fields, recorded.
 */
type RecordedField = {
  field?: Record<string, unknown>;
  title?: string;
  description?: string;
  showIf?: (values: Record<string, unknown>) => boolean;
  collapsibleSection?: { id: string; title: string };
  getCustomElement?: (
    values: Record<string, unknown>,
    props: Record<string, unknown>,
  ) => ReactElement;
  onChange?: (
    value: unknown,
    currentValues: Record<string, unknown>,
    setNewFormValues: (values: Record<string, unknown>) => void,
  ) => void;
};

describe("the template page's Affected Resources card", () => {
  function keyOf(field: RecordedField): string {
    return Object.keys(field.field || {})[0] || "";
  }

  async function cardFields(): Promise<Array<RecordedField>> {
    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <ScheduledMaintenanceTemplateView
            pageRoute={new Route("/settings/scheduled-maintenance-templates")}
            currentProject={null}
            hasPaymentMethod={false}
          />
        </MemoryRouter>,
      );
    });

    const cards: Array<Record<string, unknown>> = recordedCards.filter(
      (props: Record<string, unknown>) => {
        return props["name"] === "Affected Resources";
      },
    );

    expect(cards.length).toBeGreaterThan(0);

    return cards[cards.length - 1]!["formFields"] as Array<RecordedField>;
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

  function pickerPropsOf(field: RecordedField): Record<string, unknown> {
    const element: ReactElement = field.getCustomElement!(
      { monitors: [MONITOR_ID], hosts: [HOST_ID], services: [SERVICE_ID] },
      { onChange: (): void => {}, ariaLabelledby: "label-id" },
    );

    expect(element.type).toBe(AffectedResourcesPicker);

    return element.props as Record<string, unknown>;
  }

  function payload(
    picks: Record<string, Array<string>>,
  ): Record<string, unknown> {
    return {
      __affectedResourcesPayload: true,
      monitors: undefined,
      hosts: undefined,
      kubernetesClusters: undefined,
      dockerHosts: undefined,
      podmanHosts: undefined,
      proxmoxClusters: undefined,
      vmwareVCenters: undefined,
      cephClusters: undefined,
      dockerSwarmClusters: undefined,
      iotFleets: undefined,
      databaseServers: undefined,
      networkSites: undefined,
      services: undefined,
      ...picks,
    };
  }

  async function writeBack(
    field: RecordedField,
    value: Record<string, unknown>,
    currentValues: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const written: MockFunction = getJestMockFunction();

    field.onChange!(value, currentValues, (values: Record<string, unknown>) => {
      written(values);
    });

    // The split runs a microtask later, after the form stored the payload.
    await waitFor(() => {
      expect(written).toHaveBeenCalledTimes(1);
    });

    return written.mock.calls[0]![0] as Record<string, unknown>;
  }

  const TEMPLATE_VALUES: Record<string, unknown> = {
    monitors: [MONITOR_ID],
    hosts: [HOST_ID],
    services: [SERVICE_ID],
    changeMonitorStatusTo: UNDER_MAINTENANCE_ID,
  };

  test("asks for the monitors, then the status they change to, then the other resources", async () => {
    const shown: Array<string> = (await cardFields())
      .filter((field: RecordedField): boolean => {
        return !field.showIf || field.showIf({});
      })
      .map(keyOf);

    expect(shown.slice(0, 3)).toEqual([
      "monitors",
      "changeMonitorStatusTo",
      "hosts",
    ]);
  });

  test("the Monitors picker offers monitors alone, named by its label", async () => {
    const monitors: RecordedField = fieldNamed(await cardFields(), "monitors");
    const props: Record<string, unknown> = pickerPropsOf(monitors);

    expect(monitors.title).toBe("Monitors");
    expect(monitors.description).toBe(
      "Search and attach the monitors that events created from this template should pre-populate.",
    );
    expect(props["resourceTypes"]).toEqual(["Monitor"]);
    expect(props["ariaLabelledby"]).toBe("label-id");
    expect(props["placeholder"]).toBe("Search monitors...");
    expect(props["hosts"]).toBeUndefined();
    expect(props["services"]).toBeUndefined();
  });

  test("the other picker offers the template's other relations, never monitors", async () => {
    const others: RecordedField = fieldNamed(await cardFields(), "hosts");
    const props: Record<string, unknown> = pickerPropsOf(others);

    expect(others.title).toBe("Other Affected Resources");
    expect(others.description).toBe(
      "Search and attach hosts, Kubernetes clusters, Docker hosts, or services that events created from this template should pre-populate.",
    );
    expect(props["resourceTypes"]).toEqual(TEMPLATE_OTHER_TYPES);
    expect(props["monitors"]).toBeUndefined();
    expect(props["ariaLabelledby"]).toBe("label-id");
  });

  test("a monitor picked writes back the monitors, and leaves the other resources and the status alone", async () => {
    const written: Record<string, unknown> = await writeBack(
      fieldNamed(await cardFields(), "monitors"),
      payload({
        monitors: [MONITOR_ID, "33333333-3333-4333-8333-000000000002"],
      }),
      TEMPLATE_VALUES,
    );

    expect(written).toEqual({
      ...TEMPLATE_VALUES,
      monitors: [MONITOR_ID, "33333333-3333-4333-8333-000000000002"],
    });
  });

  test("a host picked writes back the other resources, and leaves the monitors alone", async () => {
    const written: Record<string, unknown> = await writeBack(
      fieldNamed(await cardFields(), "hosts"),
      payload({
        hosts: [HOST_ID, "44444444-4444-4444-8444-000000000002"],
        kubernetesClusters: [],
        dockerHosts: [],
        podmanHosts: [],
        services: [SERVICE_ID],
      }),
      TEMPLATE_VALUES,
    );

    expect(written).toEqual({
      ...TEMPLATE_VALUES,
      hosts: [HOST_ID, "44444444-4444-4444-8444-000000000002"],
      kubernetesClusters: [],
      dockerHosts: [],
      podmanHosts: [],
      services: [SERVICE_ID],
    });
    expect(written["monitors"]).toEqual([MONITOR_ID]);
  });

  test("the status is always asked, never folded, and says it also applies to monitors picked when scheduling", async () => {
    const status: RecordedField = fieldNamed(
      await cardFields(),
      "changeMonitorStatusTo",
    );

    expect(status.title).toBe("Change Monitor Status to");
    expect(status.description).toBe(TEMPLATE_STATUS_DESCRIPTION);
    expect(status.showIf).toBeUndefined();
    expect(status.collapsibleSection).toBeUndefined();
  });

  test("the card's Edit opens Medium, and the details card holds no picker", async () => {
    await cardFields();

    const card: Record<string, unknown> = recordedCards.filter(
      (props: Record<string, unknown>) => {
        return props["name"] === "Affected Resources";
      },
    )[0]!;

    expect(card["createEditModalWidth"]).toBe(ModalWidth.Medium);

    const details: Record<string, unknown> | undefined = recordedCards.find(
      (props: Record<string, unknown>) => {
        return props["name"] === "Scheduled Maintenance Template Details";
      },
    );

    expect(details).toBeDefined();

    const detailKeys: Array<string> = (
      details!["formFields"] as Array<RecordedField>
    ).map(keyOf);

    expect(detailKeys).not.toContain("monitors");
    expect(detailKeys).not.toContain("hosts");
    expect(detailKeys).not.toContain("changeMonitorStatusTo");
  });
});
