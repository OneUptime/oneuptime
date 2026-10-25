import PageComponentProps from "../PageComponentProps";
import {
  SECURITY_PLAYBOOK_TEMPLATES,
  SecurityPlaybookTemplate,
} from "../../Components/SecurityPlaybook/SecurityPlaybookTemplates";
import {
  TurnOnRecommendedProblem,
  describeAddFailure,
} from "../../Components/SecurityOverview/SecuritySetupModel";
import SecurityTurnOnProblems, {
  bringProblemsIntoView,
} from "../../Components/SecurityOverview/SecurityTurnOnProblems";
import {
  SecurityCaseValueLists,
  getSecurityCaseValues,
} from "../../Components/SecurityCase/SecurityCaseValues";
import { getSecurityCasePriorityOptions } from "../../Components/SecurityCase/SecurityCaseValueOptions";
import useSecurityCaseValues from "../../Components/SecurityCase/useSecurityCaseValues";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green, Gray500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import SecurityDetectionSource from "Common/Types/SecurityCase/SecurityDetectionSource";
import {
  TurnOnRecommendedAction,
  TurnOnRecommendedPart,
} from "Common/Types/SecurityEvent/TurnOnRecommended";
import SecurityPlaybookTrigger from "Common/Types/SecurityPlaybook/SecurityPlaybookTrigger";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import {
  SwitchActionsResult,
  useSwitchActions,
} from "Common/UI/Components/BulkUpdate/BulkSwitchActions";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { buildSecurityPlaybookFromTemplate } from "Common/Utils/SecurityEvent/SecurityTemplateRecords";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  SECURITY_PLAYBOOK_TRIGGER_FIELD_DESCRIPTION,
  getSecurityPlaybookTriggerOptions,
} from "../../Components/SecurityPlaybook/SecurityPlaybookTriggerOptions";
import useAiOffered from "../../Utils/UseAiOffered";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

// What the templates say when the one a reader picked could not be added (SecurityTurnOnProblems).
export const PLAYBOOK_NOT_ADDED_TITLE: string = translationKey(
  "The playbook could not be added",
);

function getPlaybookViewRoute(id: ObjectID): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_PLAYBOOK_VIEW] as Route,
    { modelId: id },
  );
}

/*
 * The project's playbooks: what each does when it runs by itself. A new one
 * starts from a template or blank, and opens on its own page to add steps.
 */
const SecurityPlaybooksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  // The project's case priorities, which a playbook's minimum is one of.
  const { values } = useSecurityCaseValues();
  // Why the template picked last could not become a playbook, as the Rule Library says a rule's.
  const [failure, setFailure] = useState<TurnOnRecommendedProblem | null>(null);
  const [creatingKey, setCreatingKey] = useState<string>("");
  const failureRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  // On a phone the tile picked can sit a screen below the box that says why.
  useEffect(() => {
    if (failure) {
      bringProblemsIntoView(failureRef.current, "nearest");
    }
  }, [failure]);

  /*
   * Enable and Disable in Bulk Actions: a disabled playbook stops running on
   * its own, and can still be run by hand from a case.
   */
  const {
    bulkActions: switchBulkActions,
    rowActions: switchRowActions,
  }: SwitchActionsResult<SecurityPlaybook> = useSwitchActions<SecurityPlaybook>(
    {
      modelType: SecurityPlaybook,
      column: "isEnabled",
    },
  );

  const createGate: PermissionGateResult = PermissionGate.check(
    new SecurityPlaybook(),
    ModelAction.Create,
  );

  const createFromTemplate: (
    template: SecurityPlaybookTemplate,
  ) => Promise<void> = async (
    template: SecurityPlaybookTemplate,
  ): Promise<void> => {
    setCreatingKey(template.key);
    setFailure(null);

    const name: string =
      translator.translateText(template.name) || template.name;

    try {
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;
      // The priorities and statuses the template's steps name, as the project has them.
      const caseValues: SecurityCaseValueLists =
        values || (await getSecurityCaseValues(projectId));

      /*
       * The record Turn on recommended makes from a template too
       * (SecurityTemplateRecords), named as the reader's language words
       * it - which SecurityTemplatesCreatable holds to the name's width in
       * every language.
       */
      const playbook: SecurityPlaybook = buildSecurityPlaybookFromTemplate({
        projectId: projectId,
        template: template.definition,
        priorities: caseValues.priorities,
        statuses: caseValues.statuses,
        name,
        description:
          translator.translateText(template.description) ||
          template.description,
      });

      const response: { data: unknown } =
        await ModelAPI.create<SecurityPlaybook>({
          model: playbook,
          modelType: SecurityPlaybook,
        });

      const created: { _id?: string } = response.data as { _id?: string };

      if (created?._id) {
        Navigation.navigate(getPlaybookViewRoute(new ObjectID(created._id)));
      }
    } catch (err) {
      /*
       * Why, in the product's words - the role, the plan, a record OneUptime
       * would not save, or a failure on its side - never a server's raw
       * sentence in grey.
       */
      setFailure({
        part: TurnOnRecommendedPart.Playbook,
        action: TurnOnRecommendedAction.Add,
        name,
        ...describeAddFailure(err),
      });
    }

    setCreatingKey("");
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">
          {translator.translateText("Start from a template")}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          {translator.translateText(
            "Each template is a working playbook you can save as it is and change later.",
          )}
        </p>
        {failure ? (
          <div className="mt-4" ref={failureRef}>
            <SecurityTurnOnProblems
              problems={[failure]}
              title={
                translator.translateText(PLAYBOOK_NOT_ADDED_TITLE) ||
                PLAYBOOK_NOT_ADDED_TITLE
              }
              dataTestId="security-playbook-template-problems"
            />
          </div>
        ) : (
          <></>
        )}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {SECURITY_PLAYBOOK_TEMPLATES.map(
            (template: SecurityPlaybookTemplate): ReactElement => {
              const isCreating: boolean = creatingKey === template.key;

              return (
                <button
                  key={template.key}
                  type="button"
                  data-testid={`security-playbook-template-${template.key}`}
                  disabled={!createGate.isAllowed || Boolean(creatingKey)}
                  title={
                    createGate.isAllowed ? undefined : createGate.disabledReason
                  }
                  className="group flex flex-col rounded-lg border border-gray-200 p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => {
                    void createFromTemplate(template);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                      <Icon icon={template.icon} className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-semibold text-gray-900">
                      {translator.translateText(template.name)}
                    </span>
                  </span>
                  <span className="mt-2 text-sm text-gray-600">
                    {translator.translateText(template.description)}
                  </span>
                  <span className="mt-3 text-xs font-medium text-indigo-600">
                    {isCreating
                      ? translator.translateText("Creating…")
                      : translator.translateText(template.trigger) ||
                        template.trigger}
                  </span>
                </button>
              );
            },
          )}
        </div>
      </div>

      <ModelTable<SecurityPlaybook>
        modelType={SecurityPlaybook}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        actionButtons={[...switchRowActions]}
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
        cardProps={{
          title: "Playbooks",
          description:
            "Responses that run on a case, such as notifying, paging on-call or containing a host. They run when a case opens or grows, or by hand.",
        }}
        noItemsMessage="No playbooks yet. Start from a template above, or create one."
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
              return item.isEnabled ? (
                <Pill color={Green} text="Enabled" />
              ) : (
                <Pill color={Gray500} text="Disabled" />
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
    </div>
  );
};

export default SecurityPlaybooksPage;
