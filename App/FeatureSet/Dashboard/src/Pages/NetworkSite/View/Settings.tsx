import PageComponentProps from "../../PageComponentProps";
import {
  fetchAllNetworkSiteTypeOptions,
  fetchParentNetworkSiteOptions,
  isParentSiteRequired,
} from "../../../Components/NetworkSite/NetworkSiteFormDropdownOptions";
import ObjectID from "Common/Types/ObjectID";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSnmpCredentialProfile from "Common/Models/DatabaseModels/NetworkSnmpCredentialProfile";
import Probe from "Common/Models/DatabaseModels/Probe";
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
            title: "Hierarchy",
            id: "hierarchy",
          },
          {
            title: "Location",
            id: "location",
          },
          {
            title: "Monitoring Defaults",
            id: "monitoring-defaults",
          },
        ]}
        formFields={[
          {
            field: {
              networkSiteType: true,
            },
            title: "Site Type",
            stepId: "site-details",
            description:
              "Choose this first. The type's configured parent determines which parent sites are available on the next step.",
            fieldType: FormFieldSchemaType.Dropdown,
            fetchDropdownOptions: fetchAllNetworkSiteTypeOptions,
            onChange: (
              _value: unknown,
              currentFormValues: FormValues<NetworkSite>,
              setNewFormValues: (
                currentFormValues: FormValues<NetworkSite>,
              ) => void,
            ): void => {
              setNewFormValues({
                ...currentFormValues,
                parentSite: null,
              });
            },
            required: true,
            placeholder: "Select Site Type",
          },
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
              parentSite: true,
            },
            title: "Parent Site",
            stepId: "hierarchy",
            sectionTitle: "Place This Site",
            sectionDescription:
              "Only sites whose type is the configured parent of the selected site type are shown.",
            description:
              "Top-level site types do not have a parent site. A child site type requires one of the matching sites below.",
            fieldType: FormFieldSchemaType.Dropdown,
            fetchDropdownOptions: (values: FormValues<NetworkSite>) => {
              return fetchParentNetworkSiteOptions(values, modelId);
            },
            required: isParentSiteRequired,
            placeholder: "No parent site (top level)",
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
          {
            field: {
              probe: true,
            },
            title: "Default Probe",
            stepId: "monitoring-defaults",
            sectionTitle: "Monitoring Defaults",
            sectionDescription:
              "What a device registered into this site starts out with. Set these once and a device can be added by name and address alone.",
            description:
              "The probe that pings and walks devices in this site unless a device names its own. A device created into this site with no probe inherits it (so does one moved here without a probe); devices that already have a probe keep it. Pick a custom probe deployed on this site's network — a probe on the public internet cannot reach a private address.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Probe,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "No default probe",
          },
          {
            field: {
              snmpCredentialProfile: true,
            },
            title: "Default SNMP Credential Profile",
            stepId: "monitoring-defaults",
            description:
              "The SNMP credentials devices in this site are walked with when neither the device nor its own profile carries any. With a profile here, a device added to this site is walked over SNMP from its first poll; without one anywhere it is pinged only.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkSnmpCredentialProfile,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "No default credential profile",
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
                probe: {
                  name: true,
                },
              },
              title: "Default Probe",
              fieldType: FieldType.Element,
              getElement: (item: NetworkSite): ReactElement => {
                if (!item.probe?.name) {
                  return (
                    <span className="text-sm text-gray-400">
                      None — devices name their own probe
                    </span>
                  );
                }
                return <span>{item.probe.name}</span>;
              },
            },
            {
              field: {
                snmpCredentialProfile: {
                  name: true,
                },
              },
              title: "Default SNMP Credential Profile",
              fieldType: FieldType.Element,
              getElement: (item: NetworkSite): ReactElement => {
                if (!item.snmpCredentialProfile?.name) {
                  return (
                    <span className="text-sm text-gray-400">
                      None — devices without credentials are pinged only
                    </span>
                  );
                }
                return <span>{item.snmpCredentialProfile.name}</span>;
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
