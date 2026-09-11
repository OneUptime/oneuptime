import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green, LightGray, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import SecurityEventConnectorType from "Common/Types/SecurityEvent/SecurityEventConnectorType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useState } from "react";

const providerOptions: Array<{ label: string; value: string }> = [
  {
    label: "AWS Security Hub",
    value: SecurityEventConnectorType.AwsSecurityHub,
  },
  {
    label: "Microsoft Defender XDR and Sentinel",
    value: SecurityEventConnectorType.MicrosoftDefender,
  },
  { label: "Cloudflare", value: SecurityEventConnectorType.Cloudflare },
  {
    label: "CrowdStrike Falcon",
    value: SecurityEventConnectorType.CrowdStrikeFalcon,
  },
  {
    label: "Google Security Command Center",
    value: SecurityEventConnectorType.GoogleSecurityCommandCenter,
  },
  { label: "Okta", value: SecurityEventConnectorType.Okta },
  {
    label: "Splunk Enterprise Security",
    value: SecurityEventConnectorType.SplunkEnterpriseSecurity,
  },
];

const documentationMarkdown: string = `
### Managed security event connections

OneUptime polls each enabled connection, normalizes the provider's findings or alerts, deduplicates them, enriches observable values with threat intelligence, and stores them as security events. Credentials are encrypted at rest and are never returned by the API.

Enter **Configuration** and **Credentials JSON** using the shape for the selected provider:

| Provider | Configuration | Credentials |
| --- | --- | --- |
| AWS Security Hub | \`{ "region": "us-east-1" }\` | \`{ "accessKeyId": "...", "secretAccessKey": "...", "sessionToken": "..." }\` |
| Microsoft Defender XDR and Sentinel | \`{ "tenantId": "..." }\` | \`{ "clientId": "...", "clientSecret": "..." }\` |
| Cloudflare | \`{ "zoneId": "..." }\` | \`{ "apiToken": "..." }\` |
| CrowdStrike Falcon | \`{ "cloud": "us-1" }\` | \`{ "clientId": "...", "clientSecret": "..." }\` |
| Google Security Command Center | \`{ "parent": "organizations/123/sources/-" }\` | A service-account key containing \`client_email\`, \`private_key\`, and optionally \`token_uri\` |
| Okta | \`{ "baseUrl": "https://example.okta.com" }\` | \`{ "apiToken": "..." }\` |
| Splunk Enterprise Security | \`{ "baseUrl": "https://splunk.example.com:8089", "search": "search index=notable" }\` | \`{ "apiToken": "...", "tokenScheme": "Bearer" }\` or \`{ "username": "...", "password": "..." }\` |

The first poll reads the preceding 15 minutes. Time-window providers later overlap the previous cursor by one minute and catch up in 24-hour windows; Okta resumes its ascending next link. Provider pagination is resumed across polls, and busy or repeatedly failing windows are narrowed automatically. GuardDuty findings must first be integrated into Security Hub, and Sentinel must be onboarded to the Defender portal. Invalid records create durable audit events and are shown as a partial import while later records continue to flow. **Last Error** and **Last Poll Result** show the latest provider and import outcome.

Credential updates are rotations for the same source. Create a new connection when AWS or CrowdStrike credentials point to a different account with otherwise identical settings.
`;

function connectionHealth(item: SecurityEventConnection): {
  color: Color;
  text: string;
} {
  if (item.lastPollResult?.["error"]) {
    return { color: Red, text: "Last poll failed" };
  }
  if (item.lastPollResult?.["complete"] === false) {
    return { color: Yellow, text: "Partial import" };
  }
  if (item.lastError) {
    return { color: Red, text: "Last poll failed" };
  }
  if (!item.lastPolledAt) {
    return { color: LightGray, text: "Never polled" };
  }
  const interval: number = Math.max(1, item.pollIntervalInMinutes || 5);
  if (
    item.isEnabled &&
    item.lastPolledAt.getTime() + interval * 2 * 60_000 < Date.now()
  ) {
    return { color: Yellow, text: "Poll overdue" };
  }
  return { color: Green, text: "Healthy" };
}

