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

type CapturedTableProps = {
  formFields?: Array<CapturedFormField>;
  formSteps?: Array<CapturedFormStep>;
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
import ScanTargetUtil from "../../../Utils/NetworkDiscovery/ScanTargetUtil";
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
