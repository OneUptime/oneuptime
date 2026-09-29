import UserElement from "../../../Components/User/User";
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
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ProjectUser from "../../../Utils/ProjectUser";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ProjectUtil from "Common/UI/Utils/Project";

export interface ComponentProps {
  onCallDutyPolicyId?: ObjectID | undefined; // if this is undefined. then it'll show logs for all policies.
}

const UserOverrideTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const query: Query<OnCallDutyPolicyUserOverride> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (props.onCallDutyPolicyId) {
    query.onCallDutyPolicyId = props.onCallDutyPolicyId.toString();
  } else {
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
          projectId: ProjectUtil.getCurrentProjectId()!,
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
          profilePictureId: true,
        },
      },
      title: "Override User",
      type: FieldType.Element,
      getElement: (item: OnCallDutyPolicyUserOverride): ReactElement => {
        if (item["overrideUser"]) {
          return <UserElement user={item["overrideUser"] as User} />;
        }
        return <p>No user.</p>;
      },
    },
    {
      field: {
        routeAlertsToUser: {
          name: true,
          email: true,
          profilePictureId: true,
        },
      },
      title: "Route Alerts To User",
      type: FieldType.Element,
      getElement: (item: OnCallDutyPolicyUserOverride): ReactElement => {
        if (item["routeAlertsToUser"]) {
          return <UserElement user={item["routeAlertsToUser"] as User} />;
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
    },
  ]);

  const formFields: Array<ModelField<OnCallDutyPolicyUserOverride>> = [
    {
      field: {
        overrideUser: true,
      },
      title: "Override User",
      description: "Select the user who will override the on-call duty.",
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      placeholder: "Select Override User",
      fetchDropdownOptions: async () => {
        return await ProjectUser.fetchProjectUsersAsDropdownOptions(
          ProjectUtil.getCurrentProjectId()!,
        );
      },
    },
    {
      field: {
        routeAlertsToUser: true,
      },
      title: "Route Alerts To User",
      description: "Select the user to whom alerts will be routed.",
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      placeholder: "Select User to Route Alerts",
      fetchDropdownOptions: async () => {
        return await ProjectUser.fetchProjectUsersAsDropdownOptions(
          ProjectUtil.getCurrentProjectId()!,
        );
      },
    },
    {
      field: {
        startsAt: true,
      },
      title: "Starts At",
      description: "Select the start date and time for the override.",
      fieldType: FormFieldSchemaType.DateTime,
      required: true,
      placeholder: "Select Start Date and Time",
    },
    {
      field: {
        endsAt: true,
      },
      title: "Ends At",
      description: "Select the end date and time for the override.",
      fieldType: FormFieldSchemaType.DateTime,
      required: true,
      placeholder: "Select End Date and Time",
    },
  ];

  return (
    <>
      <ModelTable<OnCallDutyPolicyUserOverride>
        modelType={OnCallDutyPolicyUserOverride}
        query={query}
        id="on-call-user-override-table"
        name="On-Call Policy > User Overrides"
        userPreferencesKey="on-call-user-override-table"
        isDeleteable={true}
        isEditable={false}
        isCreateable={true}
        isViewable={false}
        onBeforeCreate={(item: OnCallDutyPolicyUserOverride) => {
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          if (props.onCallDutyPolicyId) {
            item.onCallDutyPolicyId = props.onCallDutyPolicyId;
          }

          return Promise.resolve(item);
        }}
        cardProps={{
          title: props.onCallDutyPolicyId
            ? "On-Call Policy User Overrides"
            : "Global User Overrides",
          description: props.onCallDutyPolicyId
            ? "Overrides are usually useful when the user is on vacation or sick leave and you want to temporarily assign the on-call duty to another user."
            : "Global overrides are useful for assigning on-call duties across all policies when a user is unavailable.",
        }}
        formFields={formFields}
        noItemsMessage={
          props.onCallDutyPolicyId
            ? "No user overrides have been set for this policy."
            : "No global user overrides have been set."
        }
        viewPageRoute={Navigation.getCurrentRoute()}
        showRefreshButton={true}
        showViewIdButton={true}
        filters={filters}
        columns={columns}
      />
    </>
  );
};

export default UserOverrideTable;