const ManagedSecurityEventConnections: FunctionComponent = (): ReactElement => {
  const [credentialItem, setCredentialItem] =
    useState<SecurityEventConnection | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  const updateGate: PermissionGateResult = PermissionGate.check(
    new SecurityEventConnection(),
    ModelAction.Update,
  );

  return (
    <>
      <ModelTable<SecurityEventConnection>
        modelType={SecurityEventConnection}
        refreshToggle={String(refreshCounter)}
        selectMoreFields={{
          projectId: true,
          provider: true,
          configuration: true,
          isEnabled: true,
          pollIntervalInMinutes: true,
          lastPolledAt: true,
          lastSuccessfulPollAt: true,
          lastEventIngestedAt: true,
          lastPollResult: true,
          lastError: true,
        }}
        query={{ projectId: ProjectUtil.getCurrentProjectId()! }}
        id="managed-security-event-connections-table"
        name="Security Events > Managed Connections"
        userPreferencesKey="managed-security-event-connections-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        createEditModalWidth={ModalWidth.Large}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: "Managed Security Event Connections",
          description:
            "Import findings and alerts from AWS, Microsoft, Cloudflare, CrowdStrike, Google Security Command Center, Okta, and Splunk.",
        }}
        helpContent={{
          title: "Configure managed security event connections",
          description:
            "Provider settings, credential formats, polling, and connector health",
          markdown: documentationMarkdown,
        }}
        noItemsMessage='No managed security event connections found. Click "Create" to add one.'
        createInitialValues={{ isEnabled: true, pollIntervalInMinutes: 5 }}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Production Security Hub",
            validation: { minLength: 2 },
          },
          {
            field: { provider: true },
            title: "Provider",
            description:
              "The security product this connection reads from. Create another connection to change providers.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: providerOptions,
            required: true,
            doNotShowWhenEditing: true,
            placeholder: "Select a provider",
          },
          {
            field: { configuration: true },
            title: "Configuration",
            description:
              "Non-secret provider settings. Open Help for the exact JSON shape for each provider.",
            fieldType: FormFieldSchemaType.JSON,
            required: true,
            placeholder: '{ "region": "us-east-1" }',
          },
          {
            field: { credentialJson: true },
            title: "Credentials JSON",
            description:
              "Provider credentials. They are encrypted at rest and never returned; use Update Credentials to rotate them.",
            fieldType: FormFieldSchemaType.JSON,
            required: true,
            doNotShowWhenEditing: true,
            placeholder: '{ "apiToken": "..." }',
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            description:
              "Disabled connections are skipped by scheduled polling.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: { pollIntervalInMinutes: true },
            title: "Poll Interval (Minutes)",
            description: "How often events are fetched. Default 5 minutes.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "5",
            validation: { minValue: 1, maxValue: 1440 },
          },
        ]}
        searchableFields={["name", "provider"]}
        showRefreshButton={true}
        showViewIdButton={true}
        actionButtons={[
          {
            title: "Update Credentials",
            icon: IconProp.Key,
            buttonStyleType: ButtonStyleType.OUTLINE,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Replace the encrypted credentials for this connection."
              : updateGate.disabledReason,
            onClick: (
              item: SecurityEventConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              setCredentialItem(item);
              onCompleteAction();
            },
          },
        ]}
        filters={[
          {
            field: { name: true },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: { provider: true },
            type: FieldType.Text,
            title: "Provider",
          },
          {
            field: { isEnabled: true },
            type: FieldType.Boolean,
            title: "Enabled",
          },
        ]}
        columns={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
          {
            field: { provider: true },
            title: "Provider",
            type: FieldType.Text,
          },
          {
            field: { isEnabled: true },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: SecurityEventConnection): ReactElement => {
              return item.isEnabled ? (
                <Pill color={Green} text="Enabled" />
              ) : (
                <Pill color={Red} text="Disabled" />
              );
            },
          },
          {
            field: { lastPollResult: true },
            title: "Health",
            type: FieldType.JSON,
            getElement: (item: SecurityEventConnection): ReactElement => {
              const health: { color: Color; text: string } =
                connectionHealth(item);
              return <Pill color={health.color} text={health.text} />;
            },
          },
          {
            field: { pollIntervalInMinutes: true },
            title: "Interval (Minutes)",
            type: FieldType.Number,
            noValueMessage: "-",
          },
          {
            field: { lastPolledAt: true },
            title: "Last Polled",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
          {
            field: { lastSuccessfulPollAt: true },
            title: "Last Successful Poll",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
          {
            field: { lastEventIngestedAt: true },
            title: "Last Event Imported",
            type: FieldType.DateTime,
            noValueMessage: "Never",
          },
          {
            field: { lastError: true },
            title: "Last Error",
            type: FieldType.LongText,
            noValueMessage: "-",
          },
        ]}
      />

      {credentialItem && (
        <BasicFormModal<JSONObject>
          title="Update Credentials"
          name="Security Events > Update Managed Connection Credentials"
          isLoading={isLoading}
          onClose={(): void => {
            setIsLoading(false);
            setCredentialItem(null);
          }}
          onSubmit={async (data: JSONObject): Promise<void> => {
            setIsLoading(true);
            try {
              await ModelAPI.updateById<SecurityEventConnection>({
                modelType: SecurityEventConnection,
                id: credentialItem.id!,
                data: { credentialJson: data["credentialJson"] },
              });
              setCredentialItem(null);
              setRefreshCounter((value: number): number => {
                return value + 1;
              });
            } finally {
              setIsLoading(false);
            }
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: { credentialJson: true },
                title: "Credentials JSON",
                description:
                  "The replacement credential object. It is encrypted at rest and cannot be retrieved after saving.",
                fieldType: FormFieldSchemaType.JSON,
                required: true,
                placeholder: '{ "apiToken": "..." }',
              },
            ],
          }}
        />
      )}
    </>
  );
};

export default ManagedSecurityEventConnections;
