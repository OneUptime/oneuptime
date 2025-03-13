import UserElement from "../../../Components/User/User";
import DashboardNavigation from "../../../Utils/Navigation";
import OnCallPolicyView from "../OnCallPolicy";
import ObjectID from "Common/Types/ObjectID";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import Columns from "Common/UI/Components/ModelTable/Columns";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import Navigation from "Common/UI/Utils/Navigation";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import React, { FunctionComponent, ReactElement } from "react";
import User from "Common/Models/DatabaseModels/User";
import IsNull from "Common/Types/BaseDatabase/IsNull";

export interface ComponentProps {
  onCallDutyPolicyId?: ObjectID | undefined; // if this is undefined. then it'll show logs for all policies.
}

const ExecutionLogsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {

  const query: Query<OnCallDutyPolicyUserOverride> = {
    projectId: DashboardNavigation.getProjectId()!,
  };

  if (props.onCallDutyPolicyId) {
    query.onCallDutyPolicyId = props.onCallDutyPolicyId.toString();
  }else{
    query.onCallDutyPolicyId = new IsNull();
  }

  let columns: Columns<OnCallDutyPolicyUserOverride> = [];
  let filters: Array<Filter<OnCallDutyPolicyUserOverride>> = [];

  if (props.onCallDutyPolicyId) {
    // add a column for the policy name
    columns = columns.concat([
      {
        field: {
          onCallDutyPolicy: {
            name: true,
          },
        },
        title: "Policy Name",
        type: FieldType.Element,
        getElement: (item: OnCallDutyPolicyUserOverride): ReactElement => {
          if (item["onCallDutyPolicy"]) {
            return (
              <OnCallPolicyView
                onCallPolicy={item["onCallDutyPolicy"] as OnCallDutyPolicy}
              />
            );
          }
          return <p>No on-call policy.</p>;
        },
      },
    ]);

    filters = filters.concat([
      {
        title: "On Call Policy",
        type: FieldType.Entity,
        field: {
          onCallDutyPolicy: true,
        },
        filterEntityType: OnCallDutyPolicy,
        filterQuery: {
          projectId: DashboardNavigation.getProjectId()!,
        },
        filterDropdownField: {
          label: "name",
          value: "_id",
        },
      },
    ]);
  }

  filters = filters.concat([
    {
      title: "Starts At",
      type: FieldType.Date,
      field: {
        startsAt: true,
      },
    },
    {
        title: "Ends At",
        type: FieldType.Date,
        field: {
          endsAt: true,
        },
      },
  ]);

  columns = columns.concat([
    {
        field: {
            overrideUser: {
                name: true,
                email: true,
                profilePicture: true,
            },
        },
        title: "Override User",
        type: FieldType.Element,
        getElement: (item: OnCallDutyPolicyUserOverride): ReactElement => {
            if (item["overrideUser"]) {
                return (
                    <UserElement user={item["overrideUser"] as User} />
                );
            }
            return <p>No user.</p>;
        },
    },
    {
        field: {
            routeAlertsToUser: {
                name: true,
                email: true,
                profilePicture: true,
            },
        },
        title: "Route Alerts To User",
        type: FieldType.Element,
        getElement: (item: OnCallDutyPolicyUserOverride): ReactElement => {
            if (item["routeAlertsToUser"]) {
                return (
                    <UserElement user={item["routeAlertsToUser"] as User} />
                );
            }
            return <p>No user.</p>;
        },
    },
    {
        field: {
            startsAt: true,
        },
        title: "Starts At",
        type: FieldType.DateTime,
    },
    {
        field: {
            endsAt: true,
        },
        title: "Ends At",
        type: FieldType.DateTime,
    }
  ]);

  return (
    <>
      <ModelTable<OnCallDutyPolicyUserOverride>
        modelType={OnCallDutyPolicyUserOverride}
        query={query}
        id="on-call-user-override-table"
        name="On-Call Policy > User Overrides"
        isDeleteable={true}
        isEditable={false}
        isCreateable={true}
        isViewable={false}
        cardProps={{
          title: "On-Call Policy User Overrides",
          description:
            "Overrides are usually useful when the user is on vacation or sick leave and you want to temporarily assign the on-call duty to another user.",
        }}
        noItemsMessage={"No user overrides have been set for this policy."}
        viewPageRoute={Navigation.getCurrentRoute()}
        showRefreshButton={true}
        showViewIdButton={true}
        filters={filters}
        columns={columns}
      />
    </>
  );
};

export default ExecutionLogsTable;
