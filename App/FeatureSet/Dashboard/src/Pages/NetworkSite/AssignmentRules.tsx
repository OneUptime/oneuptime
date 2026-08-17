import PageComponentProps from "../PageComponentProps";
import RunRuleNowModal, {
  NetworkRuleKind,
} from "../../Components/NetworkAutomation/RunRuleNowModal";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteAssignmentRule from "Common/Models/DatabaseModels/NetworkSiteAssignmentRule";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const NetworkSiteAssignmentRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * The rule a "Run now" is open for. Assignment rules have no name, so the
   * modal identifies itself by what it is about to do instead.
   */
  const [ruleIdBeingRun, setRuleIdBeingRun] = useState<string | null>(null);

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
            "Automatically assign discovered devices to a site by subnet CIDR or hostname pattern. The higher priority number wins; ties are broken by the older rule. Rules are evaluated when a device is created, when its hostname / name / SNMP system name changes, and on the next poll of any device that has no site yet. A device you assigned to a site by hand is never moved unless its identity changes. Use Run Now on a rule to apply it to devices that already exist.",
        }}
        noItemsMessage="No assignment rules yet. Add one to route newly discovered devices into the right site automatically."
        actionButtons={[
          {
            title: "Run Now",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Play,
            onClick: async (
              item: NetworkSiteAssignmentRule,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setRuleIdBeingRun(item._id?.toString() || null);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
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
              "Wildcard pattern ('*' matches any run of characters, case-insensitive). It is matched against the device's hostname, its SNMP system name and its display name — a match on any of them assigns the device. Example: *0664* matches UN0664LANSWI03.",
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

      {ruleIdBeingRun ? (
        <RunRuleNowModal
          ruleKind={NetworkRuleKind.SiteAssignment}
          ruleId={ruleIdBeingRun}
          onClose={() => {
            setRuleIdBeingRun(null);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default NetworkSiteAssignmentRules;
