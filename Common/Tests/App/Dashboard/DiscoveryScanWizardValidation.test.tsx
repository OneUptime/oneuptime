import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The wiring half of issue #3377.
 *
 * DiscoveryScanFormValidation.test.ts (in App/Tests) proves the validators
 * themselves are right, and BasicFormStepValidation.test.tsx proves a wizard
 * step refuses to turn while its own field has an error. Neither proves the
 * Discovery page actually HANGS those validators off the right fields, on the
 * right steps — and that is the part a refactor drops silently: removing
 * `customValidation` from a field object is type-safe, render-safe, and puts
 * the form straight back to accepting a phone number as a scan target.
 *
 * The page is one big ModelTable call and its fields are configuration passed
 * as props, so the table is mocked to capture them and the captured functions
 * are then exercised directly — the same approach
 * SecurityEventsDetectionRulesPage.test.tsx uses.
 */

type CapturedFormField = {
  field: Record<string, boolean>;
  title: string;
  stepId?: string | undefined;
  required?: boolean | undefined;
  placeholder?: string | undefined;
  validation?:
    | {
        maxLength?: number | undefined;
        minValue?: number | undefined;
        maxValue?: number | undefined;
      }
    | undefined;
  customValidation?:
    | ((values: Record<string, unknown>) => string | null)
    | undefined;
  showIf?: ((values: Record<string, unknown>) => boolean) | undefined;
};

type CapturedFormStep = {
  id: string;
  title: string;
};

/*
 * The list half of the table's configuration, captured for the same reason the
 * form half is: the Scan column, the filters and the row actions are all plain
 * props, so a refactor can drop one without breaking a type or a render.
 */
type CapturedColumn = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
  /*
   * The layout flags are captured too, because "which columns does this table
   * show by default, and which can the viewer switch on" is configuration in
   * exactly the same way the form fields are — and it is decided entirely by
   * these four properties. See the Scan Target describe block at the bottom.
   */
  id?: string | undefined;
  type?: FieldType | undefined;
  isHiddenByDefault?: boolean | undefined;
  isNotCustomizable?: boolean | undefined;
  isRemovable?: boolean | undefined;
  disableSort?: boolean | undefined;
  noValueMessage?: string | undefined;
  getElement?:
    | ((item: NetworkDeviceDiscoveryScan) => React.ReactElement)
    | undefined;
};

type CapturedFilter = {
  field?: Record<string, unknown> | undefined;
  title?: string | undefined;
};

type CapturedActionButton = {
  title?: string | undefined;
  isVisible?: ((item: NetworkDeviceDiscoveryScan) => boolean) | undefined;
};

