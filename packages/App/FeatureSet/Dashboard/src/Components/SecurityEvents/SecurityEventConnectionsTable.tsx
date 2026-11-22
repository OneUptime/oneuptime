import { PillTone } from "Common/UI/Components/Pill/PillTone";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green } from "Common/Types/BrandColors";
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
import ProviderLogoImage, {
  ProviderLogoSize,
} from "Common/UI/Components/ProviderLogo/ProviderLogoImage";
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
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import ObjectID from "Common/Types/ObjectID";
import {
  CloudflareBlockingSettings,
  CloudflareBlockingStatus,
  CloudflareRuleState,
  CloudflareZoneRuleStatus,
  CloudflareZoneStatus,
  readCloudflareBlockingFailure,
  readCloudflareBlockingSettings,
  readCloudflareBlockingStatus,
} from "Common/Types/SecurityBlocklist/CloudflareBlocking";
import { DeleteConfirmation } from "Common/UI/Components/ModelTable/BaseModelTable";
import CloudflareBlockingModal from "./CloudflareBlocking/CloudflareBlockingModal";
import {
  BLOCKING_ATTENTION_DETAIL,
  BLOCKING_ON_DETAIL,
  BLOCK_ADDRESSES_ACTION,
  BLOCK_ADDRESSES_ACTION_TOOLTIP,
  DELETE_WHILE_BLOCKING,
  TURN_OFF_BUTTON,
} from "./CloudflareBlocking/CloudflareBlockingCopy";

/*
 * The tile a connection's product mark sits on at the start of its name:
 * the size Send to your SIEM's rows, and every other list of connections
 * (Cloud, AI, audit log exports), draw a product's mark at, level with the
 * name's first line. One size for every mark - a wordmark (Splunk's) or a
 * narrow one (MinIO's) - so the names after the tiles line up down the
 * column.
 */
export const CONNECTION_ROW_MARK_SIZE: ProviderLogoSize = 32;

interface FormModalState {
  connection: SecurityEventConnection | null;
  credentialsOnly: boolean;
  // Create only: the provider picked from the empty state's provider tiles.
  initialProvider?: SecurityEventConnectorProvider | undefined;
}

const documentationMarkdown: string = `
A connection brings in what one security product finds, such as a SIEM, an EDR or XDR platform, a cloud security service or an identity provider, as security events you can search, correlate and alert on. It polls the product on the interval you set.

## How a Connection Works

- Each poll imports the product's new records as OCSF security events attributed to it. Records are read by the time the **source created them**, so a detection about yesterday that the source created this morning is still picked up.
- The first poll looks back 24 hours. Bring in older records with a historical import from **Diagnostics**.
- Each provider's setup guide lists the roles, scopes and console locations for every value the form asks for.

## Testing and Health

- **Test connection** runs at once, without a worker, and reports a checklist: access to the provider, what it has to import, and whether OneUptime's workers and scheduler are running. It imports nothing.
- **Health** reads *Polling, no events imported yet* while polls succeed but nothing arrives. That is a state to look into with **Test connection**, not a success.
- **Last Error** keeps the latest failure, with credentials redacted. Open **View Error** in the row's **Actions** to read it.

## Credentials

Credentials are encrypted and never returned by the API. Rotate them with **Update credentials**; a credential left blank while editing keeps its stored value.
`;

/*
 * A provider's help as topics of the help dialog (Common HelpContent): its
 * "###" sections become "##" topics after the framework's, and the lines
 * drawn between them go, as the dialog draws its own. The provider's
 * markdown stays as written in ConnectorProviderHelp, which a test reads
 * by its declaration.
 */
