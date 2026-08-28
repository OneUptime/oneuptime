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
  /*
   * The rest of a field's configuration, captured for issue #3445. A scan's
   * METHOD is asked as a toggle whose defaultValue decides what an untouched
   * wizard creates, whose onChange clears the credentials the operator has
   * just said they do not want sent, and whose copy is the only place the
   * product explains what an ICMP-only scan can and cannot find. None of that
   * is reachable by rendering, because the table this configuration is handed
   * to is mocked away — so it is read off the props, like everything above.
   */
  fieldType?: FormFieldSchemaType | undefined;
  defaultValue?: boolean | string | number | Date | undefined;
  description?: string | undefined;
  sectionTitle?: string | undefined;
  sectionDescription?: string | undefined;
  hideOptionalLabel?: boolean | undefined;
  onChange?:
    | ((
        value: boolean,
        currentFormValues: Record<string, unknown>,
        setNewFormValues: (values: Record<string, unknown>) => void,
      ) => void)
    | undefined;
  getFooterElement?:
    | ((values: Record<string, unknown>) => React.ReactElement | undefined)
    | undefined;
};

type CapturedFormStep = {
  id: string;
  title: string;
  /*
   * A step can remove itself, which is how "SNMP Version is required" stopped
   * blocking a scan that sends no SNMP (issue #3445): BasicForm validates only
   * the fields of the step being submitted, and a step that filtered itself
   * out can never be that step.
   */
  showIf?: ((values: Record<string, unknown>) => boolean) | undefined;
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
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import SnmpSecurityLevel from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
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

/*
 * Every field the shared SNMP helper contributes to this wizard, in the order
 * it contributes them. Listed by hand rather than derived from the captured
 * props: a list read back out of the thing under test would agree with it by
 * construction, and the claim being made is that ALL NINE are gated on the
 * scan's method — including any that a later change forgets to route through
 * the gate (issue #3445).
 */
const SNMP_FIELD_KEYS: Array<string> = [
  "snmpVersion",
  "snmpCommunityString",
  "snmpV3SecurityLevel",
  "snmpV3Username",
  "snmpV3AuthProtocol",
  "snmpV3AuthKey",
  "snmpV3PrivProtocol",
  "snmpV3PrivKey",
  "snmpPort",
];

/*
 * The rest of the form each SNMP field needs before its OWN reveal rule lets
 * it through — the version it belongs to, and the security level that decides
 * whether v3 sends auth or privacy material. Without these, "is this field
 * shown for an SNMP scan?" would be asked of a form no operator could be
 * looking at, and every v3 field would answer "no" for a reason that has
 * nothing to do with the scan's method.
 */
const VALUES_THAT_SATISFY_ITS_OWN_REVEAL_RULE: Record<
  string,
  Record<string, unknown>
> = {
  // No reveal rule of its own.
  snmpVersion: {},
  snmpCommunityString: { snmpVersion: "V2c" },
  snmpV3SecurityLevel: { snmpVersion: "V3" },
  snmpV3Username: { snmpVersion: "V3" },
  snmpV3AuthProtocol: {
    snmpVersion: "V3",
    snmpV3SecurityLevel: SnmpSecurityLevel.AuthNoPriv,
  },
  snmpV3AuthKey: {
    snmpVersion: "V3",
    snmpV3SecurityLevel: SnmpSecurityLevel.AuthNoPriv,
  },
  snmpV3PrivProtocol: {
    snmpVersion: "V3",
    snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
  },
  snmpV3PrivKey: {
    snmpVersion: "V3",
    snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
  },
  // No reveal rule of its own.
  snmpPort: {},
};

/*
 * Throws rather than defaulting to `{}` for a key nobody listed: a tenth SNMP
 * field would otherwise be asked about in a form that never reveals it, and
 * "hidden because the method is off" and "hidden because its own rule was not
 * satisfied" are the same answer to an assertion and opposite answers to this
 * issue.
 */
function valuesRevealing(key: string): Record<string, unknown> {
  const values: Record<string, unknown> | undefined =
    VALUES_THAT_SATISFY_ITS_OWN_REVEAL_RULE[key];

  if (!values) {
    throw new Error(`No reveal values are listed for SNMP field "${key}"`);
  }

  return values;
}

/*
 * The form states that have to mean "this scan sends SNMP", listed once and
 * asserted twice — at step level, where an operator sees the effect, and at
 * field level, where it holds even in a form that declares no steps.
 *
 * The first group is the invariant this whole change rests on: ABSENT means
 * SNMP. An untouched form has no value until the toggle's default is applied,
 * a row written before the column existed has none, and a partially-selected
 * row returns null.
 */
const VALUES_THAT_MEAN_THE_SCAN_SENDS_SNMP: Array<
  [string, Record<string, unknown>]
> = [
  ["an untouched form", {}],
  ["an explicit yes", { isSnmpEnabled: true }],
  ["an absent flag", { isSnmpEnabled: undefined }],
  [
    "a null flag, as a partially-selected row returns it",
    {
      isSnmpEnabled: null,
    },
  ],
];

/*
 * ...and the read is `!== false` rather than `Boolean(value)` on purpose, so
 * only a real boolean off-switch turns SNMP off. Everything here is a value
 * this form never wrote, and for those the safe reading is the one the product
 * has always had: ask about SNMP. Falling back the other way would let a
 * string "false" out of a JSON body, or a 0 out of a driver that maps booleans
 * to integers, disable SNMP discovery wholesale.
 */
const VALUES_THAT_ARE_NOT_A_BOOLEAN_FALSE: Array<
  [string, Record<string, unknown>]
> = [
  ['the string "false"', { isSnmpEnabled: "false" }],
  ["a zero", { isSnmpEnabled: 0 }],
  ["an empty string", { isSnmpEnabled: "" }],
];

function stepNamed(id: string): CapturedFormStep {
  const step: CapturedFormStep | undefined =
    capturedTableProps?.formSteps?.find(
      (formStep: CapturedFormStep): boolean => {
        return formStep.id === id;
      },
    );

  if (!step) {
    throw new Error(`Discovery scan wizard step "${id}" not found`);
  }

  return step;
}

/*
 * Whether the wizard would render `key` for a form in this state. Throws
 * rather than defaulting to `true` when the field carries no showIf at all:
 * every SNMP field must have one after the gating map runs over them, and a
 * field that lost its rule is the regression, not a passing test.
 */
function isFieldShown(key: string, values: Record<string, unknown>): boolean {
  const field: CapturedFormField = fieldNamed(key);

  if (!field.showIf) {
    throw new Error(`Field "${key}" declares no showIf, so nothing hides it`);
  }

  return field.showIf(values);
}

/*
 * Drives the method toggle's onChange the way FormField does — with the new
 * value, the values as they stand, and the setter it is expected to call — and
 * hands back the setter so a test can assert it was NOT called just as easily
 * as it can read what it was called with.
 */
function toggleScanMethodTo(
  value: boolean,
  currentFormValues: Record<string, unknown>,
): jest.Mock<any, any> {
  const field: CapturedFormField = fieldNamed("isSnmpEnabled");

  if (!field.onChange) {
    throw new Error(
      "The scan method toggle rewrites nothing when it is switched",
    );
  }

  const setNewFormValues: jest.Mock<any, any> = jest.fn() as jest.Mock<
    any,
    any
  >;

  field.onChange(value, currentFormValues, setNewFormValues);

  return setNewFormValues;
}

function valuesAfterTurningSnmpOff(
  currentFormValues: Record<string, unknown>,
): Record<string, unknown> {
  const setNewFormValues: jest.Mock<any, any> = toggleScanMethodTo(
    false,
    currentFormValues,
  );

  expect(setNewFormValues).toHaveBeenCalledTimes(1);

  return setNewFormValues.mock.calls[0][0] as Record<string, unknown>;
}

/*
 * What the Scan Target field says underneath itself for a given target, or
 * undefined when it says nothing. Rendered rather than inspected for the same
 * reason renderScanCell is: the thousands separator and the singular "1
 * address" are the product here, and reading them off the element tree would
 * pin the markup instead of the sentence.
 */
function renderTargetSizeHint(target: unknown): string | undefined {
  const field: CapturedFormField = fieldNamed("cidr");

  if (!field.getFooterElement) {
    throw new Error("The Scan Target field renders no footer");
  }

  const element: React.ReactElement | undefined = field.getFooterElement({
    cidr: target,
  });

  if (!element) {
    return undefined;
  }

  const { container } = render(element);

  return container.textContent || "";
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

/*
 * The scan's METHOD (issue #3445).
 *
 * A discovery scan has always been a ping sweep followed by an SNMP probe, and
 * the wizard had no way to say "just tell me what is alive in 10.20.30.0/24".
 * Worse, it had no way to STOP saying it: SNMP Version is a required Dropdown
 * on its own step, so an operator who wanted an ICMP-only sweep could not get
 * past step 2 — "SNMP Version is required" blocked Next on a scan that was
 * never going to send an SNMP packet.
 *
 * The fix does not relax that rule. It removes the QUESTION: the step filters
 * itself out, and BasicForm validates only the fields of the step being
 * submitted. Everything below pins the wiring that makes removing a step safe
 * — where the toggle lives, what an absent flag means, and that each SNMP
 * field is gated on the method as well as on its own reveal rule.
 */
describe("The scan method decides whether the wizard asks about SNMP", () => {
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

  /*
   * The single most important placement in this change.
   *
   * BasicForm navigates the FILTERED step array — the steps whose showIf
   * passed — and locates itself in it with a findIndex on currentFormStepId.
   * Put the toggle on the step it can remove, and switching it off deletes the
   * step the form believes it is standing on: findIndex returns -1, the
   * advance branch is skipped, and Next keeps reading "Next" while doing
   * nothing at all. The wizard deadlocks on the very step whose error message
   * this issue is named after, which is strictly worse than the bug.
   */
  test("the method toggle sits on the scan-target step, never on the step it hides", async () => {
    await renderPage();

    const field: CapturedFormField = fieldNamed("isSnmpEnabled");

    expect(field.stepId).toBe(STEP_SCAN_TARGET);
    expect(field.stepId).not.toBe(STEP_SNMP);
  });

  /*
   * And nothing may hide the toggle itself. A showIf here — even one that
   * reads as harmless, "only once a probe is picked" — is the same deadlock
   * from the other side: an operator who cannot see the control cannot turn
   * SNMP back on, and the step stays gone.
   */
  test("the method toggle is never hidden by anything", async () => {
    await renderPage();

    expect(fieldNamed("isSnmpEnabled").showIf).toBeUndefined();
  });

  /*
   * The entire product as it stood before this change. An operator who never
   * touches the toggle must still get the ping + SNMP scan they have always
   * got, and the FIELD's default is what puts `isSnmpEnabled: true` in the
   * submitted body — the column default only speaks for a row the form never
   * mentioned the column on.
   */
  test("the method toggle defaults to on, so an untouched wizard still creates an SNMP scan", async () => {
    await renderPage();

    expect(fieldNamed("isSnmpEnabled").defaultValue).toBe(true);
  });

  /*
   * FieldLabel appends "(Optional)" to every non-required field, and "Check
   * SNMP on hosts that answer (Optional)" reads as though the question may be
   * left unanswered — a toggle is always answered, one way or the other.
   */
  test("the method is asked as a toggle that does not read as optional", async () => {
    await renderPage();

    const field: CapturedFormField = fieldNamed("isSnmpEnabled");

    expect(field.fieldType).toBe(FormFieldSchemaType.Toggle);
    expect(field.required).toBe(false);
    expect(field.hideOptionalLabel).toBe(true);
    expect(field.sectionTitle).toBe("What to check");
  });

  /*
   * The section header opens with what the scan ALREADY does. Without that
   * sentence, "Check SNMP on hosts that answer" reads as the whole question —
   * an operator who turns it off has no way to know a ping sweep still happens
   * and still finds things, which is the entire feature #3445 adds.
   */
  test("the section says the ping sweep happens either way, before asking about SNMP", async () => {
    await renderPage();

    const sectionDescription: string =
      fieldNamed("isSnmpEnabled").sectionDescription || "";

    expect(sectionDescription).toContain(
      "Every scan pings each address in the range to find what is alive",
    );
    /*
     * Name and vendor, NOT model: the sweep reads the SNMP system group
     * (sysName / sysDescr / sysObjectId), and a device's model arrives later
     * from the ENTITY-MIB poll. Promising it here would have the wizard
     * describe something the scan does not do.
     */
    expect(sectionDescription).toContain("name and vendor");
  });

  /*
   * Where the toggle sits in the field list, which decides two separate
   * things.
   *
   * BasicForm renders a step's fields in declaration order and `sectionTitle`
   * draws a header above the field carrying it, so everything from there down
   * reads as part of that section: a toggle declared before Probe would put
   * the probe picker under a "What to check" heading it has nothing to do
   * with. And the question has to be asked before the fields whose existence
   * it decides — an operator filling the form top to bottom answers "do you
   * want SNMP?" and only then is asked for credentials.
   */
  test("the toggle is the last question on its step and precedes every field it gates", async () => {
    await renderPage();

    const declared: Array<string> = (capturedTableProps?.formFields || []).map(
      fieldKeyOf,
    );

    const onTheFirstStep: Array<string> = (capturedTableProps?.formFields || [])
      .filter((field: CapturedFormField): boolean => {
        return field.stepId === STEP_SCAN_TARGET;
      })
      .map(fieldKeyOf);

    expect(onTheFirstStep[onTheFirstStep.length - 1]).toBe("isSnmpEnabled");

    const toggleIndex: number = declared.indexOf("isSnmpEnabled");

    for (const key of SNMP_FIELD_KEYS) {
      expect({
        field: key,
        isAskedAfterTheToggle: declared.indexOf(key) > toggleIndex,
      }).toEqual({ field: key, isAskedAfterTheToggle: true });
    }
  });

  /*
   * The copy IS the feature here. An ICMP-only scan finds addresses and
   * nothing else — no name, no model, no vendor — and everything it imports
   * arrives as a device with polling off. An operator who is not told that
   * reads an empty device page as a broken import rather than as the scan they
   * asked for.
   */
  test("the toggle says what an ICMP-only scan does and does not give you", async () => {
    await renderPage();

    const description: string = fieldNamed("isSnmpEnabled").description || "";

    expect(description).toContain("ICMP-only");
    expect(description).toContain("no credentials are asked for");
    /*
     * Points at the dialog's own "Create a Ping monitor" option rather than at
     * hand-binding, because every host an ICMP-only scan finds is a host
     * without SNMP — which is exactly the set that option covers.
     */
    expect(description).toContain("Ping monitor");
  });

  test("the SNMP step is removed for a scan that will send no SNMP", async () => {
    await renderPage();

    expect(stepNamed(STEP_SNMP).showIf?.({ isSnmpEnabled: false })).toBe(false);
  });

  /*
   * The invariant this whole change rests on, and the one that fails
   * silently: ABSENT means SNMP. Read an absent flag as "SNMP is off" and the
   * wizard quietly stops collecting credentials for every scan in the project
   * — a regression with no error message anywhere, whose only symptom is
   * discovery finding addresses instead of devices.
   */
  test.each(VALUES_THAT_MEAN_THE_SCAN_SENDS_SNMP)(
    "the SNMP step stands for %s",
    async (_label: string, values: Record<string, unknown>) => {
      await renderPage();

      expect(stepNamed(STEP_SNMP).showIf?.(values)).toBe(true);
    },
  );

  test.each(VALUES_THAT_ARE_NOT_A_BOOLEAN_FALSE)(
    "%s does not remove the SNMP step",
    async (_label: string, values: Record<string, unknown>) => {
      await renderPage();

      expect(stepNamed(STEP_SNMP).showIf?.(values)).toBe(true);
    },
  );

  /*
   * Only the middle one is conditional. A showIf that drifted onto Scan Target
   * or Schedule would put the form's own step back in reach of being filtered
   * out from under it — the deadlock described at the top of this file, moved
   * to a step nobody was thinking about.
   */
  test("only the middle step can remove itself", async () => {
    await renderPage();

    expect(typeof stepNamed(STEP_SNMP).showIf).toBe("function");
    expect(stepNamed(STEP_SCAN_TARGET).showIf).toBeUndefined();
    expect(stepNamed(STEP_SCHEDULE).showIf).toBeUndefined();
  });

  /*
   * Worth its own test, because it is the thing the issue title tempts you to
   * change. #3445 is NOT "SNMP Version should be optional": a scan that does
   * send SNMP needs a version to dial, and making the field optional would
   * trade a blocked wizard for a scan the probe cannot run. What changed is
   * that the field is no longer on any step the operator is asked to submit.
   */
  test("SNMP Version is still required — it is the step that disappears, not the rule", async () => {
    await renderPage();

    const field: CapturedFormField = fieldNamed("snmpVersion");

    expect(field.required).toBe(true);
    expect(field.stepId).toBe(STEP_SNMP);
  });

  /*
   * Belt and braces, deliberately. The step-level showIf is what an operator
   * sees; this is what holds when there is no step at all — BasicForm renders
   * every field when a form declares no steps, which is exactly how the Rename
   * dialog on this same page already renders one field from this file. A field
   * gated only by its step would reappear in any such form.
   */
  test.each(SNMP_FIELD_KEYS)(
    "%s is hidden when the scan sends no SNMP",
    async (key: string) => {
      await renderPage();

      expect(isFieldShown(key, { isSnmpEnabled: false })).toBe(false);
    },
  );

  /*
   * The other direction, field by field, and the one the negative test.each
   * above cannot stand in for. A gate written as `if (!item.isSnmpEnabled) {
   * return false; }` passes every hidden-when-off assertion and still hides
   * all nine fields from an untouched form, a legacy row and a partially
   * selected one — the ABSENT-means-SNMP invariant, broken at the only level
   * that survives a form with no steps.
   *
   * Each field is asked with the values its OWN reveal rule needs, so the
   * answer here is about the method and nothing else.
   */
  test.each(SNMP_FIELD_KEYS)(
    "%s is shown for every form state that means the scan sends SNMP",
    async (key: string) => {
      await renderPage();

      for (const [label, methodValues] of [
        ...VALUES_THAT_MEAN_THE_SCAN_SENDS_SNMP,
        ...VALUES_THAT_ARE_NOT_A_BOOLEAN_FALSE,
      ]) {
        const shown: boolean = isFieldShown(key, {
          ...methodValues,
          ...valuesRevealing(key),
        });

        expect({ methodValue: label, shown: shown }).toEqual({
          methodValue: label,
          shown: true,
        });
      }
    },
  );

  /*
   * The count is the point: a tenth SNMP field added to the shared helper
   * later reaches this step through the same spread, and this test fails until
   * SNMP_FIELD_KEYS above names it — which is what forces the new field
   * through the gating assertions rather than past them.
   */
  test("the SNMP step holds exactly the nine gated fields", async () => {
    await renderPage();

    const onTheSnmpStep: Array<string> = (capturedTableProps?.formFields || [])
      .filter((field: CapturedFormField): boolean => {
        return field.stepId === STEP_SNMP;
      })
      .map(fieldKeyOf);

    expect(onTheSnmpStep).toEqual(SNMP_FIELD_KEYS);
  });

  /*
   * A field with no reveal rule of its own — SNMP Version is the only one —
   * must end up shown whenever the method allows it. The gate wraps each
   * field's existing showIf and falls back to `true` when there is none, so
   * getting that fallback backwards would hide the version dropdown from every
   * SNMP scan and reproduce #3445 with the step still present.
   */
  test("a field with no reveal rule of its own is shown whenever the method allows it", async () => {
    await renderPage();

    expect(isFieldShown("snmpVersion", {})).toBe(true);
    expect(isFieldShown("snmpVersion", { isSnmpEnabled: true })).toBe(true);
    expect(isFieldShown("snmpVersion", { isSnmpEnabled: undefined })).toBe(
      true,
    );
    expect(isFieldShown("snmpVersion", { isSnmpEnabled: false })).toBe(false);
  });

  /*
   * The gate COMPOSES with each field's own rule rather than replacing it.
   * Replacing it — returning `isSnmpEnabled !== false` and stopping there —
   * type-checks, renders, and puts the whole v3 credential set in front of
   * someone who picked V2c.
   */
  test("the gate composes with the v3 reveal rules instead of replacing them", async () => {
    await renderPage();

    const v3AuthPriv: Record<string, unknown> = {
      isSnmpEnabled: true,
      snmpVersion: "V3",
      snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
    };

    expect(isFieldShown("snmpV3PrivKey", v3AuthPriv)).toBe(true);
    expect(isFieldShown("snmpV3Username", v3AuthPriv)).toBe(true);

    // Same security level, a version that has no v3 credentials at all.
    expect(
      isFieldShown("snmpV3PrivKey", { ...v3AuthPriv, snmpVersion: "V2c" }),
    ).toBe(false);

    // Right version, a security level that sends no privacy material.
    expect(
      isFieldShown("snmpV3PrivKey", {
        ...v3AuthPriv,
        snmpV3SecurityLevel: SnmpSecurityLevel.AuthNoPriv,
      }),
    ).toBe(false);
  });

  test("the community string still follows the version, not the method", async () => {
    await renderPage();

    expect(
      isFieldShown("snmpCommunityString", {
        isSnmpEnabled: true,
        snmpVersion: "V2c",
      }),
    ).toBe(true);

    expect(
      isFieldShown("snmpCommunityString", {
        isSnmpEnabled: true,
        snmpVersion: "V3",
      }),
    ).toBe(false);

    // ...and the method still wins over the version when it is off.
    expect(
      isFieldShown("snmpCommunityString", {
        isSnmpEnabled: false,
        snmpVersion: "V2c",
      }),
    ).toBe(false);
  });

  /*
   * The list has to fetch the method as well as ask for it: the results dialog
   * describes an ICMP-only scan differently ("hosts answered ping", no SNMP
   * filter buttons), and a column that is never selected reads as undefined,
   * which every reader is required to treat as an SNMP scan.
   */
  test("the method is fetched with the list, so the results dialog can read it", async () => {
    await renderPage();

    expect(capturedTableProps?.selectMoreFields?.["isSnmpEnabled"]).toBe(true);
  });
});

/*
 * Turning the toggle off is not only a visibility change — it has to unsay
 * what the operator already said. ModelForm builds the request body from every
 * DECLARED field without asking whether it was visible, so a v3 passphrase
 * typed before they changed their mind is still posted, stored, and sitting on
 * a scan that will never send it.
 */
describe("Turning SNMP off clears the credentials the scan will never send", () => {
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

  const TYPED_IN_CREDENTIALS: Record<string, unknown> = {
    snmpVersion: "V3",
    snmpCommunityString: "public",
    snmpPort: 1161,
    snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
    snmpV3Username: "netops",
    snmpV3AuthProtocol: "sha",
    snmpV3AuthKey: "auth-passphrase",
    snmpV3PrivProtocol: "aes",
    snmpV3PrivKey: "priv-passphrase",
  };

  test.each([
    "snmpCommunityString",
    "snmpPort",
    "snmpV3SecurityLevel",
    "snmpV3Username",
    "snmpV3AuthProtocol",
    "snmpV3AuthKey",
    "snmpV3PrivProtocol",
    "snmpV3PrivKey",
  ])("%s is cleared on the way past", async (key: string) => {
    await renderPage();

    const cleared: Record<string, unknown> = valuesAfterTurningSnmpOff({
      ...TYPED_IN_CREDENTIALS,
    });

    expect(Object.prototype.hasOwnProperty.call(cleared, key)).toBe(true);
    expect(cleared[key]).toBeUndefined();
  });

  /*
   * The one exception, and the reason it is an exception.
   *
   * Clearing snmpVersion would leave a REQUIRED Dropdown holding nothing. The
   * control still visibly reads V2c, because that is its own defaultValue, so
   * the moment the operator turns SNMP back on they are told "SNMP Version is
   * required" about a field they can see filled in — issue #3445's exact
   * symptom, reintroduced by the fix for it.
   */
  test("snmpVersion is reset to the dropdown's own default rather than emptied", async () => {
    await renderPage();

    const cleared: Record<string, unknown> = valuesAfterTurningSnmpOff({
      ...TYPED_IN_CREDENTIALS,
    });

    expect(cleared["snmpVersion"]).toBe(fieldNamed("snmpVersion").defaultValue);
    expect(cleared["snmpVersion"]).toBe("V2c");
    expect(cleared["snmpVersion"]).not.toBeUndefined();
    expect(cleared["snmpVersion"]).not.toBe("");
    expect(cleared["snmpVersion"]).not.toBeNull();
  });

  /*
   * The sweep across the whole list rather than field by field: whatever an
   * individual field's treatment is — emptied, or reset to a default — no
   * value the operator typed may survive the switch.
   *
   * It does NOT force a tenth field added to the shared helper to be handled.
   * Both SNMP_FIELD_KEYS and TYPED_IN_CREDENTIALS are written by hand in this
   * file and are blind to a field nobody listed. The test that fails until the
   * new field is named is "the SNMP step holds exactly the nine gated fields".
   */
  test("every SNMP field is either cleared or reset, none is left as typed", async () => {
    await renderPage();

    const cleared: Record<string, unknown> = valuesAfterTurningSnmpOff({
      ...TYPED_IN_CREDENTIALS,
    });

    for (const key of SNMP_FIELD_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(cleared, key)).toBe(true);
      expect(cleared[key]).not.toBe(TYPED_IN_CREDENTIALS[key]);
    }
  });

  test("the method itself is recorded as off", async () => {
    await renderPage();

    expect(
      valuesAfterTurningSnmpOff({ ...TYPED_IN_CREDENTIALS })["isSnmpEnabled"],
    ).toBe(false);
  });

  /*
   * FormField calls onChange BEFORE setFieldValue and setFieldValue spreads
   * from the object handed back here, so anything this drops is dropped for
   * good — including the three answers that have nothing to do with SNMP.
   */
  test("everything that is not an SNMP setting is left exactly as it was", async () => {
    await renderPage();

    const cleared: Record<string, unknown> = valuesAfterTurningSnmpOff({
      name: "Router Discovery - Region 1100",
      cidr: "10.16-22.0-255.51-66",
      probe: "22222222-2222-4222-8222-222222222222",
      isRecurring: true,
      rescanIntervalInMinutes: 60,
      ...TYPED_IN_CREDENTIALS,
    });

    expect(cleared["name"]).toBe("Router Discovery - Region 1100");
    expect(cleared["cidr"]).toBe("10.16-22.0-255.51-66");
    expect(cleared["probe"]).toBe("22222222-2222-4222-8222-222222222222");
    expect(cleared["isRecurring"]).toBe(true);
    expect(cleared["rescanIntervalInMinutes"]).toBe(60);
  });

  /*
   * A NEW object, never the caller's. Mutating the values in place and handing
   * the same reference back is the classic React state bug: the object is
   * reference-equal to the one already in state, so nothing re-renders and the
   * credential boxes keep showing what was supposedly cleared.
   */
  test("the operator's values are rewritten into a new object, not mutated", async () => {
    await renderPage();

    const typed: Record<string, unknown> = { ...TYPED_IN_CREDENTIALS };
    const cleared: Record<string, unknown> = valuesAfterTurningSnmpOff(typed);

    expect(cleared).not.toBe(typed);
    expect(typed["snmpV3PrivKey"]).toBe("priv-passphrase");
    expect(typed["snmpCommunityString"]).toBe("public");
  });

  /*
   * A form where nothing was typed yet still has to come out cleared, and what
   * that buys is FORM state, not wire state. setFieldValue spreads from the
   * object handed back here, so a key this object does not carry leaves
   * whatever the form already held in place — including a value typed on an
   * earlier visit to the step, since the toggle sits BEFORE these fields and
   * they are reachable again the moment SNMP goes back on.
   *
   * On the wire it buys nothing: the values written are `undefined`, and
   * JSON.stringify drops undefined properties, so the create request carries
   * no SNMP keys at all. What stops the column defaults filling them back in
   * is the server hook nulling them, which is asserted in
   * Tests/Server/Services/NetworkDeviceDiscoveryScanService.test.ts.
   */
  test("a form with nothing typed in it still comes out with the SNMP keys cleared", async () => {
    await renderPage();

    const cleared: Record<string, unknown> = valuesAfterTurningSnmpOff({});

    for (const key of SNMP_FIELD_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(cleared, key)).toBe(true);
    }

    expect(cleared["snmpCommunityString"]).toBeUndefined();
    expect(cleared["snmpVersion"]).toBe("V2c");
  });

  /*
   * Turning it back ON must rewrite nothing. Re-applying a default here would
   * stamp over credentials the operator had already typed on a previous visit
   * to the step — and the toggle is on the step BEFORE those fields, so they
   * are reachable again immediately.
   */
  test("turning SNMP back on rewrites nothing at all", async () => {
    await renderPage();

    expect(
      toggleScanMethodTo(true, { ...TYPED_IN_CREDENTIALS }),
    ).not.toHaveBeenCalled();
  });
});

