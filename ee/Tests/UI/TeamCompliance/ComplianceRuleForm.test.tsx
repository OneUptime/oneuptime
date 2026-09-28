import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * The compliance rule form: which rule kinds it offers and in what order,
 * which options each kind shows, how switching kinds cleans up after itself,
 * what the live preview says, and how the modal wires create and edit.
 * ModelFormModal is replaced by a stub that records its props, so these
 * tests read the exact form configuration the Dashboard would render.
 */

type CapturedModalProps = {
  title?: string;
  description?: string;
  submitButtonText?: string;
  initialValues?: Record<string, unknown> | undefined;
  modelIdToEdit?: { toString: () => string } | undefined;
  onBeforeCreate?: (item: Record<string, unknown>) => Promise<unknown>;
  onSuccess?: (item: unknown) => void;
  onClose?: () => void;
  formProps?: {
    id?: string;
    formType?: unknown;
    fields?: Array<unknown>;
    steps?: Array<{ id: string; title: string }>;
  };
};

let capturedModalProps: CapturedModalProps | null = null;

jest.mock("Common/UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedModalProps): null => {
      capturedModalProps = props;
      return null;
    },
  };
});

import ComplianceRuleFormModal, {
  COMPLIANCE_RULE_FORM_STEPS,
  ComplianceRulePreview,
  RULE_FORM_STEP_RULE,
  RULE_FORM_STEP_SCOPE,
  getChannelDropdownOptions,
  getComplianceRuleFormFields,
  getCreateInitialValues,
  getRulePreviewText,
  getRuleTypeCardOptions,
  getValuesForRuleType,
  isSeverityFieldShown,
} from "../../../Dashboard/TeamCompliance/ComplianceRuleForm";
import { getRuleTypeIcon } from "../../../Dashboard/TeamCompliance/ComplianceView";
import {
  CRITICAL_ID,
  MAJOR_ID,
  PROJECT_ID,
  TEAM_ID,
} from "./ComplianceFixtures";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import ObjectID from "Common/Types/ObjectID";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import ComplianceRule, {
  COMPLIANCE_CHANNEL_DEFINITIONS,
  COMPLIANCE_RULE_DEFINITIONS,
  ComplianceChannelDefinition,
  ComplianceRuleCategory,
  ComplianceRuleDefinition,
  ComplianceSeverityKind,
} from "Common/Types/Team/ComplianceRule";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "Common/UI/Components/CardSelect/CardSelect";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

type Values = FormValues<TeamComplianceSetting>;

const ALL_RULE_TYPES: Array<ComplianceRuleType> =
  Object.values(ComplianceRuleType);

const fieldFor: (key: string) => ModelField<TeamComplianceSetting> = (
  key: string,
): ModelField<TeamComplianceSetting> => {
  const field: ModelField<TeamComplianceSetting> | undefined =
    getComplianceRuleFormFields().find(
      (candidate: ModelField<TeamComplianceSetting>): boolean => {
        return Object.keys(candidate.field || {})[0] === key;
      },
    );

  if (!field) {
    throw new Error(`No ${key} field`);
  }

  return field;
};

const valuesFor: (ruleType: string, extra?: Values) => Values = (
  ruleType: string,
  extra?: Values,
): Values => {
  return {
    ruleType: ruleType as ComplianceRuleType,
    ...(extra || {}),
  };
};

