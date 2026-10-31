import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PageComponentProps from "../../PageComponentProps";
import {
  fetchAllNetworkSiteTypeOptions,
  fetchParentNetworkSiteOptions,
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
import {
  SITE_MORE_FIELDS,
  SITE_TYPE_FIELD_DESCRIPTION,
} from "../SiteFormSections";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Site settings: identity, hierarchy placement, and map position. The
 * hierarchy fields matter — the rollup engine and the map both key off
 * parent site and coordinates.
 */
const NetworkSiteSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
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
        /*
         * The Add Site form's three steps, so a field sits under the same
         * step on both: the description and location fold under More fields
         * on Site Details rather than walking a step of their own.
         */
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
            description: SITE_TYPE_FIELD_DESCRIPTION,
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
            placeholder: "London office",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "site-details",
            collapsibleSection: SITE_MORE_FIELDS,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Flagship location — two switches and a firewall.",
          },
          {
            field: {
              address: true,
            },
            title: "Address",
            stepId: "site-details",
            collapsibleSection: SITE_MORE_FIELDS,
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "742 Evergreen Terrace, Springfield, IL",
          },
          {
            field: {
              latitude: true,
            },
            title: "Latitude",
            stepId: "site-details",
            collapsibleSection: SITE_MORE_FIELDS,
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
            stepId: "site-details",
            collapsibleSection: SITE_MORE_FIELDS,
            description:
              "Between -180 and 180. Needed to pin this site on the network map.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "-89.6501",
          },
          {
            field: {
              parentSite: true,
            },
            title: "Parent Site",
            stepId: "hierarchy",
            sectionTitle: "Place This Site",
            sectionDescription:
              "Any site not below this one can be the parent. Sites of the type directly above are listed first.",
            description: "Leave it empty to keep the site at the top level.",
            fieldType: FormFieldSchemaType.Dropdown,
            fetchDropdownOptions: (values: FormValues<NetworkSite>) => {
              return fetchParentNetworkSiteOptions(values, modelId);
            },
            required: false,
            placeholder: "No parent site (top level)",
          },
          {
            field: {
              probe: true,
            },
            title: "Default Probe",
            stepId: "monitoring-defaults",
            sectionTitle: "Monitoring Defaults",
            sectionDescription: "What a device added to this site starts with.",
            description:
              "A device added here without a probe inherits it. A probe on the public internet cannot reach a private network.",
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
              "Used by devices here that have no credentials of their own. A device with none anywhere is pinged only.",
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
                  return (
                    <span className="text-gray-400">
                      {translator.translateText("Not set")}
                    </span>
                  );
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
                  return (
                    <span className="text-gray-400">
                      {translator.translateText("Top level")}
                    </span>
                  );
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
                      {translator.translateText(
                        "None — devices name their own probe",
                      )}
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
                      {translator.translateText(
                        "None — devices without credentials are pinged only",
                      )}
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
              "Opens an alert when the site turns unhealthy, and resolves it when the site recovers.",
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
              sort: {
                order: SortOrder.Ascending,
              },
            },
            required: false,
            placeholder: "Select Alert Severity",
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
                      {translator.translateText(
                        "Project default (most severe)",
                      )}
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
              "Worst status: one offline device makes the site offline. Percentage of devices down: the share decides.",
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
              "For the percentage policy: the share of devices down at which the site is offline.",
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
                      {translator.translateText("Not used by this policy")}
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
