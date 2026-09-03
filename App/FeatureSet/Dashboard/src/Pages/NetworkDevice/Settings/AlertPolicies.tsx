import PageComponentProps from "../../PageComponentProps";
import {
  AlertPolicyScopeSelection,
  readDropdownIds,
  readScopeSelection,
  summarizeScope,
  toScope,
} from "../../../Components/NetworkDevice/AlertPolicyScopeFormFields";
import PingMonitorSeedIds from "../../../Components/NetworkDevice/PingMonitorSeedIds";
import Label from "Common/Models/DatabaseModels/Label";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "Common/Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceRole from "Common/Models/DatabaseModels/NetworkDeviceRole";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green, Red } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import NetworkAlertPolicyScope from "Common/Types/NetworkDevice/NetworkAlertPolicyScope";
import ObjectID from "Common/Types/ObjectID";
import NetworkAlertPolicyBootstrapUtil from "Common/Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil";
import { MonitorCriteriaSeedIds } from "Common/Utils/NetworkDiscovery/PingMonitorBuilder";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Column from "Common/UI/Components/ModelTable/Column";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const networkAlertPolicyDocumentation: string = `
### What an Alert Policy Is

A policy says once what a whole set of devices is alerted on: **which** devices (a scope of sites, device roles and labels) and **what** to alert on (a Network Device monitor template). The engine then keeps one Network Device monitor per matching device, cloned from that template, as devices are added, moved between sites, re-labelled, archived and removed. Two hundred warehouse switches that should raise an incident when unreachable is one policy, not two hundred monitors — and the two-hundred-and-first switch is covered the moment it is discovered.

### Scope

- **AND across kinds**: a device must match the sites list AND the roles list AND the labels list.
- **OR within a kind**: "in site A or site B", "carrying label X or label Y".
- **An empty kind matches everything.** Leave sites empty to cover every site (including devices in no site).

A policy with every kind empty covers **every device in the project**. The table says "All devices" against it so nobody misreads the reach.

Only probe-polled devices that have a probe are covered: a monitor-backed device already has a monitor of its own, and an archived device is left alone.

### Monitors and your plan

**Each policy provisions one monitor per matching device, and every one of those monitors counts towards your plan.** An unscoped policy in a large estate is a lot of monitors from one form submit; the confirmation says how many devices are in the project before the recommended policy is created.

Provisioned monitors are named after the device and are re-synced from the template: edit the template's criteria and every monitor follows; edit a provisioned monitor by hand and the next sync overwrites it. Disabling a policy stands its monitors down without deleting them; deleting a policy deletes the monitors it provisioned.

### Templates

The template must be a **Network Device** monitor template, and one template can back only one policy — and cannot at the same time be selected by an auto-import rule. A provisioned monitor's provenance is the pair (device, template), so a template shared by two owners would leave both claiming the same monitor. The form refuses those selections with a sentence rather than a constraint error.

A policy outlives its template. Should a template ever go, the policies that used it keep their name and their scope, provision nothing until another template is picked, and show in the table with no template against them — so a lost template is a repair, never a rebuild.

### The recommended policy

With no policies yet, the page offers to create one: a **Network device alert pack (recommended)** template — an incident when a device stops answering ping and SNMP or an interface goes down, an alert when the SNMP walk fails, an interface saturates or logs errors — and an **Alert on every device** policy that applies it to the whole project. The template is found again by a marker in its description, so the action never mints a second copy. Narrow the policy's scope afterwards if the whole project is too much.

On a device with no SNMP credentials only the reachability item can ever fire. Such a device is pinged, not walked, so there are no interfaces and no walk result for the other four items to read, and they are not evaluated rather than reported as healthy. Give the device credentials — its own, or a profile on it or on its site — and the same monitor starts evaluating the rest on the next poll, with nothing to change here.
`;