beforeEach(() => {
  capturedModalProps = null;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the rule form's fields", () => {
  test("ask what, then which channel, severities and whether to enforce", () => {
    expect(
      getComplianceRuleFormFields().map(
        (field: ModelField<TeamComplianceSetting>) => {
          return [Object.keys(field.field || {})[0], field.stepId];
        },
      ),
    ).toEqual([
      ["ruleType", RULE_FORM_STEP_RULE],
      ["notificationChannel", RULE_FORM_STEP_SCOPE],
      ["incidentSeverities", RULE_FORM_STEP_SCOPE],
      ["alertSeverities", RULE_FORM_STEP_SCOPE],
      ["enabled", RULE_FORM_STEP_SCOPE],
    ]);
  });

  test("two steps: the rule, then its scope", () => {
    expect(COMPLIANCE_RULE_FORM_STEPS).toEqual([
      { id: "rule", title: "Rule" },
      { id: "scope", title: "Scope" },
    ]);
  });

  /*
   * A function-valued `required` is reported as missing whenever its key is
   * absent from the form values (Validation.ts), even when the function would
   * say no - so every flag here is a plain boolean.
   */
  test("only the rule type is required, and every flag is a plain boolean", () => {
    for (const field of getComplianceRuleFormFields()) {
      expect(typeof field.required).toBe("boolean");
    }
    expect(fieldFor("ruleType").required).toBe(true);
    expect(fieldFor("notificationChannel").required).toBe(false);
    expect(fieldFor("incidentSeverities").required).toBe(false);
    expect(fieldFor("alertSeverities").required).toBe(false);
    expect(fieldFor("enabled").required).toBe(false);
  });

  test("the rule type is a card picker", () => {
    expect(fieldFor("ruleType").fieldType).toBe(FormFieldSchemaType.CardSelect);
    expect(fieldFor("ruleType").cardSelectOptions).toEqual(
      getRuleTypeCardOptions(),
    );
  });

  test("it offers all thirteen rule types, on-call rules first", () => {
    const groups: Array<CardSelectOptionGroup> = getRuleTypeCardOptions();

    expect(
      groups.map((group: CardSelectOptionGroup) => {
        return [group.label, group.options.length];
      }),
    ).toEqual([
      ["On-call rules", 4],
      ["Notification methods", 9],
    ]);

    const offered: Array<string> = groups.flatMap(
      (group: CardSelectOptionGroup) => {
        return group.options.map((option: CardSelectOption) => {
          return option.value;
        });
      },
    );

    expect(offered).toHaveLength(ALL_RULE_TYPES.length);
    expect([...offered].sort()).toEqual([...ALL_RULE_TYPES].sort());
    expect(offered).toEqual(
      COMPLIANCE_RULE_DEFINITIONS.map(
        (definition: ComplianceRuleDefinition) => {
          return definition.ruleType;
        },
      ),
    );
  });

  test("each card says what the catalog says", () => {
    for (const group of getRuleTypeCardOptions()) {
      for (const option of group.options) {
        const definition: ComplianceRuleDefinition =
          ComplianceRule.getDefinition(option.value)!;

        expect(option.title).toBe(definition.title);
        expect(option.description).toBe(definition.description);
        expect(option.icon).toBe(getRuleTypeIcon(option.value));
        expect(group.label).toBe(
          definition.category === ComplianceRuleCategory.OnCallRule
            ? "On-call rules"
            : "Notification methods",
        );
      }
    }
  });

  test("the channel is a clearable dropdown of every channel, empty meaning any", () => {
    const field: ModelField<TeamComplianceSetting> = fieldFor(
      "notificationChannel",
    );

    expect(field.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(field.placeholder).toBe("Any channel");
    expect(field.dropdownOptions).toEqual(getChannelDropdownOptions());
    expect(getChannelDropdownOptions()).toEqual(
      COMPLIANCE_CHANNEL_DEFINITIONS.map(
        (definition: ComplianceChannelDefinition) => {
          return { value: definition.channel, label: definition.label };
        },
      ),
    );
    expect(getChannelDropdownOptions()).toHaveLength(9);
  });

  test("severities are picked from the project's own severity lists", () => {
    const incident: ModelField<TeamComplianceSetting> =
      fieldFor("incidentSeverities");
    const alert: ModelField<TeamComplianceSetting> =
      fieldFor("alertSeverities");

    expect(incident.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(incident.dropdownModal).toEqual({
      type: IncidentSeverity,
      labelField: "name",
      valueField: "_id",
    });
    expect(incident.placeholder).toBe("All incident severities");

    expect(alert.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(alert.dropdownModal).toEqual({
      type: AlertSeverity,
      labelField: "name",
      valueField: "_id",
    });
    expect(alert.placeholder).toBe("All alert severities");
  });

  test("new rules are enforced unless switched off", () => {
    expect(fieldFor("enabled").fieldType).toBe(FormFieldSchemaType.Toggle);
    expect(fieldFor("enabled").defaultValue).toBe(true);
  });

  test.each(ALL_RULE_TYPES)(
    "%s shows exactly the options that apply to it",
    (ruleType: ComplianceRuleType) => {
      const values: Values = valuesFor(ruleType);
      const kind: ComplianceSeverityKind | undefined =
        ComplianceRule.getSeverityKind(ruleType);

      expect(fieldFor("notificationChannel").showIf!(values)).toBe(
        ComplianceRule.isOnCallRule(ruleType),
      );
      expect(fieldFor("incidentSeverities").showIf!(values)).toBe(
        kind === ComplianceSeverityKind.Incident,
      );
      expect(fieldFor("alertSeverities").showIf!(values)).toBe(
        kind === ComplianceSeverityKind.Alert,
      );
    },
  );

  test("with no rule type chosen, no option is shown", () => {
    expect(fieldFor("notificationChannel").showIf!({})).toBe(false);
    expect(fieldFor("incidentSeverities").showIf!({})).toBe(false);
    expect(fieldFor("alertSeverities").showIf!({})).toBe(false);
    expect(isSeverityFieldShown({}, ComplianceSeverityKind.Incident)).toBe(
      false,
    );
  });
});

describe("switching rule kinds", () => {
  const scoped: Values = {
    ruleType: ComplianceRuleType.HasIncidentOnCallRules,
    notificationChannel: ComplianceNotificationChannel.Call,
    incidentSeverities: [
      CRITICAL_ID,
    ] as unknown as Values["incidentSeverities"],
    alertSeverities: [MAJOR_ID] as unknown as Values["alertSeverities"],
    enabled: true,
  };

  test("to a method rule drops the channel and every severity", () => {
    expect(
      getValuesForRuleType(
        scoped,
        ComplianceRuleType.HasNotificationPushMethod,
      ),
    ).toEqual({
      ruleType: ComplianceRuleType.HasNotificationPushMethod,
      notificationChannel: undefined,
      incidentSeverities: [],
      alertSeverities: [],
      enabled: true,
    });
  });

  test("to an alert rule keeps the channel and drops incident severities", () => {
    expect(
      getValuesForRuleType(scoped, ComplianceRuleType.HasAlertOnCallRules),
    ).toEqual({
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
      incidentSeverities: [],
      alertSeverities: [MAJOR_ID],
      enabled: true,
    });
  });

  test("to another incident rule keeps the incident severities", () => {
    expect(
      getValuesForRuleType(
        scoped,
        ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      ),
    ).toEqual({
      ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
      incidentSeverities: [CRITICAL_ID],
      alertSeverities: [],
      enabled: true,
    });
  });

  test("picking a card hands the cleaned values back to the form", () => {
    const setNewFormValues: jest.Mock = jest.fn();

    fieldFor("ruleType").onChange!(
      ComplianceRuleType.HasNotificationEmailMethod,
      scoped,
      setNewFormValues,
    );

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect(setNewFormValues.mock.calls[0]![0]).toEqual(
      getValuesForRuleType(
        scoped,
        ComplianceRuleType.HasNotificationEmailMethod,
      ),
    );
  });

  test("the input is not modified", () => {
    const before: string = JSON.stringify(scoped);

    getValuesForRuleType(scoped, ComplianceRuleType.HasNotificationSMSMethod);

    expect(JSON.stringify(scoped)).toBe(before);
  });
});

describe("the live preview", () => {
  test("nothing to preview before a rule type is chosen", () => {
    expect(getRulePreviewText({})).toBeNull();
    expect(getRulePreviewText(valuesFor("HasCarrierPigeon"))).toBeNull();
  });

  test("a channel rule for every severity", () => {
    expect(
      getRulePreviewText(
        valuesFor(ComplianceRuleType.HasIncidentOnCallRules, {
          notificationChannel: ComplianceNotificationChannel.Push,
        }),
      ),
    ).toEqual({
      title: "Push notification for incidents",
      sentence:
        "Every member has an incident on-call rule that notifies them by Push notification for every incident severity.",
      notes: [],
    });
  });

  test("one selected severity", () => {
    expect(
      getRulePreviewText(
        valuesFor(ComplianceRuleType.HasAlertOnCallRules, {
          alertSeverities: [
            CRITICAL_ID,
          ] as unknown as Values["alertSeverities"],
        }),
      )?.sentence,
    ).toBe(
      "Every member has an alert on-call rule for the severity you selected.",
    );
  });

  test("several selected severities", () => {
    expect(
      getRulePreviewText(
        valuesFor(ComplianceRuleType.HasIncidentOnCallRules, {
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: [
            CRITICAL_ID,
            MAJOR_ID,
          ] as unknown as Values["incidentSeverities"],
        }),
      )?.sentence,
    ).toBe(
      "Every member has an incident on-call rule that notifies them by Call for the 2 severities you selected.",
    );
  });

  test("severities of the other kind are ignored", () => {
    expect(
      getRulePreviewText(
        valuesFor(ComplianceRuleType.HasAlertOnCallRules, {
          incidentSeverities: [
            CRITICAL_ID,
          ] as unknown as Values["incidentSeverities"],
        }),
      )?.sentence,
    ).toBe("Every member has an alert on-call rule for every alert severity.");
  });

  test("a channel left on a method rule is ignored", () => {
    expect(
      getRulePreviewText(
        valuesFor(ComplianceRuleType.HasNotificationEmailMethod, {
          notificationChannel: ComplianceNotificationChannel.Call,
        }),
      ),
    ).toEqual({
      title: "Verified email",
      sentence: "Every member has a verified email address.",
      notes: [],
    });
  });

  test.each([
    [ComplianceNotificationChannel.Call, true],
    [ComplianceNotificationChannel.SMS, true],
    [ComplianceNotificationChannel.WhatsApp, true],
    [ComplianceNotificationChannel.Telegram, true],
    [ComplianceNotificationChannel.Push, false],
    [ComplianceNotificationChannel.Email, false],
    [ComplianceNotificationChannel.Slack, false],
  ])(
    "a %s rule mentions the project switch: %s",
    (channel: ComplianceNotificationChannel, mentioned: boolean) => {
      const notes: Array<string> =
        getRulePreviewText(
          valuesFor(ComplianceRuleType.HasIncidentOnCallRules, {
            notificationChannel: channel,
          }),
        )?.notes || [];

      expect(
        notes.some((note: string) => {
          return note.includes("switched on for the project");
        }),
      ).toBe(mentioned);
    },
  );

  test("a method rule on a switchable channel mentions the switch too", () => {
    expect(
      getRulePreviewText(
        valuesFor(ComplianceRuleType.HasNotificationCallMethod),
      )?.notes[0],
    ).toBe(
      "Call notifications also have to be switched on for the project (Project Settings > Notification Settings), or nobody will be reached this way.",
    );
  });

  test("a paused rule says so", () => {
    expect(
      getRulePreviewText(
        valuesFor(ComplianceRuleType.HasNotificationEmailMethod, {
          enabled: false,
        }),
      )?.notes,
    ).toEqual([
      "This rule is saved paused: it is listed but nobody is checked against it until you turn it on.",
    ]);
  });

  test("the preview renders under the enforce switch", () => {
    const footer: React.ReactElement | undefined = fieldFor("enabled")
      .getFooterElement!(
      valuesFor(ComplianceRuleType.HasIncidentOnCallRules, {
        notificationChannel: ComplianceNotificationChannel.Call,
      }),
    );

    render(<>{footer}</>);

    expect(
      screen.getByTestId("compliance-rule-preview-title"),
    ).toHaveTextContent("Call for incidents");
    expect(
      screen.getByTestId("compliance-rule-preview-sentence"),
    ).toHaveTextContent(
      "Every member has an incident on-call rule that notifies them by Call for every incident severity.",
    );
    expect(screen.getByText("Members pass this rule when")).toBeInTheDocument();
  });

  test("an empty form renders no preview", () => {
    const { container } = render(<ComplianceRulePreview values={{}} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the rule modal", () => {
  test("create: titled for adding, enforced by default", () => {
    render(
      <ComplianceRuleFormModal
        teamId={TEAM_ID}
        projectId={PROJECT_ID}
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    expect(capturedModalProps?.title).toBe("Add a compliance rule");
    expect(capturedModalProps?.submitButtonText).toBe("Add rule");
    expect(capturedModalProps?.initialValues).toEqual({ enabled: true });
    expect(capturedModalProps?.modelIdToEdit).toBeUndefined();
    expect(capturedModalProps?.formProps?.formType).toBe(FormType.Create);
    expect(capturedModalProps?.formProps?.steps).toEqual(
      COMPLIANCE_RULE_FORM_STEPS,
    );
    expect(capturedModalProps?.formProps?.fields).toHaveLength(5);
  });

  test("create from a recommendation opens with its values", () => {
    render(
      <ComplianceRuleFormModal
        teamId={TEAM_ID}
        projectId={PROJECT_ID}
        initialValues={{
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
        }}
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    expect(capturedModalProps?.initialValues).toEqual({
      enabled: true,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
    });
  });

  test("a recommendation can open paused", () => {
    expect(getCreateInitialValues({ enabled: false })).toEqual({
      enabled: false,
    });
    expect(getCreateInitialValues(undefined)).toEqual({ enabled: true });
  });

  test("a new rule is created for this team, in this project", async () => {
    render(
      <ComplianceRuleFormModal
        teamId={TEAM_ID}
        projectId={PROJECT_ID}
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    const item: Record<string, unknown> = {};
    await capturedModalProps?.onBeforeCreate?.(item);

    expect((item["teamId"] as ObjectID).toString()).toBe(TEAM_ID.toString());
    expect((item["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("without a project nothing is created", () => {
    render(
      <ComplianceRuleFormModal
        teamId={TEAM_ID}
        projectId={null}
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    expect(() => {
      return capturedModalProps?.onBeforeCreate?.({});
    }).toThrow("Project ID cannot be null");
  });

  test("edit: loads the rule by id, with no create defaults", () => {
    const ruleId: ObjectID = new ObjectID(
      "00000000-0000-4000-8000-0000000000a9",
    );

    render(
      <ComplianceRuleFormModal
        teamId={TEAM_ID}
        projectId={PROJECT_ID}
        modelIdToEdit={ruleId}
        initialValues={{ enabled: false }}
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    expect(capturedModalProps?.title).toBe("Edit compliance rule");
    expect(capturedModalProps?.submitButtonText).toBe("Save rule");
    expect(capturedModalProps?.modelIdToEdit?.toString()).toBe(
      ruleId.toString(),
    );
    expect(capturedModalProps?.initialValues).toBeUndefined();
    expect(capturedModalProps?.formProps?.formType).toBe(FormType.Update);
  });

  test("success and close reach the caller", () => {
    const onClose: jest.Mock = jest.fn();
    const onSuccess: jest.Mock = jest.fn();

    render(
      <ComplianceRuleFormModal
        teamId={TEAM_ID}
        projectId={PROJECT_ID}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    capturedModalProps?.onSuccess?.(new TeamComplianceSetting());
    capturedModalProps?.onClose?.();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
