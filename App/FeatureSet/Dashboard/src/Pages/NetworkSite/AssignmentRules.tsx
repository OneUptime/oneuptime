import PageComponentProps from "../PageComponentProps";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteAssignmentRule from "Common/Models/DatabaseModels/NetworkSiteAssignmentRule";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const NetworkSiteAssignmentRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<NetworkSiteAssignmentRule>
        modelType={NetworkSiteAssignmentRule}
        id="network-site-assignment-rules-table"
        userPreferencesKey="network-site-assignment-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        name="Network Site Assignment Rules"
        sortBy="priority"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: "Assignment Rules",
          description:
            "Automatically assign discovered devices and endpoints to a site by subnet CIDR or hostname pattern. The higher priority number wins; ties are broken by the older rule. Rules apply to NEW or CHANGED devices only — existing devices are never retroactively reassigned.",
        }}
        noItemsMessage="No assignment rules yet. Add one to route newly discovered devices into the right site automatically."
        filters={[
          {
            field: {
              site: {
                name: true,
              },
            },
            title: "Site",
            type: FieldType.Entity,
            filterEntityType: NetworkSite,
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              subnetCidr: true,
            },
            title: "Subnet CIDR",
            type: FieldType.Text,
          },
          {
            field: {
              hostnamePattern: true,
            },
            title: "Hostname Pattern",
            type: FieldType.Text,
          },
        ]}
        formFields={[
          {
            field: {
              site: true,
            },
            title: "Site",
            description: "The site matched devices are assigned to.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkSite,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Site",
          },
          {
            field: {
              subnetCidr: true,
            },
            title: "Subnet CIDR",
            description:
              "Devices and endpoints with an IP in this CIDR match. Set this, a hostname pattern, or both.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "10.42.7.0/24",
          },
          {
            field: {
              hostnamePattern: true,
            },
            title: "Hostname Pattern",
            description:
              "Devices with a hostname matching this wildcard pattern match.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "unit-1042-*",
          },
          {
            field: {
              priority: true,
            },
            title: "Priority",
            description:
              "Higher priority number wins when several rules match; ties are broken by the older rule.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "0",
          },
        ]}
        columns={[
          {
            field: {
              site: {
                name: true,
              },
            },
            title: "Site",
            type: FieldType.Entity,
            getElement: (item: NetworkSiteAssignmentRule): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {item.site?.name || "—"}
                </span>
              );
            },
          },
          {
            field: {
              subnetCidr: true,
            },
            title: "Subnet CIDR",
            type: FieldType.Element,
            getElement: (item: NetworkSiteAssignmentRule): ReactElement => {
              return (
                <span className="text-sm text-gray-600">
                  {item.subnetCidr || "—"}
                </span>
              );
            },
          },
          {
            field: {
              hostnamePattern: true,
            },
            title: "Hostname Pattern",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkSiteAssignmentRule): ReactElement => {
              return (
                <span className="text-sm text-gray-600">
                  {item.hostnamePattern || "—"}
                </span>
              );
            },
          },
          {
            field: {
              priority: true,
            },
            title: "Priority",
            type: FieldType.Number,
          },
        ]}
      />
    </Fragment>
  );
};

export default NetworkSiteAssignmentRules;