/*
 * A monitor template the form can pick: Network Device templates only. The
 * server refuses any other type, and a template already used by another
 * policy or by an auto-import rule, with a sentence — those are surfaced
 * by the form as the save error rather than filtered here, because the
 * list would need every policy and every rule to filter them client-side
 * and would still race a rule saved a second ago.
 */
async function fetchNetworkDeviceMonitorTemplates(): Promise<
  Array<DropdownOption>
> {
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
}

export interface AlertPolicyScopeEditorProps {
  initialValue?: unknown;
  onChange?: ((scope: NetworkAlertPolicyScope) => void) | undefined;
}

/*
 * The three entity pickers behind the one jsonb column.
 *
 * A CustomComponent rather than three MultiSelectDropdown fields, because
 * the column is one object: three separate fields would need an
 * onBeforeCreate to fold them into the scope on create and have nothing
 * equivalent on edit. This edits the object directly, so create and edit
 * are the same code path and the form posts exactly what the table reads.
 */
const AlertPolicyScopeEditor: FunctionComponent<AlertPolicyScopeEditorProps> = (
  props: AlertPolicyScopeEditorProps,
): ReactElement => {
  const [selection, setSelection] = useState<AlertPolicyScopeSelection>(
    readScopeSelection(props.initialValue),
  );

  const updateSelection: (next: AlertPolicyScopeSelection) => void = (
    next: AlertPolicyScopeSelection,
  ): void => {
    setSelection(next);
    props.onChange?.(toScope(next));
  };

  return (
    <div className="space-y-5">
      <div>
        <FieldLabelElement
          title="Sites"
          description="Devices in any of these sites. Leave empty to cover every site, including devices in no site."
          required={false}
        />
        <EntityDropdown
          id="alert-policy-scope-sites"
          modelType={NetworkSite}
          labelField="name"
          valueField="_id"
          isMultiSelect={true}
          enableLabelsTab={false}
          value={selection.siteIds}
          placeholder="Any site"
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            updateSelection({
              ...selection,
              siteIds: readDropdownIds(value),
            });
          }}
        />
      </div>
      <div>
        <FieldLabelElement
          title="Device Roles"
          description="Devices with any of these roles. Leave empty to cover every role, including unclassified devices."
          required={false}
        />
        <EntityDropdown
          id="alert-policy-scope-roles"
          modelType={NetworkDeviceRole}
          labelField="name"
          valueField="_id"
          isMultiSelect={true}
          enableLabelsTab={false}
          value={selection.networkDeviceRoleIds}
          placeholder="Any role"
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            updateSelection({
              ...selection,
              networkDeviceRoleIds: readDropdownIds(value),
            });
          }}
        />
      </div>
      <div>
        <FieldLabelElement
          title="Labels"
          description="Devices carrying any of these labels. Leave empty to cover every device regardless of labels."
          required={false}
        />
        <EntityDropdown
          id="alert-policy-scope-labels"
          modelType={Label}
          labelField="name"
          valueField="_id"
          isMultiSelect={true}
          enableLabelsTab={false}
          value={selection.labelIds}
          placeholder="Any label"
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            updateSelection({
              ...selection,
              labelIds: readDropdownIds(value),
            });
          }}
        />
      </div>
      <p className="text-sm text-gray-500">
        Currently covers: <strong>{summarizeScope(selection)}</strong>. A device
        must match every kind that is filled in, and any entry within a kind.
      </p>
    </div>
  );
};

/*
 * The recommended template, found by its marker or created. Returns its id.
 *
 * Listed with a narrow select and matched client-side rather than searched
 * by description on the server: a project holds a handful of Network Device
 * templates, and the marker check is one string test per row.
 */
