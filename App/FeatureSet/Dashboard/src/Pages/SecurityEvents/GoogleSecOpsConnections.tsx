import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import GoogleSecOpsConnection from "Common/Models/DatabaseModels/GoogleSecOpsConnection";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
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
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const documentationMarkdown: string = `
### How the Google SecOps Connector Works

The managed connector polls your Google SecOps (Chronicle) tenant's **detection alerts** on the interval set here and ingests each one as a **Detection Finding** security event, attributed to a \`Google SecOps\` telemetry service. From there the findings behave like any other security event — searchable, correlatable, and available to detection rules, alerts and monitors.

- **Region** is your tenant's regional endpoint prefix (\`us\`, \`europe\`, ...). It is used to build the Chronicle API base URL.
- **Instance Resource Name** comes from your SecOps **SIEM Settings → Profile** and looks like \`projects/{project}/locations/{location}/instances/{instance}\`.
- **Service Account JSON** is a Google Cloud service-account key with the **Chronicle API Viewer** role. It is encrypted at rest and never returned by the API, so it can never be shown back to you — rotating it goes through the row's **Update Service Account JSON** action.
- **Poll Interval** is how often new detections are fetched, as a whole number of minutes between 1 and 1440.

---

### Reading Connector Health

**Last Polled** and **Last Error** are how a connection tells you whether it is actually working.

- **Last Polled: Never** means the poll job has not run for this connection yet. A connection created moments ago shows this until the next tick — but one that has sat at "Never" for longer than its poll interval is not being polled at all.
- A recent **Last Polled** with an empty **Last Error** is a healthy connector.
- **Last Error** holds the last poll failure as OneUptime recorded it — a prefix naming the step that failed, then at most the first 500 characters of the response body, clamped and marked \`... (truncated)\` if it is still too long. It is cleared on the next successful poll, so a value here describes the most recent attempt rather than a permanent state. Read the prefix first; only two prefixes carry an HTTP status, and a message without one is not evidence of a fault on OneUptime's side:
  - \`Google token exchange failed (HTTP ...)\` — the service-account credential was rejected at Google's OAuth endpoint, before Chronicle was reached. Usually a malformed, revoked, or wrong-project key.
  - \`Google token exchange returned ...\` — that same endpoint answered with something unusable (no access token, or a body that is not JSON), still before Chronicle. Usually a proxy or gateway in between.
  - \`Google SecOps alerts fetch failed (HTTP ...)\` — Chronicle itself rejected the request. \`403\` is usually a missing **Chronicle API Viewer** role; \`404\` is usually a wrong instance resource name or region.
  - \`Google SecOps alerts fetch returned ...\` — Chronicle answered \`200\` with a body that is not a readable detection-alerts stream. It is reported rather than counted as an empty window, so the cursor cannot advance past what was missed.
  - \`Google SecOps alerts query was rejected by Chronicle on an HTTP 200\` — Chronicle ran the request and rejected the query inside the body it returned. Google's rejection, with no HTTP status anywhere in it.
  - \`timed out after 60 seconds with no response\` — nothing answered before the client gave up, so the message assigns no side. Check the worker's egress as well as the tenant.
  - A message matching none of the above is OneUptime's own failure: \`Google SecOps connection is missing id, projectId, region, instance, or credentials\` means this connection row is incomplete, and otherwise the alerts arrived and writing them to the telemetry store is what failed.
  - One known case, already fixed: \`Google SecOps alerts fetch failed (HTTP 400)\` quoting \`Unknown name "pageSize": Cannot bind query parameter\` was a OneUptime request-shape bug, resolved in this release. Google authenticates a request before it transcodes the query string, so this \`400\` is proof the service account was accepted — do not regenerate the key over it.

A disabled connection is skipped entirely, so neither field advances while it is off.
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
            "Managed pull connectors for Google SecOps (Chronicle). OneUptime polls each tenant's detection alerts on an interval and ingests them as Detection Finding security events.",
        }}
        helpContent={{
          title: "How the Google SecOps Connector Works",
          description:
            "What the connector polls, what it writes, and how to read Last Polled and Last Error",
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
              isEnabled: true,
            },
            title: "Enabled",
            description: "Disabled connections are skipped by the poller.",
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
              lastError: true,
            },
            title: "Last Error",
            type: FieldType.LongText,
            noValueMessage: "-",
          },
        ]}
      />

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
