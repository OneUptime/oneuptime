import {
  AUDIT_LOG_EXPORT_HEALTH_COPY,
  AUDIT_LOG_EXPORT_SCOPE_COPY,
  AUDIT_LOG_EXPORT_TABLE_ID,
  AuditLogExportCopy,
  AuditLogExportHealth,
  AuditLogExportScope,
  AuditLogExportScopeCopy,
} from "./AuditLogExportCopy";
import {
  describeAuditLogExportTarget,
  formatAuditLogExportDuration,
  getAuditLogExportHealth,
  getAuditLogExportHealthColor,
} from "./AuditLogExportForm";
import AuditLogExportFormModal from "./AuditLogExportFormModal";
import { AuditLogExportTestModal } from "./AuditLogExportTest";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import Route from "Common/Types/API/Route";
import {
  AUDIT_LOG_EXPORT_DOCS_PATH,
  getAuditLogExportDestinationTitle,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import {
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyState, {
  TableEmptyStateActionStyle,
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

export interface ComponentProps {
  scope: AuditLogExportScope;
  // The page's model API: the project's, or the Admin Dashboard's (no project).
  modelAPI: typeof ModelAPI;
  // The project's exports; left out for the instance's.
  projectId?: ObjectID | undefined;
  /*
   * The Enterprise license stopped audit logs (lapsed, or leaves them out):
   * exports can still be read and deleted, not added, changed or tested.
   */
  isLicenseReadOnly: boolean;
}

// A row action or button locked by the license, a permission, or neither.
function lockedBy(
  isLicenseReadOnly: boolean,
  gate: PermissionGateResult,
): { isAllowed: boolean; reason?: string | undefined } {
  if (isLicenseReadOnly) {
    return { isAllowed: false, reason: AuditLogExportCopy.licenseRequired };
  }

  return { isAllowed: gate.isAllowed, reason: gate.disabledReason };
}

// The guide to every destination, the record schema and the timings.
export const openAuditLogExportDocs: VoidFunction = (): void => {
  Navigation.navigate(Route.fromString(AUDIT_LOG_EXPORT_DOCS_PATH), {
    openInNewTab: true,
  });
};

/*
 * What the empty table says, drawn like every other empty table: what is
 * true now (nothing is exported), which destinations are supported, one
 * button that opens the form, and the guide for whoever wants to read
 * first. Whoever may not add one reads why under it.
 */
export const AuditLogExportsEmptyState: FunctionComponent<{
  canCreate: boolean;
  createDisabledReason?: string | undefined;
  onAdd: () => void;
}> = (props: {
  canCreate: boolean;
  createDisabledReason?: string | undefined;
  onAdd: () => void;
}): ReactElement => {
  return (
    <TableEmptyState
      kind={TableEmptyStateKind.Empty}
      icon={IconProp.DocumentArrowUp}
      title={AuditLogExportCopy.emptyTitle}
      description={AuditLogExportCopy.emptyDescription}
      isCompact={true}
      dataTestId="audit-log-exports-empty"
      actions={[
        {
          title: AuditLogExportCopy.addButton,
          icon: IconProp.Add,
          disabled: !props.canCreate,
          tooltip: props.canCreate ? undefined : props.createDisabledReason,
          dataTestId: "audit-log-exports-empty-add",
          onClick: props.onAdd,
        },
        {
          title: AuditLogExportCopy.docsLink,
          icon: IconProp.Book,
          style: TableEmptyStateActionStyle.Link,
          dataTestId: "audit-log-exports-empty-docs",
          onClick: openAuditLogExportDocs,
        },
      ]}
      note={props.canCreate ? undefined : props.createDisabledReason}
    />
  );
};

/*
 * The audit log exports of a project (Settings > Audit Logs > Export) or of
 * the instance (Admin Dashboard > Settings > Audit Log Export): where each
 * sends, how it is doing, and the moves on it - send a test, edit, read its
 * last error, delete. The exporter itself is ee/Server/AuditLogExport.
 */
const AuditLogExportTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: AuditLogExportScopeCopy =
    AUDIT_LOG_EXPORT_SCOPE_COPY[props.scope];
  const [formExport, setFormExport] = useState<AuditLogExport | "new" | null>(
    null,
  );
  const [testExport, setTestExport] = useState<AuditLogExport | null>(null);
  const [viewingError, setViewingError] = useState<AuditLogExport | null>(null);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  const refresh: VoidFunction = (): void => {
    setRefreshCounter((value: number): number => {
      return value + 1;
    });
  };

  const create: { isAllowed: boolean; reason?: string | undefined } = lockedBy(
    props.isLicenseReadOnly,
    PermissionGate.check(new AuditLogExport(), ModelAction.Create),
  );
  const update: { isAllowed: boolean; reason?: string | undefined } = lockedBy(
    props.isLicenseReadOnly,
    PermissionGate.check(new AuditLogExport(), ModelAction.Update),
  );

  const query: Query<AuditLogExport> =
    props.scope === AuditLogExportScope.Project && props.projectId
      ? { projectId: props.projectId }
      : ({ projectId: new IsNull() } as Query<AuditLogExport>);

  const openCreateForm: VoidFunction = (): void => {
    setFormExport("new");
  };

  /*
   * Turn on and Turn off: the switch alone, then the list again, so the
   * row's status says what it now is. A refusal (the license, a permission)
   * is the row's own error dialog.
   */
  const setEnabled: (
    item: AuditLogExport,
    isEnabled: boolean,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ) => Promise<void> = async (
    item: AuditLogExport,
    isEnabled: boolean,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ): Promise<void> => {
    try {
      await props.modelAPI.updateById<AuditLogExport>({
        modelType: AuditLogExport,
        id: item.id!,
        data: { isEnabled },
      });
      onCompleteAction();
      refresh();
    } catch (err) {
      onError(new Error(API.getFriendlyMessage(err)));
    }
  };

  const formatTimeAgo: (date: Date | undefined) => string = (
    date: Date | undefined,
  ): string => {
    return date
      ? formatFeedTimeAgo(
          new Date(date),
          getFeedClock({ language: translator.language }),
        ) || ""
      : "";
  };

  return (
    <Fragment>
      <ModelTable<AuditLogExport>
        modelType={AuditLogExport}
        modelAPI={props.modelAPI}
        refreshToggle={String(refreshCounter)}
        selectMoreFields={{
          projectId: true,
          destinationType: true,
          config: true,
          isEnabled: true,
          startsAt: true,
          lastAttemptAt: true,
          lastExportedAt: true,
          lastError: true,
          failingSince: true,
          nextAttemptAt: true,
          exportedEntryCount: true,
        }}
        query={query}
        id={AUDIT_LOG_EXPORT_TABLE_ID}
        name={
          props.scope === AuditLogExportScope.Project
            ? "Settings > Audit Logs > Export"
            : "Settings > Audit Log Export"
        }
        userPreferencesKey={`${AUDIT_LOG_EXPORT_TABLE_ID}-${props.scope}`}
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: copy.cardTitle,
          description: copy.cardDescription,
          buttons: [
            {
              title: AuditLogExportCopy.addButton,
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              disabled: !create.isAllowed,
              tooltip: create.isAllowed ? undefined : create.reason,
              onClick: openCreateForm,
            },
          ],
        }}
        noItemsMessage={
          <AuditLogExportsEmptyState
            canCreate={create.isAllowed}
            createDisabledReason={create.reason}
            onAdd={openCreateForm}
          />
        }
        showRefreshButton={true}
        actionButtons={[
          {
            title: AuditLogExportCopy.viewErrorAction,
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Error,
            isVisible: (item: AuditLogExport): boolean => {
              return Boolean(item.lastError);
            },
            onClick: (
              item: AuditLogExport,
              onCompleteAction: VoidFunction,
            ): void => {
              setViewingError(item);
              onCompleteAction();
            },
          },
          /*
           * Before Send a test: the first action a row shows is its button,
           * and an export that is off is turned on before anything else.
           */
          {
            title: AuditLogExportCopy.turnOnAction,
            icon: IconProp.Play,
            buttonStyleType: ButtonStyleType.OUTLINE,
            isVisible: (item: AuditLogExport): boolean => {
              return item.isEnabled === false;
            },
            disabled: !update.isAllowed,
            tooltip: update.isAllowed
              ? AuditLogExportCopy.turnOnActionTooltip
              : update.reason,
            onClick: (
              item: AuditLogExport,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ): void => {
              void setEnabled(item, true, onCompleteAction, onError);
            },
          },
          {
            title: AuditLogExportCopy.testRowAction,
            icon: IconProp.PaperAirplane,
            buttonStyleType: ButtonStyleType.OUTLINE,
            disabled: !update.isAllowed,
            tooltip: update.isAllowed
              ? AuditLogExportCopy.testRowActionTooltip
              : update.reason,
            onClick: (
              item: AuditLogExport,
              onCompleteAction: VoidFunction,
            ): void => {
              setTestExport(item);
              onCompleteAction();
            },
          },
          {
            title: AuditLogExportCopy.turnOffAction,
            icon: IconProp.Stop,
            buttonStyleType: ButtonStyleType.OUTLINE,
            isVisible: (item: AuditLogExport): boolean => {
              return item.isEnabled !== false;
            },
            disabled: !update.isAllowed,
            tooltip: update.isAllowed
              ? AuditLogExportCopy.turnOffActionTooltip
              : update.reason,
            onClick: (
              item: AuditLogExport,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ): void => {
              void setEnabled(item, false, onCompleteAction, onError);
            },
          },
          {
            title: "Edit",
            icon: IconProp.Edit,
            buttonStyleType: ButtonStyleType.OUTLINE,
            disabled: !update.isAllowed,
            tooltip: update.isAllowed ? undefined : update.reason,
            onClick: (
              item: AuditLogExport,
              onCompleteAction: VoidFunction,
            ): void => {
              setFormExport(item);
              onCompleteAction();
            },
          },
        ]}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
            getElement: (item: AuditLogExport): ReactElement => {
              /*
               * What it is and where it sends read under its name: "Amazon
               * S3 · my-audit-logs/oneuptime/audit-logs/". When room runs
               * out the line wraps between its two parts rather than
               * widening the column - the address is one box on the line,
               * so it moves under the destination whole instead of
               * breaking at a hyphen of its bucket ("acme-sec-" over
               * "lake/..."), and wraps inside only when it is longer than
               * the column itself.
               */
              const parts: Array<string> = [
                getAuditLogExportDestinationTitle(item.destinationType),
                describeAuditLogExportTarget(item),
              ].filter((part: string): boolean => {
                return Boolean(part);
              });

              /*
               * The name on one line, cut short with an ellipsis where the
               * column ends (the cell shows it in full under the pointer):
               * a block of its own, since an ellipsis does not reach into
               * a box inside the cell's line.
               */
              return (
                <div className="min-w-0">
                  <div className="truncate" data-testid="audit-log-export-name">
                    {item.name}
                  </div>
                  <div
                    className="whitespace-normal break-words text-xs text-gray-500"
                    data-testid="audit-log-export-detail"
                  >
                    {parts.map((part: string, index: number): ReactElement => {
                      const isLast: boolean = index === parts.length - 1;

                      return (
                        <Fragment key={index}>
                          <span
                            className={
                              index === 0 ? "" : "inline-block max-w-full"
                            }
                          >
                            {index === 0
                              ? translator.translateText(part)
                              : part}
                            {isLast ? "" : " ·"}
                          </span>
                          {isLast ? "" : " "}
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: AuditLogExportCopy.statusColumn,
            type: FieldType.Boolean,
            getElement: (item: AuditLogExport): ReactElement => {
              const health: AuditLogExportHealth =
                getAuditLogExportHealth(item);
              const line: string =
                health === AuditLogExportHealth.Failing && item.failingSince
                  ? translator.translateTemplate(
                      AuditLogExportCopy.failingFor,
                      {
                        duration: formatAuditLogExportDuration({
                          since: new Date(item.failingSince),
                          now: new Date(),
                          language: translator.language,
                        }),
                      },
                    )
                  : item.lastExportedAt
                    ? translator.translateTemplate(
                        AuditLogExportCopy.lastExported,
                        { time: formatTimeAgo(item.lastExportedAt) },
                      )
                    : "";

              return (
                <div className="flex flex-col items-start gap-1">
                  <Pill
                    color={getAuditLogExportHealthColor(health)}
                    text={AUDIT_LOG_EXPORT_HEALTH_COPY[health].title}
                    tooltip={AUDIT_LOG_EXPORT_HEALTH_COPY[health].description}
                  />
                  {line ? (
                    <span
                      className="text-xs text-gray-500"
                      data-testid="audit-log-export-status-line"
                    >
                      {line}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
        ]}
      />

      {formExport ? (
        <AuditLogExportFormModal
          key={
            formExport === "new" ? "new" : formExport.id?.toString() || "edit"
          }
          auditLogExport={formExport === "new" ? undefined : formExport}
          projectId={
            props.scope === AuditLogExportScope.Project
              ? props.projectId
              : undefined
          }
          testRoute={copy.testRoute}
          modelAPI={props.modelAPI}
          onClose={(): void => {
            setFormExport(null);
          }}
          onSaved={(): void => {
            setFormExport(null);
            refresh();
          }}
        />
      ) : (
        <></>
      )}

      {testExport?.id ? (
        <AuditLogExportTestModal
          key={testExport.id.toString()}
          route={copy.testRoute}
          modelAPI={props.modelAPI}
          exportId={testExport.id.toString()}
          exportName={
            testExport.name ||
            getAuditLogExportDestinationTitle(testExport.destinationType)
          }
          onClose={(): void => {
            setTestExport(null);
          }}
        />
      ) : (
        <></>
      )}

      {viewingError?.lastError ? (
        <Modal
          title={AuditLogExportCopy.errorTitle}
          description={AuditLogExportCopy.errorDescription}
          modalWidth={ModalWidth.Large}
          onClose={(): void => {
            setViewingError(null);
          }}
          closeButtonText="Close"
          leftFooterElement={
            <CopyTextButton
              textToBeCopied={viewingError.lastError}
              label={AuditLogExportCopy.copyError}
              size="md"
              variant="solid"
            />
          }
        >
          <div className="space-y-3">
            <pre
              aria-label={translator.translateText(
                AuditLogExportCopy.fullErrorLabel,
              )}
              tabIndex={0}
              className="whitespace-pre-wrap break-words rounded-md bg-gray-50 p-4 text-sm text-gray-800"
              data-testid="audit-log-export-error"
            >
              {viewingError.lastError}
            </pre>
            {viewingError.nextAttemptAt && viewingError.isEnabled !== false ? (
              <p
                className="text-sm text-gray-500"
                data-testid="audit-log-export-next-try"
              >
                {translator.translateTemplate(AuditLogExportCopy.nextTry, {
                  time: OneUptimeDate.getDateAsLocalFormattedString(
                    new Date(viewingError.nextAttemptAt),
                  ),
                })}
              </p>
            ) : (
              <></>
            )}
          </div>
        </Modal>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default AuditLogExportTable;