async function findOrCreateRecommendedTemplate(data: {
  projectId: ObjectID;
  seedIds: MonitorCriteriaSeedIds;
}): Promise<ObjectID> {
  const templates: ListResult<MonitorTemplate> =
    await ModelAPI.getList<MonitorTemplate>({
      modelType: MonitorTemplate,
      query: {
        projectId: data.projectId,
        monitorType: MonitorType.NetworkDevice,
      },
      select: {
        _id: true,
        templateDescription: true,
      },
      sort: { createdAt: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

  const existingTemplate: MonitorTemplate | null =
    NetworkAlertPolicyBootstrapUtil.findRecommendedTemplate(templates.data);

  if (existingTemplate?.id) {
    return existingTemplate.id;
  }

  const response: HTTPResponse<
    JSONObject | JSONArray | MonitorTemplate | Array<MonitorTemplate>
  > = await ModelAPI.create<MonitorTemplate>({
    model: NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate({
      projectId: data.projectId,
      incidentSeverityId: data.seedIds.defaultIncidentSeverityId,
      alertSeverityId: data.seedIds.defaultAlertSeverityId,
      onlineMonitorStatusId: data.seedIds.onlineMonitorStatusId,
      offlineMonitorStatusId: data.seedIds.offlineMonitorStatusId,
    }),
    modelType: MonitorTemplate,
  });

  const createdTemplateId: ObjectID | undefined =
    (response.data as MonitorTemplate | undefined)?.id ?? undefined;

  if (!createdTemplateId) {
    throw new BadDataException(
      "The recommended monitor template was created but the server did not return its id. Refresh the page and try again; the template will be found rather than created twice.",
    );
  }

  return createdTemplateId;
}

export interface RecommendedPolicyEmptyStateProps {
  onCreated: () => void;
}

/*
 * What an empty policies table shows: the offer to create the recommended
 * pair. Rendered through the table's noItemsMessage so it disappears the
 * moment a policy exists and never shows against a search that matched
 * nothing (BaseModelTable overrides the message in that case).
 */
const RecommendedPolicyEmptyState: FunctionComponent<
  RecommendedPolicyEmptyStateProps
> = (props: RecommendedPolicyEmptyStateProps): ReactElement => {
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceCount, setDeviceCount] = useState<number | null>(null);

  /*
   * Creating the pair is a MonitorTemplate create and a NetworkAlertPolicy
   * create; the policy is the one held to Owner / Admin, so it is the one
   * the button is gated on. A template-create refusal surfaces as the error.
   */
  const createGate: PermissionGateResult = PermissionGate.check(
    new NetworkAlertPolicy(),
    ModelAction.Create,
  );

  const openConfirm: () => Promise<void> = async (): Promise<void> => {
    setError(null);
    setDeviceCount(null);
    setShowConfirm(true);

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    /*
     * Best effort, and an upper bound: the engine skips monitor-backed
     * devices and devices with no probe, but the count is what tells an
     * operator whether "every device" is forty monitors or four thousand.
     */
    try {
      const count: number = await ModelAPI.count<NetworkDevice>({
        modelType: NetworkDevice,
        query: {
          projectId: projectId,
          isArchived: false,
        },
      });

      setDeviceCount(count);
    } catch {
      // The confirmation still reads correctly without a number.
    }
  };

  const createRecommendedPolicy: () => Promise<void> =
    async (): Promise<void> => {
      setIsCreating(true);
      setError(null);

      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

        if (!projectId) {
          throw new BadDataException(
            "No project is selected, so the recommended policy cannot be created.",
          );
        }

        /*
         * A project missing an operational status or a severity throws an
         * operator-facing message that names the fix; nothing is created
         * until all four ids resolve.
         */
        const seedIds: MonitorCriteriaSeedIds =
          await PingMonitorSeedIds.resolve();

        const monitorTemplateId: ObjectID =
          await findOrCreateRecommendedTemplate({
            projectId: projectId,
            seedIds: seedIds,
          });

        await ModelAPI.create<NetworkAlertPolicy>({
          model: NetworkAlertPolicyBootstrapUtil.buildRecommendedPolicy({
            projectId: projectId,
            monitorTemplateId: monitorTemplateId,
          }),
          modelType: NetworkAlertPolicy,
        });

        setShowConfirm(false);
        props.onCreated();
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsCreating(false);
    };

  /*
   * The number is the count of ACTIVE devices, which is an upper bound on the
   * monitors rather than the figure itself — the engine skips monitor-backed
   * devices and devices with no probe. It is said as an upper bound for that
   * reason: this is the sentence somebody reads before turning a four-thousand
   * device estate into four thousand billable monitors, and a number presented
   * as exact and then undershot by a thousand teaches them to ignore it.
   */
  const confirmDescription: string = `This creates the "Network device alert pack (recommended)" monitor template if the project does not have it yet, and an "Alert on every device" policy that applies it to every probe-polled device in the project, and to every device added later. One Network Device monitor is provisioned per covered device, and each counts towards your plan${
    deviceCount !== null
      ? `: the project holds ${deviceCount} active ${deviceCount === 1 ? "device" : "devices"} today, which is the most this can provision`
      : ""
  }. You can narrow the policy's scope afterwards.`;

  return (
    <div className="py-4">
      <p className="text-sm font-medium text-gray-900">No alert policies yet</p>
      <p className="mt-1 text-sm text-gray-500">
        A policy alerts on a whole set of devices at once: one monitor per
        matching device, kept as devices come and go. The recommended one raises
        an incident when a device stops answering or an interface goes down, and
        an alert when its SNMP walk fails, an interface saturates or an
        interface logs errors. A device with no SNMP credentials is pinged, not
        walked, so only the reachability item can fire on it.
      </p>
      {createGate.isAllowed ? (
        <div className="mt-4 flex justify-center">
          <Button
            title="Create the recommended policy"
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.PRIMARY}
            dataTestId="create-recommended-alert-policy"
            onClick={(): void => {
              openConfirm().catch((err: unknown): void => {
                setError(API.getFriendlyMessage(err));
              });
            }}
          />
        </div>
      ) : (
        /*
         * Say why there is no button, when there is something to say. An
         * empty state that offers nothing and explains nothing reads as a
         * broken page rather than as a permission the reader does not hold.
         * `disabledReason` is undefined while the permission snapshot is
         * still loading, and PermissionGate's contract is to show nothing
         * rather than accuse the user in that window.
         */
        createGate.disabledReason && (
          <p className="mt-4 text-sm text-gray-400">
            {createGate.disabledReason}
          </p>
        )
      )}
      {error && !showConfirm && <ErrorMessage message={error} />}
      {showConfirm && (
        <ConfirmModal
          title="Create the recommended policy?"
          description={confirmDescription}
          submitButtonText="Create policy"
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isCreating}
          error={error || undefined}
          onClose={(): void => {
            setShowConfirm(false);
          }}
          onSubmit={(): void => {
            createRecommendedPolicy().catch((err: unknown): void => {
              setError(API.getFriendlyMessage(err));
              setIsCreating(false);
            });
          }}
        />
      )}
    </div>
  );
};

