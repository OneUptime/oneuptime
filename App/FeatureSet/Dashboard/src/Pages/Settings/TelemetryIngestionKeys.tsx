import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
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
  return (
    <Fragment>
      {/*
       * Telemetry is metered and nothing about it is included in the Free
       * plan, so a Free plan project is told what an ingestion key costs
       * before it creates one - and has to acknowledge it in the modal.
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
        formFields={[
          ...getTelemetryPayAsYouGoFormFields(),
          {
            field: {
              name: true,
            },
            title: "Name",
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
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Ingestion Key Description",
          },
          {
            field: {
              keyType: true,
            },
            title: "Key Type",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnumWithReadableLabels(
                TelemetryIngestionKeyType,
              ),
            required: true,
            defaultValue: TelemetryIngestionKeyType.Server,
            description:
              "A Server key is a secret. It can write every kind of telemetry and nothing else about the request is checked, so it belongs in your servers, containers and OpenTelemetry collectors - never in browser JavaScript, a mobile bundle, or anywhere else your users can read it. A Browser key is safe to publish in a page: it is accepted only from the origins you list, it can write only traces, logs, metrics and session replays, and it is rate limited per key. The type cannot be changed later - create a second key instead.",
          },
          {
            field: {
              allowedOrigins: true,
            },
            title: "Allowed Origins",
            fieldType: FormFieldSchemaType.JSON,
            showIf: isBrowserKey,
            required: isBrowserKey,
            placeholder: '["https://app.example.com"]',
            description:
              'JSON array of the origins this key may be used from. Required on a browser key and enforced on the server for every request: telemetry from an origin that is not listed, or with no Origin header at all, is refused. Include the scheme and the port. One leading "*." host wildcard is allowed - "https://*.example.com" matches "https://app.example.com" but not "https://example.com". Ignored on a server key.',
          },
          {
            field: {
              pinnedServiceName: true,
            },
            title: "Pinned Service Name",
            fieldType: FormFieldSchemaType.Text,
            showIf: isBrowserKey,
            required: false,
            placeholder: "storefront-web",
            description:
              "Forces service.name to this value on everything the key writes, replacing whatever the sender set. Anyone who copies the key out of your page can then only write into this one service, instead of forging telemetry that looks like it came from one of your backend services.",
          },
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
