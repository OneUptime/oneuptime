import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { Green } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";

/*
 * The Network Devices create form, as the page actually hands it to the
 * table.
 *
 * A NetworkDevice never needs a monitor to be registered — the server, the
 * Settings edit form, the topology map's "Add to Monitoring" dialog and
 * discovery import all accept a monitor-backed device with nothing bound.
 * The create form on this page was the one surface that demanded one
 * (`required: isMonitorBackedDevice`), so an operator recording a device
 * before its monitor existed was blocked here and nowhere else.
 *
 * MonitorBindingNeverRequired.test.ts (in App/Tests) pins the source text.
 * This pins the BEHAVIOUR: the field definition the page builds, evaluated
 * the way BasicForm evaluates it, for both monitoring methods. A refactor
 * that moved the requirement into a `required` callback, a `customValidation`
 * or a differently-named helper would slip past a text match and be caught
 * here.
 *
 * ModelTable is replaced by a prop recorder — the point is what the page
 * hands it, not re-testing the table (the same approach as
 * NetworkDeviceBulkDelete.test.tsx).
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

type FormValuesLike = Record<string, unknown>;

type CapturedFormField = {
  field?: Record<string, unknown> | undefined;
  overrideField?: Record<string, unknown> | undefined;
  overrideFieldKey?: string | undefined;
  title?: string | undefined;
  stepId?: string | undefined;
  description?: string | undefined;
  placeholder?: string | undefined;
  required?: boolean | ((values: FormValuesLike) => boolean) | undefined;
  showIf?: ((values: FormValuesLike) => boolean) | undefined;
  customValidation?: ((values: FormValuesLike) => string | null) | undefined;
};

type CapturedFormStep = {
  id: string;
  title: string;
  showIf?: ((values: FormValuesLike) => boolean) | undefined;
};

/** A column as the page hands it to the table; only what the tests read. */
type CapturedTableColumn = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  getElement?: ((item: NetworkDevice) => ReactElement) | undefined;
};

