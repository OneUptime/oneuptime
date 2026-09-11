import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow, LightGray } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import GoogleSecOpsConnection from "Common/Models/DatabaseModels/GoogleSecOpsConnection";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import IconProp from "Common/Types/Icon/IconProp";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import GoogleSecOpsDiagnostics from "../../Components/SecurityEvents/GoogleSecOpsDiagnostics";
import { googleSecOpsHealth } from "../../Components/SecurityEvents/GoogleSecOpsDiagnosticsUtil";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const documentationMarkdown: string = `
### How the Google SecOps Connector Works

The managed connector polls your Google SecOps (Chronicle) tenant on the interval set here and ingests each matching detection as a **Detection Finding** security event, attributed to a \`Google SecOps\` telemetry service. Choose **Alerts only** or **Alerts and detections** explicitly. A rule detection does not necessarily create an alert. From there the findings are searchable, correlatable, and available to detection rules, alerts and monitors.

- **Region** is your tenant's regional endpoint prefix (\`us\`, \`europe\`, ...). It is used to build the Chronicle API base URL.
- **Instance Resource Name** comes from your SecOps **SIEM Settings → Profile** and looks like \`projects/{project}/locations/{location}/instances/{instance}\`.
- **Service Account JSON** is a Google Cloud service-account key with the **Chronicle API Viewer** role. It is encrypted at rest and never returned by the API, so it can never be shown back to you — rotating it goes through the row's **Update Service Account JSON** action.
- **Poll Interval** is how often new detections are fetched, as a whole number of minutes between 1 and 1440.

---

### Reading Connector Health

**Status** shows whether scheduled polling is enabled. **Health**, **Last Successful Poll**, and **Last Event Imported** describe the most recent polling outcome. **Last Polled** is the last attempt, which may have failed or returned zero detections.

- **Last Polled: Never** means the poll job has not run for this connection yet. A connection created moments ago shows this until the next tick — but one that has sat at "Never" for longer than its poll interval is not being polled at all.
- **Test connection** verifies credentials and access to the detections API. It does not import events or verify the scheduler. **Run now** imports the next poll window immediately.
- **Diagnostics** shows the exact requested time range, returned, imported, duplicate, rejected and failed counts, warnings, connection checks and recent run history. An empty result means Google returned no detections in that window and scope; it does not establish that a detection elsewhere is absent.
- Use **Preview detections** to read a selected time range without importing. **Import this time range** imports up to 7 days of history after confirmation. Scheduled first polls look back 15 minutes. A stale cursor catches up in 24 hour windows; use historical import for detections before the first poll.
- A detection's original time may be earlier than its creation time. **View events in this time range** opens the returned detection-time range so late-created detections are visible.
- **Last Error** stores the complete error message with credentials redacted. When a connection has an error, select **View Error** in its **Actions** column to read it, then **Copy Error** in the dialog to copy it for support. It is cleared on the next successful poll, so a value here describes the most recent attempt rather than a permanent state. Read the prefix first; only two prefixes carry an HTTP status, and a message without one is not evidence of a fault on OneUptime's side:
  - \`Google token exchange failed (HTTP ...)\` — the service-account credential was rejected at Google's OAuth endpoint, before Chronicle was reached. Usually a malformed, revoked, or wrong-project key.
  - \`Google token exchange returned ...\` — that same endpoint answered with something unusable (no access token, or a body that is not JSON), still before Chronicle. Usually a proxy or gateway in between.
  - \`Google SecOps alerts fetch failed (HTTP ...)\` — Chronicle itself rejected the request. \`403\` is usually a missing **Chronicle API Viewer** role; \`404\` is usually a wrong instance resource name or region.
  - \`Google SecOps alerts fetch returned ...\` — Chronicle answered \`200\` with a body that is not a readable detection-alerts stream. It is reported rather than counted as an empty window, so the cursor cannot advance past what was missed.
  - \`Google SecOps alerts query was rejected by Chronicle on an HTTP 200\` — Chronicle ran the request and rejected the query inside the body it returned. Google's rejection, with no HTTP status anywhere in it.
  - \`timed out after 60 seconds with no response\` — nothing answered before the client gave up, so the message assigns no side. Check the worker's egress as well as the tenant.
  - A message matching none of the above is OneUptime's own failure: \`Google SecOps connection is missing id, projectId, region, instance, or credentials\` means this connection row is incomplete, and otherwise the alerts arrived and writing them to the telemetry store is what failed.
  - \`Google SecOps alerts fetch failed (HTTP 400)\` quoting \`Unknown name "pageSize": Cannot bind query parameter\` identifies an unsupported request parameter. Upstream **13.0.0** already replaced \`pageSize\` with \`alertListOptions.maxReturnedAlerts\`. Inspect the actual app and worker images, including custom builds and separately deployed workers, if this error still appears. Rotating the service-account key does not correct an unsupported query parameter. A successful OAuth token exchange confirms credential acceptance; the parameter rejection alone does not establish authentication or authorization.

Scheduled polls skip disabled connections. On-demand checks and imports remain available; **Run now** updates poll state even while the schedule is paused.

Errors recorded before upgrading may already be truncated; a subsequent failed poll records the complete message.
`;

const GoogleSecOpsConnectionsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * Hooks run before the reseller gate below can return early — React
   * requires the same hooks in the same order on every render, and the
   * gate's answer changes as the project loads.
   */
  const [currentlyEditingItem, setCurrentlyEditingItem] =
    useState<GoogleSecOpsConnection | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [currentlyViewingError, setCurrentlyViewingError] = useState<
    string | null
  >(null);
  const [diagnosticsItem, setDiagnosticsItem] =
    useState<GoogleSecOpsConnection | null>(null);
  const [initialDiagnosticAction, setInitialDiagnosticAction] = useState<
    "test" | "poll" | undefined
  >(undefined);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  /*
   * Same reseller-telemetry gate as every other Security Events tab —
   * polled detections land in the telemetry-billed security event stream,
   * so a plan without telemetry features has nowhere to put them.
   */
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  /*
   * The rotate-credential action writes through ModelAPI directly, which
   * ModelTable's own edit gating never sees — so gate it here the way
   * DetectionRules gates its monitor deep link: a member who cannot update
   * connections gets a disabled button that says why, not a modal that
   * fails with a 403 after they have pasted a private key into it.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new GoogleSecOpsConnection(),
    ModelAction.Update,
  );

  return (
    <Fragment>
      <ModelTable<GoogleSecOpsConnection>
        modelType={GoogleSecOpsConnection}
        refreshToggle={String(refreshCounter)}
        selectMoreFields={{
          projectId: true,
          createdAt: true,
          isEnabled: true,
          pollIntervalInMinutes: true,
          lastPolledAt: true,
          lastError: true,
          lastPollResult: true,
          lastSuccessfulPollAt: true,
          lastEventIngestedAt: true,
          includeNonAlertingDetections: true,
        }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="google-secops-connections-table"
        name="Security Events > Google SecOps Connections"
        userPreferencesKey="google-secops-connections-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        createEditModalWidth={ModalWidth.Large}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: "Google SecOps Connections",
          description:
            "Poll Google SecOps alerts and detections as Detection Finding security events. Test access, run a poll, and inspect import results on demand.",
        }}
        helpContent={{
          title: "How the Google SecOps Connector Works",
          description:
            "What the connector polls, how to test access, and how to inspect and import detections",
          markdown: documentationMarkdown,
        }}
        noItemsMessage={
          'No Google SecOps connections found. Click on the "Create" button to add one.'
        }
        createInitialValues={{
          /*
           * Mirror the DB defaults (GoogleSecOpsConnection.ts): a fresh
           * create form that submits undefined for these would store a
           * disabled connection with no interval.
           */
          isEnabled: true,
          pollIntervalInMinutes: 5,
          includeNonAlertingDetections: false,
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Production SecOps tenant",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              region: true,
            },
            title: "Region",
            description:
              "Your tenant's Google SecOps regional endpoint prefix — 'us', 'europe', and so on. It is used to build the Chronicle API base URL.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "us",
            disableSpellCheck: true,
          },
          {
            field: {
              instanceResourceName: true,
            },
            title: "Instance Resource Name",
            description:
              "The Chronicle instance resource name, from your SecOps SIEM Settings > Profile.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder:
              "projects/{project}/locations/{location}/instances/{instance}",
            disableSpellCheck: true,
          },
          {
            field: {
              serviceAccountJson: true,
            },
            title: "Service Account JSON",
            description:
              "The Google Cloud service-account key with Chronicle API read access. It is encrypted at rest and never returned by the API, so it cannot be shown back to you — use the row's Update Service Account JSON action to rotate it later.",
            fieldType: FormFieldSchemaType.JSON,
            required: true,
            /*
             * The column has ColumnAccessControl read: [], so an edit form
             * can never prefill it. Showing an empty required field on edit
             * would force a re-paste of the key on every unrelated change.
             */
            doNotShowWhenEditing: true,
            placeholder: '{ "client_email": "...", "private_key": "..." }',
          },
          {
            field: {
              includeNonAlertingDetections: true,
            },
            title: "Alerts and detections",
            description:
              "Off: Alerts only. On: Alerts and detections, including rule matches that did not generate an alert.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            description:
              "Disabled connections are skipped by scheduled polling. On-demand runs remain available.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              pollIntervalInMinutes: true,
            },
            title: "Poll Interval (Minutes)",
            description:
              "How often detection alerts are fetched, in minutes. Default 5.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "e.g. 5",
            /*
             * Keeps the range identical to the service's own check
             * (GoogleSecOpsConnectionService.validateConnection), so an
             * out-of-range value fails in the form instead of at submit.
             * The service's whole-number requirement has no form-side
             * equivalent, so a fractional value is still rejected on save.
             */
            validation: {
              minValue: 1,
              maxValue: 1440,
            },
          },
        ]}
        showRefreshButton={true}
        searchableFields={["name", "region"]}
        showViewIdButton={true}
        actionButtons={[
          {
            title: "View Error",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Error,
            isVisible: (item: GoogleSecOpsConnection): boolean => {
              return Boolean(item.lastError);
            },
            onClick: (
              item: GoogleSecOpsConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              setCurrentlyViewingError(item.lastError || null);
              onCompleteAction();
            },
          },
          {
            title: "Test connection",
            buttonStyleType: ButtonStyleType.OUTLINE,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Check credentials and Google SecOps API access."
              : updateGate.disabledReason,
            onClick: (
              item: GoogleSecOpsConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              setInitialDiagnosticAction("test");
              setDiagnosticsItem(item);
              onCompleteAction();
            },
          },
          {
            title: "Run now",
            buttonStyleType: ButtonStyleType.OUTLINE,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Import the next poll window now."
              : updateGate.disabledReason,
            onClick: (
              item: GoogleSecOpsConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              setInitialDiagnosticAction("poll");
              setDiagnosticsItem(item);
              onCompleteAction();
            },
          },
          {
            title: "Diagnostics",
            buttonStyleType: ButtonStyleType.OUTLINE,
            onClick: (
              item: GoogleSecOpsConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              setInitialDiagnosticAction(undefined);
              setDiagnosticsItem(item);
              onCompleteAction();
            },
          },
          {
            title: "Update Service Account JSON",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Key,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Replace this connection's service-account key. The stored key can never be read back, so rotating it needs its own door."
              : updateGate.disabledReason ||
                "You do not have permission to update Google SecOps connections.",
            onClick: (
              item: GoogleSecOpsConnection,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentlyEditingItem(item);
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
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              isEnabled: true,
            },
            type: FieldType.Boolean,
            title: "Enabled",
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
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: GoogleSecOpsConnection): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Red} text="Disabled" />;
            },
          },
          {
            field: {
              lastPollResult: true,
            },
            title: "Health",
            type: FieldType.JSON,
            getElement: (item: GoogleSecOpsConnection): ReactElement => {
              const health: string = googleSecOpsHealth(item);
              const color: Color =
                health === "Last poll succeeded" ||
                health === "No detections returned"
                  ? Green
                  : health === "Last poll failed"
                    ? Red
                    : health === "Poll overdue" ||
                        health === "Partial import" ||
                        health === "Catching up"
                      ? Yellow
                      : LightGray;
              return <Pill color={color} text={health} />;
            },
          },
          {
            field: {
              includeNonAlertingDetections: true,
            },
            title: "Scope",
            type: FieldType.Boolean,
            getElement: (item: GoogleSecOpsConnection): ReactElement => {
              return (
                <span>
                  {item.includeNonAlertingDetections
                    ? "Alerts and detections"
                    : "Alerts only"}
                </span>
              );
            },
          },
          {
            field: {
              region: true,
            },
            title: "Region",
            type: FieldType.Text,
          },
          {
            field: {
              pollIntervalInMinutes: true,
            },
            title: "Interval (Minutes)",
            type: FieldType.Number,
            noValueMessage: "-",
          },
          {
            field: {
              lastPolledAt: true,
            },
            title: "Last Polled",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
          {
            field: {
              lastSuccessfulPollAt: true,
            },
            title: "Last Successful Poll",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
          {
            field: {
              lastEventIngestedAt: true,
            },
            title: "Last Event Imported",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
        ]}
      />

      {diagnosticsItem && (
        <GoogleSecOpsDiagnostics
          key={diagnosticsItem.id?.toString()}
          connection={diagnosticsItem}
          canRun={updateGate.isAllowed}
          disabledReason={
            updateGate.isAllowed ? undefined : updateGate.disabledReason
          }
          initialAction={initialDiagnosticAction}
          onClose={(): void => {
            setDiagnosticsItem(null);
          }}
          onUpdated={(): void => {
            setRefreshCounter((value: number): number => {
              return value + 1;
            });
          }}
        />
      )}

      {currentlyViewingError && (
        <Modal
          title="Last Error"
          description="Copy this message when contacting support."
          modalWidth={ModalWidth.Large}
          onClose={(): void => {
            setCurrentlyViewingError(null);
          }}
          closeButtonText="Close"
          leftFooterElement={
            <CopyTextButton
              textToBeCopied={currentlyViewingError}
              label="Copy Error"
              size="md"
              variant="solid"
            />
          }
        >
          <pre
            aria-label="Full error message"
            tabIndex={0}
            className="whitespace-pre-wrap break-words rounded-md bg-gray-50 p-4 text-sm text-gray-800"
          >
            {currentlyViewingError}
          </pre>
        </Modal>
      )}

      {currentlyEditingItem && (
        <BasicFormModal
          title={"Update Service Account JSON"}
          name="Security Events > Update Service Account JSON"
          isLoading={isLoading}
          onClose={() => {
            setIsLoading(false);
            return setCurrentlyEditingItem(null);
          }}
          onSubmit={async (data: JSONObject) => {
            try {
              setIsLoading(true);

              await ModelAPI.updateById<GoogleSecOpsConnection>({
                modelType: GoogleSecOpsConnection,
                id: currentlyEditingItem.id!,
                data: {
                  serviceAccountJson: data["serviceAccountJson"],
                },
              });

              setCurrentlyEditingItem(null);
            } catch {
              // do nothing
            }

            setIsLoading(false);
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  serviceAccountJson: true,
                },
                title: "Service Account JSON",
                description:
                  "The new Google Cloud service-account key with Chronicle API read access. It is encrypted at rest and never returned by the API — once saved it cannot be retrieved.",
                fieldType: FormFieldSchemaType.JSON,
                required: true,
                placeholder: '{ "client_email": "...", "private_key": "..." }',
              },
            ],
          }}
        />
      )}
    </Fragment>
  );
};

export default GoogleSecOpsConnectionsPage;
