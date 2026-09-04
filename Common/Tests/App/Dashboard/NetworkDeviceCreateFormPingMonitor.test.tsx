import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * The create form's "Also create a Ping monitor for incidents" opt-in.
 *
 * Every device this form registers is probe-polled: its probe pings it on a
 * schedule, so it has a status from its first poll and needs no monitor to
 * read Up or Down. What it has no way to do on its own is RAISE something —
 * an incident, a page, an alert — and until alert policies land, a Ping
 * monitor created on the device's address and bound to it is the only
 * one-click way to get that. So the opt-in stays, and says that instead.
 *
 * The properties that make it SAFE rather than merely present are all
 * invisible in a screenshot:
 *
 *   - it is OFF by default (monitors are billable and plan-limited, and a
 *     hidden checkbox that defaulted on would still be submitted);
 *   - it is offered only to someone allowed to create a monitor, because a
 *     box that fails on save is worse than no box;
 *   - the device is created FIRST and the monitor second, so a plan limit or
 *     a permission gap on the monitor never costs the operator the device;
 *   - an empty probe selection sends no `probes` key (an explicit empty
 *     selection means "attach nothing" to the server);
 *   - a failure is shown on the page and the device stays listed and polled,
 *     with nothing alerting on it — which is an allowed, explained state;
 *   - the list is refreshed afterwards, because the table refetches BEFORE
 *     onCreateSuccess runs, and would otherwise show the new device as
 *     carrying no monitor when one was bound to it a moment later.
 *
 * ModelTable is replaced by a prop recorder and its create hooks are called
 * directly — the point is what the page does around the create, not the
 * table (the same approach as NetworkDeviceBulkDelete.test.tsx).
 */

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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-0000-4000-8000-000000000001",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-0000-4000-8000-000000000001",
);
jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return PROJECT_ID;
      },
    },
  };
});

/*
 * Whether the viewer may create a Monitor. Flipped per test: the opt-in must
 * vanish for someone who could not complete it.
 */
let canCreateMonitor: boolean = true;

jest.mock("../../../UI/Utils/PermissionGate", () => {
  return {
    __esModule: true,
    default: {
      check: () => {
        return {
          isAllowed: canCreateMonitor,
          disabledReason: canCreateMonitor
            ? undefined
            : "You do not have permission to create monitors.",
        };
      },
    },
    ModelAction: {
      Create: "create",
      Read: "read",
      Update: "update",
      Delete: "delete",
    },
  };
});

const modelApiCreate: MockFunction = getJestMockFunction();
const modelApiUpdateById: MockFunction = getJestMockFunction();
const modelApiDeleteItem: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<unknown>) => {
        return modelApiCreate(...args);
      },
      updateById: (...args: Array<unknown>) => {
        return modelApiUpdateById(...args);
      },
      deleteItem: (...args: Array<unknown>) => {
        return modelApiDeleteItem(...args);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/PingMonitorSeedIds",
  () => {
    return {
      __esModule: true,
      default: {
        resolve: () => {
          return Promise.resolve({
            onlineMonitorStatusId: new ObjectID(
              "44444444-0000-4000-8000-000000000001",
            ),
            offlineMonitorStatusId: new ObjectID(
              "44444444-0000-4000-8000-000000000002",
            ),
            defaultIncidentSeverityId: new ObjectID(
              "55555555-0000-4000-8000-000000000001",
            ),
            defaultAlertSeverityId: new ObjectID(
              "66666666-0000-4000-8000-000000000001",
            ),
          });
        },
      },
    };
  },
);

type FormValuesLike = Record<string, unknown>;

type CapturedFormField = {
  field?: Record<string, unknown> | undefined;
  overrideField?: Record<string, unknown> | undefined;
  overrideFieldKey?: string | undefined;
  showEvenIfPermissionDoesNotExist?: boolean | undefined;
  title?: string | undefined;
  stepId?: string | undefined;
  description?: string | undefined;
  fieldType?: FormFieldSchemaType | undefined;
  defaultValue?: unknown;
  required?: boolean | ((values: FormValuesLike) => boolean) | undefined;
  showIf?: ((values: FormValuesLike) => boolean) | undefined;
  dropdownOptions?: Array<{ label: string; value: unknown }> | undefined;
};