type CapturedTableProps = {
  formFields?: Array<CapturedFormField> | undefined;
  formSteps?: Array<CapturedFormStep> | undefined;
  columns?: Array<CapturedTableColumn> | undefined;
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

/*
 * The facet bar fetches sites, labels and probes on mount and owns the query
 * the table is given. None of that is what these tests are about.
 */
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
 * One probe, so the SNMP half of the form has an option to offer and the
 * probe field's own `required: true` is exercised against real data.
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

import NetworkDevicesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Devices";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  BOUND_MONITOR_PENDING_TOOLTIP,
  NO_MONITOR_QUALIFIER,
  UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";
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

function fieldFor(props: CapturedTableProps, key: string): CapturedFormField {
  const match: CapturedFormField | undefined = (props.formFields || []).find(
    (field: CapturedFormField): boolean => {
      return Object.keys(field.field || {})[0] === key;
    },
  );

  expect({ key: key, found: Boolean(match) }).toEqual({
    key: key,
    found: true,
  });

  return match!;
}

/** `required` the way FormField.tsx reads it: a boolean, or a callback. */
function isRequired(field: CapturedFormField, values: FormValuesLike): boolean {
  if (typeof field.required === "function") {
    return field.required(values);
  }

  return field.required === true;
}

function isShown(field: CapturedFormField, values: FormValuesLike): boolean {
  return field.showIf ? field.showIf(values) : true;
}

const MONITOR_BACKED: FormValuesLike = {
  monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
  name: "lobby-ap-01",
  hostname: "10.0.0.7",
};

const SNMP: FormValuesLike = {
  monitoringMethod: NetworkDeviceMonitoringMethod.Snmp,
  name: "core-switch-01",
  hostname: "10.0.0.1",
};

describe("the Network Devices create form's Monitor binding", () => {
  beforeEach(() => {
    capturedTableProps = null;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("shows the Monitor field for a monitor-backed device and hides it for SNMP", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const monitor: CapturedFormField = fieldFor(props, "monitor");

    expect(isShown(monitor, MONITOR_BACKED)).toBe(true);
    expect(isShown(monitor, SNMP)).toBe(false);
  });

  /*
   * The regression this file exists for: the field is shown, and it is not
   * required — for either method, with or without a monitor picked.
   */
  test("never requires a monitor to create a monitor-backed device", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const monitor: CapturedFormField = fieldFor(props, "monitor");

    expect(isRequired(monitor, MONITOR_BACKED)).toBe(false);
    expect(isRequired(monitor, { ...MONITOR_BACKED, monitor: undefined })).toBe(
      false,
    );
    expect(isRequired(monitor, { ...MONITOR_BACKED, monitor: "" })).toBe(false);
    expect(isRequired(monitor, SNMP)).toBe(false);
  });

  /*
   * Permission is mocked to nothing here, so the operator would never be
   * offered the "Create a Ping monitor" box — and the method picker must
   * not promise one either.
   */
  test("does not promise a Ping monitor to someone who cannot be offered one", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const method: CapturedFormField = fieldFor(props, "monitoringMethod");

    expect(method.description).toContain("now or later");
    expect(method.description).not.toContain("created for you");
  });

  test("does not smuggle the requirement in through a custom validation", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const monitor: CapturedFormField = fieldFor(props, "monitor");

    expect(monitor.customValidation).toBeUndefined();
  });

  /*
   * The copy is the only thing that tells an operator they may leave the
   * field empty. It is shared with the Settings form and the topology
   * dialog (MonitoringMethodFormFields) so the three cannot drift.
   */
  test("tells the operator the binding is optional and can be made later", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const monitor: CapturedFormField = fieldFor(props, "monitor");

    expect(monitor.placeholder?.toLowerCase()).toContain("optional");
    expect(monitor.description).toContain("Leave it empty");
    expect(monitor.description).toContain("bind a monitor later");
  });

  /*
   * What IS required has not changed: the identity of the device. A form
   * that dropped the monitor requirement by dropping requirements wholesale
   * would pass the tests above and let a nameless, addressless device
   * through to the server's own validation.
   */
  test("still requires the device's name and hostname for either method", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    for (const values of [MONITOR_BACKED, SNMP]) {
      expect(isRequired(fieldFor(props, "name"), values)).toBe(true);
      expect(isRequired(fieldFor(props, "hostname"), values)).toBe(true);
      expect(isRequired(fieldFor(props, "monitoringMethod"), values)).toBe(
        true,
      );
    }
  });

  /*
   * The SNMP side keeps its own requirement: a probe is what polls the
   * device, and without one an SNMP device would sit on Pending for the
   * same reason an unbound monitor-backed one reads "No monitor". The two
   * methods are symmetric in what they need, not in whether they need it.
   */
  test("the probe stays required for an SNMP device and hidden for a monitor-backed one", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const probe: CapturedFormField = fieldFor(props, "probe");

    expect(isShown(probe, SNMP)).toBe(true);
    expect(isRequired(probe, SNMP)).toBe(true);
    expect(isShown(probe, MONITOR_BACKED)).toBe(false);
  });

  test("the Monitor field lives on a declared wizard step", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const monitor: CapturedFormField = fieldFor(props, "monitor");
    const stepIds: Array<string> = (props.formSteps || []).map(
      (step: CapturedFormStep): string => {
        return step.id;
      },
    );

    expect(monitor.stepId).toBeDefined();
    expect(stepIds).toContain(monitor.stepId);
  });
});

/*
 * The Status column, RENDERED.
 *
 * The same unbound-versus-bound distinction the device Overview hero draws
 * (DeviceStatusHero.test.tsx) is drawn here, in the list every operator
 * scans first: a monitor-backed device with nothing bound reads "Pending"
 * with a gray "No monitor" qualifier beside it, one whose monitor is bound
 * but quiet reads "Pending" alone, and one whose monitor has reported shows
 * the monitor's own status word. Every sentence of that was pinned by a
 * source-text match, so negating the predicate in this one column — which
 * puts "No monitor" on every BOUND device and takes it off the ones that
 * need it — left every suite green. The page's real column definition is
 * taken from the captured props and its `getElement` rendered per row.
 *
 * Tooltips are tippy, portalled to document.body on mouseenter (see the
 * notes in DisabledButtonTooltip.test.tsx).
 */

const STATUS_DEVICE_ID: ObjectID = new ObjectID(
  "22222222-0000-4000-8000-000000000002",
);
const STATUS_MONITOR_ID: ObjectID = new ObjectID(
  "33333333-0000-4000-8000-000000000003",
);

/** A list row carrying only the columns the Status cell is decided from. */
function statusRow(data: {
  monitoringMethod: string | undefined;
  monitorId?: ObjectID | undefined;
  status?: { name: string; isOfflineState: boolean } | undefined;
}): NetworkDevice {
  const row: NetworkDevice = new NetworkDevice();
  row.id = STATUS_DEVICE_ID;
  row.name = "lobby-ap-01";
  row.hostname = "10.0.0.7";

  if (data.monitoringMethod !== undefined) {
    row.monitoringMethod = data.monitoringMethod;
  }

  if (data.monitorId) {
    row.monitorId = data.monitorId;
  }

  if (data.status) {
    const status: MonitorStatus = new MonitorStatus();
    status.name = data.status.name;
    status.color = Green;
    status.isOfflineState = data.status.isOfflineState;
    row.currentMonitorStatus = status;
  }

  return row;
}

