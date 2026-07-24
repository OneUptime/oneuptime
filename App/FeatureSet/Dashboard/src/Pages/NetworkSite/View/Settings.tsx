import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Types/NetworkSite/NetworkSiteType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Site settings: identity, hierarchy placement, and map position. The
 * hierarchy fields matter — the rollup engine and the map both key off
 * parent site and coordinates.
 */
const NetworkSiteSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<NetworkSite>
        name="Site Settings"
        cardProps={{
          title: "Site Settings",
          description:
            "Name, hierarchy placement, and map position for this site.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Unit 1042 - Springfield",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Flagship location — two switches and a firewall.",
          },
          {
            field: {
              siteType: true,
            },
            title: "Site Type",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(NetworkSiteType),
            required: true,
            placeholder: "Unit",
          },
          {
            field: {
              parentSite: true,
            },
            title: "Parent Site",
            description:
              "The site this one is nested under. Leave empty for a root site.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkSite,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Parent Site (optional)",
          },
          {
            field: {
              address: true,
            },
            title: "Address",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "742 Evergreen Terrace, Springfield, IL",
          },
          {
            field: {
              latitude: true,
            },
            title: "Latitude",
            description:
              "Between -90 and 90. Needed to pin this site on the network map.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "39.7817",
          },
          {
            field: {
              longitude: true,
            },
            title: "Longitude",
            description:
              "Between -180 and 180. Needed to pin this site on the network map.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "-89.6501",
          },
        ]}
        modelDetailProps={{
          modelType: NetworkSite,
          id: "network-site-settings",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
              showIf: (item: NetworkSite): boolean => {
                return Boolean(item.description);
              },
            },
            {
              field: {
                siteType: true,
              },
              title: "Site Type",
              fieldType: FieldType.Text,
            },
            {
              field: {
                parentSite: {
                  name: true,
                },
              },
              title: "Parent Site",
              fieldType: FieldType.Element,
              getElement: (item: NetworkSite): ReactElement => {
                if (!item.parentSite?.name) {
                  return <span className="text-gray-400">Root site</span>;
                }
                return <span>{item.parentSite.name}</span>;
              },
            },
            {
              field: {
                address: true,
              },
              title: "Address",
              fieldType: FieldType.Text,
              showIf: (item: NetworkSite): boolean => {
                return Boolean(item.address);
              },
            },
          ],
        }}
      />

      <CardModelDetail<NetworkSite>
        name="Site Alerting"
        cardProps={{
          title: "Alerting",
          description:
            "Open an alert when this site's health rollup turns non-operational. The alert auto-resolves when the site recovers.",
        }}
        isEditable={true}
        editButtonText="Edit Alerting"
        formFields={[
          {
            field: {
              shouldAlertWhenUnhealthy: true,
            },
            title: "Alert When Unhealthy",
            description:
              "When enabled, an alert opens the moment this site's rollup transitions to a non-operational status, and auto-resolves on recovery.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              alertSeverity: true,
            },
            title: "Alert Severity",
            description:
              "Severity for site alerts. Defaults to the project's most severe when left empty.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: AlertSeverity,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Alert Severity (optional)",
          },
        ]}
        modelDetailProps={{
          modelType: NetworkSite,
          id: "network-site-alerting",
          modelId: modelId,
          fields: [
            {
              field: {
                shouldAlertWhenUnhealthy: true,
              },
              title: "Alert When Unhealthy",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                alertSeverity: {
                  name: true,
                },
              },
              title: "Alert Severity",
              fieldType: FieldType.Element,
              getElement: (item: NetworkSite): ReactElement => {
                if (!item.alertSeverity?.name) {
                  return (
                    <span className="text-gray-400">
                      Project default (most severe)
                    </span>
                  );
                }
                return <span>{item.alertSeverity.name}</span>;
              },
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default NetworkSiteSettings;
