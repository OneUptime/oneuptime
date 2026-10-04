import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An incident template asks for its affected resources the way Declare
 * Incident does: its monitors in a picker of their own, then "Change Monitor
 * Status to" right under them, then the other resources - on its create
 * wizard and on its Affected Resources card alike. The status page limit
 * folds under Advanced at the end of the wizard's Resources Affected step.
 *
 * Unlike an incident, a template asks for the status with no monitor picked
 * too: the status also applies to the monitors picked when an incident is
 * declared from it, where Declare Incident shows it once the first monitor
 * is picked.
 *
 * The table and the cards are stubbed and their props recorded; each
 * picker's own write-back is driven with the payload the picker hands it.
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

import AffectedResourcesPicker from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import IncidentTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentTemplates";
import IncidentTemplatesView from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentTemplatesView";
import IncidentStatusPageScopeCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

const TEMPLATE_ID: string = "a1b2c3d4-0000-4000-8000-0000000000aa";
const MONITOR_ID: string = "33333333-3333-4333-8333-000000000001";
const HOST_ID: string = "44444444-4444-4444-8444-000000000001";
const SERVICE_ID: string = "45444444-4444-4444-8444-000000000001";

const TEMPLATE_STATUS_DESCRIPTION: string =
  "Incidents declared from this template change the status of their monitors to this one - the monitors picked here and any picked when the incident is declared.";

// The template's own relations: a template holds these five besides monitors.
const TEMPLATE_OTHER_TYPES: Array<string> = [
  "Host",
  "KubernetesCluster",
  "DockerHost",
  "PodmanHost",
  "Service",
];

type RecordedField = {
  field?: Record<string, unknown>;
  title?: string;
  description?: string;
  stepId?: string;
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

function keyOf(field: RecordedField): string {
  return Object.keys(field.field || {})[0] || "";
}

// Shown: not a hidden registration (showIf () => false).
function isShown(field: RecordedField): boolean {
  return !field.showIf || field.showIf({ monitors: [MONITOR_ID] });
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

// What a picker field draws, and the props it hands the picker.
function pickerPropsOf(field: RecordedField): Record<string, unknown> {
  const element: ReactElement = field.getCustomElement!(
    { monitors: [MONITOR_ID], hosts: [HOST_ID], services: [SERVICE_ID] },
    { onChange: (): void => {}, ariaLabelledby: "label-id" },
  );

  expect(element.type).toBe(AffectedResourcesPicker);

  return element.props as Record<string, unknown>;
}

// The picker's whole payload: what it would hand its field for these picks.
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

// The form values a field's write-back leaves, from these.
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
  changeMonitorStatusTo: "status-id",
};

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

async function wizardFields(): Promise<Array<RecordedField>> {
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

  const tables: Array<Record<string, unknown>> = recordedTables.filter(
    (props: Record<string, unknown>) => {
      return props["modelType"] === IncidentTemplate;
    },
  );

  expect(tables.length).toBeGreaterThan(0);

  return tables[tables.length - 1]!["formFields"] as Array<RecordedField>;
}

async function cardFields(): Promise<Array<RecordedField>> {
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
      return props["name"] === "Affected Resources";
    },
  );

  expect(cards.length).toBeGreaterThan(0);

  return cards[cards.length - 1]!["formFields"] as Array<RecordedField>;
}

interface TemplateForm {
  form: string;
  fields: () => Promise<Array<RecordedField>>;
}

const TEMPLATE_FORMS: Array<TemplateForm> = [
  { form: "the create wizard", fields: wizardFields },
  { form: "the Affected Resources card", fields: cardFields },
];

describe.each(TEMPLATE_FORMS)(
  "An incident template's $form",
  ({ fields }: TemplateForm) => {
    test("asks for the monitors, then the status they change to, then the other resources", async () => {
      const shown: Array<string> = (await fields())
        .filter((field: RecordedField): boolean => {
          return (
            [
              "monitors",
              "changeMonitorStatusTo",
              "hosts",
              "statusPages",
            ].includes(keyOf(field)) && isShown(field)
          );
        })
        .map(keyOf);

      expect(shown.slice(0, 3)).toEqual([
        "monitors",
        "changeMonitorStatusTo",
        "hosts",
      ]);
    });

    test("the Monitors picker offers monitors alone, named by its label", async () => {
      const monitors: RecordedField = fieldNamed(await fields(), "monitors");
      const props: Record<string, unknown> = pickerPropsOf(monitors);

      expect(monitors.title).toBe("Monitors");
      expect(props["resourceTypes"]).toEqual(["Monitor"]);
      expect(props["ariaLabelledby"]).toBe("label-id");
      expect(props["placeholder"]).toBe("Search monitors...");
      // It is handed the monitors only.
      expect(props["hosts"]).toBeUndefined();
      expect(props["services"]).toBeUndefined();
    });

    test("the other picker offers the template's other relations, never monitors", async () => {
      const others: RecordedField = fieldNamed(await fields(), "hosts");
      const props: Record<string, unknown> = pickerPropsOf(others);

      expect(others.title).toBe("Other Affected Resources");
      expect(props["resourceTypes"]).toEqual(TEMPLATE_OTHER_TYPES);
      expect(props["monitors"]).toBeUndefined();
      expect(props["ariaLabelledby"]).toBe("label-id");
    });

    test("a monitor picked writes back the monitors, and leaves the other resources and the status alone", async () => {
      const written: Record<string, unknown> = await writeBack(
        fieldNamed(await fields(), "monitors"),
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
        fieldNamed(await fields(), "hosts"),
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

    test("the status is always asked, and says it also applies to monitors picked when declaring", async () => {
      const status: RecordedField = fieldNamed(
        await fields(),
        "changeMonitorStatusTo",
      );

      expect(status.title).toBe("Change Monitor Status to");
      expect(status.description).toBe(TEMPLATE_STATUS_DESCRIPTION);
      expect(status.showIf).toBeUndefined();
      expect(status.collapsibleSection).toBeUndefined();
    });
  },
);

describe("An incident template's create wizard: the status page limit", () => {
  test("folds under Advanced at the end of Resources Affected - the section its owners and labels fold into", async () => {
    const fields: Array<RecordedField> = await wizardFields();
    const pages: RecordedField = fieldNamed(fields, "statusPages");

    expect(pages.title).toBe(IncidentStatusPageScopeCopy.pickerTitle);
    expect(pages.stepId).toBe("resources-affected");
    expect(pages.collapsibleSection?.title).toBe("Advanced");

    const labels: RecordedField = fieldNamed(fields, "labels");

    expect(pages.collapsibleSection).toBe(labels.collapsibleSection);

    // Last of the step's fields that show.
    const onStep: Array<string> = fields
      .filter((field: RecordedField): boolean => {
        return field.stepId === "resources-affected" && isShown(field);
      })
      .map(keyOf);

    expect(onStep[onStep.length - 1]).toBe("statusPages");
  });

  test("every resource field is on Resources Affected", async () => {
    const fields: Array<RecordedField> = await wizardFields();

    for (const key of [
      "monitors",
      "changeMonitorStatusTo",
      "hosts",
      "statusPages",
    ]) {
      expect(`${key}: ${fieldNamed(fields, key).stepId}`).toBe(
        `${key}: resources-affected`,
      );
    }
  });
});
