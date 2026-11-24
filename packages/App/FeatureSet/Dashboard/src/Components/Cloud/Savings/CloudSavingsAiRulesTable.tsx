import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CLOUD_RESOURCE_ENVIRONMENTS,
  CLOUD_RESOURCE_ENVIRONMENT_LABELS,
  CloudResourceEnvironment,
} from "Common/Types/Cloud/CloudResourceEnvironment";
import {
  CLOUD_SAVINGS_ACTION_GROUPS,
  CLOUD_SAVINGS_ACTION_GROUP_LABELS,
  CloudSavingsActionGroup,
} from "Common/Types/Cloud/CloudSavingsAction";
import {
  CLOUD_SAVINGS_AI_AUTONOMIES,
  CLOUD_SAVINGS_AI_AUTONOMY_LABELS,
  CLOUD_SAVINGS_AI_DEFAULT_MONTHLY_LIMIT,
  CloudSavingsAiAutonomy,
  getCloudSavingsAiRuleAutonomy,
  getCloudSavingsAiRuleLimit,
} from "Common/Types/Cloud/CloudSavingsAi";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import EnabledPill from "Common/UI/Components/Pill/EnabledPill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { getCloudProviderOptions } from "../CloudProviderOptions";

/*
 * AI RULES FOR SAVINGS (#11010): what OneUptime AI does with a saving it
 * could act on through the account's cloud connection - leave it, propose
 * it to the resource's owner, or make it without asking up to a monthly
 * limit - for the savings each rule matches by the kind of change, the
 * resource's environment and its cloud (Types/Cloud/CloudSavingsAi).
 *
 * One AI rule model is split between tables by its trigger, each reading
 * only its own, so a rule is edited in one place. With no rule, every
 * saving OneUptime could act on is proposed and nothing is made. Whatever a
 * rule says, production and resources whose environment nothing says
 * always wait for a person, and a change that cannot be undone always
 * asks.
 */

export const CLOUD_SAVINGS_AI_RULES_TABLE_ID: string = "cloud-savings-ai-rules";

export const RULES_TITLE: string = translationKey("Savings AI Rules");
export const RULES_DESCRIPTION: string = translationKey(
  "What OneUptime AI does with savings it can make. With no rule, it proposes every one; with rules, only those a rule covers.",
);
export const RULES_EMPTY: string = translationKey(
  "No AI rules for savings yet. OneUptime AI proposes every saving it can make to the resource's owner.",
);
export const RULES_WHAT_IT_DOES: string = translationKey("What It Does");
export const RULES_WHICH_SAVINGS: string = translationKey("Which Savings");
export const RULES_UP_TO: string = translationKey(
  "Without asking, up to {{amount}} a month",
);
export const RULES_EVERY_CHANGE: string = translationKey("Every change");
export const RULES_ANY_ENVIRONMENT: string = translationKey("Any environment");
export const RULES_EVERY_CLOUD: string = translationKey("Every cloud");
export const MATCH_STEP: string = translationKey("Which Savings");
export const AUTONOMY_STEP: string = translationKey("What OneUptime AI Does");

const triggerEntityType: AutoRemediationTriggerEntity =
  AutoRemediationTriggerEntity.CloudSaving;

const GROUP_OPTIONS: Array<DropdownOption> = CLOUD_SAVINGS_ACTION_GROUPS.map(
  (group: CloudSavingsActionGroup): DropdownOption => {
    return { label: CLOUD_SAVINGS_ACTION_GROUP_LABELS[group], value: group };
  },
);

const ENVIRONMENT_OPTIONS: Array<DropdownOption> =
  CLOUD_RESOURCE_ENVIRONMENTS.map(
    (environment: CloudResourceEnvironment): DropdownOption => {
      return {
        label: CLOUD_RESOURCE_ENVIRONMENT_LABELS[environment],
        value: environment,
      };
    },
  );

