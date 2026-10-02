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
  getProjectSwitchNote,
  getProjectSwitchNotes,
  getRulePreviewText,
  getRuleTypeCardOptions,
  getValuesForRuleType,
  isSeverityFieldShown,
} from "../../../Dashboard/TeamCompliance/ComplianceRuleForm";
import {
  COMPLIANCE_RULE_PRESETS,
  ComplianceRulePreset,
  getPresetInitialValues,
} from "../../../Dashboard/TeamCompliance/ComplianceRulePresets";
import { getRuleTypeIcon } from "../../../Dashboard/TeamCompliance/ComplianceView";
import {
  CRITICAL_ID,
  MAJOR_ID,
  PROJECT_ID,
  TEAM_ID,
} from "./ComplianceFixtures";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
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
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

type Values = FormValues<TeamComplianceSetting>;

const ALL_RULE_TYPES: Array<ComplianceRuleType> =
  Object.values(ComplianceRuleType);

const ON_CALL_RULE_TYPES: Array<ComplianceRuleType> = ALL_RULE_TYPES.filter(
  (ruleType: ComplianceRuleType): boolean => {
    return ComplianceRule.isOnCallRule(ruleType);
  },
);

const METHOD_RULE_TYPES: Array<ComplianceRuleType> = ALL_RULE_TYPES.filter(
  (ruleType: ComplianceRuleType): boolean => {
    return !ComplianceRule.isOnCallRule(ruleType);
  },
);

// The notes the preview gives for a project switch, word for word.
const CALL_NOTE: string =
  "Call notifications also have to be switched on for the project (Project Settings > Notification Settings), or nobody will be reached this way.";
const WHATSAPP_NOTE: string =
  "Members cannot add a WhatsApp number until WhatsApp is switched on for the project in Project Settings > Notification Settings.";
const CALL_AND_SMS_NOTE: string =
  "Call and SMS notifications also have to be switched on for the project (Project Settings > Notification Settings), or nobody will be reached those ways.";
const CALL_SMS_AND_TELEGRAM_NOTE: string =
  "Call, SMS and Telegram notifications also have to be switched on for the project (Project Settings > Notification Settings), or nobody will be reached those ways.";
const PAUSED_NOTE: string =
  "This rule is saved paused: it is listed but nobody is checked against it until you turn it on.";

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

/*
 * Form values holding a channel list as the form can hold it - including
 * what a hand-edited or stale value might carry - which the model's type is
 * too narrow to spell.
 */
const withChannels: (
  ruleType: string,
  channels: unknown,
  extra?: Values,
) => Values = (ruleType: string, channels: unknown, extra?: Values): Values => {
  return valuesFor(ruleType, {
    notificationChannels: channels as Values["notificationChannels"],
    ...(extra || {}),
  });
};

/*
 * The body ModelForm's update sends for these values, built the way it
 * builds it: the form's values for its fields, as a model, through
 * ModelAPI's BaseModel.toJSON and JSONFunctions.serialize.
 */
const bodyFor: (values: Values) => JSONObject = (
  values: Values,
): JSONObject => {
  const valuesToSend: JSONObject = { _id: CRITICAL_ID };

  for (const field of getComplianceRuleFormFields()) {
    const key: string = Object.keys(field.field || {})[0]!;
    valuesToSend[key] = (values as JSONObject)[key];
  }

  const model: TeamComplianceSetting = BaseModel.fromJSON(
    valuesToSend,
    TeamComplianceSetting,
  ) as TeamComplianceSetting;

  return JSON.parse(
    JSON.stringify(
      JSONFunctions.serialize(BaseModel.toJSON(model, TeamComplianceSetting)),
    ),
  ) as JSONObject;
};