/*
 * The size of the sweep, said out loud before it is queued (issue #3445's
 * sibling complaint: an ICMP-only scan is the one people run over big ranges).
 *
 * The most surprising thing about octet-range notation is how much of it there
 * is — 10.16-22.0-255.51-66 is 28,672 addresses — and nothing on the form said
 * so until the sweep had already been handed to a probe.
 */
describe("Scan Target says how big the sweep is while it is being typed", () => {
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

  /*
   * 254 rather than 256: the parser drops the network and broadcast addresses
   * of any block bigger than a /31, exactly as the probe's expansion does, so
   * the number on the form is the number of addresses that will actually be
   * pinged.
   */
  test("a CIDR target renders its address count", async () => {
    await renderPage();

    expect(renderTargetSizeHint("192.168.1.0/24")).toBe(
      "This target sweeps 254 addresses.",
    );
  });

  test("an octet range renders the much larger count it expands to, with thousands separators", async () => {
    await renderPage();

    expect(renderTargetSizeHint("10.16-22.0-255.51-66")).toBe(
      "This target sweeps 28,672 addresses.",
    );
  });

  /*
   * "1 addresses" is the kind of detail that makes a product feel unfinished,
   * and a single-address target is a completely ordinary thing to type while
   * checking one host.
   */
  test("a single-address target says 1 address, not 1 addresses", async () => {
    await renderPage();

    expect(renderTargetSizeHint("10.0.0.5")).toBe(
      "This target sweeps 1 address.",
    );
  });

  /*
   * The hint is gated on the COUNT, not on validity — which is what makes it
   * useful in the one case where the size IS the problem. A target over the
   * ceiling states its size right next to the error explaining why that size
   * is refused, and the two have to be the SAME number: the hint counts with
   * ScanTargetUtil.countHosts while the refusal counts inside
   * getValidationError's own parse, so nothing but these literals stops a form
   * from reading "sweeps 16,777,216 addresses" above "expands to 16,777,214
   * addresses, exceeding the 32,768-address scan limit".
   */
  test("a target over the address ceiling states its size, and the refusal quotes the same number", async () => {
    await renderPage();

    expect(renderTargetSizeHint("10.0.0.0/8")).toBe(
      "This target sweeps 16,777,214 addresses.",
    );

    expect(ScanTargetUtil.getValidationError("10.0.0.0/8")).toContain(
      "expands to 16,777,214 addresses, exceeding the 32,768-address scan limit",
    );
  });

  test("a target exactly at the ceiling states the ceiling", async () => {
    await renderPage();

    const atLimit: string = "10.0.0-127.0-255";

    expect(ScanTargetUtil.countHosts(atLimit)).toBe(
      ScanTargetUtil.MAX_SCAN_HOSTS,
    );
    expect(renderTargetSizeHint(atLimit)).toBe(
      "This target sweeps 32,768 addresses.",
    );
  });

  /*
   * countHosts returns 0 for anything it cannot parse, and a half-typed target
   * is unparseable for most of the time it is being typed. Saying nothing is
   * what keeps the hint from talking over the inline validation message.
   */
  test.each([
    ["an empty box", ""],
    ["a blank box", "   "],
    ["an untouched box", undefined],
    ["a cleared box", null],
    ["free text", "not-a-target"],
    ["a half-typed target", "10.0.0."],
    ["a bad prefix", "192.168.1.0/99"],
    ["a reversed range", "10.22-16.0.1"],
    ["an out-of-range octet", "10.0.0.256"],
    /*
     * Over the parser's length cap — and deliberately just another unparseable
     * input here rather than a test OF that cap. The grammar caps a
     * well-formed target at 31 characters
     * ("255-255.255-255.255-255.255-255"), so nothing longer than
     * MAX_TARGET_LENGTH can be well-formed and no assertion about this hint
     * can tell the length gate apart from the syntax rules. The gate is pinned
     * where it is observable — by the message text, in "a target past the
     * parser's length cap is refused on this step" — and its effect on this
     * hint is pinned from below: lower the cap under 20 and the octet-range
     * count above stops rendering.
     */
    [
      "a target longer than the parser will look at",
      "1".repeat(ScanTargetUtil.MAX_TARGET_LENGTH + 1),
    ],
  ])("%s renders nothing", async (_label: string, target: unknown) => {
    await renderPage();

    expect(renderTargetSizeHint(target)).toBeUndefined();
  });

  // The box is trimmed before it is counted, same as it is before it is validated.
  test("surrounding whitespace does not stop the count", async () => {
    await renderPage();

    expect(renderTargetSizeHint("  192.168.1.0/24  ")).toBe(
      "This target sweeps 254 addresses.",
    );
  });
});
