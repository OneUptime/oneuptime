import { POSTMORTEM_ACTION_ITEMS_COPY } from "./PostmortemActionItemsCopy";
import {
  ActionItemDueState,
  getActionItemDueState,
} from "./PostmortemActionItemsModel";
import { getIncidentPostmortemRoute } from "../PostmortemsTable";
import AppLink from "../../AppLink/AppLink";
import UserElement from "../../User/User";
import ProjectUser from "../../../Utils/ProjectUser";
import IncidentPostmortemActionItem from "Common/Models/DatabaseModels/IncidentPostmortemActionItem";
import User from "Common/Models/DatabaseModels/User";
import Route from "Common/Types/API/Route";
import { Gray500, Green, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import PostmortemActionItemStatus, {
  POSTMORTEM_ACTION_ITEM_STATUS_NAMES,
} from "Common/Types/Incident/PostmortemActionItemStatus";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

// The list's own key, for its saved filters, columns and the address it keeps them in.
export const POSTMORTEM_ACTION_ITEMS_TABLE_ID: string =
  "incident-postmortem-action-items-table";

// Each status's colour: open waits, done is green, won't do is quiet.
export const POSTMORTEM_ACTION_ITEM_STATUS_COLORS: Readonly<
  Record<PostmortemActionItemStatus, Color>
> = {
  [PostmortemActionItemStatus.Open]: Yellow,
  [PostmortemActionItemStatus.Done]: Green,
  [PostmortemActionItemStatus.WontDo]: Gray500,
};

// The Status filter's choices, by the names people read (translated where drawn).
export const POSTMORTEM_ACTION_ITEM_STATUS_OPTIONS: Array<DropdownOption> = [
  PostmortemActionItemStatus.Open,
  PostmortemActionItemStatus.Done,
  PostmortemActionItemStatus.WontDo,
].map((status: PostmortemActionItemStatus): DropdownOption => {
  return {
    label: POSTMORTEM_ACTION_ITEM_STATUS_NAMES[status],
    value: status,
  };
});

/*
 * INCIDENTS > ACTION ITEMS (#6801): every postmortem's action items across
 * the project, soonest due first - the open ones first among those due the
 * same day - so a team sees what it said it would do, who owns each, and
 * what is overdue. Filter by status, owner and due date; a row opens its
 * incident's Postmortem page, where it is worked on.
 *
 * Read with the person's own permissions: a private incident's items only
 * for its team (the server's privacy filter).
 */
const PostmortemActionItemsTable: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const now: Date = OneUptimeDate.getCurrentDate();

  return (
    <ModelTable<IncidentPostmortemActionItem>
      name="Postmortem Action Items"
      modelType={IncidentPostmortemActionItem}
      id={POSTMORTEM_ACTION_ITEMS_TABLE_ID}
      userPreferencesKey={POSTMORTEM_ACTION_ITEMS_TABLE_ID}
      urlStateKey={POSTMORTEM_ACTION_ITEMS_TABLE_ID}
      saveFilterProps={{
        tableId: POSTMORTEM_ACTION_ITEMS_TABLE_ID,
      }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      showCreateForm={false}
      isViewable={true}
      viewButtonText="View"
      onViewPage={async (
        item: IncidentPostmortemActionItem,
      ): Promise<Route> => {
        return getIncidentPostmortemRoute(
          new ObjectID(item.incidentId!.toString()),
        );
      }}
      emptyState={{
        title: POSTMORTEM_ACTION_ITEMS_COPY.listEmptyTitle,
        description: POSTMORTEM_ACTION_ITEMS_COPY.listEmptyDescription,
        icon: IconProp.CheckCircle,
        hideCreateButton: true,
      }}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      sortBy="dueDate"
      sortOrder={SortOrder.Ascending}
      cardProps={{
        title: POSTMORTEM_ACTION_ITEMS_COPY.listTitle,
        description: POSTMORTEM_ACTION_ITEMS_COPY.listDescription,
      }}
      showRefreshButton={true}
      searchableFields={["title"]}
      filters={[
        {
          field: { status: true },
          title: POSTMORTEM_ACTION_ITEMS_COPY.statusColumn,
          type: FieldType.Dropdown,
          filterDropdownOptions: POSTMORTEM_ACTION_ITEM_STATUS_OPTIONS,
        },
        {
          field: { ownerUser: true },
          title: POSTMORTEM_ACTION_ITEMS_COPY.ownerField,
          type: FieldType.Entity,
          filterEntityType: User,
          fetchFilterDropdownOptions: async (): Promise<
            Array<DropdownOption>
          > => {
            return await ProjectUser.fetchProjectUsersAsDropdownOptions(
              ProjectUtil.getCurrentProjectId()!,
            );
          },
          filterDropdownField: {
            label: "name",
            value: "_id",
          },
        },
        {
          field: { dueDate: true },
          title: POSTMORTEM_ACTION_ITEMS_COPY.dueDateField,
          type: FieldType.Date,
        },
        {
          field: { title: true },
          title: POSTMORTEM_ACTION_ITEMS_COPY.actionItemColumn,
          type: FieldType.Text,
        },
      ]}
      selectMoreFields={{
        incidentId: true,
        status: true,
        ownerUserId: true,
      }}
      columns={[
        {
          field: { title: true },
          title: POSTMORTEM_ACTION_ITEMS_COPY.actionItemColumn,
          type: FieldType.Element,
          // The row's name: always shown.
          isNotCustomizable: true,
          // IsolatedText reads the title its own way, in a right-to-left page too.
          getLineText: drawsItsOwnLines,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-[18rem] 2xl:max-w-md",
          contentClassName: "min-w-[10rem]",
          getElement: (item: IncidentPostmortemActionItem): ReactElement => {
            const isClosed: boolean =
              item.status === PostmortemActionItemStatus.Done ||
              item.status === PostmortemActionItemStatus.WontDo;

            if (!item.incidentId) {
              return <IsolatedText text={item.title || ""} />;
            }

            return (
              <AppLink
                className={`font-medium hover:underline ${
                  isClosed ? "text-gray-500 line-through" : "text-gray-900"
                }`}
                to={getIncidentPostmortemRoute(
                  new ObjectID(item.incidentId.toString()),
                )}
              >
                <IsolatedText text={item.title || ""} />
              </AppLink>
            );
          },
        },
        {
          field: {
            incident: {
              title: true,
              incidentNumber: true,
              incidentNumberWithPrefix: true,
            },
          },
          title: POSTMORTEM_ACTION_ITEMS_COPY.incidentColumn,
          type: FieldType.Element,
          hideOnMobile: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-[14rem]",
          getElement: (item: IncidentPostmortemActionItem): ReactElement => {
            const numberLabel: string =
              item.incident?.incidentNumberWithPrefix ||
              (item.incident?.incidentNumber
                ? `#${item.incident.incidentNumber}`
                : "");

            return (
              <span className="text-sm text-gray-700">
                {numberLabel ? (
                  <span className="me-1 font-medium text-gray-900">
                    {numberLabel}
                  </span>
                ) : (
                  <></>
                )}
                <IsolatedText text={item.incident?.title?.toString() || ""} />
              </span>
            );
          },
        },
        {
          field: {
            ownerUser: {
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          title: POSTMORTEM_ACTION_ITEMS_COPY.ownerField,
          type: FieldType.Element,
          hideOnMobile: true,
          noValueMessage: POSTMORTEM_ACTION_ITEMS_COPY.noOwner,
          getElement: (item: IncidentPostmortemActionItem): ReactElement => {
            if (!item.ownerUser) {
              return (
                <span className="text-sm text-gray-500">
                  {translator.translateText(
                    POSTMORTEM_ACTION_ITEMS_COPY.noOwner,
                  )}
                </span>
              );
            }

            return <UserElement user={item.ownerUser as User} />;
          },
        },
        {
          field: { dueDate: true },
          title: POSTMORTEM_ACTION_ITEMS_COPY.dueDateField,
          type: FieldType.Element,
          getElement: (item: IncidentPostmortemActionItem): ReactElement => {
            if (!item.dueDate) {
              return <></>;
            }

            const isOverdue: boolean =
              getActionItemDueState(item, now) === ActionItemDueState.Overdue;
            const date: string =
              OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                item.dueDate,
                true,
              );

            return (
              <span
                className={`whitespace-nowrap text-sm ${
                  isOverdue ? "font-medium text-red-700" : "text-gray-700"
                }`}
                data-overdue={isOverdue ? "true" : "false"}
              >
                {isOverdue
                  ? translator.translateTemplate(
                      POSTMORTEM_ACTION_ITEMS_COPY.overdue,
                      { date },
                    )
                  : date}
              </span>
            );
          },
        },
        {
          field: { status: true },
          title: POSTMORTEM_ACTION_ITEMS_COPY.statusColumn,
          type: FieldType.Element,
          getElement: (item: IncidentPostmortemActionItem): ReactElement => {
            const status: PostmortemActionItemStatus =
              item.status || PostmortemActionItemStatus.Open;

            return (
              <Pill
                isMinimal={true}
                color={POSTMORTEM_ACTION_ITEM_STATUS_COLORS[status]}
                text={POSTMORTEM_ACTION_ITEM_STATUS_NAMES[status]}
              />
            );
          },
        },
      ]}
    />
  );
};

export default PostmortemActionItemsTable;