function statusColumnFor(props: CapturedTableProps): CapturedTableColumn {
  const match: CapturedTableColumn | undefined = (props.columns || []).find(
    (column: CapturedTableColumn): boolean => {
      return column.title === "Status";
    },
  );

  expect({ title: "Status", found: Boolean(match) }).toEqual({
    title: "Status",
    found: true,
  });
  expect(match!.getElement).toBeDefined();

  return match!;
}

/** Render the cell the way the table would, and hand back its root. */
function renderStatusCell(
  props: CapturedTableProps,
  row: NetworkDevice,
): HTMLElement {
  const column: CapturedTableColumn = statusColumnFor(props);

  const rendered: { container: HTMLElement } = render(
    <MemoryRouter>{column.getElement!(row)}</MemoryRouter>,
  );

  return rendered.container;
}

function pillTextsIn(container: HTMLElement): Array<string> {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="pill"]'),
  ).map((pill: HTMLElement): string => {
    return pill.textContent || "";
  });
}

function pillIn(container: HTMLElement, text: string): HTMLElement {
  const match: HTMLElement | undefined = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="pill"]'),
  ).find((pill: HTMLElement): boolean => {
    return pill.textContent === text;
  });

  expect({ text: text, found: Boolean(match) }).toEqual({
    text: text,
    found: true,
  });

  return match!;
}

/** Hover a pill and return the text of every tooltip tippy has mounted. */
function tooltipsAfterHovering(pill: HTMLElement): Array<string> {
  fireEvent.mouseEnter(pill);

  return screen.getAllByRole("tooltip").map((tooltip: HTMLElement): string => {
    return tooltip.textContent || "";
  });
}

describe("the Network Devices list's Status column", () => {
  beforeEach(() => {
    capturedTableProps = null;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("reads Pending with the No monitor qualifier for a monitor-backed device with nothing bound", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    const cell: HTMLElement = renderStatusCell(
      props,
      statusRow({ monitoringMethod: NetworkDeviceMonitoringMethod.Monitor }),
    );

    expect(pillTextsIn(cell)).toEqual(["Pending", NO_MONITOR_QUALIFIER.text]);
    expect(pillTextsIn(cell)).toContain("No monitor");
  });

  test("reads Pending alone for a bound monitor that has not reported", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    const cell: HTMLElement = renderStatusCell(
      props,
      statusRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: STATUS_MONITOR_ID,
      }),
    );

    expect(pillTextsIn(cell)).toEqual(["Pending"]);
    expect(pillTextsIn(cell)).not.toContain("No monitor");
  });

  /*
   * NULL in the column is what every device created before the method
   * existed holds, and it means SNMP — a device with no binding to be
   * missing, so no qualifier however long it sits on Pending.
   */
  test("reads Pending alone for an SNMP device that has never been polled", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    const cell: HTMLElement = renderStatusCell(
      props,
      statusRow({ monitoringMethod: undefined }),
    );

    expect(pillTextsIn(cell)).toEqual(["Pending"]);
    expect(pillTextsIn(cell)).not.toContain("No monitor");
  });

  test("shows the monitor's own status word once the bound monitor has reported", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    const cell: HTMLElement = renderStatusCell(
      props,
      statusRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: STATUS_MONITOR_ID,
        status: { name: "Operational", isOfflineState: false },
      }),
    );

    expect(pillTextsIn(cell)).toEqual(["Operational"]);
    expect(pillTextsIn(cell)).not.toContain("No monitor");
    expect(pillTextsIn(cell)).not.toContain("Pending");
  });

  /*
   * The two Pendings look identical; the tooltip is the only place the list
   * says which one it is, and a single hedged sentence for both was the
   * thing the split was made to avoid.
   */
  test("explains the unbound Pending as a missing binding and the bound one as a quiet monitor", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    const unbound: HTMLElement = renderStatusCell(
      props,
      statusRow({ monitoringMethod: NetworkDeviceMonitoringMethod.Monitor }),
    );

    expect(tooltipsAfterHovering(pillIn(unbound, "Pending"))).toContain(
      UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP,
    );
    expect(
      tooltipsAfterHovering(pillIn(unbound, NO_MONITOR_QUALIFIER.text)),
    ).toContain(NO_MONITOR_QUALIFIER.tooltip);

    const bound: HTMLElement = renderStatusCell(
      props,
      statusRow({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorId: STATUS_MONITOR_ID,
      }),
    );

    expect(tooltipsAfterHovering(pillIn(bound, "Pending"))).toContain(
      BOUND_MONITOR_PENDING_TOOLTIP,
    );
  });
});