type CapturedFormStep = {
  id: string;
  title: string;
};

type CapturedTableProps = {
  formFields?: Array<CapturedFormField> | undefined;
  formSteps?: Array<CapturedFormStep> | undefined;
  refreshToggle?: string | undefined;
  onBeforeCreate?:
    | ((
        item: NetworkDevice,
        miscDataProps: Record<string, unknown>,
      ) => Promise<NetworkDevice>)
    | undefined;
  onCreateSuccess?:
    | ((item: NetworkDevice) => Promise<NetworkDevice>)
    | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          filterBar: null,
          mergeFiltersIntoQuery: (
            base: Record<string, unknown> | undefined,
          ) => {
            return base || {};
          },
          hasActiveFilters: false,
          facetSelections: {},
          facetOperators: {},
          setFacetSelection: () => {
            // no-op
          },
          clearAllFacets: () => {
            // no-op
          },
          facetSaveState: {},
          restoreFacetState: () => {
            // no-op
          },
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {
            // no-op
          },
        };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkOidTemplateActions",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { bulkActions: [], modals: null };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

/*
 * One probe, so the "Ping from probes" picker has something to offer and
 * its visibility rule (only when there is a probe to pick) is exercised
 * against real data.
 */
jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: async () => {
        return [{ _id: "probe-1", name: "Branch probe" }];
      },
    },
  };
});

import NetworkDevicesPage, {
  CREATE_PING_MONITOR_FIELD_KEY,
  PING_PROBES_FIELD_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Devices";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/network-devices"),
  currentProject: null,
  hasPaymentMethod: true,
};

async function renderDevicesPage(): Promise<CapturedTableProps> {
  const Page: (props: PageComponentProps) => ReactElement =
    NetworkDevicesPage as unknown as (
      props: PageComponentProps,
    ) => ReactElement;

  render(
    <MemoryRouter>
      <Page {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });

  return capturedTableProps!;
}

function overrideFieldFor(
  props: CapturedTableProps,
  key: string,
): CapturedFormField {
  const match: CapturedFormField | undefined = (props.formFields || []).find(
    (field: CapturedFormField): boolean => {
      return field.overrideFieldKey === key;
    },
  );

  expect({ key: key, found: Boolean(match) }).toEqual({
    key: key,
    found: true,
  });

  return match!;
}

function isShown(field: CapturedFormField, values: FormValuesLike): boolean {
  return field.showIf ? field.showIf(values) : true;
}

/*
 * The form values a half-filled create form holds. There is no monitoring
 * method among them any more — the form does not ask — so this is every
 * device it can create.
 */
const DEVICE: FormValuesLike = {
  name: "lobby-ap-01",
  hostname: "10.0.0.7",
};

function deviceBeingCreated(): NetworkDevice {
  const item: NetworkDevice = new NetworkDevice();
  item.name = "lobby-ap-01";
  item.hostname = "10.0.0.7";

  return item;
}

function createdDevice(): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = DEVICE_ID;
  device.name = "lobby-ap-01";
  device.hostname = "10.0.0.7";
  device.monitoringMethod = NetworkDeviceMonitoringMethod.Probe;
  return device;
}

/** Drive the two table hooks the way ModelTable does around a create. */
async function runCreate(
  props: CapturedTableProps,
  data: {
    miscDataProps: Record<string, unknown>;
  },
): Promise<NetworkDevice> {
  expect(props.onBeforeCreate).toBeDefined();
  expect(props.onCreateSuccess).toBeDefined();

  await props.onBeforeCreate!(deviceBeingCreated(), data.miscDataProps);

  return props.onCreateSuccess!(createdDevice());
}