const AUTONOMY_OPTIONS: Array<DropdownOption> = CLOUD_SAVINGS_AI_AUTONOMIES.map(
  (autonomy: CloudSavingsAiAutonomy): DropdownOption => {
    return {
      label: CLOUD_SAVINGS_AI_AUTONOMY_LABELS[autonomy],
      value: autonomy,
    };
  },
);

// A new rule: stop idle non-production resources without asking, under the default limit.
export const NEW_SAVINGS_RULE_VALUES: FormValues<AutoRemediationRule> = {
  cloudSavingAutonomy: CloudSavingsAiAutonomy.WithoutAsking,
  cloudSavingActionGroups: [CloudSavingsActionGroup.Stop],
  cloudSavingEnvironments: [CloudResourceEnvironment.NonProduction],
  cloudSavingMonthlyLimit: CLOUD_SAVINGS_AI_DEFAULT_MONTHLY_LIMIT,
  isEnabled: true,
} as FormValues<AutoRemediationRule>;

function isRefusedReadingRules(): boolean {
  const gate: PermissionGateResult = PermissionGate.check(
    new AutoRemediationRule(),
    ModelAction.Read,
  );

  return !gate.isAllowed && Boolean(gate.disabledReason);
}

// "Stop idle instances and databases · Non-production · AWS": what a rule matches.
export function getSavingsRuleMatchText(
  rule: AutoRemediationRule,
  translator: Translator,
): string {
  const words: (keys: Array<string>, none: string) => string = (
    keys: Array<string>,
    none: string,
  ): string => {
    return keys.length > 0
      ? keys
          .map((key: string): string => {
            return translator.translateText(key) || key;
          })
          .join(", ")
      : translator.translateText(none) || none;
  };
  const providers: Array<DropdownOption> = getCloudProviderOptions();

  return [
    words(
      (rule.cloudSavingActionGroups || []).map((group: string): string => {
        return (
          CLOUD_SAVINGS_ACTION_GROUP_LABELS[group as CloudSavingsActionGroup] ||
          group
        );
      }),
      RULES_EVERY_CHANGE,
    ),
    words(
      (rule.cloudSavingEnvironments || []).map(
        (environment: string): string => {
          return (
            CLOUD_RESOURCE_ENVIRONMENT_LABELS[
              environment as CloudResourceEnvironment
            ] || environment
          );
        },
      ),
      RULES_ANY_ENVIRONMENT,
    ),
    words(
      (rule.cloudSavingProviders || []).map((provider: string): string => {
        return String(
          providers.find((option: DropdownOption): boolean => {
            return option.value === provider;
          })?.label || provider,
        );
      }),
      RULES_EVERY_CLOUD,
    ),
  ].join(" · ");
}

