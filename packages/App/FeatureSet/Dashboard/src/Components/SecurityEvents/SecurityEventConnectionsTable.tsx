import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green, Red } from "Common/Types/BrandColors";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
  getSecurityEventConnectorTitle,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import ProviderLogoImage from "Common/UI/Components/ProviderLogo/ProviderLogoImage";
import FieldType from "Common/UI/Components/Types/FieldType";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import ConnectionTestModal, {
  runConnectionTestRequest,
} from "./ConnectionTestModal";
import {
  ConnectorProviderHelpEntry,
  connectorProviderHelpEntries,
} from "./ConnectorProviderHelp";
import SecurityEventConnectionDiagnostics from "./SecurityEventConnectionDiagnostics";
import {
  SECURITY_EVENT_CONNECTION_TEST_ROUTE,
  connectorHealth,
  connectorHealthPillColor,
  connectorHealthTooltip,
  connectorScopeSummary,
} from "./SecurityEventConnectionDiagnosticsUtil";
import SecurityEventConnectionFormModal from "./SecurityEventConnectionFormModal";
import SecurityEventConnectionsEmptyState from "./SecurityEventConnectionsEmptyState";
import RelativeTimeCell from "./RelativeTimeCell";
import SecurityListNameCell, {
  SECURITY_LIST_NAME_COLUMN_MAX_WIDTH_CLASS_NAME,
} from "./SecurityListNameCell";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";

/*
 * The logo slot at the start of a connection's name: as wide as a 16px
 * wordmark (Splunk's is 24px), the mark centred in it, level with the
 * name's first line - so the names after the marks line up down the column.
 */
export const PROVIDER_COLUMN_LOGO_SLOT_CLASS_NAME: string =
  "mt-0.5 inline-flex w-6 flex-shrink-0 justify-center";

interface FormModalState {
  connection: SecurityEventConnection | null;
  credentialsOnly: boolean;
  // Create only: the provider picked from the empty state's provider tiles.
  initialProvider?: SecurityEventConnectorProvider | undefined;
}

const documentationMarkdown: string = `
### How Security Event Connections Work

A connection polls one security product (a SIEM, an EDR / XDR platform, a cloud security service or an identity provider) on the interval set here and imports each new record as an OCSF security event attributed to that product. Records are read by the time the **source created them**, so a detection about yesterday that the source only created this morning is still picked up.

- The first scheduled poll looks back 24 hours; older records need a historical import from **Diagnostics**.
- **Test connection** runs immediately, without a worker, and reports a checklist: access to the provider, what it has available to import, and whether OneUptime's own workers and scheduler are running. It imports nothing.
- **Health** reads *Polling, no events imported yet* while polls succeed but nothing has arrived. That is the state to investigate with **Test connection**, not a success.
- Credentials are encrypted at rest and never returned by the API. Rotate them with **Update credentials**; leaving a credential blank while editing keeps the stored value.
- **Last Error** stores the most recent failure with credentials redacted. Open **View Error** in the **Actions** column to read it.

Each provider's setup guide lists the exact roles, scopes and console locations for every value the form asks for.
`;

/*
 * The help panel: the framework-level text above, then a section for each
 * provider that has in-product help of its own (ConnectorProviderHelp), in
 * catalog order.
 */
export function securityEventConnectionsHelpMarkdown(): string {
  return connectorProviderHelpEntries().reduce(
    (markdown: string, entry: ConnectorProviderHelpEntry): string => {
      return `${markdown}\n---\n${entry.markdown}`;
    },
    documentationMarkdown,
  );
}

/*
 * What a connection is, under its name: its provider ("Okta System Log"),
 * and for a provider with an alerting distinction what it imports ("Google
 * SecOps · Alerts only"), in the reader's words where they have them.
 */
export function getConnectionProviderDetailParts(
  connection: Pick<SecurityEventConnection, "provider" | "alertingOnly">,
  translator: Translator,
): Array<string> {
  const provider: string = getSecurityEventConnectorTitle(connection.provider);
  const scope: string | undefined = connectorScopeSummary(
    getSecurityEventConnectorDefinition(connection.provider),
    connection.alertingOnly,
  );
  const providerWords: string = translator.translateText(provider) || provider;

  if (!scope) {
    return [providerWords];
  }

  return [providerWords, translator.translateText(scope) || scope];
}

/*
 * The table for the managed Security Event Connections framework: every
 * provider, Google SecOps included, in one list.
 *
 * Create and edit go through SecurityEventConnectionFormModal rather than
 * ModelTable's generated form: the fields depend on the provider picked in
 * step one, secrets are a single encrypted JSON column that the form
 * assembles from per-provider inputs, and the form can test the unsaved
 * settings — none of which ModelTable's column-driven form can express.
 */
