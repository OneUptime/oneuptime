import PageComponentProps from "../../PageComponentProps";
import RunAutoImportRuleModal from "../../../Components/NetworkAutomation/RunAutoImportRuleModal";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Column from "Common/UI/Components/ModelTable/Column";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import NetworkDeviceAutoImportRule from "Common/Models/DatabaseModels/NetworkDeviceAutoImportRule";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { Blue, Green, Red } from "Common/Types/BrandColors";
import {
  canSelectAutoImportMonitorTemplate,
  getReadableMonitorTemplateColumn,
  updateMonitorIncompatibleBehavior,
} from "./AutoImportRuleFormUtil";

const networkDeviceAutoImportDocumentation: string = `
### How Auto Import Rules Work

Auto Import Rules turn discovery scan results into Network Devices automatically — matching hosts are imported the moment a scan completes, with no manual "Review Results → Import" step. Site assignment, owner, and label rules then apply to the imported devices automatically.

An import rule can also select a **Network Device Monitor Template**. That opt-in completes the alerting pipeline: OneUptime creates an active monitor for each matching SNMP device, copies the template's criteria, interval, minimum probe agreement, custom fields and monitor labels, and then applies the normal Monitor Label and Owner Rules. Existing rules with no template remain inventory-only.

### Match Criteria

A rule imports a discovered host only when **all** specified criteria pass — conditions on one rule are ANDed. At least one condition is required — a rule with no conditions matches nothing, and is rejected when you save it. To OR conditions, create multiple rules.

- **Host IP Is In** — a CIDR (\`192.168.1.0/24\`) or octet range (\`10.16-22.0-255.51-66\`), the same notations a scan target takes.
- **System Name / Description Pattern** — case-insensitive regex, or a \`*\` wildcard pattern, matched against the host's SNMP sysName / sysDescr.
- **System Object ID Pattern** — matched against the host's sysObjectID, the vendor's registered enterprise OID. NOT the free-text syntax above: an OID is a dotted numeric arc, so this takes an OID prefix (\`1.3.6.1.4.1.9\`) or a \`*\` wildcard pattern with literal dots (\`1.3.6.1.4.1.9.*\` is "any Cisco device" and can never match enterprise 94). Only hosts found by probes that report sysObjectID can match this condition.

By default only hosts that answered SNMP are imported. Enable **Include Ping-Only Hosts** to also import hosts that only answered ping — but beware: a wrong SNMP credential makes every host on a subnet report as ping-only.

### Monitor Provisioning

Selecting a monitor template creates active monitors and may affect plan usage or billing. The template must belong to this project and have the **Network Device** monitor type. Ping-only hosts cannot use this operation because they do not produce the SNMP walks a Network Device monitor evaluates.

The monitor template is the alerting layer: it supplies evaluation criteria and monitor settings. SNMP Health OIDs, interface walking, and endpoint collection remain polling settings on the Network Device itself; auto-imported devices continue to use the existing vendor-health-template seeding behavior for those fields.

Provisioned monitors are named after the DEVICE, not the template: the discovered host's SNMP sysName, falling back to its address. A template that fills in **Default Monitor Name** appends it as a suffix (\`UN0660WANRTR01 - Unit Router\`), which is what tells two templates apart on one device; leave that field blank and each monitor carries the device name alone.

Provisioning is reconciled and safe to repeat: a missing template monitor is added even when the Network Device was registered by an earlier scan, while an existing automatic or manually configured Network Device monitor is left alone. If several matching rules select the same template, OneUptime creates one monitor. If they deliberately select different templates, it creates one monitor per distinct template.

Changing a rule's template does not delete or rewrite monitors created from its old template. This avoids destructive surprises; delete the old automatic monitor and let the intended rule recreate it, or replace it with a manual monitor if you are migrating templates.

### Exclusion Rules

An exclusion rule inverts the match: hosts it matches are **never** auto-imported, even when another rule matches them. Use one to carve printers, phones, or other unwanted hosts out of a broader import rule. An exclusion rule cannot be run directly — it vetoes other rules instead of importing anything.

### Dry Run and Run Now

Rules fire automatically when a discovery scan completes. **Run Now** applies a rule to completed scans already in the project, including backfilling a selected template monitor for an already-registered matching device. **Dry Run** performs the same reconciliation but writes nothing — it answers what would be imported and which monitors would be created before you trust the rule. It also works on a **disabled** rule. Device and monitor creation are idempotent, so running a rule more than once is safe.
`;

const NetworkDeviceAutoImportRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const monitorTemplateColumn: Column<NetworkDeviceAutoImportRule> | null =
    getReadableMonitorTemplateColumn();
  const canReadMonitorTemplate: boolean = Boolean(monitorTemplateColumn);

  const fetchNetworkDeviceMonitorTemplates: () => Promise<
    Array<DropdownOption>
  > = async (): Promise<Array<DropdownOption>> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return [];
    }

    const result: ListResult<MonitorTemplate> =
      await ModelAPI.getList<MonitorTemplate>({
        modelType: MonitorTemplate,
        query: {
          projectId: projectId,
          monitorType: MonitorType.NetworkDevice,
        },
        select: {
          _id: true,
          templateName: true,
        },
        sort: { templateName: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    return result.data.map((template: MonitorTemplate): DropdownOption => {
      return {
        value: template.id?.toString() || "",
        label: template.templateName || "Unnamed Network Device template",
      };
    });
  };

  const fetchOidCollectionTemplates: () => Promise<
    Array<DropdownOption>
  > = async (): Promise<Array<DropdownOption>> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return [];
    }

    const result: ListResult<NetworkDeviceOidTemplate> =
      await ModelAPI.getList<NetworkDeviceOidTemplate>({
        modelType: NetworkDeviceOidTemplate,
        query: {
          projectId: projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    return result.data.map(
      (template: NetworkDeviceOidTemplate): DropdownOption => {
        return {
          value: template.id?.toString() || "",
          label: template.name || "Unnamed OID Collection Template",
        };
      },
    );
  };

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
          ...(monitorTemplateColumn ? [monitorTemplateColumn] : []),
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={[
          { title: "Basic Info", id: "basic-info" },
          { title: "Match Criteria", id: "match-criteria", columns: 2 },
          { title: "Behavior", id: "behavior" },
          ...(canReadMonitorTemplate
            ? [
                {
                  title: "Monitor",
                  id: "monitor",
                  showIf: canSelectAutoImportMonitorTemplate,
                },
              ]
            : []),
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
            field: { sysObjectIdPattern: true },
            title: "System Object ID Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder:
              "1.3.6.1.4.1.9.* (Cisco) or 1.3.6.1.4.1.2636.* (Juniper)",
            description:
              "An OID prefix (1.3.6.1.4.1.9) or a '*' wildcard OID pattern with literal dots — not regex — matched against the discovered host's SNMP sysObjectID, the vendor's registered enterprise OID. Leave empty to match any vendor. Only hosts found by probes new enough to report sysObjectID can match.",
          },
          {
            field: { includePingOnlyHosts: true },
            title: "Include Ping-Only Hosts",
            stepId: "behavior",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Also import hosts that answered ping but not SNMP. Off by default: a wrong SNMP credential makes every host on a subnet report as ping-only, and this rule would then import all of them as half-identified devices.",
            onChange: (
              value: unknown,
              currentValues: FormValues<NetworkDeviceAutoImportRule>,
              setNewFormValues: (
                values: FormValues<NetworkDeviceAutoImportRule>,
              ) => void,
            ): void => {
              setNewFormValues(
                updateMonitorIncompatibleBehavior(
                  currentValues,
                  "includePingOnlyHosts",
                  value === true,
                ),
              );
            },
          },
          {
            field: { isExclusion: true },
            title: "Is Exclusion Rule",
            stepId: "behavior",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Invert this rule: matching hosts are NEVER auto-imported, even when another rule matches them. Use it to carve printers, phones, or other unwanted hosts out of a broader rule.",
            onChange: (
              value: unknown,
              currentValues: FormValues<NetworkDeviceAutoImportRule>,
              setNewFormValues: (
                values: FormValues<NetworkDeviceAutoImportRule>,
              ) => void,
            ): void => {
              setNewFormValues(
                updateMonitorIncompatibleBehavior(
                  currentValues,
                  "isExclusion",
                  value === true,
                ),
              );
            },
          },
          {
            field: { oidTemplate: true },
            title: "OID Collection Template",
            stepId: "behavior",
            sectionTitle: "Optional Collection",
            sectionDescription:
              "What every device this rule imports collects. The Monitor Template below decides what those devices are ALERTED on; this decides what they COLLECT.",
            fieldType: FormFieldSchemaType.Dropdown,
            fetchDropdownOptions: fetchOidCollectionTemplates,
            required: false,
            placeholder: "No template (device-specific OIDs only)",
            description:
              "Imported devices are LINKED to this template, not given a copy: editing the template later changes what every linked device collects on its next poll. Without one, an imported device starts with whatever the vendor fingerprint seeds and has to be configured by hand.",
            showIf: (
              values: FormValues<NetworkDeviceAutoImportRule>,
            ): boolean => {
              return !values.isExclusion;
            },
          },
          ...(canReadMonitorTemplate
            ? [
                {
                  field: { monitorTemplate: true },
                  title: "Network Device Monitor Template",
                  stepId: "monitor",
                  sectionTitle: "Optional Alerting",
                  sectionDescription:
                    "Leave this empty for inventory-only import. Selecting a template creates active, potentially billable monitors and runs the normal Monitor Label and Owner Rules after creation.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  fetchDropdownOptions: fetchNetworkDeviceMonitorTemplates,
                  required: false,
                  placeholder: "Import device only (no monitor)",
                  description:
                    "Alert criteria, interval, minimum probe agreement, custom fields and monitor labels are copied from this template. Health OIDs and other polling settings remain on the Network Device. Matching rules that select different templates can create multiple monitors per device.",
                  showIf: canSelectAutoImportMonitorTemplate,
                },
              ]
            : []),
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