type CapturedTableProps = {
  formFields?: Array<CapturedFormField>;
  formSteps?: Array<CapturedFormStep>;
  columns?: Array<CapturedColumn>;
  filters?: Array<CapturedFilter>;
  actionButtons?: Array<CapturedActionButton>;
  selectMoreFields?: Record<string, boolean>;
  isEditable?: boolean | undefined;
  /*
   * BaseModelTable gates the entire "Customize Columns" picker on this pair
   * (isColumnCustomizationEnabled). Nothing else in the repo reads this key,
   * so dropping the prop would make every hidden-by-default column on this
   * table permanently unreachable, with no other symptom.
   */
  userPreferencesKey?: string | undefined;
  disableColumnCustomization?: boolean | undefined;
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

import DiscoveryPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Discovery";
import ProbeUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Probe";
import Project from "../../../Models/DatabaseModels/Project";
import Probe from "../../../Models/DatabaseModels/Probe";
import ProjectUtil from "../../../UI/Utils/Project";
import PermissionUtil from "../../../UI/Utils/Permission";
import Permission from "../../../Types/Permission";
import ScanTargetUtil from "../../../Utils/NetworkDiscovery/ScanTargetUtil";
import ScanNameUtil from "../../../Utils/NetworkDiscovery/ScanNameUtil";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import FieldType from "../../../UI/Components/Types/FieldType";
import ModelTableColumn from "../../../UI/Components/ModelTable/Column";
import ModelTableColumns from "../../../UI/Components/ModelTable/Columns";
import {
  ColumnPreference,
  applyColumnPreference,
  getColumnIds,
} from "../../../UI/Components/ModelTable/ColumnPreference";
import { getSelectFromColumns } from "../../../UI/Components/ModelTable/SelectFromColumns";
import Select from "../../../Types/BaseDatabase/Select";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const STEP_SCAN_TARGET: string = "scan-target";
const STEP_SNMP: string = "snmp";
const STEP_SCHEDULE: string = "schedule";

function fieldKeyOf(field: CapturedFormField): string {
  return Object.keys(field.field || {})[0] as string;
}

function fieldNamed(key: string): CapturedFormField {
  const field: CapturedFormField | undefined =
    capturedTableProps?.formFields?.find(
      (formField: CapturedFormField): boolean => {
        return fieldKeyOf(formField) === key;
      },
    );

  if (!field) {
    throw new Error(`Discovery scan form field "${key}" not found`);
  }

  return field;
}

function columnNamed(key: string): CapturedColumn {
  const column: CapturedColumn | undefined = capturedTableProps?.columns?.find(
    (tableColumn: CapturedColumn): boolean => {
      return Object.keys(tableColumn.field || {})[0] === key;
    },
  );

  if (!column) {
    throw new Error(`Discovery scans table column "${key}" not found`);
  }

  return column;
}

function columnByTitle(title: string): CapturedColumn {
  const column: CapturedColumn | undefined = capturedTableProps?.columns?.find(
    (tableColumn: CapturedColumn): boolean => {
      return tableColumn.title === title;
    },
  );

  if (!column) {
    throw new Error(`Discovery scans table column titled "${title}" not found`);
  }

  return column;
}

/*
 * The captured columns handed to the real ColumnPreference helpers. The mock
 * stores them as the loose CapturedColumn shape; they are the very objects the
 * page declared, so the layout functions can be run over them directly rather
 * than over a replica that could drift from the page.
 */
function declaredColumns(): ModelTableColumns<NetworkDeviceDiscoveryScan> {
  return (capturedTableProps?.columns ||
    []) as unknown as ModelTableColumns<NetworkDeviceDiscoveryScan>;
}

/*
 * The titles a viewer sees, in order, for a given stored layout — computed by
 * the same function BaseModelTable renders through, so these tests move when
 * the real rule moves.
 */
function visibleColumnTitles(
  preference: ColumnPreference | null,
): Array<string> {
  return applyColumnPreference<NetworkDeviceDiscoveryScan>({
    columns: declaredColumns(),
    preference: preference,
  }).map((column: ModelTableColumn<NetworkDeviceDiscoveryScan>): string => {
    return column.title || "";
  });
}

/*
 * What the Scan column actually puts on screen for a given row. Rendered
 * rather than inspected: the fallback that matters here is a rendering
 * decision (name on the first line, target underneath, target ALONE when there
 * is no name), and reading it off the element tree would pin the markup rather
 * than what an operator sees.
 */
function renderScanCell(scan: Partial<NetworkDeviceDiscoveryScan>): string {
  const column: CapturedColumn = columnNamed("name");

  if (!column.getElement) {
    throw new Error("The Scan column renders no element");
  }

  const { container } = render(
    <MemoryRouter>
      {column.getElement(scan as NetworkDeviceDiscoveryScan)}
    </MemoryRouter>,
  );

  return container.textContent || "";
}

/*
 * What the Recurrence column puts on screen. Rendered rather than inspected,
 * for the same reason the Scan cell is: the thing under test is a sentence an
 * operator reads, not a shape in the element tree.
 */
function renderRecurrenceCell(
  scan: Partial<NetworkDeviceDiscoveryScan>,
): string {
  const column: CapturedColumn = columnNamed("isRecurring");

  if (!column.getElement) {
    throw new Error("The Recurrence column renders no element");
  }

  const { container } = render(
    <MemoryRouter>
      {column.getElement(scan as NetworkDeviceDiscoveryScan)}
    </MemoryRouter>,
  );

  return container.textContent || "";
}

function validate(key: string, values: Record<string, unknown>): string | null {
  const field: CapturedFormField = fieldNamed(key);

  if (!field.customValidation) {
    throw new Error(`Field "${key}" has no customValidation`);
  }

  return field.customValidation(values);
}

async function renderPage(): Promise<void> {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <DiscoveryPage
        pageRoute={new Route("/dashboard/network-devices/discovery")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  /*
   * The page renders a loader until its probe fetch settles, so the table (and
   * with it the form config) does not exist on the first paint.
   */
  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });
}

