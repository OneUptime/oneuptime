import PageComponentProps from "../PageComponentProps";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteLink from "Common/Models/DatabaseModels/NetworkSiteLink";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const NetworkSiteLinks: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<NetworkSiteLink>
        modelType={NetworkSiteLink}
        id="network-site-links-table"
        userPreferencesKey="network-site-links-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        name="Network Site Links"
        cardProps={{
          title: "Site Links",
          description:
            "WAN links between sites, drawn as edges on the network map. Bind a monitor to a link and the edge takes the monitor's status color.",
        }}
        noItemsMessage="No site links yet. Add one to draw a WAN connection between two sites on the network map."
        filters={[
          {
            field: {
              fromSite: {
                name: true,
              },
            },
            title: "From Site",
            type: FieldType.Entity,
            filterEntityType: NetworkSite,
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              toSite: {
                name: true,
              },
            },
            title: "To Site",
            type: FieldType.Entity,
            filterEntityType: NetworkSite,
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "MPLS to Springfield",
          },
          {
            field: {
              fromSite: true,
            },
            title: "From Site",
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
              toSite: true,
            },
            title: "To Site",
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
              monitor: true,
            },
            title: "Monitor",
            description:
              "Optional. The monitor watching this link — its status colors the edge on the map.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Monitor (optional)",
          },
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
              fromSite: {
                name: true,
              },
            },
            title: "From Site",
            type: FieldType.Entity,
            getElement: (item: NetworkSiteLink): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {item.fromSite?.name || "—"}
                </span>
              );
            },
          },
          {
            field: {
              toSite: {
                name: true,
              },
            },
            title: "To Site",
            type: FieldType.Entity,
            getElement: (item: NetworkSiteLink): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {item.toSite?.name || "—"}
                </span>
              );
            },
          },
          {
            field: {
              monitor: {
                name: true,
              },
            },
            title: "Bound Monitor",
            type: FieldType.Entity,
            hideOnMobile: true,
            getElement: (item: NetworkSiteLink): ReactElement => {
              if (!item.monitor?.name) {
                return <span className="text-sm text-gray-400">None</span>;
              }
              return (
                <span className="text-sm text-gray-900">
                  {item.monitor.name}
                </span>
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default NetworkSiteLinks;