const CloudSavingsAiRulesTable: FunctionComponent = (): ReactElement | null => {
  const translator: Translator = useTranslator();

  if (isRefusedReadingRules()) {
    return null;
  }

  return (
    <ModelTable<AutoRemediationRule>
      modelType={AutoRemediationRule}
      rowSwitch={{ column: "isEnabled" }}
      id={CLOUD_SAVINGS_AI_RULES_TABLE_ID}
      userPreferencesKey={CLOUD_SAVINGS_AI_RULES_TABLE_ID}
      name="Savings AI Rules"
      query={{ triggerEntityType: triggerEntityType }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      isViewable={false}
      showRefreshButton={true}
      createEditModalWidth={ModalWidth.Large}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      cardProps={{ title: RULES_TITLE, description: RULES_DESCRIPTION }}
      noItemsMessage={RULES_EMPTY}
      createInitialValues={NEW_SAVINGS_RULE_VALUES}
      onBeforeCreate={(
        rule: AutoRemediationRule,
      ): Promise<AutoRemediationRule> => {
        rule.triggerEntityType = triggerEntityType;
        return Promise.resolve(rule);
      }}
      selectMoreFields={{
        isEnabled: true,
        cloudSavingAutonomy: true,
        cloudSavingMonthlyLimit: true,
        cloudSavingActionGroups: true,
        cloudSavingEnvironments: true,
        cloudSavingProviders: true,
      }}
      filters={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
      columns={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { cloudSavingAutonomy: true },
          title: RULES_WHAT_IT_DOES,
          type: FieldType.Element,
          disableSort: true,
          getElement: (rule: AutoRemediationRule): ReactElement => {
            const autonomy: CloudSavingsAiAutonomy =
              getCloudSavingsAiRuleAutonomy(rule);
            // A rule with no limit holds to the default, as the server does.
            const limit: number =
              getCloudSavingsAiRuleLimit(rule) ??
              CLOUD_SAVINGS_AI_DEFAULT_MONTHLY_LIMIT;

            return (
              <span className="text-sm text-gray-700">
                {autonomy === CloudSavingsAiAutonomy.WithoutAsking
                  ? translator.translateTemplate(RULES_UP_TO, {
                      // In each saving's own currency: a figure, never a symbol.
                      amount: translator.formatNumber(limit),
                    })
                  : translator.translateText(
                      CLOUD_SAVINGS_AI_AUTONOMY_LABELS[autonomy],
                    )}
              </span>
            );
          },
        },
        {
          field: { cloudSavingActionGroups: true },
          title: RULES_WHICH_SAVINGS,
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (rule: AutoRemediationRule): ReactElement => {
            return (
              <span className="text-sm text-gray-700">
                {getSavingsRuleMatchText(rule, translator)}
              </span>
            );
          },
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (rule: AutoRemediationRule): ReactElement => {
            return <EnabledPill isEnabled={rule.isEnabled} />;
          },
        },
      ]}
      /*
       * As every AI rule's form: which savings, then what OneUptime AI
       * may do with them, then the rule's name.
       */
      formSteps={[
        { title: MATCH_STEP, id: "match" },
        { title: AUTONOMY_STEP, id: "autonomy" },
        { title: "Name", id: "name" },
      ]}
      formFields={[
        {
          field: { cloudSavingActionGroups: true },
          hideColumnDescription: true,
          title: "Changes",
          stepId: "match",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownOptions: GROUP_OPTIONS,
          required: false,
          description:
            "Leave empty for every change. Released addresses and deleted snapshots are only ever proposed.",
        },
        {
          field: { cloudSavingEnvironments: true },
          hideColumnDescription: true,
          title: "Environments",
          stepId: "match",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownOptions: ENVIRONMENT_OPTIONS,
          required: false,
          description:
            "As each resource's environment tag, account and labels say. Leave empty for any.",
        },
        {
          field: { cloudSavingProviders: true },
          hideColumnDescription: true,
          title: "Clouds",
          stepId: "match",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownOptions: getCloudProviderOptions().map(
            (option: DropdownOption): DropdownOption => {
              return {
                label: option.label,
                value: option.value as CloudProvider,
              };
            },
          ),
          required: false,
          description: "Leave empty for every cloud.",
        },
        {
          field: { cloudSavingAutonomy: true },
          hideColumnDescription: true,
          title: "OneUptime AI",
          stepId: "autonomy",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: AUTONOMY_OPTIONS,
          required: true,
          description:
            "Production, and resources nothing says are not production, are always proposed, whatever this says.",
        },
        {
          field: { cloudSavingMonthlyLimit: true },
          hideColumnDescription: true,
          title: "Act Without Asking Up To",
          stepId: "autonomy",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          placeholder: String(CLOUD_SAVINGS_AI_DEFAULT_MONTHLY_LIMIT),
          description:
            "The most a saving may be worth a month to be made without asking. A larger one is proposed.",
        },
        {
          field: { name: true },
          title: "Name",
          stepId: "name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Stop idle development resources",
          validation: { minLength: 2 },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "name",
          collapsibleSection: getAdvancedFormSection<AutoRemediationRule>(),
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "What this rule is for.",
        },
      ]}
    />
  );
};

export default CloudSavingsAiRulesTable;