export function getConnectorProviderHelpTopics(markdown: string): string {
  return markdown
    .replace(/^### /gm, "## ")
    .replace(/^---[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/*
 * The help panel: the framework-level text above, then the topics of each
 * provider that has in-product help of its own (ConnectorProviderHelp), in
 * catalog order.
 */
export function securityEventConnectionsHelpMarkdown(): string {
  return [
    documentationMarkdown.trim(),
    ...connectorProviderHelpEntries().map(
      (entry: ConnectorProviderHelpEntry): string => {
        return getConnectorProviderHelpTopics(entry.markdown);
      },
    ),
  ].join("\n\n");
}

/*
 * What a connection is, under its name: its provider ("Okta System Log"),
 * and for a provider with an alerting distinction what it imports ("Google
 * SecOps · Alerts only"), in the reader's words where they have them.
 */
export function getConnectionProviderDetailParts(
  connection: Pick<
    SecurityEventConnection,
    "provider" | "alertingOnly" | "blockingSettings" | "blockingStatus"
  >,
  translator: Translator,
): Array<string> {
  const provider: string = getSecurityEventConnectorTitle(connection.provider);
  const scope: string | undefined = connectorScopeSummary(
    getSecurityEventConnectorDefinition(connection.provider),
    connection.alertingOnly,
  );
  const providerWords: string = translator.translateText(provider) || provider;
  const parts: Array<string> = scope
    ? [providerWords, translator.translateText(scope) || scope]
    : [providerWords];
  const blocking: string | null = getConnectionBlockingDetail(connection);

  if (blocking) {
    parts.push(translator.translateText(blocking) || blocking);
  }

  return parts;
}

/*
 * Whether a connection blocks addresses at its provider (#10343), and
 * whether that needs a look - a rule turned off, deleted or changed at
 * Cloudflare, or a change or check that failed: an English key, or null for
 * a connection that only reads.
 */
export function getConnectionBlockingDetail(
  connection: Pick<
    SecurityEventConnection,
    "blockingSettings" | "blockingStatus"
  >,
): string | null {
  const settings: CloudflareBlockingSettings = readCloudflareBlockingSettings(
    connection.blockingSettings,
  );

  if (!settings.isEnabled) {
    return null;
  }

  const status: CloudflareBlockingStatus | null = readCloudflareBlockingStatus(
    connection.blockingStatus,
  );
  const ruleOff: boolean = Boolean(
    status?.zones.some((zone: CloudflareZoneStatus): boolean => {
      return zone.rules.some((rule: CloudflareZoneRuleStatus): boolean => {
        return rule.state !== CloudflareRuleState.Enforcing;
      });
    }),
  );

  return ruleOff || readCloudflareBlockingFailure(connection.blockingStatus)
    ? BLOCKING_ATTENTION_DETAIL
    : BLOCKING_ON_DETAIL;
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
  // The Cloudflare connection whose Block Addresses dialog is open, and whether on turning it off.
  const [blockingItem, setBlockingItem] = useState<{
    id: ObjectID;
    isTurningOff: boolean;
  } | null>(null);

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
          blockingSettings: true,
          blockingStatus: true,
        }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="security-event-connections-table"
        name="Security Events > Security Event Connections"
        userPreferencesKey="security-event-connections-table"
        isDeleteable={true}
        /*
         * A Cloudflare connection that blocks addresses is turned off first
         * (#10343): turning it off asks whether to remove OneUptime's lists
         * and rules from Cloudflare, which takes the connection's token.
         */
        getDeleteConfirmation={async (
          item: SecurityEventConnection,
        ): Promise<DeleteConfirmation> => {
          if (
            !item.id ||
            !readCloudflareBlockingSettings(item.blockingSettings).isEnabled
          ) {
            return {};
          }

          const id: ObjectID = item.id;

          return {
            description: translator.translateTemplate(DELETE_WHILE_BLOCKING, {
              name: item.name || "",
            }),
            isDeleteBlocked: true,
            alternative: {
              title: TURN_OFF_BUTTON,
              onClick: async (): Promise<void> => {
                setBlockingItem({ id, isTurningOff: true });
              },
            },
          };
        }}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: "Your security tools",
          /*
           * Every kind of product the catalog connects, with a well-known
           * one of each: ten names ran past a card description's two lines,
           * and Add connection lists every product.
           */
          description:
            "Bring in alerts and events from the SIEM, EDR / XDR, cloud security and identity tools you already use, such as Microsoft Sentinel, CrowdStrike Falcon, AWS Security Hub and Microsoft Entra ID.",
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
            "Bring what your security products find into OneUptime, as security events.",
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
            title: BLOCK_ADDRESSES_ACTION,
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.NoSymbol,
            isVisible: (item: SecurityEventConnection): boolean => {
              return (
                item.provider === SecurityEventConnectorProvider.Cloudflare
              );
            },
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.isAllowed
              ? BLOCK_ADDRESSES_ACTION_TOOLTIP
              : updateGate.disabledReason,
            onClick: (
              item: SecurityEventConnection,
              onCompleteAction: VoidFunction,
            ): void => {
              if (item.id) {
                setBlockingItem({ id: item.id, isTurningOff: false });
              }

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
            // Each of its lines already reads its own way.
            getLineText: drawsItsOwnLines,
            getElement: (item: SecurityEventConnection): ReactElement => {
              const definition: SecurityEventConnectorDefinition | undefined =
                getSecurityEventConnectorDefinition(item.provider);

              /*
               * The product's official mark leads the row on its tile, as
               * each SIEM's does in Send to your SIEM under this table: the
               * same size for every product, level with the name's first
               * line, so every name in the column starts at one place.
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
                      <ProviderLogoImage
                        logo={definition.logo}
                        size={CONNECTION_ROW_MARK_SIZE}
                        isDecorative={true}
                        className="mt-0.5"
                      />
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
              return <Pill tone={PillTone.Paused} text="Disabled" />;
            },
          },
          {
            field: {
              lastPollResult: true,
            },
            title: "Health",
            type: FieldType.JSON,
            /*
             * The one word each row is read for, never cut short: a
             * language whose states run long ("Расписание
             * приостановлено") wraps one onto a second line, between its
             * words, where the table has not the room for it on one. Cut
             * to the 8rem a value gives way to, the Russian ones read
             * "Последний о..." and "Расписание п..." at 1280 (#6891).
             */
            getElement: (item: SecurityEventConnection): ReactElement => {
              const health: string = connectorHealth(item);
              return (
                <Pill
                  color={connectorHealthPillColor(health)}
                  text={health}
                  tooltip={connectorHealthTooltip(health)}
                  isWrapping={true}
                  isKeepingWordsWhole={true}
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
            /*
             * Under Last Event Imported, with its name before it, where the
             * rows do not fit the card (TableFit): in Russian at 1280px,
             * beside the side menu, the row's "Проверить подключение" left
             * the table 83px wider than its card, and its last time ran
             * under the sticky buttons ("3 мин", "Никог"). Health already
             * says how the polls go; this is the one that gives way.
             */
            hideBelowLargeScreen: true,
            foldInto: "lastEventIngestedAt",
            showTitleWhenFolded: true,
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
          title={translator.translateTemplate("Test connection: {{name}}", {
            name:
              testItem.name ||
              getSecurityEventConnectorTitle(testItem.provider),
          })}
          isTitleTranslated={true}
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

      {blockingItem && (
        <CloudflareBlockingModal
          key={`${blockingItem.id.toString()}-${blockingItem.isTurningOff ? "off" : "open"}`}
          connectionId={blockingItem.id}
          isTurningOff={blockingItem.isTurningOff}
          onClose={(): void => {
            setBlockingItem(null);
          }}
          onChanged={refresh}
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
            aria-label={translator.translateText("Full error message")}
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
