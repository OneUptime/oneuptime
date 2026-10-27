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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  placement?: string | undefined;
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
  // The page hears how many rules the table read (the how-it-works card).
  onFetchSuccess?:
    | ((data: Array<unknown>, totalCount: number) => void)
    | undefined;
  noItemsMessage?: unknown;
  emptyState?:
    | {
        title?: string | undefined;
        description?: unknown;
        actions?:
          | Array<{
              title: string;
              dataTestId?: string | undefined;
              onClick: () => void;
            }>
          | undefined;
      }
    | undefined;
  createInitialValues?: Record<string, unknown>;
  helpContent?:
    | {
        title?: string | undefined;
        description?: string | undefined;
        markdown?: string | undefined;
      }
    | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      // A marker, so tests can check what the page renders around it.
      return React.createElement("div", {
        "data-testid": "detection-rules-table",
      });
    },
  };
});

import DetectionRulesPage, {
  DETECTION_RULE_TUNING_MENU_GROUP,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/DetectionRules";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../Models/DatabaseModels/Project";
import Reseller from "../../../Models/DatabaseModels/Reseller";
import ProjectUtil from "../../../UI/Utils/Project";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import DetectionRulesGuide from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/DetectionRulesGuide";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { isFormFieldValueSet } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { guideToMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsGuide";
import SecurityCaseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import { RETROHUNT_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntCopy";
import { RULE_EXCEPTIONS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionsCopy";
import { getRuleExceptionsFilterParams } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionsRoute";
import DetectionRuleException from "../../../Models/DatabaseModels/DetectionRuleException";
import IconProp from "../../../Types/Icon/IconProp";
import { DetectionRuleExceptionKind } from "../../../Types/SecurityEvent/DetectionRuleException";
import { parseDetectionRetrohuntResult } from "../../../Types/SecurityEvent/DetectionRetrohunt";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

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
    // The count under each rule's name reads the exceptions: none, unless a test says so.
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 0,
    } as never);
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

    /*
     * How matches are counted is folded under More fields on the On Match
     * step now: a new rule starts at the defaults the guide documents.
     */
    test("both new fields sit under More fields on the On Match step, beside Group By Field", () => {
      renderPage();

      for (const title of [
        "Evaluation Interval (Minutes)",
        "Group By Field",
        "Distinct Count Field",
        "Match Count Threshold",
      ]) {
        const field: CapturedFormField = fieldTitled(title);

        expect({ title, stepId: field.stepId }).toEqual({
          title,
          stepId: "on-match",
        });
        expect(
          (field as unknown as { collapsibleSection?: { id: string } })
            .collapsibleSection?.id,
        ).toBe("advanced");
      }
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

  describe("how detection rules work", () => {
    /*
     * The page used to explain itself only behind the table header's
     * small help (?) icon. It now leads with a visible card, and the
     * help modal shows the same guide — one source, so the two cannot
     * disagree.
     */
    test("the how-it-works card is shown above the rules table", () => {
      renderPage();

      const card: HTMLElement = screen.getByTestId(
        `how-it-works-${DetectionRulesGuide.id}`,
      );
      const table: HTMLElement = screen.getByTestId("detection-rules-table");

      expect(card).toHaveTextContent(DetectionRulesGuide.title);
      expect(
        card.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    test("the table's help (?) modal shows the same guide as the card", () => {
      renderPage();

      expect(capturedTableProps?.helpContent).toEqual({
        title: DetectionRulesGuide.guideTitle,
        description: DetectionRulesGuide.guideDescription,
        markdown: guideToMarkdown(DetectionRulesGuide),
      });
    });

    test("the help no longer tells customers to prefix attribute keys", () => {
      /*
       * The old help listed `attributes.<key>` as a field name, but the
       * compiler looks attribute keys up exactly as written — the prefix
       * made a rule silently match nothing.
       */
      renderPage();

      expect(capturedTableProps?.helpContent?.markdown).not.toContain(
        "`attributes.<key>`",
      );
    });

    test("a reseller plan without telemetry sees neither the card nor the table", () => {
      const project: Project = new Project();
      project.id = PROJECT_ID;
      const reseller: Reseller = new Reseller();
      reseller.enableTelemetryFeatures = false;
      project.reseller = reseller;

      render(
        <MemoryRouter>
          <DetectionRulesPage
            pageRoute={new Route("/dashboard/security-events/detection-rules")}
            currentProject={project}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );

      expect(
        screen.queryByTestId(`how-it-works-${DetectionRulesGuide.id}`),
      ).not.toBeInTheDocument();
      expect(capturedTableProps).toBeNull();
      expect(
        screen.getByText(/did not include telemetry features/),
      ).toBeInTheDocument();
    });
  });

  describe("the form asks for the rule, then what a match does", () => {
    type CapturedStep = { id: string; title: string };

    function steps(): Array<CapturedStep> {
      return (
        (capturedTableProps as unknown as { formSteps?: Array<CapturedStep> })
          ?.formSteps || []
      );
    }

    function fieldByColumn(column: string): CapturedFormField {
      const field: CapturedFormField | undefined = (
        capturedTableProps?.formFields || []
      ).find((formField: CapturedFormField): boolean => {
        return Object.keys(formField.field || {})[0] === column;
      });

      expect(field).toBeDefined();

      return field!;
    }

    type ChoiceField = CapturedFormField & {
      overrideFieldKey?: string | undefined;
      formOnly?: boolean | undefined;
      radioButtonOptions?: Array<{ value: string; title: string }>;
      getDefaultValue?: (values: Record<string, unknown>) => string;
      onChange?: (
        value: unknown,
        values: Record<string, unknown>,
        set: (values: Record<string, unknown>) => void,
      ) => void;
    };

    function raisesChoice(): ChoiceField {
      const field: CapturedFormField | undefined = (
        capturedTableProps?.formFields || []
      ).find((formField: CapturedFormField): boolean => {
        return (
          (formField as ChoiceField).overrideFieldKey === "securityMatchRaises"
        );
      });

      expect(field).toBeDefined();

      return field as ChoiceField;
    }

    test("two steps: the Sigma rule, then On Match", () => {
      renderPage();

      expect(
        steps().map((step: CapturedStep) => {
          return [step.id, step.title];
        }),
      ).toEqual([
        ["sigma-rule", "Sigma Rule"],
        ["on-match", "On Match"],
      ]);
    });

    test("the rule is named after its Sigma rule's title until a name of one's own is typed", () => {
      renderPage();

      const yaml: ChoiceField = fieldTitled("Sigma Rule (YAML)") as ChoiceField;
      const named: Array<Record<string, unknown>> = [];
      const set: (values: Record<string, unknown>) => void = (
        values: Record<string, unknown>,
      ): void => {
        named.push(values);
      };

      yaml.onChange!(
        "title: Failed logon burst\nlogsource:\n  category: authentication",
        { name: "", sigmaRuleYaml: "" },
        set,
      );
      // The name the last title gave follows the next one.
      yaml.onChange!(
        "title: 'Password spraying'\ndetection: {}",
        {
          name: "Failed logon burst",
          sigmaRuleYaml: "title: Failed logon burst",
        },
        set,
      );
      // A name of one's own stays.
      yaml.onChange!(
        "title: Something else",
        { name: "My rule", sigmaRuleYaml: "title: Password spraying" },
        set,
      );

      expect(
        named.map((values: Record<string, unknown>) => {
          return values["name"];
        }),
      ).toEqual(["Failed logon burst", "Password spraying"]);
    });

    test("a new rule runs: Enabled is the Edit form's", () => {
      renderPage();

      const enabled: CapturedFormField = fieldByColumn("isEnabled");

      expect(
        (enabled as unknown as { doNotShowWhenCreating?: boolean })
          .doNotShowWhenCreating,
      ).toBe(true);
      expect(capturedTableProps?.createInitialValues).toMatchObject({
        isEnabled: true,
      });
    });

    test("what a match raises is one choice, the default first, written to both columns", () => {
      renderPage();

      const choice: ChoiceField = raisesChoice();

      expect(choice.formOnly).toBe(true);
      expect(choice.stepId).toBe("on-match");
      expect(
        (choice.radioButtonOptions || []).map(
          (option: { value: string; title: string }) => {
            return option.title;
          },
        ),
      ).toEqual(["Create an alert", "Declare an incident", "Both", "Neither"]);

      // A new rule starts where its columns' defaults start: an alert.
      expect(
        choice.getDefaultValue!(capturedTableProps?.createInitialValues || {}),
      ).toBe("alert");
      // A Rule Library rule (no alert, no incident) reads as Neither.
      expect(
        choice.getDefaultValue!({
          shouldCreateAlert: false,
          shouldCreateIncident: false,
        }),
      ).toBe("neither");

      const written: Array<Record<string, unknown>> = [];

      for (const answer of ["incident", "both", "neither", "alert"]) {
        choice.onChange!(
          answer,
          { name: "Rule" },
          (values: Record<string, unknown>) => {
            written.push(values);
          },
        );
      }

      expect(written).toEqual([
        { name: "Rule", shouldCreateAlert: false, shouldCreateIncident: true },
        { name: "Rule", shouldCreateAlert: true, shouldCreateIncident: true },
        { name: "Rule", shouldCreateAlert: false, shouldCreateIncident: false },
        { name: "Rule", shouldCreateAlert: true, shouldCreateIncident: false },
      ]);
    });

    test("the two columns behind the choice are loaded and saved, never shown", () => {
      renderPage();

      for (const column of ["shouldCreateAlert", "shouldCreateIncident"]) {
        const field: CapturedFormField = fieldByColumn(column);

        expect(field.showIf).toBeDefined();
        expect(field.showIf!({})).toBe(false);
        expect(field.stepId).toBe("on-match");
      }
    });

    /*
     * A new rule starts at 5 minutes, not the column's 1: the folded More
     * fields compared with the column and showed "Evaluation Interval
     * (Minutes): 5" as set on every new rule.
     */
    test("More fields does not call a new rule's evaluation interval set, until it is changed", () => {
      renderPage();

      const values: FormValues<DetectionRule> =
        (capturedTableProps?.createInitialValues ||
          {}) as FormValues<DetectionRule>;
      const interval: Field<DetectionRule> = {
        ...(fieldByColumn(
          "evaluationIntervalInMinutes",
        ) as unknown as Field<DetectionRule>),
        // What ModelForm hands a field that names no default of its own.
        columnDefaultValue: 1,
      };

      expect(
        (values as unknown as Record<string, unknown>)[
          "evaluationIntervalInMinutes"
        ],
      ).toBe(5);
      expect(isFormFieldValueSet(interval, values)).toBe(false);
      expect(
        isFormFieldValueSet(interval, {
          ...values,
          evaluationIntervalInMinutes: 15,
        } as FormValues<DetectionRule>),
      ).toBe(true);
    });

    test("a severity's line says what an empty pick does, and not again that it is optional", () => {
      renderPage();

      const descriptionOf: (column: string) => string = (
        column: string,
      ): string => {
        return (
          (fieldByColumn(column) as unknown as { description?: string })
            .description || ""
        );
      };

      expect(descriptionOf("alertSeverity")).toBe(
        "Left empty, the Sigma rule's level picks one of this project's alert severities.",
      );
      expect(descriptionOf("incidentSeverity")).toBe(
        "Left empty, the Sigma rule's level picks one of this project's incident severities.",
      );
      expect(descriptionOf("groupByField")).toBe(
        "Matches that share this field's value become one finding, such as one alert per host.",
      );

      for (const column of [
        "alertSeverity",
        "incidentSeverity",
        "groupByField",
      ]) {
        expect(descriptionOf(column).startsWith("Optional")).toBe(false);
      }
    });

    test("the case is asked on the same step, and the finding waits under More fields", () => {
      renderPage();

      expect(fieldByColumn("shouldCreateCase").stepId).toBe("on-match");

      const finding: CapturedFormField = fieldByColumn(
        "shouldWriteDetectionFinding",
      );

      expect(finding.stepId).toBe("on-match");
      expect(
        (finding as unknown as { collapsibleSection?: { id: string } })
          .collapsibleSection?.id,
      ).toBe("advanced");
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

  describe("Draft with AI, under the Sigma rule", () => {
    type FooterField = {
      getFooterElement?: (
        values: Record<string, unknown>,
        error?: string,
        footer?: { setValue: (value: unknown) => void },
      ) => React.ReactElement | undefined;
    };

    function drawFooter(
      values: Record<string, unknown>,
    ): ReturnType<typeof jest.fn> {
      renderPage();

      const field: FooterField = fieldTitled(
        "Sigma Rule (YAML)",
      ) as unknown as FooterField;
      const setValue: ReturnType<typeof jest.fn> = jest.fn();

      expect(field.getFooterElement).toBeDefined();
      render(
        field.getFooterElement!(values, undefined, {
          setValue: setValue as unknown as (value: unknown) => void,
        })!,
      );

      return setValue;
    }

    test("an empty rule is offered a draft; a written one a redraft", () => {
      jest
        .spyOn(ProjectUtil, "getCurrentProject")
        .mockReturnValue({ enableAi: true } as never);

      drawFooter({ sigmaRuleYaml: "" });
      expect(
        screen.getByTestId("detection-rule-ai-draft-open"),
      ).toHaveTextContent("Draft with AI");
      cleanup();

      drawFooter({ sigmaRuleYaml: "   " });
      expect(
        screen.getByTestId("detection-rule-ai-draft-open"),
      ).toHaveTextContent("Draft with AI");
      cleanup();

      drawFooter({ sigmaRuleYaml: "title: Something\n" });
      expect(
        screen.getByTestId("detection-rule-ai-draft-open"),
      ).toHaveTextContent("Redraft with AI");
    });

    test("the drafted rule is set as the field's own value, so the rule is named after it", async () => {
      jest
        .spyOn(ProjectUtil, "getCurrentProject")
        .mockReturnValue({ enableAi: true } as never);
      jest
        .spyOn(SecurityCaseApi, "draftDetectionRule")
        .mockResolvedValue({ sigmaRuleYaml: "title: Drafted\n", title: "" });

      const setValue: ReturnType<typeof jest.fn> = drawFooter({
        sigmaRuleYaml: "",
      });

      fireEvent.click(screen.getByTestId("detection-rule-ai-draft-open"));
      fireEvent.change(
        screen.getByTestId("detection-rule-ai-draft-description"),
        { target: { value: "SSH sign-ins from outside the office" } },
      );
      fireEvent.click(screen.getByTestId("detection-rule-ai-draft-submit"));

      await waitFor(() => {
        expect(setValue).toHaveBeenCalledWith("title: Drafted\n");
      });
    });

    test("with the project's AI off the field has no Draft with AI", () => {
      jest
        .spyOn(ProjectUtil, "getCurrentProject")
        .mockReturnValue({ enableAi: false } as never);

      drawFooter({ sigmaRuleYaml: "" });

      expect(screen.queryByTestId("detection-rule-ai-draft-open")).toBeNull();
    });
  });

  describe("Create Monitor row action", () => {
    /*
     * Found by its title: a rule whose last run left a message leads its
     * row with View Error (SecurityEventsDetectionStatusTables).
     */
    const createMonitorButton: () => CapturedActionButton | undefined = ():
      | CapturedActionButton
      | undefined => {
      return capturedTableProps?.actionButtons?.find(
        (actionButton: CapturedActionButton): boolean => {
          return actionButton.title === "Create Monitor";
        },
      );
    };

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

      const button: CapturedActionButton | undefined = createMonitorButton();

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

      const button: CapturedActionButton | undefined = createMonitorButton();

      expect(button?.disabled).toBe(true);
      expect(button?.tooltip).toBe("You need the Create Monitor permission.");
    });

    /*
     * In the row's menu: a monitor on a rule's findings is set up once.
     * As the row's one button it took the place of Edit, what a rule's row
     * is for, and the width Last Match needed at 1280.
     */
    test("waits in the row's menu, so Edit is the row's button", () => {
      renderPage();

      expect(createMonitorButton()?.placement).toBe("MoreMenu");
    });
  });

  describe("an empty list, and the card above a busy one", () => {
    function rulesRead(count: number): void {
      act(() => {
        capturedTableProps!.onFetchSuccess!([], count);
      });
    }

    function isCardShown(): boolean {
      return (
        screen
          .getByTestId("how-it-works-toggle")
          .getAttribute("aria-expanded") === "true"
      );
    }

    beforeEach(() => {
      window.localStorage.clear();
    });

    test("the card waits folded while the rules are read, and opens only for a project with none", () => {
      renderPage();
      expect(isCardShown()).toBe(false);

      rulesRead(0);
      expect(isCardShown()).toBe(true);
      cleanup();

      renderPage();
      rulesRead(9);
      expect(isCardShown()).toBe(false);
      // A search that empties the table later does not open it.
      rulesRead(0);
      expect(isCardShown()).toBe(false);
    });

    test("an empty list says no rules yet, and leads to the Rule Library", () => {
      const navigateSpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(Navigation, "navigate")
        .mockImplementation(() => {
          return undefined;
        });

      renderPage();

      // Its own words, not the old "No detection rules found."
      expect(capturedTableProps?.noItemsMessage).toBeUndefined();
      expect(capturedTableProps?.emptyState?.title).toBe(
        "No detection rules yet",
      );
      expect(capturedTableProps?.emptyState?.description).toBe(
        "Add ready-made rules from the Rule Library in a click, or write a Sigma rule of your own.",
      );

      const actions: Array<{
        title: string;
        dataTestId?: string | undefined;
        onClick: () => void;
      }> = capturedTableProps?.emptyState?.actions || [];

      expect(
        actions.map((action: { title: string }): string => {
          return action.title;
        }),
      ).toEqual(["Open the Rule Library"]);

      actions[0]!.onClick();

      expect(navigateSpy).toHaveBeenCalledTimes(1);
      expect(String(navigateSpy.mock.calls[0]?.[0])).toContain(
        "/security-events/rule-library",
      );
    });
  });

  /*
   * Tuning a rule, from its row and its form: Run on Past Events (what it
   * would have found), Add Exception (what it skips, with why) and View
   * Exceptions (its exceptions on Rule Exceptions), in a run of their own
   * in the row's menu; the count of exceptions that skip something now
   * under its name; and Run on Past Events under the YAML as it is edited.
   */
  describe("tuning a rule", () => {
    const TUNING: Array<string> = [
      "Run on Past Events",
      "Add Exception",
      "View Exceptions",
    ];

    type TuningButton = CapturedActionButton & {
      icon?: string | undefined;
      menuGroup?: string | undefined;
    };

    type ElementColumn = {
      title: string;
      getElement?: (item: unknown) => React.ReactElement;
    };

    function tuningButton(title: string): TuningButton {
      const button: CapturedActionButton | undefined =
        capturedTableProps?.actionButtons?.find(
          (actionButton: CapturedActionButton): boolean => {
            return actionButton.title === title;
          },
        );

      expect(button).toBeDefined();

      return button as TuningButton;
    }

    function click(title: string, item: Record<string, unknown>): void {
      act(() => {
        tuningButton(title).onClick(
          item,
          () => {
            // completed
          },
          () => {
            // no-op
          },
        );
      });
    }

    function nameColumn(): ElementColumn {
      const column: ElementColumn | undefined = (
        capturedTableProps as unknown as { columns: Array<ElementColumn> }
      ).columns.find((candidate: ElementColumn): boolean => {
        return candidate.title === "Name";
      });

      expect(column?.getElement).toBeDefined();

      return column!;
    }

    function ruleNamed(name: string): DetectionRule {
      const rule: DetectionRule = new DetectionRule();
      rule._id = String(RULE["_id"]);
      rule.name = name;
      return rule;
    }

    const RULE: Record<string, unknown> = {
      _id: "22222222-2222-4222-8222-222222222222",
      name: "Failed logon burst",
    };

    test("the three wait in the row's menu, in a run of their own after the row's state and before Create Monitor", () => {
      renderPage();

      const titles: Array<string> = (
        capturedTableProps?.actionButtons || []
      ).map((button: CapturedActionButton): string => {
        return button.title;
      });

      const first: number = titles.indexOf(TUNING[0]!);

      expect(titles.slice(first, first + 3)).toEqual(TUNING);
      expect(titles.indexOf("Create Monitor")).toBe(first + 3);

      for (const title of TUNING) {
        expect([title, tuningButton(title).placement]).toEqual([
          title,
          "MoreMenu",
        ]);
        expect([title, tuningButton(title).menuGroup]).toEqual([
          title,
          DETECTION_RULE_TUNING_MENU_GROUP,
        ]);
      }

      expect(tuningButton("Run on Past Events").icon).toBe(IconProp.Backward);
      expect(tuningButton("Add Exception").icon).toBe(IconProp.EyeSlash);
      expect(tuningButton("View Exceptions").icon).toBe(IconProp.List);
    });

    test("Run on Past Events opens the rule's run, by its id, named", async () => {
      const run: ReturnType<typeof jest.spyOn> = jest
        .spyOn(SecurityCaseApi, "runDetectionRuleRetrohunt")
        .mockResolvedValue(
          parseDetectionRetrohuntResult({ firedCount: 0 }) as never,
        );

      renderPage();
      click("Run on Past Events", RULE);

      const dialog: HTMLElement = await screen.findByRole("dialog");

      expect(dialog).toHaveTextContent("Run on Past Events");
      expect(dialog).toHaveTextContent("Failed logon burst");

      await waitFor(() => {
        expect(run).toHaveBeenCalledWith({
          periodInHours: 168,
          detectionRuleId: RULE["_id"],
        });
      });
    });

    test("View Exceptions opens Rule Exceptions filtered to the rule", () => {
      const navigateSpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(Navigation, "navigate")
        .mockImplementation(() => {
          return undefined;
        });

      renderPage();
      click("View Exceptions", RULE);

      const destination: string = String(navigateSpy.mock.calls[0]?.[0]);
      const params: Record<string, string> = getRuleExceptionsFilterParams(
        String(RULE["_id"]),
      );

      expect(destination).toContain("/security-events/rule-exceptions?");
      expect(destination).toContain(
        `${Object.keys(params)[0]!}=${Object.values(params)[0]!}`,
      );
    });

    test("Add Exception is open to whoever may add exceptions", () => {
      renderPage();

      expect(tuningButton("Add Exception").disabled).toBe(false);
      expect(tuningButton("Add Exception").tooltip).toBeUndefined();
    });

    test("Add Exception is locked, with the gate's reason, for whoever may not", () => {
      jest
        .spyOn(PermissionGate, "check")
        .mockImplementation((model: unknown): PermissionGateResult => {
          return model instanceof DetectionRuleException
            ? {
                isAllowed: false,
                disabledReason:
                  "You need the Edit Detection Rule permission to add exceptions.",
              }
            : { isAllowed: true };
        });

      renderPage();

      expect(tuningButton("Add Exception").disabled).toBe(true);
      expect(tuningButton("Add Exception").tooltip).toBe(
        "You need the Edit Detection Rule permission to add exceptions.",
      );
      // Monitors are another gate's.
      expect(
        capturedTableProps?.actionButtons?.find(
          (button: CapturedActionButton): boolean => {
            return button.title === "Create Monitor";
          },
        )?.disabled,
      ).toBe(false);
    });

    test("Add Exception opens the exception form for the rule", async () => {
      jest.spyOn(ModelAPI, "getList").mockResolvedValue({
        data: [],
        count: 0,
        skip: 0,
        limit: 0,
      } as never);

      renderPage();
      click("Add Exception", RULE);

      const dialog: HTMLElement = await screen.findByRole("dialog");

      expect(dialog).toHaveTextContent("Add Exception");
      // The shared form's two steps: what to skip, then why.
      expect(dialog).toHaveTextContent("What to Skip");
      expect(dialog).toHaveTextContent("Why");
    });

    test("a rule's name has the count of its exceptions that skip something now under it", async () => {
      const exception: DetectionRuleException = new DetectionRuleException();
      exception._id = "33333333-3333-4333-8333-333333333333";
      exception.detectionRuleId = new ObjectID(String(RULE["_id"]));
      exception.kind = DetectionRuleExceptionKind.Entity;

      const second: DetectionRuleException = new DetectionRuleException();
      second._id = "33333333-3333-4333-8333-333333333334";
      second.detectionRuleId = new ObjectID(String(RULE["_id"]));
      second.kind = DetectionRuleExceptionKind.Value;

      const getList: ReturnType<typeof jest.spyOn> = jest
        .spyOn(ModelAPI, "getList")
        .mockResolvedValue({
          data: [exception, second],
          count: 2,
          skip: 0,
          limit: 2,
        } as never);

      renderPage();

      await waitFor(() => {
        expect(getList).toHaveBeenCalled();
      });

      const query: Record<string, unknown> = (
        getList.mock.calls[0]?.[0] as { query: Record<string, unknown> }
      ).query;

      expect(query["projectId"]).toBe(PROJECT_ID);

      // The count arrives after the list's first draw: the page draws again.
      await act(async () => {
        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 0);
        });
      });

      const cell: ReturnType<typeof render> = render(
        nameColumn().getElement!(ruleNamed("Failed logon burst")),
      );

      expect(
        within(cell.container).getByTestId(RULE_EXCEPTIONS_TEST_IDS.ruleCount),
      ).toHaveTextContent("2 active exceptions");
    });

    test("a rule with none has no line under its name", () => {
      renderPage();

      render(nameColumn().getElement!(ruleNamed("Failed logon burst")));

      expect(screen.getByText("Failed logon burst")).toBeInTheDocument();
      expect(
        screen.queryByTestId(RULE_EXCEPTIONS_TEST_IDS.ruleCount),
      ).toBeNull();
    });

    test("Run on Past Events waits under the YAML, beside Draft with AI, for the rule as it stands", async () => {
      const run: ReturnType<typeof jest.spyOn> = jest
        .spyOn(SecurityCaseApi, "runDetectionRuleRetrohunt")
        .mockResolvedValue(
          parseDetectionRetrohuntResult({ firedCount: 0 }) as never,
        );

      renderPage();

      type FooterField = {
        getFooterElement?: (
          values: Record<string, unknown>,
          error?: string,
          footer?: { setValue: (value: unknown) => void },
        ) => React.ReactElement | undefined;
      };

      const field: FooterField = fieldTitled(
        "Sigma Rule (YAML)",
      ) as unknown as FooterField;

      render(
        field.getFooterElement!(
          {
            _id: String(RULE["_id"]),
            sigmaRuleYaml: "title: Edited\n",
            groupByField: "principalIp",
            matchCountThreshold: 5,
            evaluationIntervalInMinutes: 10,
          },
          undefined,
          {
            setValue: () => {
              // not drafted here
            },
          },
        )!,
      );

      fireEvent.click(screen.getByTestId(RETROHUNT_TEST_IDS.open));

      await waitFor(() => {
        expect(run).toHaveBeenCalledWith({
          periodInHours: 168,
          detectionRuleId: RULE["_id"],
          sigmaRuleYaml: "title: Edited\n",
          groupByField: "principalIp",
          distinctCountField: "",
          matchCountThreshold: 5,
          evaluationIntervalInMinutes: 10,
        });
      });
    });
  });
});
