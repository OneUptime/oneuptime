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
  getSecurityEventConnectorDefinition,
  getSecurityEventConnectorTitle,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
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
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";

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
          title: "Security Event Connections",
          description:
            "Poll Microsoft Sentinel, Defender XDR, CrowdStrike Falcon, Splunk, Elastic Security, AWS Security Hub, Okta and Google SecOps as OCSF security events. Test access, run a poll, and inspect imports on demand.",
          buttons: [
            {
              title: "Add connection",
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
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              provider: true,
            },
            title: "Provider",
            type: FieldType.Text,
            getElement: (item: SecurityEventConnection): ReactElement => {
              /*
               * A provider with an alerting distinction shows what the
               * connection imports under its name ("Alerts only"), so a
               * connection that skips non-alerting records is visible
               * without opening it.
               */
              const scope: string | undefined = connectorScopeSummary(
                getSecurityEventConnectorDefinition(item.provider),
                item.alertingOnly,
              );
              return (
                <div>
                  <span>{getSecurityEventConnectorTitle(item.provider)}</span>
                  {scope && (
                    <div className="text-xs text-gray-500">{scope}</div>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
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
