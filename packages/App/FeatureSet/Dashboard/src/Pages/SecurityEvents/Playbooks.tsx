import PageComponentProps from "../PageComponentProps";
import SecurityPlaybookTemplatePicker, {
  getPlaybookViewRoute,
} from "../../Components/SecurityPlaybook/SecurityPlaybookTemplatePicker";
import {
  CREATE_FROM_TEMPLATE,
  PLAYBOOK_TEMPLATES_DESCRIPTION,
} from "../../Components/SecurityPlaybook/SecurityPlaybookTemplateModel";
import { getSecurityCasePriorityOptions } from "../../Components/SecurityCase/SecurityCaseValueOptions";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import useSecurityCaseValues from "../../Components/SecurityCase/useSecurityCaseValues";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green, Red } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecurityDetectionSource from "Common/Types/SecurityCase/SecurityDetectionSource";
import SecurityPlaybookTrigger from "Common/Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkSwitchActions from "Common/UI/Components/BulkUpdate/BulkSwitchActions";
import { BulkActionButtonSchema } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  SECURITY_PLAYBOOK_TRIGGER_FIELD_DESCRIPTION,
  getSecurityPlaybookTriggerOptions,
} from "../../Components/SecurityPlaybook/SecurityPlaybookTriggerOptions";
import useAiOffered from "../../Utils/UseAiOffered";
import React, { FunctionComponent, ReactElement, useState } from "react";

// The list's own names: "Create Playbook", "4 playbooks" - not the model's "Security Playbook".
export const PLAYBOOK_SINGULAR_NAME: string = translationKey("Playbook");
export const PLAYBOOK_PLURAL_NAME: string = translationKey("Playbooks");

/*
 * The project's playbooks: what each does when it runs by itself. A new one
 * starts from a template or blank, and opens on its own page to add steps.
 * The templates are the empty list's, and Create from Template's once there
 * are playbooks (SecurityPlaybookTemplatePicker).
 */
const SecurityPlaybooksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  // The project's case priorities, which a playbook's minimum is one of.
  const { values } = useSecurityCaseValues();
  const [showTemplates, setShowTemplates] = useState<boolean>(false);
  // The blank playbook's form, opened from the empty list's templates.
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

  /*
   * Enable and Disable in Bulk Actions: a disabled playbook stops running on
   * its own, and can still be run by hand from a case.
   */
  const switchBulkActions: Array<BulkActionButtonSchema<SecurityPlaybook>> =
    useBulkSwitchActions<SecurityPlaybook>({
      modelType: SecurityPlaybook,
      column: "isEnabled",
    });

  /*
   * Create from Template, beside Create Playbook: the templates, each
   * Added or one click from a working playbook, in a dialog.
   */
  const templatesButton: CardButtonSchema | null =
    PermissionGate.gateCardButton(
      {
        title: CREATE_FROM_TEMPLATE,
        buttonStyle: ButtonStyleType.OUTLINE,
        icon: IconProp.Template,
        onClick: (): void => {
          setShowTemplates(true);
        },
      },
      new SecurityPlaybook(),
      ModelAction.Create,
    );

  return (
    <div className="space-y-6">
      <ModelTable<SecurityPlaybook>
        modelType={SecurityPlaybook}
        id="security-playbooks-table"
        name="Security Events > Playbooks"
        userPreferencesKey="security-playbooks-table"
        query={{ projectId: ProjectUtil.getCurrentProjectId()! }}
        isDeleteable={true}
        bulkActions={{
          buttons: [...switchBulkActions],
        }}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        viewButtonText="View"
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SECURITY_PLAYBOOKS] as Route,
        )}
        onCreateSuccess={(
          item: SecurityPlaybook,
        ): Promise<SecurityPlaybook> => {
          if (item._id) {
            Navigation.navigate(
              getPlaybookViewRoute(new ObjectID(item._id.toString())),
            );
          }

          return Promise.resolve(item);
        }}
        singularName={PLAYBOOK_SINGULAR_NAME}
        pluralName={PLAYBOOK_PLURAL_NAME}
        cardProps={{
          title: "Playbooks",
          description:
            "Responses that run on a case, such as notifying, paging on-call or containing a host. They run when a case opens or grows, or by hand.",
          buttons: templatesButton ? [templatesButton] : [],
        }}
        // An empty list offers the templates, and a blank playbook.
        noItemsMessage={
          <SecurityPlaybookTemplatePicker
            showIntro={true}
            onCreateBlank={(): void => {
              setShowCreateForm(true);
            }}
          />
        }
        showCreateForm={showCreateForm}
        onCreateEditModalClose={(): void => {
          setShowCreateForm(false);
        }}
        createInitialValues={{
          isEnabled: true,
          trigger: SecurityPlaybookTrigger.CaseOpened,
        }}
        formSteps={[
          { title: "Playbook", id: "playbook" },
          { title: "When It Runs", id: "when" },
        ]}
        formFields={[
          {
            field: { name: true },
            stepId: "playbook",
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Contain compromised accounts",
          },
          {
            field: { description: true },
            stepId: "playbook",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
          },
          {
            field: { trigger: true },
            stepId: "when",
            title: "Trigger",
            description: SECURITY_PLAYBOOK_TRIGGER_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.Dropdown,
            // Each says when it runs; the AI one only while AI is on.
            dropdownOptions: getSecurityPlaybookTriggerOptions({
              isAiOffered,
              isEditing: false,
            }),
            required: true,
          },
          {
            field: { minimumSecurityCasePriorityId: true },
            stepId: "when",
            title: "For Cases At Least",
            description: "Optional. Only cases of this priority or higher.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: getSecurityCasePriorityOptions(
              values?.priorities || [],
            ),
            required: false,
          },
          {
            field: { detectionSource: true },
            stepId: "when",
            title: "Only For Detections From",
            description:
              "Optional. Only when the detection behind the case came from this source.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              SecurityDetectionSource,
            ),
            required: false,
          },
          {
            field: { isEnabled: true },
            stepId: "playbook",
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        filters={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
          {
            field: { isEnabled: true },
            title: "Enabled",
            type: FieldType.Boolean,
          },
          {
            field: { trigger: true },
            title: "Trigger",
            type: FieldType.Dropdown,
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              SecurityPlaybookTrigger,
            ),
          },
        ]}
        selectMoreFields={{
          description: true,
          steps: true,
          isEnabled: true,
          minimumSecurityCasePriority: { name: true },
        }}
        columns={[
          {
            field: { name: true },
            title: "Playbook",
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xl",
            getElement: (item: SecurityPlaybook): ReactElement => {
              const stepCount: number = Array.isArray(item.steps)
                ? item.steps.length
                : 0;

              return (
                <div className="min-w-[14rem]">
                  <div className="break-words font-medium text-gray-900">
                    {item.name || ""}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                    {translator.translatePlural(
                      { one: "{{count}} step", other: "{{count}} steps" },
                      stepCount,
                    )}
                    {item.description ? ` · ${item.description}` : ""}
                  </div>
                </div>
              );
            },
          },
          {
            field: { isEnabled: true },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: SecurityPlaybook): ReactElement => {
              // As every list of the Dashboard draws a switch: Enabled green, Disabled red.
              return item.isEnabled ? (
                <Pill color={Green} text="Enabled" />
              ) : (
                <Pill color={Red} text="Disabled" />
              );
            },
          },
          {
            field: { trigger: true },
            title: "Trigger",
            type: FieldType.Element,
            getElement: (item: SecurityPlaybook): ReactElement => {
              return (
                <div className="text-sm text-gray-700">
                  <div>
                    {translator.translateText(item.trigger || "") ||
                      item.trigger}
                  </div>
                  {item.minimumSecurityCasePriority?.name ? (
                    <div className="text-xs text-gray-500">
                      {translator.translateTemplate("{{priority}} and up", {
                        priority:
                          translator.translateText(
                            item.minimumSecurityCasePriority.name,
                          ) || item.minimumSecurityCasePriority.name,
                      })}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { runCount: true },
            title: "Runs So Far",
            type: FieldType.Number,
            hideOnMobile: true,
          },
          {
            field: { lastRunAt: true },
            title: "Last Run",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: SecurityPlaybook): ReactElement => {
              if (!item.lastRunAt) {
                return (
                  <span className="text-sm text-gray-400">
                    {translator.translateText("Never")}
                  </span>
                );
              }

              return (
                <span
                  className="text-sm text-gray-700"
                  title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    item.lastRunAt,
                  )}
                >
                  {OneUptimeDate.fromNow(item.lastRunAt)}
                </span>
              );
            },
          },
        ]}
      />

      {showTemplates ? (
        <Modal
          title={CREATE_FROM_TEMPLATE}
          description={PLAYBOOK_TEMPLATES_DESCRIPTION}
          modalWidth={ModalWidth.Large}
          onClose={(): void => {
            setShowTemplates(false);
          }}
        >
          <SecurityPlaybookTemplatePicker />
        </Modal>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityPlaybooksPage;
