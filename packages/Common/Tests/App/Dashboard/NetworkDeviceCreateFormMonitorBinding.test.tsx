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
 * Registering a device is a statement about the DEVICE: what it is called,
 * where it is, and which probe can reach it. The form used to open by asking
 * something else entirely — "how is this device monitored?", Probe or Bound
 * monitor — a question about OneUptime's internals, put to the operator
 * before they had told it a single thing about their device, and answered
 * wrong by anyone who read "Bound monitor" as "monitored". The answer then
 * decided whether the rest of the form asked for a probe or for a monitor,
 * so getting it wrong produced a device that nothing polls and nothing
 * reports on.
 *
 * There is no such question now. Every device this form creates is
 * probe-polled — pinged by its probe, and walked over SNMP as well once it
 * has credentials — and the bound-monitor override lives on the device's
 * Settings page, where an operator meets it already knowing what their
 * device is. The Monitor binding field went with the question: it existed
 * only to serve the "Bound monitor" answer, and a field shown by a branch
 * that can no longer be taken is a field nobody sees.
 *
 * MonitorBindingNeverRequired.test.ts (in App/Tests) pins the source text of
 * the surfaces that DO bind a monitor. This pins the create form's own
 * fields, evaluated the way BasicForm evaluates them, so a method question
 * or a binding smuggled back in as a `required` callback, a
 * `customValidation` or a differently-named helper is caught here rather
 * than by a text match.
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

/** The field for a column, or undefined when the form does not ask for it. */
function maybeFieldFor(
  props: CapturedTableProps,
  key: string,
): CapturedFormField | undefined {
  return (props.formFields || []).find((field: CapturedFormField): boolean => {
    return Object.keys(field.field || {})[0] === key;
  });
}

function fieldFor(props: CapturedTableProps, key: string): CapturedFormField {
  const match: CapturedFormField | undefined = maybeFieldFor(props, key);

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

/*
 * A half-filled create form. There is no monitoring method among the values,
 * because the form does not ask for one — which is exactly what makes it the
 * right thing to evaluate every showIf and every `required` against.
 */
const DEVICE: FormValuesLike = {
  name: "core-switch-01",
  hostname: "10.0.0.1",
};

/** `showIf` the way BasicForm reads it: absent means "always". */
function isShown(field: CapturedFormField, values: FormValuesLike): boolean {
  return field.showIf ? field.showIf(values) : true;
}

function stepIdsOf(props: CapturedTableProps): Array<string> {
  return (props.formSteps || []).map((step: CapturedFormStep): string => {
    return step.id;
  });
}

describe("the Network Devices create form asks about the device, not about monitoring", () => {
  beforeEach(() => {
    capturedTableProps = null;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  /*
   * The regression this file exists for. Not "the question is answered for
   * you" and not "the question is hidden" — the field is GONE, because a
   * hidden field's default is still submitted and a collapsed question is
   * still a question somebody has to maintain the copy for.
   */
  test("has no monitoring-method field and no step to put one on", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    expect(maybeFieldFor(props, "monitoringMethod")).toBeUndefined();
    expect(stepIdsOf(props)).not.toContain("monitoring-method");
  });

  /*
   * The binding existed only to serve the "Bound monitor" answer, and it is
   * still offered — on the device's Settings page, once the device exists
   * and the operator knows they need the override.
   */
  test("offers no monitor binding", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    expect(maybeFieldFor(props, "monitor")).toBeUndefined();
  });

  /*
   * The steps that are left are all about the device. Pinned as a set,
   * because "SNMP" losing its step is how an optional step becomes an
   * invisible one (its fields would then render on every step, or on none —
   * see NetworkFormStepsInvariants.test.ts).
   */
  test("walks the operator through device details, probe and site, and SNMP", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    expect(stepIdsOf(props)).toEqual([
      "device-details",
      "probe-and-site",
      "snmp",
    ]);
  });

  /*
   * What IS required is the identity of the device and the probe that
   * reaches it. A form that dropped the method question by dropping
   * questions wholesale would pass the tests above and let a nameless,
   * addressless, unpolled device through to the server's own validation.
   */
  test("still requires the device's name, hostname and probe", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    expect(isRequired(fieldFor(props, "name"), DEVICE)).toBe(true);
    expect(isRequired(fieldFor(props, "hostname"), DEVICE)).toBe(true);
    expect(isRequired(fieldFor(props, "probe"), DEVICE)).toBe(true);
  });

  /*
   * Nothing on this form branches on a monitoring method any more, so
   * nothing may HIDE on one either: a showIf that returned false for the
   * values this form actually holds would take its field off the wizard
   * entirely, which is silent — BasicForm renders what matches and warns
   * about nothing.
   */
  test("shows every field it asks for, whatever the form holds", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    for (const key of ["name", "hostname", "probe", "site"]) {
      expect({
        key: key,
        shown: isShown(fieldFor(props, key), DEVICE),
      }).toEqual({ key: key, shown: true });
    }
  });

  /*
   * The site is the one thing on this form the operator may genuinely not
   * know yet — a device found in a cupboard belongs somewhere, and which
   * site that is can be settled later (or by an assignment rule).
   */
  test("does not require a site to register a device", async () => {
    const props: CapturedTableProps = await renderDevicesPage();
    const site: CapturedFormField = fieldFor(props, "site");

    expect(isRequired(site, DEVICE)).toBe(false);
    expect(site.customValidation).toBeUndefined();
    expect(site.placeholder?.toLowerCase()).toContain("optional");
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

const STATUS_PROBE_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000004",
);

/** A list row carrying only the columns the Status cell is decided from. */
function statusRow(data: {
  monitoringMethod: string | undefined;
  monitorId?: ObjectID | undefined;
  probeId?: ObjectID | undefined;
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

  if (data.probeId) {
    row.probeId = data.probeId;
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
   * existed holds, and it parses as Probe — a device with no binding to be
   * missing, so no "No monitor" however long it sits on Pending. With a
   * probe assigned it is simply waiting for its first poll.
   */
  test("reads Pending alone for a probe-polled device that has never been polled", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    const cell: HTMLElement = renderStatusCell(
      props,
      statusRow({ monitoringMethod: undefined, probeId: STATUS_PROBE_ID }),
    );

    expect(pillTextsIn(cell)).toEqual(["Pending"]);
    expect(pillTextsIn(cell)).not.toContain("No monitor");
  });

  /*
   * The probe-polled counterpart of "No monitor": a device with no probe is
   * not waiting for a poll, because none is coming. It is a different pill
   * for a different fix, and it must not read as the monitor one — the
   * create form requires a probe precisely so this row is rare.
   */
  test("reads Pending with the No probe qualifier when no probe is assigned", async () => {
    const props: CapturedTableProps = await renderDevicesPage();

    const cell: HTMLElement = renderStatusCell(
      props,
      statusRow({ monitoringMethod: undefined }),
    );

    expect(pillTextsIn(cell)).toEqual(["Pending", "No probe"]);
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