describe("Create Network Device Discovery Scan wizard", () => {
  beforeEach(() => {
    capturedTableProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

    const probe: Probe = new Probe();
    probe.id = new ObjectID("22222222-2222-4222-8222-222222222222");
    probe.name = "Datacenter Probe";

    jest.spyOn(ProbeUtil, "getAllProbes").mockResolvedValue([probe] as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    capturedTableProps = null;
  });

  test("is still a three-step wizard", async () => {
    await renderPage();

    expect(
      capturedTableProps?.formSteps?.map((step: CapturedFormStep): string => {
        return step.id;
      }),
    ).toEqual([STEP_SCAN_TARGET, STEP_SNMP, STEP_SCHEDULE]);
  });

  test("every field names a step that the wizard actually declares", async () => {
    await renderPage();

    const declared: Array<string> =
      capturedTableProps?.formSteps?.map((step: CapturedFormStep): string => {
        return step.id;
      }) || [];

    const fields: Array<CapturedFormField> =
      capturedTableProps?.formFields || [];

    expect(fields.length).toBeGreaterThan(0);

    for (const field of fields) {
      /*
       * A field with no stepId is validated on no step and rendered on no
       * step — the exact failure this wizard's validators are meant to close.
       */
      expect(declared).toContain(field.stepId);
    }
  });
});

describe("Scan Target is validated on the Scan Target step", () => {
  beforeEach(() => {
    capturedTableProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(ProbeUtil, "getAllProbes").mockResolvedValue([] as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    capturedTableProps = null;
  });

  test("the field carries a validator, on the first step, and is required", async () => {
    await renderPage();

    const field: CapturedFormField = fieldNamed("cidr");

    expect(field.stepId).toBe(STEP_SCAN_TARGET);
    expect(field.required).toBe(true);
    expect(typeof field.customValidation).toBe("function");
  });

  test("the reported input is rejected right there", async () => {
    await renderPage();

    expect(validate("cidr", { cidr: "9876543210" })).toContain(
      "is not a valid scan target",
    );
  });

  test.each([
    ["free text", "not-a-target"],
    ["a bad prefix", "10.0.0.0/33"],
    ["an out-of-range octet", "10.0.0.256"],
    ["a reversed range", "10.22-16.0.1"],
    ["a target over the address ceiling", "10.0.0.0/8"],
  ])("%s is rejected", async (_label: string, target: string) => {
    await renderPage();

    expect(validate("cidr", { cidr: target })).toBe(
      ScanTargetUtil.getValidationError(target),
    );
  });

  test.each([
    ["CIDR", "192.168.1.0/24"],
    ["an octet range", "10.16-22.0-255.51-66"],
    ["a single address", "10.0.0.5"],
  ])("%s is accepted", async (_label: string, target: string) => {
    await renderPage();

    expect(validate("cidr", { cidr: target })).toBeNull();
  });

  test("an empty target is left to the field's own required rule", async () => {
    await renderPage();

    for (const value of [undefined, null, ""]) {
      expect(validate("cidr", { cidr: value })).toBeNull();
    }
  });

  test("a BLANK target is not left to anything — nothing else would catch it", async () => {
    await renderPage();

    /*
     * Validation.validateRequired measures the untrimmed string, so a lone
     * space satisfies it. If the validator read a blank box as an empty one,
     * "   " would clear step 1 and fail on the server two steps later — the
     * reported bug, reproduced through the fix meant to close it.
     */
    for (const value of [" ", "   ", "\t"]) {
      expect(validate("cidr", { cidr: value })).not.toBeNull();
    }
  });

  test("a target past the parser's length cap is refused on this step", async () => {
    await renderPage();

    const tooLong: string = "1".repeat(ScanTargetUtil.MAX_TARGET_LENGTH + 1);

    expect(validate("cidr", { cidr: tooLong })).toContain(
      `longer than ${ScanTargetUtil.MAX_TARGET_LENGTH} characters`,
    );
  });

  test("the field declares no maxLength of its own", async () => {
    /*
     * ModelForm infers one from the ShortText column (100) and validateLength
     * runs before customValidation, which then overwrites its message with the
     * parser's — so a declared cap would be inert. The rule that actually
     * bites is the parser's own 64, asserted above.
     */
    await renderPage();

    expect(fieldNamed("cidr").validation?.maxLength).toBeUndefined();
  });
});

describe("Rescan Interval is validated on the Schedule step", () => {
  beforeEach(() => {
    capturedTableProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(ProbeUtil, "getAllProbes").mockResolvedValue([] as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    capturedTableProps = null;
  });

  test("the field carries a validator and lives on the last step", async () => {
    await renderPage();

    const field: CapturedFormField = fieldNamed("rescanIntervalInMinutes");

    expect(field.stepId).toBe(STEP_SCHEDULE);
    expect(typeof field.customValidation).toBe("function");
  });

  test("it only reveals itself once the scan is set to repeat", async () => {
    await renderPage();

    const field: CapturedFormField = fieldNamed("rescanIntervalInMinutes");

    expect(field.showIf?.({ isRecurring: true })).toBe(true);
    expect(field.showIf?.({ isRecurring: false })).toBe(false);
    expect(field.showIf?.({})).toBe(false);
  });

  test("an interval under the floor is rejected", async () => {
    await renderPage();

    expect(
      validate("rescanIntervalInMinutes", {
        isRecurring: true,
        rescanIntervalInMinutes: 5,
      }),
    ).toContain("at least 15 minutes");
  });

  test("a fractional interval is rejected even though it clears the floor", async () => {
    await renderPage();

    expect(
      validate("rescanIntervalInMinutes", {
        isRecurring: true,
        rescanIntervalInMinutes: 20.5,
      }),
    ).toContain("whole number");
  });

  test("a sensible interval is accepted", async () => {
    await renderPage();

    expect(
      validate("rescanIntervalInMinutes", {
        isRecurring: true,
        rescanIntervalInMinutes: 60,
      }),
    ).toBeNull();
  });

  test("nothing is demanded of a scan that does not repeat", async () => {
    await renderPage();

    expect(
      validate("rescanIntervalInMinutes", {
        isRecurring: false,
        rescanIntervalInMinutes: 1,
      }),
    ).toBeNull();
  });
});

describe("SNMP Port is bounded on the SNMP Credentials step", () => {
  beforeEach(() => {
    capturedTableProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(ProbeUtil, "getAllProbes").mockResolvedValue([] as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    capturedTableProps = null;
  });

  test("carries a validator on the SNMP step", async () => {
    await renderPage();

    const field: CapturedFormField = fieldNamed("snmpPort");

    expect(field.stepId).toBe(STEP_SNMP);
    expect(typeof field.customValidation).toBe("function");
  });

  test.each([
    ["zero", 0],
    ["a port past the top of the range", 65536],
    ["a fractional port", 161.5],
  ])("%s is rejected right there", async (_label: string, value: unknown) => {
    await renderPage();

    expect(validate("snmpPort", { snmpPort: value })).not.toBeNull();
  });

  test("the SNMP default is accepted, and an empty box says nothing", async () => {
    await renderPage();

    expect(validate("snmpPort", { snmpPort: 161 })).toBeNull();
    expect(validate("snmpPort", { snmpPort: "" })).toBeNull();
    expect(validate("snmpPort", {})).toBeNull();
  });
});

/*
 * The name (issue #3391).
 *
 * A discovery scan was identified everywhere by its target alone, so a list of
 * them read as a column of octet ranges with no way to tell the router sweep
 * from the switch range. These tests pin the three places the name has to
 * appear for that to be fixed — the wizard that collects it, the list column
 * that shows it, and the filters that find it — plus the fallback that keeps
 * every scan created before the column existed looking exactly as it did.
 */
describe("Name is collected by the wizard", () => {
  beforeEach(() => {
    capturedTableProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(ProbeUtil, "getAllProbes").mockResolvedValue([] as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    capturedTableProps = null;
  });

  test("is the first thing the wizard asks for, on the first step", async () => {
    await renderPage();

    const fields: Array<CapturedFormField> =
      capturedTableProps?.formFields || [];

    expect(fieldKeyOf(fields[0] as CapturedFormField)).toBe("name");
    expect(fieldNamed("name").stepId).toBe(STEP_SCAN_TARGET);
  });

  /*
   * Optional on purpose. Requiring it would put a wall in front of the
   * operator sweeping one subnet once, which is the case the page was built
   * for.
   */
  test("is optional", async () => {
    await renderPage();

    expect(fieldNamed("name").required).toBeFalsy();
  });

  test("carries the shared validator, so the form and the server agree", async () => {
    await renderPage();

    expect(typeof fieldNamed("name").customValidation).toBe("function");

    for (const value of [
      "Router Discovery - Region 1100",
      "",
      "   ",
      "a".repeat(ScanNameUtil.MAX_SCAN_NAME_LENGTH + 1),
      1100,
    ]) {
      expect(validate("name", { name: value })).toBe(
        ScanNameUtil.getValidationError(value),
      );
    }
  });

  test("says nothing about an empty box, so Next is never blocked by it", async () => {
    await renderPage();

    expect(validate("name", {})).toBeNull();
    expect(validate("name", { name: "" })).toBeNull();
  });
});

describe("Name identifies the scan in the list", () => {
  beforeEach(() => {
    capturedTableProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(ProbeUtil, "getAllProbes").mockResolvedValue([] as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    capturedTableProps = null;
  });

  test("a named scan leads with its name and still shows its target", async () => {
    await renderPage();

    const cell: string = renderScanCell({
      name: "Router Discovery - Region 1100",
      cidr: "10.15.128.0-255",
    });

    expect(cell).toContain("Router Discovery - Region 1100");
    expect(cell).toContain("10.15.128.0-255");
  });

  /*
   * The case that has to keep working: every scan that existed before this
   * column did. It reads exactly as it did before — the target, on the first
   * line, with nothing above it.
   */
  test("an unnamed scan reads exactly as it did before names existed", async () => {
    await renderPage();

    expect(renderScanCell({ cidr: "10.114.167.11-38" })).toBe(
      "10.114.167.11-38",
    );
    expect(renderScanCell({ name: "", cidr: "10.114.167.11-38" })).toBe(
      "10.114.167.11-38",
    );
    expect(renderScanCell({ name: "   ", cidr: "10.114.167.11-38" })).toBe(
      "10.114.167.11-38",
    );
  });

  test("a blank name never renders as an empty line above the target", async () => {
    await renderPage();

    const cell: string = renderScanCell({
      name: "  ",
      cidr: "192.168.1.0/24",
    });

    expect(cell.trim()).toBe("192.168.1.0/24");
  });

  test("a stored name is tidied up on the way out, not rendered raw", async () => {
    await renderPage();

    expect(
      renderScanCell({ name: "Router\nDiscovery", cidr: "10.0.0.0/24" }),
    ).toContain("Router Discovery");
  });

  /*
   * The column renders `cidr` while being keyed on `name`, so the target has
   * to be DECLARED on the column — not merely selected alongside it. Declaring
   * it is what fetches it for the second line AND what puts it in the CSV
   * export, which builds its row out of a column's declared fields alone
   * (Common/UI/Components/ModelTable/ExportFromColumns.ts). Reaching the
   * target through selectMoreFields instead exported an empty cell for every
   * scan without a name.
   */
  test("the target is declared on the column, so it is fetched and exported", async () => {
    await renderPage();

    expect(Object.keys(columnNamed("name").field || {})).toEqual([
      "name",
      "cidr",
    ]);
  });

  test("both halves of the identity are searchable", async () => {
    await renderPage();

    const filtered: Array<string> = (capturedTableProps?.filters || []).map(
      (filter: CapturedFilter): string => {
        return Object.keys(filter.field || {})[0] as string;
      },
    );

    expect(filtered).toContain("name");
    expect(filtered).toContain("cidr");
  });

  /*
   * A scan that cannot be corrected is worse than no scan: a name on the wrong
   * range misleads everyone who reads the list afterwards, a typo'd subnet
   * sweeps nothing, and a rejected community string finds nothing — and the
   * only way to fix any of them used to be deleting the scan and its results
   * and starting again (OneUptime issue #3444). One dialog fixes all of them;
   * it replaced a Rename dialog that could only fix the first.
   */
  test("a scan can be edited after it was created", async () => {
    await renderPage();

    const actions: Array<string> = (
      capturedTableProps?.actionButtons || []
    ).map((button: CapturedActionButton): string => {
      return button.title || "";
    });

    expect(actions).toContain("Edit");
    // Superseded: everything it offered is the first field of Edit.
    expect(actions).not.toContain("Rename");
  });

  /*
   * The table is not editable, so this button is the page's only edit
   * affordance and nothing else gates it. Offered to a reader, it would open a
   * dialog whose fields ModelForm has already dropped for want of the update
   * permission — boxes that cannot be saved and do not say why.
   */
  test("editing is offered only to someone who could save it", async () => {
    await renderPage();

    const edit: CapturedActionButton | undefined = (
      capturedTableProps?.actionButtons || []
    ).find((button: CapturedActionButton): boolean => {
      return button.title === "Edit";
    });

    const scan: NetworkDeviceDiscoveryScan = {
      cidr: "10.0.0.0/24",
    } as NetworkDeviceDiscoveryScan;

    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.Viewer]);

    expect(edit?.isVisible?.(scan)).toBe(false);

    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ProjectAdmin]);

    expect(edit?.isVisible?.(scan)).toBe(true);
  });

  test("a one-time scan reads as one-time", async () => {
    await renderPage();

    expect(renderRecurrenceCell({ isRecurring: false })).toContain("One-time");
  });

  test("a scheduled recurring scan says when it next runs", async () => {
    await renderPage();

    const cell: string = renderRecurrenceCell({
      isRecurring: true,
      rescanIntervalInMinutes: 60,
      status: "Completed",
      nextScanAt: new Date(Date.now() + 30 * 60000),
    });

    expect(cell).toContain("Every 60 min");
    expect(cell).toContain("Next scan");
  });

  /*
   * The half-truth this column used to tell. A recurring scan whose
   * nextScanAt is NULL is never re-queued — the worker's predicate is
   * `nextScanAt <= now`, and that is UNKNOWN for NULL — but the cell printed
   * the cadence and simply omitted the second line, so a scan that would never
   * run again was indistinguishable from one due in an hour.
   */
  test("a recurring scan with nothing scheduled says so rather than showing a bare cadence", async () => {
    await renderPage();

    const cell: string = renderRecurrenceCell({
      isRecurring: true,
      rescanIntervalInMinutes: 60,
      status: "Completed",
    });

    expect(cell).toContain("Every 60 min");
    expect(cell).toContain("No next scan is scheduled");
  });

  /*
   * ...but that is only alarming once the scan has finished. A run that is
   * queued or under way has its next one scheduled when it reports.
   */
  test("a recurring scan mid-run explains that the next one waits for it", async () => {
    await renderPage();

    for (const status of ["Pending", "In Progress"]) {
      const cell: string = renderRecurrenceCell({
        isRecurring: true,
        rescanIntervalInMinutes: 60,
        status: status,
      });

      expect(cell).toContain("when this run finishes");
      expect(cell).not.toContain("No next scan is scheduled");
    }
  });

  /*
   * The complaint in the issue was that a finished scan could not be given a
   * schedule. Nothing may hide Edit behind a status: a Completed scan is the
   * one people most need to change, and an In Progress one abandons its sweep
   * and starts again with the new settings rather than refusing.
   */
  test("editing is offered whatever state the scan is in", async () => {
    await renderPage();

    const edit: CapturedActionButton | undefined = (
      capturedTableProps?.actionButtons || []
    ).find((button: CapturedActionButton): boolean => {
      return button.title === "Edit";
    });

    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ProjectAdmin]);

    for (const status of ["Pending", "In Progress", "Completed", "Failed"]) {
      const scan: NetworkDeviceDiscoveryScan = {
        cidr: "10.0.0.0/24",
        status: status,
      } as NetworkDeviceDiscoveryScan;

      expect(edit?.isVisible?.(scan)).toBe(true);
    }
  });
});