describe("the create form's Create a Ping monitor opt-in", () => {
  beforeEach(() => {
    capturedTableProps = null;
    canCreateMonitor = true;
    window.localStorage.clear();
    modelApiCreate.mockReset();
    modelApiUpdateById.mockReset();
    modelApiDeleteItem.mockReset();
    modelApiCreate.mockResolvedValue({ data: { id: MONITOR_ID } } as never);
    modelApiUpdateById.mockResolvedValue({} as never);
    modelApiDeleteItem.mockResolvedValue({} as never);
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  describe("the fields", () => {
    test("the checkbox is an override field on the probe-and-site step, off by default", async () => {
      const props: CapturedTableProps = await renderDevicesPage();
      const checkbox: CapturedFormField = overrideFieldFor(
        props,
        CREATE_PING_MONITOR_FIELD_KEY,
      );

      expect(checkbox.field).toBeUndefined();
      expect(checkbox.overrideField).toEqual({
        [CREATE_PING_MONITOR_FIELD_KEY]: true,
      });
      expect(checkbox.showEvenIfPermissionDoesNotExist).toBe(true);
      expect(checkbox.fieldType).toBe(FormFieldSchemaType.Checkbox);
      /*
       * No defaultValue AT ALL, which is what "off" means here: BasicForm
       * seeds a defaultValue with no showIf check, so a box that defaulted on
       * would spend the operator's monitor quota even while hidden.
       */
      expect(checkbox.defaultValue).toBeUndefined();
      expect(checkbox.required).toBe(false);

      const stepIds: Array<string> = (props.formSteps || []).map(
        (step: CapturedFormStep): string => {
          return step.id;
        },
      );
      expect(checkbox.stepId).toBe("probe-and-site");
      expect(stepIds).toContain("probe-and-site");
    });

    /*
     * The title carries the whole offer, because the checkbox is the one
     * field an operator decides on without reading anything else: "also"
     * says the device is already monitored without it, "for incidents" says
     * what it adds, and "(optional)" says it may be skipped.
     */
    test("the checkbox is worded as an addition, not as the way to get a status", async () => {
      const props: CapturedTableProps = await renderDevicesPage();
      const checkbox: CapturedFormField = overrideFieldFor(
        props,
        CREATE_PING_MONITOR_FIELD_KEY,
      );

      expect(checkbox.title).toBe(
        "Also create a Ping monitor for incidents (optional)",
      );
    });

    /*
     * Offered for every device this form creates. It used to be offered only
     * for a monitor-backed device with nothing bound, because a monitor was
     * the only thing that could give such a device a status; a probe-polled
     * device has one either way, and the monitor is what alerts on it.
     */
    test("the checkbox is offered for the device being registered", async () => {
      const props: CapturedTableProps = await renderDevicesPage();
      const checkbox: CapturedFormField = overrideFieldFor(
        props,
        CREATE_PING_MONITOR_FIELD_KEY,
      );

      expect(isShown(checkbox, DEVICE)).toBe(true);
      // Nothing about the device can hide it - not even an empty form.
      expect(isShown(checkbox, {})).toBe(true);
    });

    test("the checkbox is hidden for someone who may not create a monitor", async () => {
      canCreateMonitor = false;

      const props: CapturedTableProps = await renderDevicesPage();

      expect(
        isShown(overrideFieldFor(props, CREATE_PING_MONITOR_FIELD_KEY), DEVICE),
      ).toBe(false);
    });

    /*
     * The copy has to say the monitor is an ADDITION — an operator who reads
     * it as "this is how the device gets a status" will tick it for every
     * device in the estate and pay for all of them.
     */
    test("the checkbox says the probe already gives the device a status", async () => {
      const props: CapturedTableProps = await renderDevicesPage();
      const checkbox: CapturedFormField = overrideFieldFor(
        props,
        CREATE_PING_MONITOR_FIELD_KEY,
      );

      expect(checkbox.description).toContain("already pings this device");
      expect(checkbox.description).toContain("incident");
      expect(checkbox.description).toContain("counts towards your plan");
      expect(checkbox.description).toContain("incidents are off");
      /*
       * "No monitor" is the pill a monitor-backed device with nothing bound
       * wears. No device created by this form can ever read it, so promising
       * it here would send the operator hunting for a state that cannot
       * happen.
       */
      expect(checkbox.description).not.toContain("No monitor");
    });

    test("the probe picker appears only once the box is ticked, and lists the project's probes", async () => {
      const props: CapturedTableProps = await renderDevicesPage();
      const probes: CapturedFormField = overrideFieldFor(
        props,
        PING_PROBES_FIELD_KEY,
      );

      expect(probes.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
      expect(probes.stepId).toBe("probe-and-site");
      expect(probes.required).toBe(false);
      expect(probes.showEvenIfPermissionDoesNotExist).toBe(true);
      expect(probes.dropdownOptions).toEqual([
        { label: "Branch probe", value: "probe-1" },
      ]);

      expect(isShown(probes, DEVICE)).toBe(false);
      expect(
        isShown(probes, {
          ...DEVICE,
          [CREATE_PING_MONITOR_FIELD_KEY]: true,
        }),
      ).toBe(true);
    });

    test("the probe picker is hidden from someone who is not offered the box", async () => {
      canCreateMonitor = false;

      const props: CapturedTableProps = await renderDevicesPage();

      expect(
        isShown(overrideFieldFor(props, PING_PROBES_FIELD_KEY), {
          ...DEVICE,
          [CREATE_PING_MONITOR_FIELD_KEY]: true,
        }),
      ).toBe(false);
    });
  });

  describe("what happens after the device is created", () => {
    test("creates a Ping monitor on the device's address and binds it", async () => {
      const props: CapturedTableProps = await renderDevicesPage();

      const returned: NetworkDevice = await runCreate(props, {
        miscDataProps: {
          [CREATE_PING_MONITOR_FIELD_KEY]: true,
          [PING_PROBES_FIELD_KEY]: ["probe-1"],
        },
      });

      expect(returned.id?.toString()).toBe(DEVICE_ID.toString());

      expect(modelApiCreate).toHaveBeenCalledTimes(1);
      const createCall: {
        model: Monitor;
        modelType: unknown;
        miscDataProps: Record<string, unknown>;
      } = modelApiCreate.mock.calls[0]![0] as {
        model: Monitor;
        modelType: unknown;
        miscDataProps: Record<string, unknown>;
      };
      expect(createCall.modelType).toBe(Monitor);
      expect(createCall.model.name).toBe("Ping lobby-ap-01");
      expect(
        createCall.model.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data?.monitorDestination?.toString(),
      ).toBe("10.0.0.7");
      expect(createCall.miscDataProps).toEqual({ probes: ["probe-1"] });

      expect(modelApiUpdateById).toHaveBeenCalledTimes(1);
      const bind: { id: ObjectID; data: Record<string, unknown> } =
        modelApiUpdateById.mock.calls[0]![0] as {
          id: ObjectID;
          data: Record<string, unknown>;
        };
      expect(bind.id.toString()).toBe(DEVICE_ID.toString());
      expect(bind.data).toEqual({ monitorId: MONITOR_ID.toString() });
    });

    test("creates the device's monitor after the device exists, not before", async () => {
      const props: CapturedTableProps = await renderDevicesPage();

      // onBeforeCreate alone must not touch the API.
      await props.onBeforeCreate!(deviceBeingCreated(), {
        [CREATE_PING_MONITOR_FIELD_KEY]: true,
      });

      expect(modelApiCreate).not.toHaveBeenCalled();
    });

    test("sends no probes key when no probe was picked", async () => {
      const props: CapturedTableProps = await renderDevicesPage();

      await runCreate(props, {
        miscDataProps: { [CREATE_PING_MONITOR_FIELD_KEY]: true },
      });

      const createCall: { miscDataProps: Record<string, unknown> } =
        modelApiCreate.mock.calls[0]![0] as {
          miscDataProps: Record<string, unknown>;
        };
      expect(createCall.miscDataProps).toEqual({});
    });

    test("accepts a probe selection that arrives as options rather than ids", async () => {
      const props: CapturedTableProps = await renderDevicesPage();

      await runCreate(props, {
        miscDataProps: {
          [CREATE_PING_MONITOR_FIELD_KEY]: true,
          [PING_PROBES_FIELD_KEY]: [
            { label: "Branch probe", value: "probe-1" },
          ],
        },
      });

      const createCall: { miscDataProps: Record<string, unknown> } =
        modelApiCreate.mock.calls[0]![0] as {
          miscDataProps: Record<string, unknown>;
        };
      expect(createCall.miscDataProps).toEqual({ probes: ["probe-1"] });
    });

    /*
     * The box is off unless ticked, and an unticked box sends nothing at all
     * (ModelForm drops a false override) — so an absent flag is the normal
     * case, not an edge one, and it must cost the operator nothing.
     */
    test("does nothing when the box was not ticked", async () => {
      const props: CapturedTableProps = await renderDevicesPage();

      await runCreate(props, {
        miscDataProps: {},
      });

      expect(modelApiCreate).not.toHaveBeenCalled();
      expect(modelApiUpdateById).not.toHaveBeenCalled();
    });

    test("shows a success notice and refreshes the list", async () => {
      const props: CapturedTableProps = await renderDevicesPage();
      const toggleBefore: string | undefined = props.refreshToggle;

      await runCreate(props, {
        miscDataProps: { [CREATE_PING_MONITOR_FIELD_KEY]: true },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("network-device-ping-monitor-notice"),
        ).toBeInTheDocument();
      });

      const notice: HTMLElement = screen.getByTestId(
        "network-device-ping-monitor-notice",
      );
      expect(notice.textContent).toContain("Ping lobby-ap-01");
      expect(notice.textContent?.toLowerCase()).not.toContain("verified");

      await waitFor(() => {
        expect(capturedTableProps?.refreshToggle).not.toBe(toggleBefore);
      });
    });

    test("a monitor failure is shown on the page and the device stays created", async () => {
      modelApiCreate.mockRejectedValue(
        new Error("You have reached the monitor limit for your plan.") as never,
      );

      const props: CapturedTableProps = await renderDevicesPage();
      const toggleBefore: string | undefined = props.refreshToggle;

      const returned: NetworkDevice = await runCreate(props, {
        miscDataProps: { [CREATE_PING_MONITOR_FIELD_KEY]: true },
      });

      // Resolved, not rejected: the table must not treat the create as failed.
      expect(returned.id?.toString()).toBe(DEVICE_ID.toString());
      expect(modelApiUpdateById).not.toHaveBeenCalled();

      await waitFor(() => {
        expect(
          screen.getByTestId("network-device-ping-monitor-notice"),
        ).toBeInTheDocument();
      });

      const notice: HTMLElement = screen.getByTestId(
        "network-device-ping-monitor-notice",
      );
      expect(notice.textContent).toContain("lobby-ap-01 was created");
      expect(notice.textContent).toContain("monitor limit");
      /*
       * What was lost is the ALERTING, and only that: the device exists and
       * its probe polls it. A notice that implied the device had no status
       * would send the operator to fix something that is not broken.
       */
      expect(notice.textContent).toContain("its probe polls it");
      expect(notice.textContent).toContain("Create Ping Monitor");

      await waitFor(() => {
        expect(capturedTableProps?.refreshToggle).not.toBe(toggleBefore);
      });
    });

    test("a bind failure removes the monitor again and says so", async () => {
      modelApiUpdateById.mockRejectedValue(
        new Error("Monitor not found.") as never,
      );

      const props: CapturedTableProps = await renderDevicesPage();

      await runCreate(props, {
        miscDataProps: { [CREATE_PING_MONITOR_FIELD_KEY]: true },
      });

      expect(modelApiDeleteItem).toHaveBeenCalledTimes(1);

      await waitFor(() => {
        expect(
          screen.getByTestId("network-device-ping-monitor-notice"),
        ).toBeInTheDocument();
      });
      expect(
        screen.getByTestId("network-device-ping-monitor-notice").textContent,
      ).toContain("removed again");
    });

    test("a request is consumed once, so a second create does not reuse it", async () => {
      const props: CapturedTableProps = await renderDevicesPage();

      await runCreate(props, {
        miscDataProps: { [CREATE_PING_MONITOR_FIELD_KEY]: true },
      });
      expect(modelApiCreate).toHaveBeenCalledTimes(1);

      // A second success with no onBeforeCreate in between must not provision.
      await props.onCreateSuccess!(createdDevice());
      expect(modelApiCreate).toHaveBeenCalledTimes(1);
    });
  });
});
