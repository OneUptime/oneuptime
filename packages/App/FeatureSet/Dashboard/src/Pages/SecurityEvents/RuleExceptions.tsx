import PageComponentProps from "../PageComponentProps";
import {
  RuleExceptionAddedByCell,
  RuleExceptionSkipsCell,
  RuleExceptionStatusCell,
} from "../../Components/SecurityEvents/RuleExceptions/RuleExceptionCells";
import {
  RULE_EXCEPTION_FORM_STEPS,
  getRuleExceptionFormFields,
  getRuleExceptionWindowDefaults,
} from "../../Components/SecurityEvents/RuleExceptions/RuleExceptionFormFields";
import {
  ADDED_BY_COLUMN_TITLE,
  REASON_COLUMN_TITLE,
  RULE_COLUMN_TITLE,
  RULE_EXCEPTIONS_EMPTY_DESCRIPTION,
  RULE_EXCEPTIONS_EMPTY_TITLE,
  RULE_EXCEPTIONS_TABLE_DESCRIPTION,
  RULE_EXCEPTIONS_TABLE_TITLE,
  RULE_EXCEPTION_PLURAL,
  RULE_EXCEPTION_SINGULAR,
  RULE_NOT_FOUND,
  SKIPS_COLUMN_TITLE,
  STATUS_COLUMN_TITLE,
} from "../../Components/SecurityEvents/RuleExceptions/RuleExceptionsCopy";
import { getRuleExceptionInitialValues } from "../../Components/SecurityEvents/RuleExceptions/RuleExceptionsModel";
import {
  RULE_EXCEPTIONS_RULE_FILTER_KEY,
  RULE_EXCEPTIONS_TABLE_ID,
} from "../../Components/SecurityEvents/RuleExceptions/RuleExceptionsRoute";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import DetectionRuleException from "Common/Models/DatabaseModels/DetectionRuleException";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { DETECTION_RULE_EXCEPTION_KINDS } from "Common/Types/SecurityEvent/DetectionRuleException";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import {
  ModalTableBulkDefaultActions,
  ModalType,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

function kindFilterOptions(): Array<DropdownOption> {
  return DETECTION_RULE_EXCEPTION_KINDS.map((kind: string): DropdownOption => {
    return { label: kind, value: kind };
  });
}

/*
 * SECURITY EVENTS > DETECTIONS > RULE EXCEPTIONS: everything the project's
 * detection rules skip - an entity, a value or a time window - each with
 * who added it, why and until when. One list, so the blind spots a team
 * chose are reviewed in one place rather than rule by rule.
 *
 * A rule's View Exceptions lands here filtered to that rule (its Rule
 * filter, in the address: RuleExceptionsRoute); Add Rule Exception, a
 * rule's Add Exception and a case's detection open the same form
 * (RuleExceptionFormFields).
 */
const SecurityRuleExceptionsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  /*
   * Which form the table opens: a new exception's expiry must be ahead, an
   * edit keeps the one it has (the API checks a changed one). A hook, so
   * above the reseller gate.
   */
  const [isCreateForm, setIsCreateForm] = useState<boolean>(true);

  // Same reseller-telemetry gate as every other Security Events page.
  if (props.currentProject?.reseller?.enableTelemetryFeatures === false) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  if (!projectId) {
    return <></>;
  }

  return (
    <ModelTable<DetectionRuleException>
      modelType={DetectionRuleException}
      id={RULE_EXCEPTIONS_TABLE_ID}
      name="Security Events > Rule Exceptions"
      userPreferencesKey={RULE_EXCEPTIONS_TABLE_ID}
      singularName={RULE_EXCEPTION_SINGULAR}
      pluralName={RULE_EXCEPTION_PLURAL}
      createVerb="Add"
      query={{ projectId: projectId }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      isViewable={false}
      bulkActions={{
        buttons: [ModalTableBulkDefaultActions.Delete],
      }}
      sortBy="createdAt"
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: RULE_EXCEPTIONS_TABLE_TITLE,
        description: RULE_EXCEPTIONS_TABLE_DESCRIPTION,
      }}
      emptyState={{
        title: RULE_EXCEPTIONS_EMPTY_TITLE,
        description: RULE_EXCEPTIONS_EMPTY_DESCRIPTION,
        icon: IconProp.EyeSlash,
      }}
      createInitialValues={
        {
          ...getRuleExceptionInitialValues({}),
          ...getRuleExceptionWindowDefaults(OneUptimeDate.getCurrentDate()),
        } as FormValues<DetectionRuleException>
      }
      onShowFormType={(formType: ModalType) => {
        setIsCreateForm(formType === ModalType.Create);
      }}
      formSteps={RULE_EXCEPTION_FORM_STEPS}
      formFields={getRuleExceptionFormFields({
        translator,
        isCreate: isCreateForm,
      })}
      showRefreshButton={true}
      searchableFields={["value", "fieldName", "reason"]}
      filters={[
        {
          field: { [RULE_EXCEPTIONS_RULE_FILTER_KEY]: true },
          title: "Rule",
          type: FieldType.Entity,
          filterEntityType: DetectionRule,
          filterQuery: { projectId: projectId },
          filterDropdownField: { label: "name", value: "_id" },
        },
        {
          field: { kind: true },
          title: "Kind",
          type: FieldType.Dropdown,
          filterDropdownOptions: kindFilterOptions(),
        },
      ]}
      selectMoreFields={{
        kind: true,
        entityType: true,
        fieldName: true,
        startsAt: true,
        endsAt: true,
        expiresAt: true,
        createdAt: true,
        detectionRuleId: true,
      }}
      columns={[
        {
          field: { value: true },
          title: SKIPS_COLUMN_TITLE,
          type: FieldType.Element,
          disableSort: true,
          getElement: (item: DetectionRuleException): ReactElement => {
            return <RuleExceptionSkipsCell exception={item} />;
          },
        },
        {
          field: { detectionRule: { name: true } },
          title: RULE_COLUMN_TITLE,
          type: FieldType.Element,
          disableSort: true,
          getElement: (item: DetectionRuleException): ReactElement => {
            const name: string = item.detectionRule?.name || "";

            return name ? (
              <span className="block min-w-[8rem] text-sm text-gray-900">
                <IsolatedText text={name} />
              </span>
            ) : (
              <span className="text-sm text-gray-400">
                {translator.translateText(RULE_NOT_FOUND)}
              </span>
            );
          },
        },
        {
          field: { reason: true },
          title: REASON_COLUMN_TITLE,
          type: FieldType.LongText,
          wrapContent: true,
          hideOnMobile: true,
        },
        {
          field: { expiresAt: true },
          title: STATUS_COLUMN_TITLE,
          type: FieldType.Element,
          disableSort: true,
          getElement: (item: DetectionRuleException): ReactElement => {
            return (
              <RuleExceptionStatusCell
                exception={item}
                now={OneUptimeDate.getCurrentDate()}
              />
            );
          },
        },
        {
          field: {
            createdByUser: { name: true, email: true, profilePictureId: true },
          },
          title: ADDED_BY_COLUMN_TITLE,
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (item: DetectionRuleException): ReactElement => {
            return (
              <RuleExceptionAddedByCell
                name={
                  item.createdByUser?.name?.toString() ||
                  item.createdByUser?.email?.toString() ||
                  undefined
                }
                createdAt={item.createdAt}
              />
            );
          },
        },
      ]}
    />
  );
};

export default SecurityRuleExceptionsPage;