beforeEach(() => {
  capturedModalProps = null;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the rule form's fields", () => {
  test("ask what, then which channels, severities and whether to enforce", () => {
    expect(
      getComplianceRuleFormFields().map(
        (field: ModelField<TeamComplianceSetting>) => {
          return [Object.keys(field.field || {})[0], field.stepId];
        },
      ),
    ).toEqual([
      ["ruleType", RULE_FORM_STEP_RULE],
      ["notificationChannels", RULE_FORM_STEP_SCOPE],
      ["incidentSeverities", RULE_FORM_STEP_SCOPE],
      ["alertSeverities", RULE_FORM_STEP_SCOPE],
      ["enabled", RULE_FORM_STEP_SCOPE],
    ]);
  });

  /*
   * The deprecated single column is never a field: the form reads and writes
   * the list, and the server keeps the old column in step on its own.
   */
  test("the single notificationChannel column is not a field of the form", () => {
    const keys: Array<string> = getComplianceRuleFormFields().map(
      (field: ModelField<TeamComplianceSetting>): string => {
        return Object.keys(field.field || {})[0]!;
      },
    );

    expect(keys).not.toContain("notificationChannel");
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
    expect(fieldFor("notificationChannels").required).toBe(false);
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

  test("the channels are a multi-select of every channel, empty meaning any", () => {
    const field: ModelField<TeamComplianceSetting> = fieldFor(
      "notificationChannels",
    );

    expect(field.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(field.title).toBe("Channels");
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

  /*
   * The channels are the catalog's, not a model's rows: the static dropdown,
   * not the entity search the severity lists use.
   */
  test("the channel options are static, not looked up", () => {
    const field: ModelField<TeamComplianceSetting> = fieldFor(
      "notificationChannels",
    );

    expect(field.dropdownModal).toBeUndefined();
  });

  test("the channel options are the nine channels, in the catalog's order", () => {
    expect(
      getChannelDropdownOptions().map((option: { value: unknown }) => {
        return option.value;
      }),
    ).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.SMS,
      ComplianceNotificationChannel.Push,
      ComplianceNotificationChannel.Email,
      ComplianceNotificationChannel.WhatsApp,
      ComplianceNotificationChannel.Telegram,
      ComplianceNotificationChannel.Slack,
      ComplianceNotificationChannel.MicrosoftTeams,
      ComplianceNotificationChannel.Webhook,
    ]);
    expect(
      getChannelDropdownOptions().map((option: { label: string }) => {
        return option.label;
      }),
    ).toEqual([
      "Call",
      "SMS",
      "Push notification",
      "Email",
      "WhatsApp",
      "Telegram",
      "Slack",
      "Microsoft Teams",
      "Webhook",
    ]);
  });

  /*
   * "Each channel you pick": every picked channel is required, the way the
   * severity lists below it read "each severity you pick" - and an empty
   * list accepts any channel.
   */
  test("the channel field says a rule is needed on each channel picked, and that empty is any", () => {
    // A plain sentence - the field's description may also be an element.
    const description: string = fieldFor("notificationChannels")
      .description as string;

    expect(description).toBe(
      "Members need a rule that notifies them on each channel you pick - Call and Push notification, say, so a critical page rings their phone and reaches the app. Leave empty to accept any channel.",
    );
    expect(description).toContain("each channel you pick");
    expect(description).toContain("Leave empty to accept any channel.");
  });

  /*
   * In the order the severities are ranked on their settings pages, most
   * severe first - not in the order they happened to be created.
   */
  test("severities are picked from the project's own severity lists, most severe first", () => {
    const incident: ModelField<TeamComplianceSetting> =
      fieldFor("incidentSeverities");
    const alert: ModelField<TeamComplianceSetting> =
      fieldFor("alertSeverities");

    expect(incident.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(incident.dropdownModal).toEqual({
      type: IncidentSeverity,
      labelField: "name",
      valueField: "_id",
      sort: { order: SortOrder.Ascending },
    });
    expect(incident.placeholder).toBe("All incident severities");

    expect(alert.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(alert.dropdownModal).toEqual({
      type: AlertSeverity,
      labelField: "name",
      valueField: "_id",
      sort: { order: SortOrder.Ascending },
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

      expect(fieldFor("notificationChannels").showIf!(values)).toBe(
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

  test("the channels are shown for the four on-call kinds and none of the nine method kinds", () => {
    expect(ON_CALL_RULE_TYPES).toHaveLength(4);
    expect(METHOD_RULE_TYPES).toHaveLength(9);

    for (const ruleType of ON_CALL_RULE_TYPES) {
      expect(
        fieldFor("notificationChannels").showIf!(valuesFor(ruleType)),
      ).toBe(true);
    }

    for (const ruleType of METHOD_RULE_TYPES) {
      expect(
        fieldFor("notificationChannels").showIf!(valuesFor(ruleType)),
      ).toBe(false);
    }
  });

  test("with no rule type chosen, no option is shown", () => {
    expect(fieldFor("notificationChannels").showIf!({})).toBe(false);
    expect(fieldFor("incidentSeverities").showIf!({})).toBe(false);
    expect(fieldFor("alertSeverities").showIf!({})).toBe(false);
    expect(isSeverityFieldShown({}, ComplianceSeverityKind.Incident)).toBe(
      false,
    );
  });

  test("an unknown rule type shows no channels", () => {
    expect(
      fieldFor("notificationChannels").showIf!(valuesFor("HasCarrierPigeon")),
    ).toBe(false);
  });
});

describe("switching rule kinds", () => {
  const scoped: Values = {
    ruleType: ComplianceRuleType.HasIncidentOnCallRules,
    notificationChannels: [ComplianceNotificationChannel.Call],
    incidentSeverities: [
      CRITICAL_ID,
    ] as unknown as Values["incidentSeverities"],
    alertSeverities: [MAJOR_ID] as unknown as Values["alertSeverities"],
    enabled: true,
  };

  const onTwoChannels: Values = {
    ...scoped,
    notificationChannels: [
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ],
  };

  test("to a method rule drops the channels and every severity", () => {
    expect(
      getValuesForRuleType(
        scoped,
        ComplianceRuleType.HasNotificationPushMethod,
      ),
    ).toEqual({
      ruleType: ComplianceRuleType.HasNotificationPushMethod,
      // An empty list, not undefined: cleared channels have to reach the server.
      notificationChannels: [],
      incidentSeverities: [],
      alertSeverities: [],
      enabled: true,
    });
  });

  test.each(METHOD_RULE_TYPES)(
    "to %s drops every channel of a two-channel rule, as an empty list",
    (ruleType: ComplianceRuleType) => {
      const next: Values = getValuesForRuleType(onTwoChannels, ruleType);

      expect(next.notificationChannels).toEqual([]);
      expect(next.notificationChannels).not.toBeUndefined();
      expect(Object.keys(next)).toContain("notificationChannels");
    },
  );

  test.each(ON_CALL_RULE_TYPES)(
    "to %s keeps both channels of a two-channel rule",
    (ruleType: ComplianceRuleType) => {
      expect(
        getValuesForRuleType(onTwoChannels, ruleType).notificationChannels,
      ).toEqual([
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ]);
    },
  );

  /*
   * A form that never had channels (a new rule, nothing picked yet) is given
   * the empty list too when a method card is picked: what reaches the server
   * then says "no channels" rather than nothing at all.
   */
  test("to a method rule gives a form that had no channels the empty list too", () => {
    expect(
      getValuesForRuleType(
        valuesFor(ComplianceRuleType.HasIncidentOnCallRules),
        ComplianceRuleType.HasNotificationEmailMethod,
      ).notificationChannels,
    ).toEqual([]);
  });

  test("to an on-call rule leaves a form that had no channels without them", () => {
    const next: Values = getValuesForRuleType(
      valuesFor(ComplianceRuleType.HasNotificationEmailMethod),
      ComplianceRuleType.HasAlertOnCallRules,
    );

    expect(next.notificationChannels).toBeUndefined();
    expect(getRulePreviewText(next)?.title).toBe("Alert on-call rules");
  });

  /*
   * Editing "Call for incidents": the admin clicks a method card, then goes
   * back to "Incident on-call rules". The form shows "Any channel" - so the
   * saved rule must be any channel too. With the channels left undefined the
   * request body dropped the key, and the server kept the stored Call.
   */
  test("channels cleared by a detour through a method card reach the server as an empty list", () => {
    const afterMethodCard: Values = getValuesForRuleType(
      onTwoChannels,
      ComplianceRuleType.HasNotificationCallMethod,
    );
    const backOnCall: Values = getValuesForRuleType(
      afterMethodCard,
      ComplianceRuleType.HasIncidentOnCallRules,
    );

    expect(backOnCall.notificationChannels).toEqual([]);
    // What the form then previews is what will be saved: any channel.
    expect(getRulePreviewText(backOnCall)?.title).toBe(
      "Incident on-call rules",
    );

    const body: JSONObject = bodyFor(backOnCall);

    expect(body["ruleType"]).toBe(ComplianceRuleType.HasIncidentOnCallRules);
    expect(Object.keys(body)).toContain("notificationChannels");
    expect(body["notificationChannels"]).toEqual([]);
    // Never the deprecated single column: the list alone says what is meant.
    expect(Object.keys(body)).not.toContain("notificationChannel");
  });

  test("a two-channel rule's list reaches the server as it is", () => {
    const body: JSONObject = bodyFor(onTwoChannels);

    expect(body["notificationChannels"]).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
    expect(Object.keys(body)).not.toContain("notificationChannel");
  });

  test("to an alert rule keeps the channels and drops incident severities", () => {
    expect(
      getValuesForRuleType(scoped, ComplianceRuleType.HasAlertOnCallRules),
    ).toEqual({
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
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
      notificationChannels: [ComplianceNotificationChannel.Call],
      incidentSeverities: [CRITICAL_ID],
      alertSeverities: [],
      enabled: true,
    });
  });

  test("picking a card hands the cleaned values back to the form", () => {
    const setNewFormValues: jest.Mock = jest.fn();

    fieldFor("ruleType").onChange!(
      ComplianceRuleType.HasNotificationEmailMethod,
      onTwoChannels,
      setNewFormValues,
    );

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect(setNewFormValues.mock.calls[0]![0]).toEqual(
      getValuesForRuleType(
        onTwoChannels,
        ComplianceRuleType.HasNotificationEmailMethod,
      ),
    );
    expect(
      (setNewFormValues.mock.calls[0]![0] as Values).notificationChannels,
    ).toEqual([]);
  });

  test("the input is not modified", () => {
    const before: string = JSON.stringify(scoped);

    getValuesForRuleType(scoped, ComplianceRuleType.HasNotificationSMSMethod);

    expect(JSON.stringify(scoped)).toBe(before);
  });

  test("a two-channel rule's list is not emptied in place", () => {
    const channels: Array<ComplianceNotificationChannel> = [
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ];

    getValuesForRuleType(
      { ...onTwoChannels, notificationChannels: channels },
      ComplianceRuleType.HasNotificationSMSMethod,
    );

    expect(channels).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
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
        withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
          ComplianceNotificationChannel.Push,
        ]),
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
        withChannels(
          ComplianceRuleType.HasIncidentOnCallRules,
          [ComplianceNotificationChannel.Call],
          {
            incidentSeverities: [
              CRITICAL_ID,
              MAJOR_ID,
            ] as unknown as Values["incidentSeverities"],
          },
        ),
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

  test("channels left on a method rule are ignored", () => {
    expect(
      getRulePreviewText(
        withChannels(ComplianceRuleType.HasNotificationEmailMethod, [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ]),
      ),
    ).toEqual({
      title: "Verified email",
      sentence: "Every member has a verified email address.",
      notes: [],
    });
  });

  test("an empty list is any channel", () => {
    expect(
      getRulePreviewText(
        withChannels(ComplianceRuleType.HasIncidentOnCallRules, []),
      ),
    ).toEqual({
      title: "Incident on-call rules",
      sentence:
        "Every member has an incident on-call rule for every incident severity.",
      notes: [],
    });
  });

  describe("a rule on several channels", () => {
    test("Call and Push: titled for both, and a rule on each is needed", () => {
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Push,
          ]),
        ),
      ).toEqual({
        title: "Call and Push notification for incidents",
        sentence:
          "Every member has incident on-call rules that notify them by Call and by Push notification for every incident severity.",
        // Only Call can be switched off for a project.
        notes: [CALL_NOTE],
      });
    });

    test("the order the channels were picked in does not matter", () => {
      const pickedCallFirst: ReturnType<typeof getRulePreviewText> =
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Push,
          ]),
        );
      const pickedPushFirst: ReturnType<typeof getRulePreviewText> =
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
            ComplianceNotificationChannel.Push,
            ComplianceNotificationChannel.Call,
          ]),
        );

      expect(pickedPushFirst).toEqual(pickedCallFirst);
      expect(pickedPushFirst?.title).toBe(
        "Call and Push notification for incidents",
      );
    });

    test("a channel picked twice counts once", () => {
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasAlertOnCallRules, [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Call,
          ]),
        ),
      ).toEqual(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasAlertOnCallRules, [
            ComplianceNotificationChannel.Call,
          ]),
        ),
      );
    });

    test("three channels read as prose, each with its own 'by'", () => {
      expect(
        getRulePreviewText(
          withChannels(
            ComplianceRuleType.HasAlertEpisodeOnCallRules,
            [
              ComplianceNotificationChannel.Push,
              ComplianceNotificationChannel.SMS,
              ComplianceNotificationChannel.Call,
            ],
            {
              alertSeverities: [
                CRITICAL_ID,
                MAJOR_ID,
              ] as unknown as Values["alertSeverities"],
            },
          ),
        ),
      ).toEqual({
        title: "Call, SMS and Push notification for alert episodes",
        sentence:
          "Every member has alert episode on-call rules that notify them by Call, by SMS and by Push notification for the 2 severities you selected.",
        notes: [CALL_AND_SMS_NOTE],
      });
    });

    test("every channel at once", () => {
      const preview: ReturnType<typeof getRulePreviewText> = getRulePreviewText(
        withChannels(
          ComplianceRuleType.HasIncidentOnCallRules,
          [...Object.values(ComplianceNotificationChannel)].reverse(),
        ),
      );

      expect(preview?.title).toBe(
        "Call, SMS, Push notification, Email, WhatsApp, Telegram, Slack, Microsoft Teams and Webhook for incidents",
      );
      expect(preview?.sentence).toBe(
        "Every member has incident on-call rules that notify them by Call, by SMS, by Push notification, by Email, by WhatsApp, by Telegram, by Slack, by Microsoft Teams and by Webhook for every incident severity.",
      );
      expect(preview?.notes).toEqual([
        CALL_SMS_AND_TELEGRAM_NOTE,
        WHATSAPP_NOTE,
      ]);
    });

    test("values that are not channels are ignored", () => {
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
            "Fax",
            ComplianceNotificationChannel.Call,
            7,
            null,
          ]),
        )?.title,
      ).toBe("Call for incidents");
      // Nothing recognisable left: any channel.
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, ["Fax"]),
        ),
      ).toEqual({
        title: "Incident on-call rules",
        sentence:
          "Every member has an incident on-call rule for every incident severity.",
        notes: [],
      });
    });

    /*
     * The channels are a list. A lone string is not one - no form control
     * this field renders produces it - and reads as no channels.
     */
    test("a lone channel that is not in a list reads as any channel", () => {
      expect(
        getRulePreviewText(
          withChannels(
            ComplianceRuleType.HasIncidentOnCallRules,
            ComplianceNotificationChannel.Call,
          ),
        )?.title,
      ).toBe("Incident on-call rules");
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
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, [channel]),
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
    ).toBe(CALL_NOTE);
  });

  test.each([
    [ComplianceNotificationChannel.Call, "Call"],
    [ComplianceNotificationChannel.SMS, "SMS"],
    [ComplianceNotificationChannel.Telegram, "Telegram"],
  ])(
    "switched off, %s reaches nobody - and the note says so",
    (channel: ComplianceNotificationChannel, label: string) => {
      const note: string = `${label} notifications also have to be switched on for the project (Project Settings > Notification Settings), or nobody will be reached this way.`;

      expect(getProjectSwitchNote(channel)).toBe(note);
      expect(getProjectSwitchNotes([channel])).toEqual([note]);
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, [channel]),
        )?.notes,
      ).toEqual([note]);
    },
  );

  /*
   * Switched off, WhatsApp still pages numbers verified before - so "nobody
   * will be reached" would be untrue. What it does stop is adding a number,
   * the only way to meet a WhatsApp rule.
   */
  test("a WhatsApp rule says members cannot add a number until the project switches WhatsApp on", () => {
    expect(getProjectSwitchNote(ComplianceNotificationChannel.WhatsApp)).toBe(
      WHATSAPP_NOTE,
    );
    expect(
      getRulePreviewText(
        withChannels(ComplianceRuleType.HasAlertOnCallRules, [
          ComplianceNotificationChannel.WhatsApp,
        ]),
      )?.notes,
    ).toEqual([WHATSAPP_NOTE]);
    expect(
      getRulePreviewText(
        valuesFor(ComplianceRuleType.HasNotificationWhatsAppMethod),
      )?.notes,
    ).toEqual([WHATSAPP_NOTE]);
    expect(WHATSAPP_NOTE).not.toContain("nobody will be reached");
  });

  test("a paused rule says so", () => {
    expect(
      getRulePreviewText(
        valuesFor(ComplianceRuleType.HasNotificationEmailMethod, {
          enabled: false,
        }),
      )?.notes,
    ).toEqual([PAUSED_NOTE]);
  });

  describe("project switch notes on a rule with several channels", () => {
    test("Call and SMS share one note, not one each", () => {
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.SMS,
          ]),
        )?.notes,
      ).toEqual([CALL_AND_SMS_NOTE]);
    });

    test("SMS picked before Call still reads 'Call and SMS'", () => {
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
            ComplianceNotificationChannel.SMS,
            ComplianceNotificationChannel.Call,
          ]),
        )?.notes,
      ).toEqual([CALL_AND_SMS_NOTE]);
    });

    test("Call, SMS and Telegram share one note too", () => {
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasAlertOnCallRules, [
            ComplianceNotificationChannel.Telegram,
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.SMS,
          ]),
        )?.notes,
      ).toEqual([CALL_SMS_AND_TELEGRAM_NOTE]);
    });

    /*
     * WhatsApp's problem is different - nobody can ADD a number - so it keeps
     * its own note, after the one for the channels nobody is paged on.
     */
    test("WhatsApp keeps its own note, after the others", () => {
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
            ComplianceNotificationChannel.WhatsApp,
            ComplianceNotificationChannel.Call,
          ]),
        )?.notes,
      ).toEqual([CALL_NOTE, WHATSAPP_NOTE]);
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.SMS,
            ComplianceNotificationChannel.WhatsApp,
          ]),
        )?.notes,
      ).toEqual([CALL_AND_SMS_NOTE, WHATSAPP_NOTE]);
    });

    test("WhatsApp beside channels no project switches off has only its own note", () => {
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
            ComplianceNotificationChannel.Push,
            ComplianceNotificationChannel.WhatsApp,
            ComplianceNotificationChannel.Email,
          ]),
        )?.notes,
      ).toEqual([WHATSAPP_NOTE]);
    });

    test("Push, Email, Slack, Microsoft Teams and Webhook add no note", () => {
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
            ComplianceNotificationChannel.Push,
            ComplianceNotificationChannel.Email,
            ComplianceNotificationChannel.Slack,
            ComplianceNotificationChannel.MicrosoftTeams,
            ComplianceNotificationChannel.Webhook,
          ]),
        )?.notes,
      ).toEqual([]);
    });

    test("a switchable channel beside ones that are not still gets its note alone", () => {
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
            ComplianceNotificationChannel.Push,
            ComplianceNotificationChannel.Telegram,
            ComplianceNotificationChannel.Email,
          ]),
        )?.notes,
      ).toEqual([getProjectSwitchNote(ComplianceNotificationChannel.Telegram)]);
    });

    /*
     * A method rule is about its own channel, whatever channel list the form
     * still holds from an on-call card picked before it.
     */
    test("a method rule's note is for its own channel, not a leftover list", () => {
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasNotificationSMSMethod, [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Telegram,
          ]),
        ),
      ).toEqual({
        title: "Verified phone for SMS",
        sentence: "Every member has a verified phone number for SMS.",
        notes: [getProjectSwitchNote(ComplianceNotificationChannel.SMS)],
      });
      expect(
        getRulePreviewText(
          withChannels(ComplianceRuleType.HasNotificationPushMethod, [
            ComplianceNotificationChannel.Call,
          ]),
        )?.notes,
      ).toEqual([]);
    });

    test("a paused rule's note comes after the switch notes", () => {
      expect(
        getRulePreviewText(
          withChannels(
            ComplianceRuleType.HasIncidentOnCallRules,
            [
              ComplianceNotificationChannel.WhatsApp,
              ComplianceNotificationChannel.SMS,
              ComplianceNotificationChannel.Call,
            ],
            { enabled: false },
          ),
        )?.notes,
      ).toEqual([CALL_AND_SMS_NOTE, WHATSAPP_NOTE, PAUSED_NOTE]);
    });

    test("getProjectSwitchNotes: nothing for no channels, one note for the not-sent ones, WhatsApp last", () => {
      expect(getProjectSwitchNotes([])).toEqual([]);
      expect(
        getProjectSwitchNotes([
          ComplianceNotificationChannel.Push,
          ComplianceNotificationChannel.Email,
        ]),
      ).toEqual([]);
      expect(
        getProjectSwitchNotes([
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.SMS,
        ]),
      ).toEqual([CALL_AND_SMS_NOTE]);
      expect(
        getProjectSwitchNotes([ComplianceNotificationChannel.WhatsApp]),
      ).toEqual([WHATSAPP_NOTE]);
      // Named in catalog order, once each, whatever order they arrive in.
      expect(
        getProjectSwitchNotes([
          ComplianceNotificationChannel.WhatsApp,
          ComplianceNotificationChannel.SMS,
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.SMS,
        ]),
      ).toEqual([CALL_AND_SMS_NOTE, WHATSAPP_NOTE]);
      expect(
        getProjectSwitchNotes(
          COMPLIANCE_CHANNEL_DEFINITIONS.map(
            (
              definition: ComplianceChannelDefinition,
            ): ComplianceNotificationChannel => {
              return definition.channel;
            },
          ),
        ),
      ).toEqual([CALL_SMS_AND_TELEGRAM_NOTE, WHATSAPP_NOTE]);
    });

    test("one switchable channel keeps the one-channel wording", () => {
      expect(
        getProjectSwitchNotes([
          ComplianceNotificationChannel.Push,
          ComplianceNotificationChannel.Call,
        ]),
      ).toEqual([CALL_NOTE]);
      expect(CALL_NOTE).toContain("this way");
      expect(CALL_AND_SMS_NOTE).toContain("those ways");
    });
  });

  test("the preview renders under the enforce switch", () => {
    const footer: React.ReactElement | undefined = fieldFor("enabled")
      .getFooterElement!(
      withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
        ComplianceNotificationChannel.Call,
      ]),
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

  test("the preview of a two-channel rule names both, and says each switch note once", () => {
    const footer: React.ReactElement | undefined = fieldFor("enabled")
      .getFooterElement!(
      withChannels(ComplianceRuleType.HasIncidentOnCallRules, [
        ComplianceNotificationChannel.SMS,
        ComplianceNotificationChannel.Call,
      ]),
    );

    render(<>{footer}</>);

    expect(
      screen.getByTestId("compliance-rule-preview-title"),
    ).toHaveTextContent("Call and SMS for incidents");
    expect(
      screen.getByTestId("compliance-rule-preview-sentence"),
    ).toHaveTextContent(
      "Every member has incident on-call rules that notify them by Call and by SMS for every incident severity.",
    );
    expect(screen.getAllByText(CALL_AND_SMS_NOTE)).toHaveLength(1);
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

  test("create says the rule is narrowed by channels and severities", () => {
    render(
      <ComplianceRuleFormModal
        teamId={TEAM_ID}
        projectId={PROJECT_ID}
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    expect(capturedModalProps?.description).toBe(
      "Choose what every member of this team must have set up, then narrow it to the channels and severities that matter.",
    );
  });

  test("create from a recommendation opens with its values", () => {
    render(
      <ComplianceRuleFormModal
        teamId={TEAM_ID}
        projectId={PROJECT_ID}
        initialValues={{
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannels: [ComplianceNotificationChannel.Call],
        }}
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    expect(capturedModalProps?.initialValues).toEqual({
      enabled: true,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
    });
  });

  test("create can open on several channels", () => {
    render(
      <ComplianceRuleFormModal
        teamId={TEAM_ID}
        projectId={PROJECT_ID}
        initialValues={{
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannels: [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Push,
          ],
        }}
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    expect(capturedModalProps?.initialValues).toEqual({
      enabled: true,
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      notificationChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ],
    });
  });

  test("a recommendation can open paused", () => {
    expect(getCreateInitialValues({ enabled: false })).toEqual({
      enabled: false,
    });
    expect(getCreateInitialValues(undefined)).toEqual({ enabled: true });
  });

  test("a recommendation's channel list is carried over as a list", () => {
    expect(
      getCreateInitialValues({
        notificationChannels: [
          ComplianceNotificationChannel.SMS,
          ComplianceNotificationChannel.Webhook,
        ],
      }),
    ).toEqual({
      enabled: true,
      notificationChannels: [
        ComplianceNotificationChannel.SMS,
        ComplianceNotificationChannel.Webhook,
      ],
    });
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

  test("a new rule's channels are left as the form picked them", async () => {
    render(
      <ComplianceRuleFormModal
        teamId={TEAM_ID}
        projectId={PROJECT_ID}
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    const item: Record<string, unknown> = {
      notificationChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ],
    };
    await capturedModalProps?.onBeforeCreate?.(item);

    expect(item["notificationChannels"]).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
    expect(Object.keys(item)).not.toContain("notificationChannel");
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

describe("the recommended rules' channels", () => {
  const presetById: (id: string) => ComplianceRulePreset = (
    id: string,
  ): ComplianceRulePreset => {
    const preset: ComplianceRulePreset | undefined =
      COMPLIANCE_RULE_PRESETS.find(
        (candidate: ComplianceRulePreset): boolean => {
          return candidate.id === id;
        },
      );

    if (!preset) {
      throw new Error(`No ${id} preset`);
    }

    return preset;
  };

  beforeEach(() => {
    // No severity to preselect: only the channels are under test here.
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 1,
    } as never);
  });

  test("every preset's channels are a list the form can hold", () => {
    for (const preset of COMPLIANCE_RULE_PRESETS) {
      if (preset.notificationChannels === undefined) {
        continue;
      }

      expect(Array.isArray(preset.notificationChannels)).toBe(true);

      for (const channel of preset.notificationChannels) {
        expect(ComplianceRule.isKnownChannel(channel)).toBe(true);
      }

      // Only on-call rules take channels.
      expect(ComplianceRule.supportsChannel(preset.ruleType)).toBe(true);
    }
  });

  test("Call for critical incidents opens on Call alone", async () => {
    expect(
      (await getPresetInitialValues(presetById("call-for-critical-incidents")))
        .notificationChannels,
    ).toEqual([ComplianceNotificationChannel.Call]);
  });

  test("Push for critical alerts opens on Push alone", async () => {
    expect(
      (await getPresetInitialValues(presetById("push-for-critical-alerts")))
        .notificationChannels,
    ).toEqual([ComplianceNotificationChannel.Push]);
  });

  test("presets without channels open with none, which is any channel", async () => {
    for (const id of [
      "incident-rules-for-every-severity",
      "verified-phone-for-calls",
    ]) {
      const values: Values = await getPresetInitialValues(presetById(id));

      expect(values.notificationChannels).toBeUndefined();
      expect(Object.keys(values)).not.toContain("notificationChannel");
    }
  });

  /*
   * The presets are one shared table. The form edits the values it is given,
   * so a preset hands it a copy of its channels - picking another channel in
   * one form must not change what the next form opens with.
   */
  test("a preset hands the form a copy of its channels, never its own list", async () => {
    const preset: ComplianceRulePreset = presetById(
      "call-for-critical-incidents",
    );

    const first: Values = await getPresetInitialValues(preset);

    expect(first.notificationChannels).not.toBe(preset.notificationChannels);

    // What picking another channel in that form would do to its list.
    (first.notificationChannels as Array<ComplianceNotificationChannel>).push(
      ComplianceNotificationChannel.Push,
    );

    expect(preset.notificationChannels).toEqual([
      ComplianceNotificationChannel.Call,
    ]);
    expect((await getPresetInitialValues(preset)).notificationChannels).toEqual(
      [ComplianceNotificationChannel.Call],
    );
  });

  test("a preset opens in the preview exactly as it is named", async () => {
    expect(
      getRulePreviewText(
        await getPresetInitialValues(presetById("call-for-critical-incidents")),
      )?.title,
    ).toBe("Call for incidents");
    expect(
      getRulePreviewText(
        await getPresetInitialValues(presetById("push-for-critical-alerts")),
      )?.title,
    ).toBe("Push notification for alerts");
  });
});
