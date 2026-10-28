import PageComponentProps from "../../PageComponentProps";
import { SecurityCasePriorityPill } from "../../../Components/SecurityCase/SecurityCasePills";
import {
  ResponseTargetEntry,
  ResponseTargetUnit,
  getTargetFieldError,
} from "../../../Components/SecurityCase/ResponseTargets/ResponseTargetDuration";
import ResponseTargetDurationField from "../../../Components/SecurityCase/ResponseTargets/ResponseTargetDurationField";
import {
  RESPONSE_TARGETS_COPY,
  RESPONSE_TARGETS_TEST_IDS,
} from "../../../Components/SecurityCase/ResponseTargets/ResponseTargetsCopy";
import { invalidateSecurityCaseValues } from "../../../Components/SecurityCase/SecurityCaseValues";
import { getCompactDurationParts } from "../../../Utils/CompactDuration";
import { formatEventDurationParts } from "../../../Utils/EventDuration";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { readTargetMinutes } from "Common/Utils/SecurityCase/SecurityCaseTargets";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Security Events > Settings > Response Targets: how fast a case at each of
 * the project's priorities must be taken on (Acknowledge Within) and
 * contained or closed (Contain Within). One row a priority, in the
 * priorities' order, most urgent first; Edit sets its two targets, each a
 * number and a unit, empty for none.
 *
 * A case's due times come from these as it opens, and move with its
 * priority (Common/Utils/SecurityCase/SecurityCaseTargets); a case about to
 * miss one, or missing it, tells the people on it. A new project's built-in
 * priorities start with targets; one made before them shows "No target"
 * until somebody sets them. Priorities themselves - their names and
 * colours - are under Case Priorities; an archived one is left out, as
 * nothing new is put at it. Like every list of priorities, its rows drag
 * into another order. Edit names the priority it opens for.
 */
const SecurityResponseTargetsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * A target in the reader's words, whole: "15 minutes", "4 hours", "1 day"
   * - "No target" for none. A settings table has the room; "1 d" and "7 d"
   * were the product's compact figures, made for a stat tile.
   */
  const TargetCell: (props: { minutes: unknown }) => ReactElement = (props: {
    minutes: unknown;
  }): ReactElement => {
    const minutes: number | null = readTargetMinutes(props.minutes);

    if (minutes === null) {
      return (
        <span className="text-sm text-gray-400">
          {translator.translateText(RESPONSE_TARGETS_COPY.noTarget)}
        </span>
      );
    }

    return (
      <span className="whitespace-nowrap text-sm font-medium text-gray-700">
        {formatEventDurationParts(
          getCompactDurationParts(minutes),
          translator.language,
        )}
      </span>
    );
  };

  return (
    <ModelTable<SecurityCasePriority>
      modelType={SecurityCasePriority}
      id={RESPONSE_TARGETS_TEST_IDS.table}
      userPreferencesKey="security-response-targets-table"
      name="Security Events > Settings > Response Targets"
      singularName={RESPONSE_TARGETS_COPY.singularName}
      pluralName={RESPONSE_TARGETS_COPY.pluralName}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        isArchived: false,
      }}
      isDeleteable={false}
      isEditable={true}
      isCreateable={false}
      disablePagination={true}
      /*
       * In the priorities' order, most urgent first, and dragged into
       * another as every list of them is (DragOrderedListsGuard: the
       * maintainer asked for every ordered list to drag).
       */
      enableDragAndDrop={true}
      dragDropIndexField="order"
      sortBy="order"
      sortOrder={SortOrder.Ascending}
      // Which priority's targets the dialog edits.
      editFormTitle={(item: SecurityCasePriority): string => {
        const name: string = item.name?.toString() || "";

        return translator.translateTemplate(RESPONSE_TARGETS_COPY.editTitle, {
          priority: translator.translateText(name) || name,
        });
      }}
      cardProps={{
        title: RESPONSE_TARGETS_COPY.title,
        description: RESPONSE_TARGETS_COPY.description,
      }}
      onFetchSuccess={() => {
        // Every case page and list reads the new targets, not a cached list.
        invalidateSecurityCaseValues();
      }}
      selectMoreFields={{
        color: true,
      }}
      filters={[]}
      viewPageRoute={Navigation.getCurrentRoute()}
      showRefreshButton={true}
      columns={[
        {
          field: { name: true },
          title: RESPONSE_TARGETS_COPY.priorityColumn,
          type: FieldType.Element,
          isNotCustomizable: true,
          // A phone's card opens with the priority's pill: it names itself.
          hideTitleOnMobile: true,
          getElement: (item: SecurityCasePriority): ReactElement => {
            return <SecurityCasePriorityPill value={item} />;
          },
        },
        {
          field: { acknowledgeWithinInMinutes: true },
          title: RESPONSE_TARGETS_COPY.acknowledgeColumn,
          headerTooltip: RESPONSE_TARGETS_COPY.acknowledgeTooltip,
          type: FieldType.Element,
          getElement: (item: SecurityCasePriority): ReactElement => {
            return <TargetCell minutes={item.acknowledgeWithinInMinutes} />;
          },
        },
        {
          field: { containWithinInMinutes: true },
          title: RESPONSE_TARGETS_COPY.containColumn,
          headerTooltip: RESPONSE_TARGETS_COPY.containTooltip,
          type: FieldType.Element,
          getElement: (item: SecurityCasePriority): ReactElement => {
            return <TargetCell minutes={item.containWithinInMinutes} />;
          },
        },
      ]}
      formFields={[
        {
          field: { acknowledgeWithinInMinutes: true },
          title: RESPONSE_TARGETS_COPY.acknowledgeColumn,
          description: RESPONSE_TARGETS_COPY.acknowledgeFieldDescription,
          fieldType: FormFieldSchemaType.CustomComponent,
          required: false,
          hideColumnDescription: true,
          customValidation: (
            values: FormValues<SecurityCasePriority>,
          ): string | null => {
            const error: string | null = getTargetFieldError(
              values.acknowledgeWithinInMinutes,
            );

            return error ? translator.translateText(error) || error : null;
          },
          getCustomElement: (
            values: FormValues<SecurityCasePriority>,
            props: CustomElementProps,
          ): ReactElement => {
            return (
              <ResponseTargetDurationField
                initialMinutes={
                  values.acknowledgeWithinInMinutes as number | null
                }
                emptyUnit={ResponseTargetUnit.Minutes}
                error={props.error}
                ariaLabelledby={props.ariaLabelledby}
                ariaDescribedby={props.ariaDescribedby}
                tabIndex={props.tabIndex}
                onChange={(value: number | null | ResponseTargetEntry) => {
                  props.onChange?.(value);
                }}
              />
            );
          },
        },
        {
          field: { containWithinInMinutes: true },
          title: RESPONSE_TARGETS_COPY.containColumn,
          description: RESPONSE_TARGETS_COPY.containFieldDescription,
          fieldType: FormFieldSchemaType.CustomComponent,
          required: false,
          hideColumnDescription: true,
          customValidation: (
            values: FormValues<SecurityCasePriority>,
          ): string | null => {
            const error: string | null = getTargetFieldError(
              values.containWithinInMinutes,
            );

            return error ? translator.translateText(error) || error : null;
          },
          getCustomElement: (
            values: FormValues<SecurityCasePriority>,
            props: CustomElementProps,
          ): ReactElement => {
            return (
              <ResponseTargetDurationField
                initialMinutes={values.containWithinInMinutes as number | null}
                emptyUnit={ResponseTargetUnit.Hours}
                error={props.error}
                ariaLabelledby={props.ariaLabelledby}
                ariaDescribedby={props.ariaDescribedby}
                tabIndex={props.tabIndex}
                onChange={(value: number | null | ResponseTargetEntry) => {
                  props.onChange?.(value);
                }}
              />
            );
          },
        },
      ]}
    />
  );
};

export default SecurityResponseTargetsPage;
