import EnabledPill from "Common/UI/Components/Pill/EnabledPill";
import PageComponentProps from "../../PageComponentProps";
import RunAutoImportRuleModal from "../../../Components/NetworkAutomation/RunAutoImportRuleModal";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Column from "Common/UI/Components/ModelTable/Column";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import NetworkDeviceAutoImportRule from "Common/Models/DatabaseModels/NetworkDeviceAutoImportRule";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import Route from "Common/Types/API/Route";
import { DEVICE_MONITOR_TEMPLATE_TYPES } from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { Blue, Red } from "Common/Types/BrandColors";
import {
  AUTO_IMPORT_MONITOR_TEMPLATE_SELECT,
  NO_DEVICE_MONITOR_TEMPLATE_YET,
  canSelectAutoImportMonitorTemplate,
  getAutoImportMonitorTemplateOptions,
  getReadableMonitorTemplateColumn,
  updateMonitorIncompatibleBehavior,
} from "./AutoImportRuleFormUtil";
import { getPollingIntervalOptions } from "../../../Components/NetworkDevice/DiscoveryImport/PollingIntervalLabels";
import { LISTED_TEMPLATE_KINDS_RULE } from "../../../Components/NetworkDevice/DiscoveryImport/DiscoveryImportTemplateCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

const networkDeviceAutoImportDocumentation: string = `
An auto import rule turns what a discovery scan finds into network devices for you: every host it matches is imported as the scan reports it, with no **Review Results** and **Import** by hand. Site, owner and label rules then apply to the new devices as usual.

## When Rules Run

Rules need no schedule: they run on scan results, which OneUptime checks for every minute. A rule runs:

- **As a scan reports hosts.** Each result a probe uploads is matched within about a minute, including the partial results of a long sweep. A scan with **Repeat this scan** on imports newly found hosts on every rescan.
- **When you create or change a rule.** The project's recent scan results are offered to it again, so a rule you write today applies to hosts found today.
- **When you select Run Now.**

Results older than 24 hours are not imported by themselves: only **Run Now** imports them. A host whose address already has a network device is skipped, so repeating a scan or a rule never makes a duplicate.

## Match Criteria

A rule imports a discovered host that matches its conditions. A rule needs at least one condition: with none it would match nothing, so it is refused when you save it.

## What the Conditions Compare

- **IP Address**: the host's address. **Is in** takes a CIDR (\`192.168.1.0/24\`) or an octet range (\`10.16-22.0-255.51-66\`), as a scan target does.
- **System Name**, **System Description**: the host's SNMP sysName and sysDescr. A pattern is a case-insensitive regular expression or a \`*\` wildcard.
- **System Object ID**: the vendor's registered enterprise OID. Its pattern is an OID prefix (\`1.3.6.1.4.1.9\`) or a \`*\` wildcard with literal dots: \`1.3.6.1.4.1.9.*\` is any Cisco device, and never enterprise 94. Only hosts from probes that report sysObjectID can match it.

Only hosts that answered SNMP are imported, unless you turn on **Include Ping-Only Hosts**. Beware: a wrong SNMP credential makes every host on a subnet look ping-only.

## Monitors for Imported Devices

Pick a **Monitor Template** to give each imported device a monitor too, made from the template's criteria, interval, probe agreement, custom field defaults and labels, with your monitor label and owner rules applied. It is the same choice **Review Results** offers. Without a template, a rule only adds devices to the inventory.

- The template is a **Network Device** template, whose monitor reads what each device's polls find, or a **Ping**, **IP**, **Port** or **NTP** template, whose monitor checks each device's own address, from the probe that polls the device. Templates of other kinds cannot check a device and are not listed. **Manage templates** opens your templates in a new tab.
- Each monitor is active, and may count towards your plan. The template must be this project's.
- A host that only answers ping gets a monitor too: a Network Device template's reachability check fires, and its SNMP checks wait until the device has credentials.
- A monitor is named after the device (its sysName, or its address). A template's **Default Monitor Name** is added after it (\`UN0660WANRTR01 - Unit Router\`), which tells two templates apart on one device.
- A device never gets a second monitor of the same kind. A device that already has a monitor from the template, or a Ping, IP, NTP or Port monitor that checks the same thing (a Port or NTP monitor on the same port), from another template or bound to it, is counted as already monitored. A monitor of another kind is still added: a Ping monitor beside a Network Device one.
- Running a rule again adds a missing monitor, even for a device an earlier scan added, and leaves an existing Network Device monitor alone. Rules that pick the same template make one monitor; different Network Device templates make one each.
- Changing a rule's template never deletes or rewrites the monitors it made before. Delete the old monitor and let the rule make the new one.

SNMP health OIDs, interface walking and endpoint collection stay settings of the device itself.

## Exclusion Rules

An exclusion rule turns the match around: a host it matches is never imported, even when another rule matches it. Use one to keep printers, phones and other hosts you do not want out of a broad rule. It cannot be run itself: it only vetoes the others.

## Dry Run and Run Now

- **Run Now** applies a rule to every scan in the project, including results older than 24 hours, and adds the template's monitor to devices that already exist.
- **Dry Run** works out the same, writes nothing, and shows what would be imported and which monitors made, even for a disabled rule.

Running a rule more than once is safe: nothing is made twice.
`;

const NetworkDeviceAutoImportRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const monitorTemplateColumn: Column<NetworkDeviceAutoImportRule> | null =
    getReadableMonitorTemplateColumn();
  /*
   * The two template pickers list the project's templates, so each is
   * offered only to somebody who may list those templates as well as read
   * the rule (PermissionGate.canPickRelation). Without one, the rest of the
   * form stays: an inventory-only rule needs neither template.
   */
  const canPickMonitorTemplate: boolean = PermissionGate.canPickRelation(
    new NetworkDeviceAutoImportRule(),
    "monitorTemplate",
    new MonitorTemplate(),
  );
  const canPickOidTemplate: boolean = PermissionGate.canPickRelation(
    new NetworkDeviceAutoImportRule(),
    "oidTemplate",
    new NetworkDeviceOidTemplate(),
  );

  const translator: Translator = useTranslator();

  /*
   * Every template a device's monitor can be made from (issue #9510): a
   * Network Device one, whose monitor reads each device's polls, or a Ping,
   * IP, Port or NTP one, whose monitor checks each device's address - the
   * kinds Review Results offers. Read each time the Monitor step opens, so a
   * template made in the tab Manage templates opens is there on coming back.
   */
  const fetchDeviceMonitorTemplates: () => Promise<
    Array<DropdownOption | DropdownOptionGroup>
  > = async (): Promise<Array<DropdownOption | DropdownOptionGroup>> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return [];
    }

    const result: ListResult<MonitorTemplate> =
      await ModelAPI.getList<MonitorTemplate>({
        modelType: MonitorTemplate,
        query: {
          projectId: projectId,
          monitorType: new Includes([...DEVICE_MONITOR_TEMPLATE_TYPES]),
        },
        select: AUTO_IMPORT_MONITOR_TEMPLATE_SELECT,
        sort: { templateName: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    return getAutoImportMonitorTemplateOptions({
      templates: result.data,
      translator: translator,
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
          // Its own name as written; the word for none in the reader's words.
          isUserContent: Boolean(template.name),
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
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
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
            "Import the hosts your scans find automatically, when they match a rule. Exclusion rules keep hosts out.",
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
              return <EnabledPill isEnabled={item.isEnabled} />;
            },
          },
          {
            field: { isExclusion: true },
            title: "Rule Type",
            type: FieldType.Boolean,
            /*
             * The rule's kind, named as a kind: "Import" alone is the
             * Import button's key, which many languages word as a verb
             * (Hindi आयात करें, "do import"; German Importieren).
             */
            getElement: (item: NetworkDeviceAutoImportRule): ReactElement => {
              return item.isExclusion ? (
                <Pill color={Red} text="Exclusion rule" />
              ) : (
                <Pill color={Blue} text="Import rule" />
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
          ...(canPickMonitorTemplate
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
            /*
             * Off on purpose, though the column defaults to on: saving an
             * enabled import rule imports the hosts discovered in the last
             * day within a minute, and each one becomes a monitored device.
             * A new rule is tried with Dry Run first and switched on after
             * (CreateFormDefaultsGuard lists why).
             */
            defaultValue: false,
            description: "Enable or disable this rule.",
          },
          {
            field: { ipMatchTarget: true },
            title: "IP Address",
            stepId: "match-criteria",
            sectionTitle: "Match by Address",
            sectionDescription:
              "A host must match every condition you fill in. Fill in at least one.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "192.168.1.0/24 or 10.16-22.0-255.51-66",
            description:
              "A subnet (192.168.1.0/24) or octet range (10.16-22.0-255.51-66). Empty matches any address.",
          },
          {
            field: { sysNamePattern: true },
            title: "System Name",
            stepId: "match-criteria",
            sectionTitle: "Match by SNMP Identity",
            sectionDescription:
              "A regex or * pattern, such as *switch*, matched against what the host reported over SNMP.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "core-sw-.* or *switch*",
            description:
              "Matched against the host's SNMP name. Empty matches any name.",
          },
          {
            field: { sysDescrPattern: true },
            title: "System Description",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Cisco IOS.* or *JUNOS*",
            description:
              "Matched against the host's SNMP description. Empty matches any description.",
          },
          {
            field: { sysObjectIdPattern: true },
            title: "System Object ID",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder:
              "1.3.6.1.4.1.9.* (Cisco) or 1.3.6.1.4.1.2636.* (Juniper)",
            description:
              "An OID prefix (1.3.6.1.4.1.9) or * pattern for the vendor's OID. Empty matches any vendor.",
          },
          {
            field: { includePingOnlyHosts: true },
            title: "Include Ping-Only Hosts",
            stepId: "behavior",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Also import hosts that answered ping but not SNMP, such as every host an ICMP scan finds.",
          },
          {
            field: { isExclusion: true },
            title: "Is Exclusion Rule",
            stepId: "behavior",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Hosts this rule matches are never imported, even when another rule matches them.",
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
          /*
           * Below Is Exclusion Rule, which hides it: a switch that takes away
           * the fields under it, never one above the switch itself.
           */
          {
            field: { pollingIntervalInMinutes: true },
            title: "Check every",
            stepId: "behavior",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: getPollingIntervalOptions(),
            required: false,
            placeholder: "Every 5 minutes (the default)",
            description:
              "How often the scan's probe checks each device this rule imports.",
            showIf: (
              values: FormValues<NetworkDeviceAutoImportRule>,
            ): boolean => {
              return !values.isExclusion;
            },
          },
          ...(canPickOidTemplate
            ? [
                {
                  field: { oidTemplate: true },
                  title: "OID Collection Template",
                  stepId: "behavior",
                  sectionTitle: "Optional Collection",
                  sectionDescription:
                    "What the devices collect. The monitor template below decides what they are alerted on.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  fetchDropdownOptions: fetchOidCollectionTemplates,
                  required: false,
                  placeholder: "No template (device-specific OIDs only)",
                  description:
                    "Devices are linked to it, so editing the template later changes what they all collect.",
                  showIf: (
                    values: FormValues<NetworkDeviceAutoImportRule>,
                  ): boolean => {
                    return !values.isExclusion;
                  },
                },
              ]
            : []),
          ...(canPickMonitorTemplate
            ? [
                {
                  field: { monitorTemplate: true },
                  /*
                   * "Monitor Template", as the rules table's column says:
                   * it is no longer a Network Device template only (issue
                   * #9510).
                   */
                  title: "Monitor Template",
                  stepId: "monitor",
                  sectionTitle: "Optional Alerting",
                  /*
                   * The custom fields half names where they are SET, because
                   * that is what issue #3548 could not find: the values were
                   * always copied from the template onto every imported
                   * device's monitor, and the template had nowhere to enter
                   * them until the Custom Field Defaults card existed.
                   */
                  sectionDescription:
                    "Leave it empty to import devices only. Each monitor copies the template's criteria, interval, labels and custom field defaults, and may be billed.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  fetchDropdownOptions: fetchDeviceMonitorTemplates,
                  required: false,
                  placeholder: "Import device only (no monitor)",
                  // Which templates are listed, worded as Review Results words it.
                  description: LISTED_TEMPLATE_KINDS_RULE,
                  // How to make one, in a new tab so the form is kept.
                  sideLink: {
                    text: "Manage templates",
                    url: RouteUtil.populateRouteParams(
                      RouteMap[PageMap.MONITORS_SETTINGS_TEMPLATES] as Route,
                    ),
                    openLinkInNewTab: true,
                  },
                  noOptionsText: NO_DEVICE_MONITOR_TEMPLATE_YET,
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