/*
 * Settings > Network > Alert Policies.
 *
 * The table is what an operator reads to find out why a monitor exists and
 * whether a policy is quietly working or has been failing since Tuesday:
 * hence the engine's stamped columns (covered device count, last sync and
 * its error) beside the scope, rather than a live device query per row.
 */
const NetworkAlertPoliciesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [refreshToggle, setRefreshToggle] = useState<string>(
    ObjectID.generate().toString(),
  );

  /*
   * Selecting an unreadable relation fails the whole list request, so the
   * template column and the template field only exist for a user who may
   * read monitor templates (the AutoImportRules precedent). The server
   * still requires a template, so a user without the field is told so on
   * save rather than shown a form that silently drops it.
   */
  const canReadMonitorTemplate: boolean = PermissionGate.canReadColumn(
    new NetworkAlertPolicy(),
    "monitorTemplate",
  );

  const monitorTemplateColumn: Column<NetworkAlertPolicy> | null =
    canReadMonitorTemplate
      ? {
          field: { monitorTemplate: { templateName: true } },
          title: "Monitor Template",
          type: FieldType.Entity,
          /*
           * `selectedProperty` is what makes this cell render the template's
           * NAME. The table derives its cell key from the first key of
           * `field` alone, so without it both the cell and the CSV exporter
           * receive the MonitorTemplate object — "[object Object]" in the
           * table and raw JSON in the export. The same reasoning, and the
           * same line, as getReadableMonitorTemplateColumn on the auto-import
           * rules page.
           */
          selectedProperty: "templateName",
          noValueMessage: "Template deleted — pick another",
        }
      : null;

  return (
    <Fragment>
      <ModelTable<NetworkAlertPolicy>
        modelType={NetworkAlertPolicy}
        id="network-alert-policies-table"
        name="Settings > Network Alert Policies"
        userPreferencesKey="network-alert-policies-table"
        saveFilterProps={{
          tableId: "network-alert-policies-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        createEditModalWidth={ModalWidth.Large}
        refreshToggle={refreshToggle}
        cardProps={{
          title: "Alert Policies",
          /*
           * The delete consequence is said HERE, on the page, and not only in
           * the help drawer: the row's delete confirmation is the table's own
           * ("this action cannot be undone") and cannot be given a policy's
           * particular one, so this is the last place an operator can read
           * that the monitors go with the policy before they click it.
           */
          description:
            "Alert on a set of devices at once. Each policy provisions one Network Device monitor per matching device from its monitor template and keeps the set in step as devices come and go — and every one of those monitors counts towards your plan. Disabling a policy stands its monitors down; deleting one deletes them.",
        }}
        helpContent={{
          title: "How Alert Policies Work",
          description:
            "Scope a set of devices, pick what they are alerted on, and let the engine keep the monitors.",
          markdown: networkAlertPolicyDocumentation,
        }}
        noItemsMessage={
          <RecommendedPolicyEmptyState
            onCreated={(): void => {
              setRefreshToggle(ObjectID.generate().toString());
            }}
          />
        }
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        searchableFields={["name", "description"]}
        selectMoreFields={{ lastSyncError: true }}
        filters={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
          {
            field: { isEnabled: true },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
            isNotCustomizable: true,
          },
          ...(monitorTemplateColumn ? [monitorTemplateColumn] : []),
          {
            field: { scope: true },
            title: "Scope",
            type: FieldType.Element,
            disableSort: true,
            getElement: (item: NetworkAlertPolicy): ReactElement => {
              return (
                <span className="text-sm text-gray-900">
                  {summarizeScope(item.scope)}
                </span>
              );
            },
            getExportValue: (item: NetworkAlertPolicy): string => {
              return summarizeScope(item.scope);
            },
          },
          {
            field: { isEnabled: true },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: NetworkAlertPolicy): ReactElement => {
              return item.isEnabled ? (
                <Pill color={Green} text="Enabled" />
              ) : (
                <Pill color={Gray500} text="Disabled" />
              );
            },
          },
          /*
           * The count the engine stamped, and nothing until it has run once.
           * The column defaults to 0 in the database, so a policy created a
           * second ago would otherwise read "0 devices covered" — which is a
           * statement about its scope, and the wrong one. Until the first
           * pass the honest answer is that nobody has counted yet.
           */
          {
            field: { coveredDeviceCount: true },
            title: "Covered Devices",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkAlertPolicy): ReactElement => {
              if (!item.lastSyncAt) {
                return (
                  <span className="text-sm text-gray-400">Not counted yet</span>
                );
              }

              return (
                <span className="text-sm text-gray-900">
                  {item.coveredDeviceCount ?? 0}
                </span>
              );
            },
            getExportValue: (item: NetworkAlertPolicy): string => {
              return item.lastSyncAt
                ? String(item.coveredDeviceCount ?? 0)
                : "Not counted yet";
            },
          },
          {
            field: { lastSyncAt: true },
            title: "Last Sync",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkAlertPolicy): ReactElement => {
              if (item.lastSyncError) {
                return (
                  <div>
                    <Pill color={Red} text="Failed" />
                    <div className="mt-1 text-xs text-gray-500">
                      {item.lastSyncError}
                    </div>
                  </div>
                );
              }

              if (item.lastSyncAt) {
                return (
                  <span className="text-sm text-gray-900">
                    {OneUptimeDate.getDateAsLocalFormattedString(
                      item.lastSyncAt,
                    )}
                  </span>
                );
              }

              return (
                <span className="text-sm text-gray-400">Not synced yet</span>
              );
            },
            getExportValue: (item: NetworkAlertPolicy): string => {
              if (item.lastSyncError) {
                return `Failed: ${item.lastSyncError}`;
              }

              return item.lastSyncAt
                ? OneUptimeDate.getDateAsLocalFormattedString(item.lastSyncAt)
                : "Not synced yet";
            },
          },
          /*
           * The OTHER half of "is this policy up to date". Last Sync is about
           * the device SET — who is covered; this is about the template — what
           * every covered device is watched for. Editing a template's criteria
           * is the change an operator then wants to see land on the fleet, and
           * without this column the only way to ask is to open a provisioned
           * monitor and read its criteria back.
           */
          {
            field: { templateSyncedAt: true },
            title: "Template Synced",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkAlertPolicy): ReactElement => {
              return item.templateSyncedAt ? (
                <span className="text-sm text-gray-900">
                  {OneUptimeDate.getDateAsLocalFormattedString(
                    item.templateSyncedAt,
                  )}
                </span>
              ) : (
                <span className="text-sm text-gray-400">Never</span>
              );
            },
            getExportValue: (item: NetworkAlertPolicy): string => {
              return item.templateSyncedAt
                ? OneUptimeDate.getDateAsLocalFormattedString(
                    item.templateSyncedAt,
                  )
                : "Never";
            },
          },
          {
            field: { createdAt: true },
            title: "Created",
            type: FieldType.Date,
            hideOnMobile: true,
          },
        ]}
        formSteps={[
          { title: "Basic Info", id: "basic-info" },
          { title: "Template", id: "template" },
          { title: "Scope", id: "scope" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Warehouse switches - reachability",
            validation: { minLength: 2 },
            description:
              "What this policy covers and alerts on. Names are unique in the project.",
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Every switch in a warehouse site raises an incident when unreachable.",
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
            description:
              "Disable to stand the policy's monitors down without deleting them; enable again to bring the same set back.",
          },
          ...(canReadMonitorTemplate
            ? [
                {
                  field: { monitorTemplate: true },
                  title: "Network Device Monitor Template",
                  stepId: "template",
                  sectionTitle: "What every covered device is alerted on",
                  sectionDescription:
                    "Every matching device gets a monitor cloned from this template, and is re-synced from it when the template changes.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  fetchDropdownOptions: fetchNetworkDeviceMonitorTemplates,
                  required: true,
                  placeholder: "Select a Network Device template",
                  description:
                    "Only Network Device monitor templates are listed. A template can back one policy, and cannot also be selected by an auto-import rule — the save is refused with the reason if it is.",
                },
              ]
            : []),
          {
            field: { scope: true },
            title: "Scope",
            stepId: "scope",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            description:
              "Which devices this policy covers. Leave every picker empty to cover every device in the project — the widest scope, and the one that provisions the most monitors.",
            getCustomElement: (
              values: FormValues<NetworkAlertPolicy>,
              elementProps: CustomElementProps,
            ): ReactElement => {
              return (
                <AlertPolicyScopeEditor
                  initialValue={values.scope}
                  onChange={(scope: NetworkAlertPolicyScope): void => {
                    elementProps.onChange?.(scope);
                  }}
                />
              );
            },
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default NetworkAlertPoliciesPage;
