import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The Detection Rules page is one big ModelTable call, and everything this
 * change added to it — the incident toggle, the two severity dropdowns
 * with their showIf chains, the DB-default-mirroring initial values, and
 * the "Create Monitor" row action — is configuration passed as props.
 * Dropping any of it is type-safe and render-safe, so the props are the
 * only place it can be pinned. The table itself is mocked to capture them;
 * the showIf and onClick functions are then exercised directly.
 */

type CapturedFormField = {
  field: Record<string, boolean>;
  title: string;
  fieldType?: unknown;
  stepId?: string | undefined;
  required?: boolean | undefined;
  validation?: { minValue?: number | undefined } | undefined;
  showIf?: ((model: Record<string, unknown>) => boolean) | undefined;
  dropdownModal?: { type: unknown } | undefined;
};

type CapturedActionButton = {
  title: string;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
  onClick: (
    item: Record<string, unknown>,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => void;
};

type CapturedTableProps = {
  formFields?: Array<CapturedFormField>;
  actionButtons?: Array<CapturedActionButton>;
  createInitialValues?: Record<string, unknown>;
  helpContent?: { markdown?: string | undefined } | undefined;
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

import DetectionRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/DetectionRules";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectUtil from "../../../UI/Utils/Project";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function fieldTitled(title: string): CapturedFormField {
  const field: CapturedFormField | undefined =
    capturedTableProps?.formFields?.find(
      (formField: CapturedFormField): boolean => {
        return formField.title === title;
      },
    );

  expect(field).toBeDefined();

  return field!;
}

function renderPage(): void {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <DetectionRulesPage
        pageRoute={new Route("/dashboard/security-events/detection-rules")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  expect(capturedTableProps).not.toBeNull();
}

function gateMonitorCreate(result: PermissionGateResult): void {
  jest.spyOn(PermissionGate, "check").mockReturnValue(result);
}

describe("Detection Rules page", () => {
  beforeEach(() => {
    capturedTableProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    gateMonitorCreate({ isAllowed: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("incident opt-in fields", () => {
    test("the incident toggle exists on the evaluation step", () => {
      renderPage();
      fieldTitled("Create Incident on Match");
    });

    test("the incident severity dropdown shows only when the toggle is on", () => {
      renderPage();
      const severityField: CapturedFormField = fieldTitled("Incident Severity");

      expect(severityField.showIf).toBeDefined();
      expect(severityField.showIf!({ shouldCreateIncident: true })).toBe(true);
      expect(severityField.showIf!({ shouldCreateIncident: false })).toBe(
        false,
      );
      // undefined must read as off — the column defaults to false.
      expect(severityField.showIf!({})).toBe(false);
    });

    test("the incident severity dropdown selects from IncidentSeverity, not AlertSeverity", () => {
      renderPage();
      const severityField: CapturedFormField = fieldTitled("Incident Severity");

      expect(severityField.dropdownModal?.type).toBe(IncidentSeverity);
      expect(severityField.field).toEqual({ incidentSeverity: true });
    });

    test("the alert severity dropdown chains on the alert toggle the same way", () => {
      renderPage();
      const severityField: CapturedFormField = fieldTitled("Alert Severity");

      expect(severityField.dropdownModal?.type).toBe(AlertSeverity);
      expect(severityField.showIf!({ shouldCreateAlert: true })).toBe(true);
      expect(severityField.showIf!({ shouldCreateAlert: false })).toBe(false);
    });

    test("initial values mirror the DB defaults, so the chained fields are honest on a fresh form", () => {
      /*
       * shouldCreateAlert defaults TRUE in the schema and
       * shouldCreateIncident FALSE. Without these initial values a fresh
       * create form shows the alert toggle apparently off (undefined)
       * with its severity dropdown hidden — while saving would create an
       * alerting rule.
       */
      renderPage();
      expect(capturedTableProps?.createInitialValues).toMatchObject({
        shouldCreateAlert: true,
        shouldWriteDetectionFinding: true,
        shouldCreateIncident: false,
      });
    });
  });

  describe("distinct count and match threshold fields", () => {
    /*
     * Issue #3398: a rule can now count unique values of one field
     * (distinctCountField) instead of raw matching events, and hold fire
     * until the count reaches matchCountThreshold. Both knobs are plain
     * form configuration on the evaluation step — dropping either one is
     * type-safe and render-safe, so the captured props are the only place
     * they can be pinned.
     */
    test("the Distinct Count Field is an optional text field", () => {
      renderPage();

      const field: CapturedFormField = fieldTitled("Distinct Count Field");

      expect(field.field).toEqual({ distinctCountField: true });
      expect(field.fieldType).toBe(FormFieldSchemaType.Text);
      expect(field.required).toBe(false);
    });

    test("the Match Count Threshold is a required number field that refuses values below 1", () => {
      renderPage();

      const field: CapturedFormField = fieldTitled("Match Count Threshold");

      expect(field.field).toEqual({ matchCountThreshold: true });
      expect(field.fieldType).toBe(FormFieldSchemaType.Number);
      expect(field.required).toBe(true);
      /*
       * The service rejects 0 and negatives with a BadDataException; the
       * form must stop them before submit.
       */
      expect(field.validation?.minValue).toBe(1);
    });

    test("both new fields sit on the evaluation step alongside Group By Field", () => {
      renderPage();

      expect(fieldTitled("Group By Field").stepId).toBe("evaluation");
      expect(fieldTitled("Distinct Count Field").stepId).toBe("evaluation");
      expect(fieldTitled("Match Count Threshold").stepId).toBe("evaluation");
    });

    test("a fresh create form seeds matchCountThreshold with the DB default of 1", () => {
      /*
       * matchCountThreshold is NOT NULL DEFAULT 1 in the schema and the
       * form field is required — without this initial value a fresh
       * create form would open with a required number field left blank.
       */
      renderPage();

      expect(capturedTableProps?.createInitialValues).toMatchObject({
        matchCountThreshold: 1,
      });
    });

    test("the help documentation explains both new controls", () => {
      renderPage();

      const markdown: string = capturedTableProps?.helpContent?.markdown || "";

      expect(markdown).toContain("Distinct Count Field");
      expect(markdown).toContain("Match Count Threshold");
    });
  });

  describe("the Sigma rule field is a YAML editor", () => {
    /*
     * The rule is YAML — SigmaRuleParser runs js-yaml over it and
     * DetectionRuleService rejects a create or update whose rule does not
     * compile. It was declared as Markdown, which put a rich-text toolbar
     * (Bold, H1) over a Sigma rule and, worse, routed the value through an
     * editor that round-trips through HTML. Indentation-sensitive YAML does
     * not survive that.
     */
    test("it is declared as YAML", () => {
      renderPage();

      expect(fieldTitled("Sigma Rule (YAML)").fieldType).toBe(
        FormFieldSchemaType.YAML,
      );
    });

    test("it is not the Markdown editor", () => {
      renderPage();

      expect(fieldTitled("Sigma Rule (YAML)").fieldType).not.toBe(
        FormFieldSchemaType.Markdown,
      );
    });

    test("it still binds to sigmaRuleYaml on its own form step", () => {
      renderPage();

      const field: CapturedFormField = fieldTitled("Sigma Rule (YAML)");

      expect(field.field).toEqual({ sigmaRuleYaml: true });
      expect((field as unknown as { stepId?: string | undefined }).stepId).toBe(
        "sigma-rule",
      );
      expect(
        (field as unknown as { required?: boolean | undefined }).required,
      ).toBe(true);
    });

    test("no other field on the page was switched to YAML by accident", () => {
      renderPage();

      const yamlFields: Array<CapturedFormField> = (
        capturedTableProps?.formFields || []
      ).filter((field: CapturedFormField): boolean => {
        return field.fieldType === FormFieldSchemaType.YAML;
      });

      expect(yamlFields).toHaveLength(1);
      expect(yamlFields[0]?.title).toBe("Sigma Rule (YAML)");
    });
  });

  describe("Create Monitor row action", () => {
    test("navigates to monitor create carrying the rule id", () => {
      renderPage();

      const navigateSpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(Navigation, "navigate")
        .mockImplementation(() => {
          return undefined;
        });

      const button: CapturedActionButton | undefined =
        capturedTableProps?.actionButtons?.find(
          (actionButton: CapturedActionButton): boolean => {
            return actionButton.title === "Create Monitor";
          },
        );

      expect(button).toBeDefined();

      let completed: boolean = false;

      button!.onClick(
        { _id: "22222222-2222-4222-8222-222222222222" },
        () => {
          completed = true;
        },
        () => {
          // no-op
        },
      );

      expect(navigateSpy).toHaveBeenCalledTimes(1);

      const destination: string = String(navigateSpy.mock.calls[0]?.[0]);

      expect(destination).toContain("/monitors/create");
      expect(destination).toContain(
        "detectionRuleId=22222222-2222-4222-8222-222222222222",
      );

      // A row button that never completes spins forever.
      expect(completed).toBe(true);
    });

    test("is enabled with the explainer tooltip when monitor create is allowed", () => {
      renderPage();

      const button: CapturedActionButton | undefined =
        capturedTableProps?.actionButtons?.[0];

      expect(button?.disabled).toBe(false);
      expect(button?.tooltip).toContain("Detection Findings");
    });

    test("is disabled with the gate's reason when monitor create is not allowed", () => {
      /*
       * Same contract as MonitorTable's create button (issue #3306): a
       * member who cannot create monitors must not be walked into the
       * wizard to be refused at submit — the button stays visible,
       * disabled, and says which permission is missing.
       */
      gateMonitorCreate({
        isAllowed: false,
        disabledReason: "You need the Create Monitor permission.",
      });

      renderPage();

      const button: CapturedActionButton | undefined =
        capturedTableProps?.actionButtons?.[0];

      expect(button?.disabled).toBe(true);
      expect(button?.tooltip).toBe("You need the Create Monitor permission.");
    });
  });
});