const SecurityEventConnectionsTable: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [formModal, setFormModal] = useState<FormModalState | null>(null);
  const [testItem, setTestItem] = useState<SecurityEventConnection | null>(
    null,
  );
  const [diagnosticsItem, setDiagnosticsItem] =
    useState<SecurityEventConnection | null>(null);
  const [initialDiagnosticAction, setInitialDiagnosticAction] = useState<
    "test" | "poll" | undefined
  >(undefined);
  const [currentlyViewingError, setCurrentlyViewingError] = useState<
    string | null
  >(null);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  const refresh: VoidFunction = (): void => {
    setRefreshCounter((value: number): number => {
      return value + 1;
    });
  };

  /*
   * Every write here goes through ModelAPI directly, which ModelTable's
   * own gating never sees; gate the affordances up front so a member who
   * cannot update connections gets a disabled button that says why.
   */
  const createGate: PermissionGateResult = PermissionGate.check(
    new SecurityEventConnection(),
    ModelAction.Create,
  );
  const updateGate: PermissionGateResult = PermissionGate.check(
    new SecurityEventConnection(),
    ModelAction.Update,
  );

  /*
   * The card's Add connection button and the empty state's open the same
   * form. A provider tile in the empty state passes its provider, which
   * starts the form with that provider selected.
   */
  const openCreateForm: (
    initialProvider?: SecurityEventConnectorProvider | undefined,
  ) => void = (
    initialProvider?: SecurityEventConnectorProvider | undefined,
  ): void => {
    setFormModal({
      connection: null,
      credentialsOnly: false,
      initialProvider: initialProvider,
    });
  };

  return (
    <Fragment>
      <ModelTable<SecurityEventConnection>
        modelType={SecurityEventConnection}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        refreshToggle={String(refreshCounter)}
        selectMoreFields={{
          projectId: true,
          createdAt: true,
          description: true,
          provider: true,
          config: true,
          isEnabled: true,
          pollIntervalInMinutes: true,
          alertingOnly: true,
          lastPolledAt: true,
          lastError: true,
          lastPollResult: true,
          lastSuccessfulPollAt: true,
          lastEventIngestedAt: true,
        }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="security-event-connections-table"
        name="Security Events > Security Event Connections"
        userPreferencesKey="security-event-connections-table"
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: "Your security tools",
          description:
            "Bring in alerts and events from the security tools you already use: Microsoft Sentinel, Defender XDR, CrowdStrike Falcon, Splunk, Elastic Security, AWS Security Hub, Okta, Microsoft Entra ID, Google Workspace and Google SecOps.",
          buttons: [
            {
              title: "Add connection",
              phoneTitle: "Add",
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              disabled: !createGate.isAllowed,
              tooltip: createGate.isAllowed
                ? "Choose a provider, enter its credentials and test them before saving."
                : createGate.disabledReason,
              onClick: openCreateForm,
            },
          ],
        }}
        helpContent={{
          title: "How Security Event Connections Work",
          description:
            "What a connection polls, how to test it, how to read its health, and provider-specific guidance",
          markdown: securityEventConnectionsHelpMarkdown(),
        }}
        noItemsMessage={
          <SecurityEventConnectionsEmptyState
            canCreate={createGate.isAllowed}
            createDisabledReason={createGate.disabledReason}
            onAddConnection={openCreateForm}
          />
        }
        showRefreshButton={true}
        searchableFields={["name", "provider"]}
        showViewIdButton={true}
        actionButtons={[
          {
            title: "View Error",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Error,
            isVisible: (item: SecurityEventConnection): boolean => {
              return Boolean(item.lastError);
            },
            onClick: (
              item: SecurityEventConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              setCurrentlyViewingError(item.lastError || null);
              onCompleteAction();
            },
          },
          {
            title: "Test connection",
            icon: IconProp.Signal,
            buttonStyleType: ButtonStyleType.OUTLINE,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Check access, what is available to import, and whether OneUptime's workers are running. Runs immediately; imports nothing."
              : updateGate.disabledReason,
            onClick: (
              item: SecurityEventConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              setTestItem(item);
              onCompleteAction();
            },
          },
          {
            title: "Run now",
            icon: IconProp.Play,
            buttonStyleType: ButtonStyleType.OUTLINE,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Import the next poll window now."
              : updateGate.disabledReason,
            onClick: (
              item: SecurityEventConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              setInitialDiagnosticAction("poll");
              setDiagnosticsItem(item);
              onCompleteAction();
            },
          },
          {
            title: "Diagnostics",
            icon: IconProp.WrenchScrewdriver,
            buttonStyleType: ButtonStyleType.OUTLINE,
            onClick: (
              item: SecurityEventConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              setInitialDiagnosticAction(undefined);
              setDiagnosticsItem(item);
              onCompleteAction();
            },
          },
          {
            title: "Edit",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Edit,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Change settings, schedule or name. Credentials stay unless you enter new ones."
              : updateGate.disabledReason,
            onClick: (
              item: SecurityEventConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              setFormModal({ connection: item, credentialsOnly: false });
              onCompleteAction();
            },
          },
          {
            title: "Update credentials",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Key,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? "Replace this connection's stored credentials. They can never be read back, so rotating them needs its own door."
              : updateGate.disabledReason,
            onClick: (
              item: SecurityEventConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              setFormModal({ connection: item, credentialsOnly: true });
              onCompleteAction();
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
              provider: true,
            },
            type: FieldType.Text,
            title: "Provider",
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
          /*
           * The connection's name, with its provider under it - and, for a
           * provider with an alerting distinction, what it imports ("Alerts
           * only"), so a connection that skips non-alerting records is
           * visible without opening it. One column, where the provider had
           * one of its own and the table was twice its card's width at
           * 1280 (#5246).
           */
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
            wrapContent: true,
            wrapMaxWidthClassName:
              SECURITY_LIST_NAME_COLUMN_MAX_WIDTH_CLASS_NAME,
            getElement: (item: SecurityEventConnection): ReactElement => {
              const definition: SecurityEventConnectorDefinition | undefined =
                getSecurityEventConnectorDefinition(item.provider);

              /*
               * The product's official mark leads the row, in a slot as
               * wide as a wordmark's (Splunk's), centred and level with the
               * name's first line - so every name in the column starts on
               * one line however wide its mark is.
               */
              return (
                <SecurityListNameCell
                  name={item.name || ""}
                  detailParts={getConnectionProviderDetailParts(
                    item,
                    translator,
                  )}
                  detailTestId="security-event-connection-provider"
                  mark={
                    definition ? (
                      <span
                        className={PROVIDER_COLUMN_LOGO_SLOT_CLASS_NAME}
                        data-testid="security-event-connection-provider-logo-slot"
                      >
                        <ProviderLogoImage
                          logo={definition.logo}
                          isBare={true}
                          isDecorative={true}
                        />
                      </span>
                    ) : undefined
                  }
                />
              );
            },
          },
          /*
           * Whether the connection is on: Health says so too (Paused), so
           * it waits in Customize Columns with the poll interval, a setting,
           * and the last successful poll, which View Error and Health
           * cover while polls fail. With all eight shown, the table was
           * twice its card's width at 1280 (#5246).
           */
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            isHiddenByDefault: true,
            getElement: (item: SecurityEventConnection): ReactElement => {
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
            getElement: (item: SecurityEventConnection): ReactElement => {
              const health: string = connectorHealth(item);
              return (
                <Pill
                  color={connectorHealthPillColor(health)}
                  text={health}
                  tooltip={connectorHealthTooltip(health)}
                />
              );
            },
          },
          {
            field: {
              pollIntervalInMinutes: true,
            },
            title: "Interval (Minutes)",
            type: FieldType.Number,
            noValueMessage: "-",
            isHiddenByDefault: true,
          },
          /*
           * When it last polled, last polled well and last brought an event
           * in, as how long ago ("2 minutes ago", the date and time under
           * the pointer): three columns of full dates were some 640px of a
           * card 874px wide. Still dates to the table - kept whole when it
           * gives way, sorted by the date.
           */
          {
            field: {
              lastPolledAt: true,
            },
            title: "Last Polled",
            type: FieldType.DateTime,
            noValueMessage: "Never",
            getElement: (item: SecurityEventConnection): ReactElement => {
              return <RelativeTimeCell date={item.lastPolledAt} />;
            },
          },
          {
            field: {
              lastSuccessfulPollAt: true,
            },
            title: "Last Successful Poll",
            type: FieldType.DateTime,
            noValueMessage: "Never",
            isHiddenByDefault: true,
            getElement: (item: SecurityEventConnection): ReactElement => {
              return <RelativeTimeCell date={item.lastSuccessfulPollAt} />;
            },
          },
          {
            field: {
              lastEventIngestedAt: true,
            },
            title: "Last Event Imported",
            type: FieldType.DateTime,
            noValueMessage: "Never",
            getElement: (item: SecurityEventConnection): ReactElement => {
              return <RelativeTimeCell date={item.lastEventIngestedAt} />;
            },
          },
        ]}
      />

      {formModal && (
        <SecurityEventConnectionFormModal
          key={`${formModal.connection?.id?.toString() || "new"}-${formModal.credentialsOnly ? "credentials" : "settings"}-${formModal.initialProvider || "any"}`}
          connection={formModal.connection || undefined}
          credentialsOnly={formModal.credentialsOnly}
          initialProvider={formModal.initialProvider}
          onClose={(): void => {
            setFormModal(null);
          }}
          onSaved={(): void => {
            setFormModal(null);
            refresh();
          }}
        />
      )}

      {testItem && (
        <ConnectionTestModal
          key={testItem.id?.toString()}
          title={`Test connection: ${testItem.name || getSecurityEventConnectorTitle(testItem.provider)}`}
          providerTitle={getSecurityEventConnectorTitle(testItem.provider)}
          runTest={() => {
            return runConnectionTestRequest({
              route: SECURITY_EVENT_CONNECTION_TEST_ROUTE,
              body: { connectionId: testItem.id!.toString() },
            });
          }}
          onClose={(): void => {
            setTestItem(null);
            // The API records each test as a run row; keep history current.
            refresh();
          }}
        />
      )}

      {diagnosticsItem && (
        <SecurityEventConnectionDiagnostics
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
          onUpdated={refresh}
        />
      )}

      {currentlyViewingError && (
        <Modal
          title="Last Error"
          description="Copy this message when contacting support. Credentials are redacted."
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
    </Fragment>
  );
};

export default SecurityEventConnectionsTable;
