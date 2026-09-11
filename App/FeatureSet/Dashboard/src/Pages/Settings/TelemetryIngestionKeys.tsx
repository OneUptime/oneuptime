import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import IconProp from "Common/Types/Icon/IconProp";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import OriginAllowList from "Common/Utils/Telemetry/OriginAllowList";
import {
  TelemetryPayAsYouGoCard,
  getTelemetryPayAsYouGoFormFields,
} from "../../Components/Billing/PayAsYouGo";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The origin allowlist and the pinned service name mean something only on a
 * Browser key - the ingest guard ignores both on a Server key - so the form
 * hides them until Browser is picked. Showing a field the server will
 * silently ignore is worse than not showing it at all: it reads as
 * protection that is not actually there.
 */
type IsBrowserKeyFunction = (
  item: FormValues<TelemetryIngestionKey>,
) => boolean;

const isBrowserKey: IsBrowserKeyFunction = (
  item: FormValues<TelemetryIngestionKey>,
): boolean => {
  return item.keyType === TelemetryIngestionKeyType.Browser;
};

const APIKeys: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const billingFields: Array<ModelField<TelemetryIngestionKey>> =
    getTelemetryPayAsYouGoFormFields();

  return (
    <Fragment>
      {/*
       * Telemetry is metered and nothing about it is included in the Free
       * plan, so a Free plan project is told what an ingestion key costs
       * before it creates one, including a dedicated step in the modal.
       */}
      <TelemetryPayAsYouGoCard />
      <ModelTable<TelemetryIngestionKey>
        modelType={TelemetryIngestionKey}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="api-keys-table"
        name="Settings > Telemetry Ingestion Keys"
        saveFilterProps={{
          tableId: "settings-telemetry-ingestion-keys-table",
        }}
        isDeleteable={false}
        isEditable={false}
        showViewIdButton={false}
        isCreateable={true}
        isViewable={true}
        singularName="Ingestion Key"
        userPreferencesKey="telemetry-ingestion-keys-table"
        cardProps={{
          title: "Telemetry Ingestion Keys",
          description:
            "These keys are used to ingest telemetry data like Logs, Traces and Metrics for your project.",
        }}
        noItemsMessage={"No telemetry ingestion keys found."}
        formSteps={[
          { id: "details", title: "Details" },
          { id: "key-type", title: "Key Type" },
          {
            id: "browser-settings",
            title: "Browser Settings",
            showIf: isBrowserKey,
          },
          ...(billingFields.length > 0
            ? [{ id: "billing", title: "Billing" }]
            : []),
        ]}
        formSummary={{ enabled: true }}
        onBeforeCreate={async (
          item: TelemetryIngestionKey,
        ): Promise<TelemetryIngestionKey> => {
          // The JSON editor holds text; the API expects an array of origins.
          const origins: unknown = item.allowedOrigins;
          if (
            item.keyType === TelemetryIngestionKeyType.Browser &&
            typeof origins === "string"
          ) {
            item.allowedOrigins = JSON.parse(origins) as Array<string>;
          }
          return item;
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "details",
            description: "Give this key a name you will recognize later.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Ingestion Key Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "details",
            description: "Describe where this key will be used.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Ingestion Key Description",
          },
          {
            field: {
              keyType: true,
            },
            title: "Key Type",
            stepId: "key-type",
            fieldType: FormFieldSchemaType.CardSelect,
            cardSelectSingleColumn: true,
            cardSelectOptions: [
              {
                value: TelemetryIngestionKeyType.Server,
                title: "Server",
                icon: IconProp.Server,
                description:
                  "For servers, containers and OpenTelemetry collectors. Writes every kind of telemetry without origin restrictions. Keep it secret: never include it in browser JavaScript or a mobile app.",
              },
              {
                value: TelemetryIngestionKeyType.Browser,
                title: "Browser",
                icon: IconProp.Globe,
                description:
                  "For public web pages. Writes traces, logs, metrics and session replays only from the origins you allow, with a per-key rate limit. Configure those origins in the next step.",
              },
            ],
            required: true,
            defaultValue: TelemetryIngestionKeyType.Server,
            onChange: (
              value: string,
              values: FormValues<TelemetryIngestionKey>,
              setValues: (values: FormValues<TelemetryIngestionKey>) => void,
            ): void => {
              if (value === TelemetryIngestionKeyType.Server) {
                /*
                 * Browser-only drafts must not reach JSON parsing or the API
                 * after the user chooses a Server key.
                 */
                setValues({
                  ...values,
                  allowedOrigins: undefined,
                  pinnedServiceName: undefined,
                });
              }
            },
            description:
              "Choose where you will send telemetry from. The key type cannot be changed after creation.",
          },
          {
            field: {
              allowedOrigins: true,
            },
            title: "Allowed Origins",
            stepId: "browser-settings",
            fieldType: FormFieldSchemaType.JSON,
            showIf: isBrowserKey,
            required: isBrowserKey,
            customValidation: (
              values: FormValues<TelemetryIngestionKey>,
            ): string | null => {
              if (!values.allowedOrigins) {
                return null; // Let the required-field validation explain this.
              }
              let origins: unknown = values.allowedOrigins;
              if (typeof origins === "string") {
                try {
                  origins = JSON.parse(origins);
                } catch {
                  return null; // The JSON field reports syntax errors inline.
                }
              }
              if (
                !Array.isArray(origins) ||
                !origins.some((origin: unknown): boolean => {
                  return typeof origin === "string" && origin.trim().length > 0;
                })
              ) {
                return "Enter at least one allowed origin as a JSON array.";
              }
              for (const origin of origins as Array<unknown>) {
                if (typeof origin !== "string") {
                  return "Every allowed origin must be text.";
                }
                if (origin.trim()) {
                  const error: string | null =
                    OriginAllowList.validateOriginPattern(origin);
                  if (error) {
                    return error;
                  }
                }
              }
              return null;
            },
            placeholder: '["https://app.example.com"]',
            description:
              'List allowed origins as a JSON array, including the scheme and any port. Requests with a missing or unlisted Origin are refused. A leading host wildcard is supported: "https://*.example.com" matches "https://app.example.com", but not "https://example.com".',
          },
          {
            field: {
              pinnedServiceName: true,
            },
            title: "Pinned Service Name",
            stepId: "browser-settings",
            fieldType: FormFieldSchemaType.Text,
            showIf: isBrowserKey,
            required: false,
            placeholder: "storefront-web",
            description:
              "Set service.name on all telemetry sent with this key. This prevents someone who copies the public key from writing telemetry under a different service name.",
          },
          ...billingFields.map(
            (
              field: ModelField<TelemetryIngestionKey>,
            ): ModelField<TelemetryIngestionKey> => {
              return {
                ...field,
                stepId: "billing",
                getSummaryElement: (
                  values: FormValues<TelemetryIngestionKey>,
                ): ReactElement => {
                  return field.getCustomElement?.(values, {}) || <></>;
                },
              };
            },
          ),
        ]}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={Navigation.getCurrentRoute()}
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
              keyType: true,
            },
            type: FieldType.Dropdown,
            title: "Key Type",
            filterDropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnumWithReadableLabels(
                TelemetryIngestionKeyType,
              ),
          },
          {
            field: {
              description: true,
            },
            type: FieldType.Text,
            title: "Description",
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
              keyType: true,
            },
            title: "Type",
            type: FieldType.Text,
          },
          {
            field: {
              lastUsedAt: true,
            },
            /*
             * The column that answers "is anything still sending with this?",
             * which is the question you have to answer before rotating or
             * deleting a key. Empty means no ingest has been recorded since
             * this started being tracked, not that the key never worked -
             * hence "Never" rather than a dash.
             */
            noValueMessage: "Never",
            title: "Last Used",
            type: FieldType.DateTime,
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
          },
        ]}
      />
    </Fragment>
  );
};

export default APIKeys;
