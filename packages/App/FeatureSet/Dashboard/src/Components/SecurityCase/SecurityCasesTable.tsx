import AppLink from "../AppLink/AppLink";
import UserElement from "../User/User";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SecurityCasePriorityPill,
  SecurityCaseStatusPill,
  getSecurityDetectionSourceIcon,
} from "./SecurityCasePills";
import SecurityEntityChips, {
  readSecurityEntities,
} from "./SecurityEntityChips";
import {
  getSecurityCaseAssigneePickerConfig,
  getSecurityCaseTeamPickerConfig,
} from "./SecurityCaseAssigneePicker";
import {
  SECURITY_CASE_QUEUE_VIEWS,
  SecurityCaseQueueView,
  SecurityCaseQueueViewKey,
  getSecurityCaseQueueQuery,
} from "./SecurityCaseQueueViews";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import Label from "Common/Models/DatabaseModels/Label";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityCasePriority from "Common/Types/SecurityCase/SecurityCasePriority";
import SecurityCaseStatus from "Common/Types/SecurityCase/SecurityCaseStatus";
import SecurityCaseVerdict from "Common/Types/SecurityCase/SecurityCaseVerdict";
import { SecurityEntity } from "Common/Types/SecurityCase/SecurityEntity";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import LabelsElement from "Common/UI/Components/Label/Labels";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  initialView?: SecurityCaseQueueViewKey | undefined;
}

type BulkCaseChange = "status" | "priority";

/*
 * Said after a Delete's question, in a row's dialog and a bulk one: closing
 * a case keeps it, as the case page's own Delete says.
 */
export const CLOSE_CASE_INSTEAD_OF_DELETE: string = translationKey(
  "To keep the record, close the case with a verdict instead.",
);

// A case as its page names it: its number, then its title.
export const getSecurityCaseName: (securityCase: SecurityCase) => string = (
  securityCase: SecurityCase,
): string => {
  return `${securityCase.caseNumberWithPrefix || ""} ${
    securityCase.title || ""
  }`.trim();
};

/*
 * The case queue. A case is opened by a detection - a rule, threat
 * intelligence or a connected product - or by a person, and is worked here:
 * the views along the top are the questions an analyst asks of the queue
 * (what is open, what is mine, what nobody has picked up), and the bulk
 * actions are what they do to several cases at once.
 */
const SecurityCasesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [view, setView] = useState<SecurityCaseQueueViewKey>(
    props.initialView || "open",
  );
  const [refreshToggle, setRefreshToggle] = useState<string>("");
  const [bulkChange, setBulkChange] = useState<BulkCaseChange | null>(null);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<SecurityCase> | null>(null);

  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  // Write one change to every case selected, reporting each as it goes.
  const applyToSelected: (
    actionProps: BulkActionOnClickProps<SecurityCase>,
    data: JSONObject,
  ) => Promise<void> = async (
    actionProps: BulkActionOnClickProps<SecurityCase>,
    data: JSONObject,
  ): Promise<void> => {
    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      actionProps;

    onBulkActionStart();

    const inProgressItems: Array<SecurityCase> = [...items];
    const successItems: Array<SecurityCase> = [];
    const failed: Array<BulkActionFailed<SecurityCase>> = [];

    for (const item of items) {
      inProgressItems.splice(inProgressItems.indexOf(item), 1);

      try {
        await ModelAPI.updateById<SecurityCase>({
          modelType: SecurityCase,
          id: new ObjectID(item._id!.toString()),
          data: data,
        });
        successItems.push(item);
      } catch (error) {
        failed.push({ item, failedMessage: API.getFriendlyMessage(error) });
      }

      onProgressInfo({
        totalItems: items,
        failed,
        successItems,
        inProgressItems,
      });
    }

    onBulkActionEnd();
    setRefreshToggle(Date.now().toString());
  };

  const bulkActions: Array<
    BulkActionButtonSchema<SecurityCase> | ModalTableBulkDefaultActions
  > = [
    {
      title: "Assign to Me",
      icon: IconProp.User,
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: async (
        actionProps: BulkActionOnClickProps<SecurityCase>,
      ): Promise<void> => {
        await applyToSelected(actionProps, {
          assignedToUserId: User.getUserId().toString(),
        });
      },
    },
    {
      title: "Change Status",
      icon: IconProp.ArrowCircleRight,
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: async (
        actionProps: BulkActionOnClickProps<SecurityCase>,
      ): Promise<void> => {
        setBulkActionProps(actionProps);
        setBulkChange("status");
      },
    },
    {
      title: "Change Priority",
      icon: IconProp.Signal,
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: async (
        actionProps: BulkActionOnClickProps<SecurityCase>,
      ): Promise<void> => {
        setBulkActionProps(actionProps);
        setBulkChange("priority");
      },
    },
    ModalTableBulkDefaultActions.Delete,
  ];

  const closeBulkModal: () => void = (): void => {
    setBulkChange(null);
    setBulkActionProps(null);
  };

  return (
    <>
      <ModelTable<SecurityCase>
        modelType={SecurityCase}
        id="security-cases-table"
        name="Security Events > Cases"
        userPreferencesKey="security-cases-table"
        query={{
          projectId: projectId,
          ...getSecurityCaseQueueQuery(view, User.getUserId()),
        }}
        refreshToggle={refreshToggle}
        /*
         * Delete in each case's ⋯ menu and in Bulk Actions - one switch for
         * both. Its dialogs name the case as its page does, say what goes
         * with it (DeleteConsequences) and that a verdict keeps the record.
         */
        isDeleteable={true}
        getItemName={getSecurityCaseName}
        deleteConfirmationWarning={CLOSE_CASE_INSTEAD_OF_DELETE}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        viewButtonText="View"
        createVerb="Open"
        createEditModalWidth={ModalWidth.Large}
        sortBy="lastDetectedAt"
        sortOrder={SortOrder.Descending}
        bulkActions={{ buttons: bulkActions }}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SECURITY_CASES] as Route,
        )}
        /*
         * No row menu with the record's ID: each row names its case by number,
         * and the case's page has the ID line. The queue keeps its width for
         * the case itself.
         */
        cardProps={{
          // Its search and buttons drop under the title beside the side menu.
          headerLayout: "stacked",
          title: "Security Cases",
          description:
            "Each case is one thing to look into: the detections about the same user, host or address, grouped together as they fire. Pick one up, work it, and close it with a verdict.",
        }}
        topContent={
          <div className="flex flex-wrap items-center gap-1 px-4 pb-3 pt-1 sm:px-6">
            {SECURITY_CASE_QUEUE_VIEWS.map(
              (queueView: SecurityCaseQueueView): ReactElement => {
                const isActive: boolean = queueView.key === view;

                return (
                  <button
                    key={queueView.key}
                    type="button"
                    data-testid={`security-case-view-${queueView.key}`}
                    aria-pressed={isActive}
                    title={translator.translateText(queueView.description)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                    onClick={() => {
                      setView(queueView.key);
                    }}
                  >
                    <Icon icon={queueView.icon} className="h-3.5 w-3.5" />
                    <span>{translator.translateText(queueView.title)}</span>
                  </button>
                );
              },
            )}
          </div>
        }
        noItemsMessage={
          SECURITY_CASE_QUEUE_VIEWS.find(
            (queueView: SecurityCaseQueueView): boolean => {
              return queueView.key === view;
            },
          )?.emptyMessage || "No cases."
        }
        createInitialValues={{
          priority: SecurityCasePriority.Medium,
        }}
        formSteps={[
          { title: "Case", id: "case" },
          { title: "Assignment", id: "assignment" },
        ]}
        formFields={[
          {
            field: { title: true },
            stepId: "case",
            title: "Title",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Suspicious sign-ins for alice@example.com",
          },
          {
            field: { description: true },
            stepId: "case",
            title: "Description",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            description: "What prompted this case, and what to look at first.",
          },
          {
            field: { priority: true },
            stepId: "case",
            title: "Priority",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(SecurityCasePriority),
          },
          {
            field: { assignedToUserId: true },
            stepId: "assignment",
            title: "Assign To",
            fieldType: FormFieldSchemaType.PeoplePicker,
            required: false,
            description: "Optional. The person working the case.",
            peoplePicker: getSecurityCaseAssigneePickerConfig(),
          },
          {
            field: { assignedToTeamId: true },
            stepId: "assignment",
            title: "Team",
            fieldType: FormFieldSchemaType.PeoplePicker,
            required: false,
            description: "Optional. The team the case belongs to.",
            peoplePicker: getSecurityCaseTeamPickerConfig(),
          },
          {
            field: { labels: true },
            stepId: "assignment",
            title: "Labels",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            required: false,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
          },
        ]}
        showRefreshButton={true}
        searchableFields={["title", "caseNumberWithPrefix"]}
        selectMoreFields={{
          caseNumberWithPrefix: true,
          source: true,
          detectionCount: true,
          assignedToTeam: { name: true, _id: true },
        }}
        filters={[
          {
            field: { title: true },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: { priority: true },
            title: "Priority",
            type: FieldType.Dropdown,
            filterDropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(SecurityCasePriority),
          },
          {
            field: { status: true },
            title: "Status",
            type: FieldType.Dropdown,
            filterDropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(SecurityCaseStatus),
          },
          {
            field: { verdict: true },
            title: "Verdict",
            type: FieldType.Dropdown,
            filterDropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(SecurityCaseVerdict),
          },
          {
            field: { labels: { name: true, color: true } },
            title: "Labels",
            type: FieldType.EntityArray,
            filterEntityType: Label,
            filterQuery: { projectId: projectId },
            filterDropdownField: { label: "name", value: "_id" },
          },
          {
            field: { createdAt: true },
            title: "Opened",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            /*
             * What the case is, what raised it and who or what it is about,
             * in one column that wraps: the title over at most two lines,
             * then its source and the first entities it names. The other
             * columns are short values, so the queue fits beside the side
             * menu.
             */
            field: { title: true, entities: true },
            title: "Case",
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xl",
            getElement: (item: SecurityCase): ReactElement => {
              const detections: number = item.detectionCount || 0;
              const entities: Array<SecurityEntity> = readSecurityEntities(
                item.entities,
              );

              return (
                /*
                 * One grid track that may shrink to nothing (grid-cols-1 is
                 * minmax(0, 1fr)), never under 14rem: what the cell holds
                 * never widens the column, so the queue keeps fitting beside
                 * the side menu with each row's ⋯ menu. An entity chip
                 * longer than the column truncates (its tooltip has the
                 * whole value), and a long word in the title breaks.
                 */
                <div className="grid min-w-[14rem] grid-cols-1">
                  <AppLink
                    className="group block min-w-0"
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.SECURITY_CASE_VIEW] as Route,
                      { modelId: new ObjectID(item._id!.toString()) },
                    )}
                  >
                    <span className="line-clamp-2 break-words font-medium text-gray-900 group-hover:underline">
                      <span className="mr-1.5 font-mono text-xs text-gray-500">
                        {item.caseNumberWithPrefix || ""}
                      </span>
                      {item.title || ""}
                    </span>
                  </AppLink>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
                    <Icon
                      icon={getSecurityDetectionSourceIcon(item.source)}
                      className="h-3 w-3 text-gray-400"
                    />
                    <span>
                      {item.source ? translator.translateText(item.source) : ""}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {translator.translatePlural(
                        {
                          one: "{{count}} detection",
                          other: "{{count}} detections",
                        },
                        detections,
                      )}
                    </span>
                  </div>
                  {entities.length > 0 ? (
                    <div className="mt-1.5">
                      <SecurityEntityChips entities={entities} limit={2} />
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { priority: true },
            title: "Priority",
            type: FieldType.Element,
            getElement: (item: SecurityCase): ReactElement => {
              return <SecurityCasePriorityPill value={item.priority} />;
            },
          },
          {
            field: { status: true },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: SecurityCase): ReactElement => {
              return <SecurityCaseStatusPill value={item.status} />;
            },
          },
          {
            field: {
              assignedToUser: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "Assignee",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: SecurityCase): ReactElement => {
              if (item.assignedToUser) {
                return (
                  <UserElement user={item.assignedToUser} hideEmail={true} />
                );
              }

              if (item.assignedToTeam?.name) {
                return (
                  <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                    <Icon
                      icon={IconProp.UserGroup}
                      className="h-4 w-4 text-gray-400"
                    />
                    {item.assignedToTeam.name}
                  </span>
                );
              }

              return (
                <span className="text-sm text-gray-400">
                  {translator.translateText("Unassigned")}
                </span>
              );
            },
          },
          {
            field: { labels: { name: true, color: true } },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            isHiddenByDefault: true,
            getElement: (item: SecurityCase): ReactElement => {
              return <LabelsElement labels={item.labels || []} />;
            },
          },
          {
            field: { lastDetectedAt: true },
            title: "Last Detection",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: SecurityCase): ReactElement => {
              if (!item.lastDetectedAt) {
                return <span className="text-sm text-gray-400">-</span>;
              }

              return (
                <span
                  className="text-sm text-gray-700"
                  title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    item.lastDetectedAt,
                  )}
                >
                  {OneUptimeDate.fromNow(item.lastDetectedAt)}
                </span>
              );
            },
          },
        ]}
      />

      {bulkChange && bulkActionProps ? (
        <BasicFormModal<JSONObject>
          title={
            bulkChange === "status"
              ? "Change Status of Selected Cases"
              : "Change Priority of Selected Cases"
          }
          description={
            bulkChange === "status"
              ? "Every selected case moves to this status. Closing asks for a verdict, which is kept on each case."
              : "Every selected case gets this priority."
          }
          submitButtonText={
            bulkChange === "status" ? "Change Status" : "Change Priority"
          }
          onClose={closeBulkModal}
          formProps={{
            name: "security-case-bulk-change",
            initialValues:
              bulkChange === "status"
                ? { status: SecurityCaseStatus.Investigating }
                : { priority: SecurityCasePriority.High },
            fields:
              bulkChange === "status"
                ? [
                    {
                      field: { status: true },
                      title: "Status",
                      fieldType: FormFieldSchemaType.Dropdown,
                      required: true,
                      dropdownOptions:
                        DropdownUtil.getDropdownOptionsFromEnum(
                          SecurityCaseStatus,
                        ),
                    },
                    {
                      field: { verdict: true },
                      title: "Verdict",
                      fieldType: FormFieldSchemaType.Dropdown,
                      required: true,
                      description:
                        "What the cases turned out to be. Kept for the overview's verdict counts.",
                      dropdownOptions:
                        DropdownUtil.getDropdownOptionsFromEnum(
                          SecurityCaseVerdict,
                        ),
                      showIf: (values: FormValues<JSONObject>): boolean => {
                        return values["status"] === SecurityCaseStatus.Closed;
                      },
                    },
                  ]
                : [
                    {
                      field: { priority: true },
                      title: "Priority",
                      fieldType: FormFieldSchemaType.Dropdown,
                      required: true,
                      dropdownOptions:
                        DropdownUtil.getDropdownOptionsFromEnum(
                          SecurityCasePriority,
                        ),
                    },
                  ],
          }}
          onSubmit={async (values: FormValues<JSONObject>) => {
            const actionProps: BulkActionOnClickProps<SecurityCase> =
              bulkActionProps;
            const data: JSONObject =
              bulkChange === "status"
                ? {
                    status: values["status"] as string,
                    ...(values["status"] === SecurityCaseStatus.Closed
                      ? {
                          verdict:
                            (values["verdict"] as string) ||
                            SecurityCaseVerdict.Undetermined,
                        }
                      : {}),
                  }
                : { priority: values["priority"] as string };

            closeBulkModal();
            await applyToSelected(actionProps, data);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default SecurityCasesTable;