/*
 * Issue #3446: "Scan Target column missing from the Discovery Scans table, but
 * present as a filter option".
 *
 * THE ACTUAL HISTORY, because it is easy to get wrong and it decides the shape
 * of the fix. Up to 12.0.22 this table had a standalone `{ cidr }` "Scan
 * Target" column and no filters at all. The commit that added scan names
 * (#3391) folded the target into the composite "Scan" cell AND introduced the
 * Name / Scan Target filters, in one change — so the filter for the target
 * appeared in the same release the column for it disappeared. The data was
 * never lost (the Scan cell shows the target on every row, and 12.0.24 is
 * byte-identical to this file's page in that respect); what was lost was the
 * target as a COLUMN: a header saying what the filter says, something to sort
 * on, and its own CSV heading.
 *
 * So the column comes back, switched off. That keeps #3391's default layout
 * exactly as designed — putting it back visible would print the target twice
 * in every named row — while making it one tick away in Customize Columns.
 *
 * WHAT THIS BLOCK GUARDS, in rough order of how expensive the mistake is:
 *
 *   - The column silently widening the default table (a dropped
 *     `isHiddenByDefault`), which is the #3391 regression wearing a new hat.
 *   - The recycled id. `getColumnBaseId` derives a column's identity from its
 *     first declared field, which for `{ cidr: true }` is "cidr" — the exact
 *     id the 12.0.22 column had, on this same userPreferencesKey. Stored
 *     layouts live in localStorage, are sanitized on read but never rewritten,
 *     and an id present in `order` OVERRIDES isHiddenByDefault. Ship the
 *     derived id and every operator who arranged this table a few releases ago
 *     silently gets the column back, on, duplicating the Scan cell. The
 *     explicit `id` is the whole fix for that, and it looks like a redundant
 *     line nobody would miss deleting — hence a test.
 *   - The picker being switched off table-wide, which would make a
 *     hidden-by-default column unreachable forever with no other symptom.
 *
 * These run against the columns the page really declared (captured through the
 * ModelTable mock) and through the real ColumnPreference / SelectFromColumns
 * helpers, so they follow the product rather than restating it.
 */
