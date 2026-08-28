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
