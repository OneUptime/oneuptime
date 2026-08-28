import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import SiteHealthRollupPolicy, {
  getSiteHealthRollupPolicyLabel,
  parseSiteHealthRollupPolicy,
} from "Common/Types/NetworkSite/SiteHealthRollupPolicy";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
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
        formSteps={[
          {
            title: "Site Details",
            id: "site-details",
          },
          {
            title: "Location",
            id: "location",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "site-details",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Unit 1042 - Springfield",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "site-details",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Flagship location — two switches and a firewall.",
          },
          {
            field: {
              networkSiteType: true,
            },
            title: "Site Type",
            stepId: "site-details",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkSiteType,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Site Type",
          },
          {
            field: {
              parentSite: true,
            },
            title: "Parent Site",
            stepId: "site-details",
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
            stepId: "location",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "742 Evergreen Terrace, Springfield, IL",
          },
          {
            field: {
              latitude: true,
            },
            title: "Latitude",
            stepId: "location",
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
            stepId: "location",
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
                networkSiteType: {
                  name: true,
                },
              },
              title: "Site Type",
              fieldType: FieldType.Element,
              getElement: (item: NetworkSite): ReactElement => {
                if (!item.networkSiteType?.name) {
                  return <span className="text-gray-400">Not set</span>;
                }
                return <span>{item.networkSiteType.name}</span>;
              },
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

      <CardModelDetail<NetworkSite>
        name="Health Rollup"
        cardProps={{
          title: "Health Rollup",
          description:
            "How this site's status is derived from the devices at it and at every site beneath it.",
        }}
        isEditable={true}
        editButtonText="Edit Health Rollup"
        formFields={[
          {
            field: {
              healthRollupPolicy: true,
            },
            title: "Rollup Policy",
            description:
              "Worst status: any offline device makes this site offline — right for a single unit, where four switches in one building are not independent. Percentage of devices down: the share decides — right for a region, where one dark switch in one store should not paint four hundred of them red.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: [
              {
                value: SiteHealthRollupPolicy.WorstStatus,
                label: getSiteHealthRollupPolicyLabel(
                  SiteHealthRollupPolicy.WorstStatus,
                ),
              },
              {
                value: SiteHealthRollupPolicy.PercentThreshold,
                label: getSiteHealthRollupPolicyLabel(
                  SiteHealthRollupPolicy.PercentThreshold,
                ),
              },
            ],
            required: false,
            placeholder: "Worst status of any device",
          },
          {
            field: {
              offlineThresholdPercent: true,
            },
            title: "Offline Threshold (%)",
            description:
              "Only used by the percentage policy. At or above this share of reporting devices down, the site is offline. Below it, but above zero, the site is degraded.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "50",
            showIf: (item: FormValues<NetworkSite>): boolean => {
              return (
                item.healthRollupPolicy ===
                SiteHealthRollupPolicy.PercentThreshold
              );
            },
          },
        ]}
        modelDetailProps={{
          modelType: NetworkSite,
          id: "network-site-health-rollup",
          modelId: modelId,
          fields: [
            {
              field: {
                healthRollupPolicy: true,
              },
              title: "Rollup Policy",
              fieldType: FieldType.Element,
              getElement: (item: NetworkSite): ReactElement => {
                return (
                  <span>
                    {getSiteHealthRollupPolicyLabel(
                      parseSiteHealthRollupPolicy(item.healthRollupPolicy),
                    )}
                  </span>
                );
              },
            },
            {
              field: {
                offlineThresholdPercent: true,
              },
              title: "Offline Threshold (%)",
              fieldType: FieldType.Element,
              getElement: (item: NetworkSite): ReactElement => {
                if (
                  parseSiteHealthRollupPolicy(item.healthRollupPolicy) !==
                  SiteHealthRollupPolicy.PercentThreshold
                ) {
                  return (
                    <span className="text-gray-400">
                      Not used by this policy
                    </span>
                  );
                }
                return <span>{item.offlineThresholdPercent}%</span>;
              },
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default NetworkSiteSettings;