describe("Scan Target is reachable as a column, not only as a filter", () => {
  beforeEach(() => {
    capturedTableProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

    const probe: Probe = new Probe();
    probe.id = new ObjectID("22222222-2222-4222-8222-222222222222");
    probe.name = "Datacenter Probe";

    jest.spyOn(ProbeUtil, "getAllProbes").mockResolvedValue([probe] as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    capturedTableProps = null;
  });

  test("the table declares a Scan Target column keyed on the target", async () => {
    await renderPage();

    const column: CapturedColumn = columnByTitle("Scan Target");

    expect(Object.keys(column.field || {})).toEqual(["cidr"]);
    expect(column.type).toBe(FieldType.Text);
  });

  /*
   * The title is not decoration here: it is the entire complaint in #3446.
   * The filter dialog says "Scan Target", so the column has to say it too, and
   * both have to mean the same field or the pair is a different lie.
   */
  test("what you can filter by, you can now also show", async () => {
    await renderPage();

    const filter: CapturedFilter | undefined = (
      capturedTableProps?.filters || []
    ).find((tableFilter: CapturedFilter): boolean => {
      return tableFilter.title === "Scan Target";
    });

    expect(Object.keys(filter?.field || {})).toEqual(["cidr"]);
    expect(Object.keys(columnByTitle("Scan Target").field || {})).toEqual(
      Object.keys(filter?.field || {}),
    );
  });

  /*
   * The load-bearing one. #3391 decided this table shows ONE identity column,
   * and a Scan Target column that arrives switched on quietly reverses that
   * for every operator at once — the target rendered twice on every named row.
   * Asserted through applyColumnPreference (what BaseModelTable renders
   * through) rather than by reading the flag, so it fails if the rule that
   * honours the flag changes too.
   */
  test("it ships switched off, so the default layout is unchanged", async () => {
    await renderPage();

    expect(columnByTitle("Scan Target").isHiddenByDefault).toBe(true);

    expect(visibleColumnTitles(null)).toEqual([
      "Scan",
      "Probe",
      "Status",
      "Responded Hosts",
      "Recurrence",
      "Started",
    ]);
  });

  test("a viewer who switches it on gets it, between Scan and Probe", async () => {
    await renderPage();

    const preference: ColumnPreference = {
      order: ["scanTarget"],
      hidden: [],
    };

    expect(visibleColumnTitles(preference)).toEqual([
      "Scan",
      "Scan Target",
      "Probe",
      "Status",
      "Responded Hosts",
      "Recurrence",
      "Started",
    ]);
  });

  /*
   * The regression test for the recycled id, written as the upgrade it
   * describes: a layout saved on 12.0.22, when this table's first column was
   * `{ field: { cidr: true }, title: "Scan Target" }` and therefore had the
   * derived id "cidr". That entry is still in the viewer's localStorage today.
   * With an explicit id it stays unknown and keeps being dropped; reuse the
   * derived one and this viewer is upgraded straight into the duplicated
   * layout, without ever asking for it.
   */
  test("a layout saved before 12.0.23 does not switch it back on", async () => {
    await renderPage();

    const staleLayout: ColumnPreference = {
      order: [
        "cidr",
        "probe",
        "status",
        "respondedHostCount",
        "isRecurring",
        "createdAt",
      ],
      hidden: [],
    };

    expect(visibleColumnTitles(staleLayout)).not.toContain("Scan Target");
  });

  test("the column ids are unique, and the target's is not the recycled one", async () => {
    await renderPage();

    const ids: Array<string> =
      getColumnIds<NetworkDeviceDiscoveryScan>(declaredColumns());

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("cidr");
    expect(ids).toContain("scanTarget");

    /*
     * The Scan column's id has to stay "name". It declares `{ name, cidr }`,
     * and an id derives from the FIRST key — so reordering that pair to
     * `{ cidr, name }` would collide both columns onto "cidr", trigger
     * title-slug disambiguation, and invalidate every stored layout for this
     * table at once.
     */
    expect(ids[0]).toBe("name");
  });

  /*
   * A column can be switched off in two very different ways. isHiddenByDefault
   * means "off, but in the picker"; isNotCustomizable means "not the viewer's
   * to touch" and makes isHiddenByDefault a no-op. Setting both would produce a
   * column that lives in neither the table nor the picker — invisible, with
   * nothing to click.
   */
  test("it is offered in the picker rather than pinned out of it", async () => {
    await renderPage();

    const column: CapturedColumn = columnByTitle("Scan Target");

    expect(column.isNotCustomizable).toBeFalsy();
    // Nothing put it there for the viewer to take away again.
    expect(column.isRemovable).toBeFalsy();
  });

  /*
   * BaseModelTable gates the whole picker on `userPreferencesKey` being set
   * and `disableColumnCustomization` being absent. Neither is referenced
   * anywhere else, so losing one turns every hidden column on this table into
   * dead configuration and no other test would notice.
   */
  test("the picker this column depends on is switched on for the table", async () => {
    await renderPage();

    expect(capturedTableProps?.userPreferencesKey).toBe(
      "network-device-discovery-scans-table",
    );
    expect(capturedTableProps?.disableColumnCustomization).toBeFalsy();
  });

  /*
   * Sorting is the second thing the column buys over the subtitle already on
   * screen, and it is on by default only because `cidr` is a plain text
   * column — BaseModelTable disables sorting for entity columns. It sorts
   * lexicographically, which is what every other address-shaped text column in
   * the product does (Endpoints "IP Address", Assignment Rules "Subnet CIDR").
   */
  test("the target can be sorted on", async () => {
    await renderPage();

    expect(columnByTitle("Scan Target").disableSort).toBeFalsy();
    expect(new NetworkDeviceDiscoveryScan().isEntityColumn("cidr")).toBe(false);
  });

  /*
   * `cidr` is NOT NULL so this is close to hypothetical, but a bare text cell
   * renders "" for a missing value and the mobile card drops the whole
   * labelled block when the value is empty — so the "Scan Target" label itself
   * would disappear, where every other cell on this table shows an em-dash.
   */
  test("an empty target reads like every other empty cell here", async () => {
    await renderPage();

    expect(columnByTitle("Scan Target").noValueMessage).toBe("—");
  });

  /*
   * Every field any column declares has to be a real column on the model. A
   * typo here does not blank one cell — getSelectFromColumns throws on an
   * unknown PRIMARY field, which takes down the whole page.
   */
  test("the target is actually requested from the API", async () => {
    await renderPage();

    const select: Select<NetworkDeviceDiscoveryScan> =
      getSelectFromColumns<NetworkDeviceDiscoveryScan>({
        columns: declaredColumns(),
        model: new NetworkDeviceDiscoveryScan(),
      });

    expect(select.cidr).toBe(true);
    expect(select.name).toBe(true);
  });

  /*
   * "Scan" is a strict prefix of "Scan Target", so both surface when someone
   * types "scan" into the picker's search box. Duplicate titles there would
   * leave two identical rows and no way to tell which checkbox does what.
   */
  test("no two columns share a title", async () => {
    await renderPage();

    const titles: Array<string> = (capturedTableProps?.columns || []).map(
      (column: CapturedColumn): string => {
        return column.title || "";
      },
    );

    expect(new Set(titles).size).toBe(titles.length);
  });
});
