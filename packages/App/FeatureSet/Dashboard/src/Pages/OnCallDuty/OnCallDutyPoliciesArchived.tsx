import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import {
  getArchivedAtFilter,
  getArchivedColumns,
} from "../../Components/Archive/ArchivedColumns";
import { ON_CALL_POLICY_ARCHIVE_COPY } from "../../Components/Archive/ResourceArchiveCopy";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Distinct from the live list's key, so the two tables never share saved
 * column preferences or URL filter state.
 */
export const ON_CALL_POLICIES_ARCHIVED_TABLE_ID: string =
  "on-call-policies-archived-table";

/**
 * On-call policies that have been archived: they page no one - an incident or
 * alert that still lists one gets a "not executed" execution log saying why -
 * and they are hidden from the On-Call Policies list until unarchived. Their
 * escalation rules and execution history are kept.
 */
const OnCallDutyPoliciesArchived: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { unarchiveBulkActions } = useBulkArchiveActions<OnCallDutyPolicy>({
    modelType: OnCallDutyPolicy,
    singularName: ON_CALL_POLICY_ARCHIVE_COPY.singularName,
    pluralName: ON_CALL_POLICY_ARCHIVE_COPY.pluralName,
    archiveConfirmMessage:
      ON_CALL_POLICY_ARCHIVE_COPY.bulkArchiveConfirmMessage,
    unarchiveConfirmMessage:
      ON_CALL_POLICY_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
  });

  return (
    <Fragment>
      <ModelTable<OnCallDutyPolicy>
        modelType={OnCallDutyPolicy}
        id={ON_CALL_POLICIES_ARCHIVED_TABLE_ID}
        userPreferencesKey={ON_CALL_POLICIES_ARCHIVED_TABLE_ID}
        query={{
          isArchived: true,
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        showRefreshButton={true}
        showViewIdButton={true}
        bulkActions={{
          buttons: [...unarchiveBulkActions],
        }}
        name={ON_CALL_POLICY_ARCHIVE_COPY.archivedPageTitle}
        cardProps={{
          title: ON_CALL_POLICY_ARCHIVE_COPY.archivedPageTitle,
          description: ON_CALL_POLICY_ARCHIVE_COPY.archivedPageDescription,
        }}
        noItemsMessage={ON_CALL_POLICY_ARCHIVE_COPY.noArchivedItemsMessage}
        searchableFields={["name", "description"]}
        sortBy="archivedAt"
        sortOrder={SortOrder.Descending}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          getArchivedAtFilter<OnCallDutyPolicy>(),
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
            hideOnMobile: true,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (item: OnCallDutyPolicy): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          ...getArchivedColumns<OnCallDutyPolicy>(),
        ]}
        onViewPage={(item: OnCallDutyPolicy): Promise<Route> => {
          /*
           * /on-call-duty/policies/<id>; the table's default (this list's URL
           * + /<id>) would be /policies/archived/<id>, which no route matches.
           */
          return Promise.resolve(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route,
              {
                modelId: new ObjectID(item._id as string),
              },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default OnCallDutyPoliciesArchived;
