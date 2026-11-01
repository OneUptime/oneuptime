import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import AIPostmortemRule from "Common/Models/DatabaseModels/AIPostmortemRule";
import IncidentPostmortemTemplate from "Common/Models/DatabaseModels/IncidentPostmortemTemplate";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { Green, Red } from "Common/Types/BrandColors";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useMemo,
  useRef,
} from "react";
import {
  RuleLlmProviderChoices,
  withRuleLlmProviderSummary,
} from "../AI/RuleLlmProviderCopy";
import {
  getRuleLlmProviderFormField,
  useRuleLlmProviderChoices,
} from "../AI/RuleLlmProviderField";
import {
  AI_LANE_ADVANCED_CARD_TITLES,
  AI_POSTMORTEM_RULES_TABLE_ID,
  AiLane,
  AiLaneAdvancedCard,
} from "./ProjectAiSettingsCopy";
import { reportEnabledAiLaneRuleCount } from "./AiLaneRuleCount";
import {
  POSTMORTEM_RULE_NAME_DESCRIPTION,
  POSTMORTEM_RULE_NAME_PLACEHOLDER,
  POSTMORTEM_RULE_STANDARD_OUTLINE,
  POSTMORTEM_RULE_TEMPLATES_COLUMN_TITLE,
  POSTMORTEM_RULE_TEMPLATES_DESCRIPTION,
  POSTMORTEM_RULE_TEMPLATES_TITLE,
  POSTMORTEM_RULES_CARD_DESCRIPTION,
  POSTMORTEM_RULES_CARD_DESCRIPTION_WITHOUT_TEMPLATES,
  POSTMORTEM_RULES_NO_ITEMS_MESSAGE,
} from "./PostmortemRulesCopy";
import {
  canPickPostmortemTemplates,
  followTemplatesWithRuleName,
  getNewPostmortemRuleValues,
} from "./PostmortemRuleForm";
import PostmortemRuleTemplates, {
  POSTMORTEM_RULE_TEMPLATES_COLUMN_CLASS_NAME,
  POSTMORTEM_RULE_TEXT_COLUMN_FLOOR_CLASS_NAME,
} from "./PostmortemRuleTemplates";
import {
  RULE_ENABLED_DESCRIPTION,
  RULE_NAME_MAX_LENGTH,
} from "../../Utils/Form/ResourceRuleForm";

export interface ComponentProps {
  // How many enabled rules there are, after every read of the table.
  onRulesLoaded?: ((count: number) => void) | undefined;
}

/*
 * What most rules leave alone, folded under More fields on the Draft step:
 * the LLM provider OneUptime AI drafts with (none picked: the default
 * provider, which the folded line names) and the description. Built once
 * per table, so the form folds it the same way each time.
 */
export function getPostmortemRuleMoreFields(
  getLlmProviderChoices: () => RuleLlmProviderChoices | null,
): FormFieldCollapsibleSection<AIPostmortemRule> {
  return getAdvancedFormSection<AIPostmortemRule>({
    getSummary: (
      values: FormValues<AIPostmortemRule>,
    ): Array<string> | undefined => {
      return withRuleLlmProviderSummary(
        undefined,
        values,
        getLlmProviderChoices(),
      );
    },
  });
}

/*
 * Incidents → AI → Settings → More settings → Postmortem rules: which
 * resolved incidents OneUptime AI drafts a postmortem for, while "Draft a
 * postmortem when an incident resolves" is on, and the templates each draft
 * follows. With no rule, every resolved incident gets a draft in the
 * standard outline; with rules, only the incidents one matches do, and the
 * first rule that matches, from the top, decides - so the rules are put in
 * order by dragging, as every list whose order decides something is.
 *
 * A rule asks what the project's other incident rules ask: what it matches
 * (Match: the same conditions as an investigation rule, drawn as one
 * conditions builder that starts on "All incidents"), then what it does
 * (Draft: the templates the draft may follow - none for the standard
 * outline, several for OneUptime AI to pick the best fit - and the rule's
 * name, filled in from them). Words in PostmortemRulesCopy.
 */
const AIPostmortemRulesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Postmortem templates need the Growth plan on OneUptime Cloud: a project
   * below it is not offered them, and its drafts follow the standard
   * outline (the server holds the same rule).
   */
  const offersTemplates: boolean = canPickPostmortemTemplates();

  /*
   * The project's LLM providers, for the folded More fields line to name a
   * rule's provider - or the default one - by. Read through a ref: a form
   * may hold on to the fields it was opened with.
   */
  const llmProviderChoices: RuleLlmProviderChoices | null =
    useRuleLlmProviderChoices();
  const llmProviderChoicesRef: MutableRefObject<RuleLlmProviderChoices | null> =
    useRef<RuleLlmProviderChoices | null>(llmProviderChoices);
  llmProviderChoicesRef.current = llmProviderChoices;

  const moreFields: FormFieldCollapsibleSection<AIPostmortemRule> =
    useMemo(() => {
      return getPostmortemRuleMoreFields((): RuleLlmProviderChoices | null => {
        return llmProviderChoicesRef.current;
      });
    }, []);

  return (
    <ModelTable<AIPostmortemRule>
      modelType={AIPostmortemRule}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      rowSwitch={{ column: "isEnabled" }}
      id={AI_POSTMORTEM_RULES_TABLE_ID}
      name="Settings > AI > Postmortem Rules"
      userPreferencesKey={AI_POSTMORTEM_RULES_TABLE_ID}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      // The first rule that matches decides, from the top; a new one goes last.
      sortBy="order"
      sortOrder={SortOrder.Ascending}
      enableDragAndDrop={true}
      dragDropIndexField="order"
      // Named after the standard outline until a template is picked.
      createInitialValues={getNewPostmortemRuleValues<AIPostmortemRule>()}
      onFetchSuccess={() => {
        void reportEnabledAiLaneRuleCount<AIPostmortemRule>({
          modelType: AIPostmortemRule,
          onRulesLoaded: props.onRulesLoaded,
        });
      }}
      cardProps={{
        /*
         * Its place in an incident's AI More settings: the name the folded
         * header lists it by, so a link to it lands here.
         */
        id: AiLaneAdvancedCard.PostmortemRules,
        title:
          AI_LANE_ADVANCED_CARD_TITLES[AiLane.Incident][
            AiLaneAdvancedCard.PostmortemRules
          ],
        description: offersTemplates
          ? POSTMORTEM_RULES_CARD_DESCRIPTION
          : POSTMORTEM_RULES_CARD_DESCRIPTION_WITHOUT_TEMPLATES,
      }}
      noItemsMessage={POSTMORTEM_RULES_NO_ITEMS_MESSAGE}
      selectMoreFields={{ isEnabled: true }}
      filters={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
      columns={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
          /*
           * A rule's name on as many lines as it needs. Beside Match
           * Criteria, Templates and Status, the column is narrow on a
           * 1280px screen, and cut short on one line every name read
           * "Draft with Database..." - the part that tells rules apart was
           * the part cut off. Never narrower than 8rem, so the table fits
           * in German and Russian too.
           */
          wrapContent: true,
          contentClassName: POSTMORTEM_RULE_TEXT_COLUMN_FLOOR_CLASS_NAME,
        },
        ...(offersTemplates
          ? [
              {
                field: { postmortemTemplates: { templateName: true } },
                title: POSTMORTEM_RULE_TEMPLATES_COLUMN_TITLE,
                type: FieldType.EntityArray,
                /*
                 * One template a line, cut short at a width that leaves
                 * every column in sight beside the side menu at 1280px -
                 * Status included (PostmortemRuleTemplates).
                 */
                wrapContent: true,
                wrapMaxWidthClassName:
                  POSTMORTEM_RULE_TEMPLATES_COLUMN_CLASS_NAME,
                contentClassName: POSTMORTEM_RULE_TEXT_COLUMN_FLOOR_CLASS_NAME,
                getElement: (item: AIPostmortemRule): ReactElement => {
                  return (
                    <PostmortemRuleTemplates
                      templates={item.postmortemTemplates}
                    />
                  );
                },
              },
            ]
          : []),
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: AIPostmortemRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
      formSteps={[
        { title: "Match", id: "match-criteria" },
        { title: "Draft", id: "postmortem-draft" },
      ]}
      formFields={[
        // Match: drawn as one conditions builder, on "All incidents".
        {
          field: { monitors: true },
          title: "Monitors",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Monitor,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Monitors",
        },
        {
          field: { incidentSeverities: true },
          title: "Incident Severities",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: IncidentSeverity,
            labelField: "name",
            valueField: "_id",
            sort: {
              order: SortOrder.Ascending,
            },
          },
          required: false,
          placeholder: "Select Severities",
        },
        {
          field: { labels: true },
          title: "Incident Labels",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Labels",
        },
        {
          field: { monitorLabels: true },
          title: "Monitor Labels",
          description:
            "Only match incidents whose monitor has one of these labels.",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Monitor Labels",
        },
        {
          field: { titlePattern: true },
          title: "Incident Title",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "database|postgres|db-",
        },
        {
          field: { descriptionPattern: true },
          title: "Incident Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "timeout|connection refused",
        },
        /*
         * Draft: the templates the draft may follow - none for the standard
         * outline - then the rule's name, filled in from them.
         */
        ...(offersTemplates
          ? [
              {
                field: { postmortemTemplates: true },
                title: POSTMORTEM_RULE_TEMPLATES_TITLE,
                description: POSTMORTEM_RULE_TEMPLATES_DESCRIPTION,
                stepId: "postmortem-draft",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: IncidentPostmortemTemplate,
                  labelField: "templateName",
                  valueField: "_id",
                  sort: {
                    templateName: SortOrder.Ascending,
                  },
                },
                required: false,
                // What no template means, said where none is picked.
                placeholder: POSTMORTEM_RULE_STANDARD_OUTLINE,
                onChange: followTemplatesWithRuleName<AIPostmortemRule>(),
              },
            ]
          : []),
        {
          field: { name: true },
          title: "Name",
          /*
           * Named after its templates - when there are templates to pick.
           * Otherwise it needs no help: "Name of this postmortem rule.",
           * the column's own description, says nothing the title does not.
           */
          description: offersTemplates ? POSTMORTEM_RULE_NAME_DESCRIPTION : "",
          hideColumnDescription: true,
          stepId: "postmortem-draft",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: POSTMORTEM_RULE_NAME_PLACEHOLDER,
          validation: {
            minLength: 2,
            maxLength: RULE_NAME_MAX_LENGTH,
          },
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          description: RULE_ENABLED_DESCRIPTION,
          stepId: "postmortem-draft",
          fieldType: FormFieldSchemaType.Toggle,
          // A rule starts on: the switch is on its edit form only.
          doNotShowWhenCreating: true,
          required: false,
        },
        // The LLM provider OneUptime AI drafts with: none is the default.
        getRuleLlmProviderFormField<AIPostmortemRule>({
          stepId: "postmortem-draft",
          collapsibleSection: moreFields,
          dataTestId: "ai-postmortem-rule-llm-provider-field",
          getChoices: (): RuleLlmProviderChoices | null => {
            return llmProviderChoicesRef.current;
          },
        }),
        {
          field: { description: true },
          title: "Description",
          stepId: "postmortem-draft",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          collapsibleSection: moreFields,
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default AIPostmortemRulesTable;
