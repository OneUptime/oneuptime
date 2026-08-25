import PageComponentProps from "../../PageComponentProps";
import RunAutoImportRuleModal from "../../../Components/NetworkAutomation/RunAutoImportRuleModal";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import NetworkDeviceAutoImportRule from "Common/Models/DatabaseModels/NetworkDeviceAutoImportRule";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { Blue, Green, Red } from "Common/Types/BrandColors";

const networkDeviceAutoImportDocumentation: string = `
### How Auto Import Rules Work

Auto Import Rules turn discovery scan results into Network Devices automatically — matching hosts are imported the moment a scan completes, with no manual "Review Results → Import" step. Site assignment, owner, and label rules then apply to the imported devices automatically, so a rule here is the first link in a fully automatic pipeline from scan to labelled, owned, site-assigned device.

### Match Criteria

A rule imports a discovered host only when **all** specified criteria pass — conditions on one rule are ANDed. At least one condition is required — a rule with no conditions matches nothing, and is rejected when you save it. To OR conditions, create multiple rules.

- **Host IP Is In** — a CIDR (\`192.168.1.0/24\`) or octet range (\`10.16-22.0-255.51-66\`), the same notations a scan target takes.
- **System Name / Description Pattern** — case-insensitive regex, or a \`*\` wildcard pattern, matched against the host's SNMP sysName / sysDescr.

By default only hosts that answered SNMP are imported. Enable **Include Ping-Only Hosts** to also import hosts that only answered ping — but beware: a wrong SNMP credential makes every host on a subnet report as ping-only.

### Exclusion Rules

An exclusion rule inverts the match: hosts it matches are **never** auto-imported, even when another rule matches them. Use one to carve printers, phones, or other unwanted hosts out of a broader import rule. An exclusion rule cannot be run directly — it vetoes other rules instead of importing anything.

### Dry Run and Run Now

Rules fire automatically when a discovery scan completes, so a rule written after your scans ran does not reach them. **Run Now** applies a rule to every completed scan already in the project. **Dry Run** does the same evaluation but writes nothing — it answers "what would this rule import" before you trust the rule. Hosts that already have a registered device are always skipped, so running a rule more than once is safe.
`;

const NetworkDeviceAutoImportRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The rule a run is open for, by id, plus its name and which kind of run.
  const [ruleBeingRun, setRuleBeingRun] = useState<{
    id: string;
    name: string | undefined;
    isDryRun: boolean;
  } | null>(null);

  type OpenRunModalFunction = (
    item: NetworkDeviceAutoImportRule,
    isDryRun: boolean,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ) => void;

  const openRunModal: OpenRunModalFunction = (
    item: NetworkDeviceAutoImportRule,
    isDryRun: boolean,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ): void => {
    try {
      const id: string | undefined = item._id?.toString();

      if (id) {
        setRuleBeingRun({ id: id, name: item.name, isDryRun: isDryRun });
      }

      onCompleteAction();
    } catch (err) {
      onCompleteAction();
      onError(err as Error);
    }
  };

  return (
    <Fragment>
      <ModelTable<NetworkDeviceAutoImportRule>
        modelType={NetworkDeviceAutoImportRule}
        id="network-device-auto-import-rules-table"
        name="Settings > Network Device Auto Import Rules"
        userPreferencesKey="network-device-auto-import-rules-table"
        saveFilterProps={{
          tableId: "network-device-auto-import-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Network Device Auto Import Rules",
          description:
            "Automatically import hosts found by discovery scans as network devices when they match these rules. Site assignment, owner, and label rules then apply to the imported devices automatically. Exclusion rules veto matching hosts.",
        }}
        helpContent={{
          title: "How Auto Import Rules Work",
          description:
            "Import discovered hosts as network devices automatically.",
          markdown: networkDeviceAutoImportDocumentation,
        }}
        actionButtons={[
          {
            title: "Dry Run",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Beaker,
            // An exclusion rule vetoes; there is nothing of it to run.
            isVisible: (item: NetworkDeviceAutoImportRule): boolean => {
              return !item.isExclusion;
            },
            onClick: async (
              item: NetworkDeviceAutoImportRule,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              openRunModal(item, true, onCompleteAction, onError);
            },
          },
          {
            title: "Run Now",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Play,
            isVisible: (item: NetworkDeviceAutoImportRule): boolean => {
              return !item.isExclusion;
            },
            onClick: async (
              item: NetworkDeviceAutoImportRule,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              openRunModal(item, false, onCompleteAction, onError);
            },
          },
        ]}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        filters={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
          {
            field: { isEnabled: true },
            title: "Enabled",
            type: FieldType.Boolean,
          },
          {
            field: { isExclusion: true },
            title: "Is Exclusion Rule",
            type: FieldType.Boolean,
          },
          {
            field: { ipMatchTarget: true },
            title: "Host IP Is In",
            type: FieldType.Text,
          },
        ]}
        columns={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
          {
            field: { isEnabled: true },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: NetworkDeviceAutoImportRule): ReactElement => {
              return item.isEnabled ? (
                <Pill color={Green} text="Enabled" />
              ) : (
                <Pill color={Red} text="Disabled" />
              );
            },
          },
          {
            field: { isExclusion: true },
            title: "Rule Type",
            type: FieldType.Boolean,
            getElement: (item: NetworkDeviceAutoImportRule): ReactElement => {
              return item.isExclusion ? (
                <Pill color={Red} text="Exclusion" />
              ) : (
                <Pill color={Blue} text="Import" />
              );
            },
          },
          {
            field: { ipMatchTarget: true },
            title: "Host IP Is In",
            type: FieldType.Text,
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={[
          { title: "Basic Info", id: "basic-info" },
          { title: "Match Criteria", id: "match-criteria", columns: 2 },
          { title: "Behavior", id: "behavior" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Import core switches",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: "Enable or disable this rule.",
          },
          {
            field: { ipMatchTarget: true },
            title: "Host IP Is In",
            stepId: "match-criteria",
            sectionTitle: "Match by Address",
            sectionDescription:
              "Conditions on one rule are ANDed — every filled-in condition must pass. At least one condition is required; to OR conditions, create multiple rules.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "192.168.1.0/24 or 10.16-22.0-255.51-66",
            description:
              "Only trigger for discovered hosts whose IP is inside this CIDR (192.168.1.0/24) or octet range (10.16-22.0-255.51-66) — the same notations a scan target takes. Leave empty to match any address.",
          },
          {
            field: { sysNamePattern: true },
            title: "System Name Pattern",
            stepId: "match-criteria",
            sectionTitle: "Match by SNMP Identity",
            sectionDescription:
              "Case-insensitive regex — or a '*' wildcard pattern such as *switch* — matched against what the host reported over SNMP.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "core-sw-.* or *switch*",
            description:
              "Regex or * wildcard pattern (case-insensitive) matched against the discovered host's SNMP sysName. Leave empty to match any name.",
          },
          {
            field: { sysDescrPattern: true },
            title: "System Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Cisco IOS.* or *JUNOS*",
            description:
              "Regex or * wildcard pattern (case-insensitive) matched against the discovered host's SNMP sysDescr. Leave empty to match any description.",
          },
          {
            field: { includePingOnlyHosts: true },
            title: "Include Ping-Only Hosts",
            stepId: "behavior",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Also import hosts that answered ping but not SNMP. Off by default: a wrong SNMP credential makes every host on a subnet report as ping-only, and this rule would then import all of them as half-identified devices.",
          },
          {
            field: { isExclusion: true },
            title: "Is Exclusion Rule",
            stepId: "behavior",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Invert this rule: matching hosts are NEVER auto-imported, even when another rule matches them. Use it to carve printers, phones, or other unwanted hosts out of a broader rule.",
          },
        ]}
        showRefreshButton={true}
      />

      {ruleBeingRun ? (
        <RunAutoImportRuleModal
          ruleId={ruleBeingRun.id}
          ruleName={ruleBeingRun.name}
          isDryRun={ruleBeingRun.isDryRun}
          onClose={() => {
            setRuleBeingRun(null);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default NetworkDeviceAutoImportRulesPage;
