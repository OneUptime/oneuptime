import {
  ARCHIVABLE_VALUE_COPY,
  ARCHIVE_ACTION,
  ARCHIVE_DIALOG_TITLE,
  ARCHIVE_INSTEAD,
  ARCHIVED_COUNT,
  ArchivableValueCopy,
  BULK_DELETE_REFUSAL_REASON,
  CHECKING_WHAT_USES_IT,
  DELETE_CHANGES_ARCHIVE_INSTEAD,
  DELETE_CHANGES_CANNOT_UNDO,
  DELETE_CHANGES_INTRO,
  DELETE_REFUSED_ALREADY_ARCHIVED,
  DELETE_REFUSED_ARCHIVE_INSTEAD,
  DELETE_REFUSED_INTRO,
  DELETE_REFUSED_NAMED,
  STILL_SET_UP_TO_USE_IT,
  UNARCHIVE_ACTION,
} from "./ArchivableValueCopy";
import {
  PersonalUsageNotes,
  UsageGroups,
  UsageList,
} from "./ArchivableValueUsageList";
import {
  ArchiveDialogUsage,
  UsageGroup,
  getArchiveDialogUsage,
  getDeleteDialogGroups,
  isDeleteRefused,
} from "./ArchivableValueUsageText";
import ArchivableValuesBulkDeleteDetails from "./ArchivableValuesBulkDeleteDetails";
import { fetchArchivableValueUsage } from "./FetchArchivableValueUsage";
import { getArchivedColumns } from "../Archive/ArchivedColumns";
import PageMap from "../../Utils/PageMap";
import { RouteUtil } from "../../Utils/RouteMap";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import { ArchivableValueUsageItem } from "Common/Types/ArchivableValue/ArchivableValueUsage";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Select from "Common/Types/BaseDatabase/Select";
import OnCallRuleKind, {
  getOnCallRuleKindQuery,
} from "Common/Types/NotificationRule/OnCallRuleKind";
import ObjectID from "Common/Types/ObjectID";
import {
  ARCHIVABLE_VALUES,
  ARCHIVED_COLUMN,
  ArchivableValueDefinition,
  ArchivableValueType,
  getArchiveProtectionReason,
} from "Common/Utils/ArchivableValues";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { BulkActionConfirmControls } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import CardSections from "Common/UI/Components/Card/CardSections";
import DeleteConfirmationMessage from "Common/UI/Components/DeleteConfirmation/DeleteConfirmationMessage";
import NamedSentence from "Common/UI/Components/DeleteConfirmation/NamedSentence";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import InlineLoadingLine from "Common/UI/Components/Loader/InlineLoadingLine";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import {
  BulkActionProps,
  DeleteConfirmation,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import Columns from "Common/UI/Components/ModelTable/Columns";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ModelListCache from "Common/UI/Utils/ModelListCache";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * ARCHIVE AND UNARCHIVE FOR THE VALUES RECORDS PICK FROM
 * (Common/Utils/ArchivableValues), the same on all eight settings pages.
 *
 * The maintainer: "Can we build functionality to archive things like
 * severity, stage, labels, etc., so they cannot be used in new records like
 * incidents or monitors, but the old records should exist? The current
 * functionality only has delete, but when you delete it, the old records
 * are modified as well."
 *
 * Each page keeps its own <ModelTable> of the values that are not archived
 * and takes from here:
 *
 *   - `query`: the live values only - archived ones are never mixed in;
 *   - `actionButtons`: Archive, in each row's ⋯ menu. A value OneUptime
 *     moves records into (the resolved state, the operational status, the
 *     primary role), or a project's last live severity, keeps Archive
 *     locked, with why as its tooltip. Archive asks first, saying what it
 *     does and which settings and automations still use the value;
 *   - `getDeleteConfirmation`: Delete says what it would do to everything
 *     that uses the value - refused while records still have it, otherwise
 *     what comes off, goes or is cleared - and offers Archive instead;
 *   - `bulkActions`: Bulk Actions > Delete says first what deleting the
 *     selected values would do - which of them records still have, left as
 *     they are, and what deleting the rest changes - read once for the
 *     selection (ArchivableValuesBulkDeleteDetails);
 *   - `refreshToggle`: the tables read again after an archive or unarchive;
 *   - `element`, placed after the table: the folded Archived section - only
 *     when something is archived - whose rows Unarchive with one click, and
 *     the Archive dialog.
 *
 * The Archive dialog lists the project's settings that keep using the
 * value, and says apart how many people have their own settings that name
 * it - their on-call rules for a severity - which stay as they are, with a
 * link to the reader's own.
 *
 * A page whose table draws its values its own way (a label as a label, a
 * role with its icon) hands that in as `getNameElement`, so an archived
 * value looks in the Archived section as it does in the table above it,
 * and on every record that has it.
 */

export interface ArchivableValues<T extends BaseModel> {
  query: Query<T>;
  actionButtons: Array<ActionButtonSchema<T>>;
  getDeleteConfirmation: (item: T) => Promise<DeleteConfirmation>;
  bulkActions: BulkActionProps<T>;
  refreshToggle: string;
  element: ReactElement;
}

interface ArchiveDialogState<T extends BaseModel> {
  item: T;
  /*
   * The settings that keep using it, and the people whose own settings name
   * it - null while they are read. The dialog opens at once and says it is
   * checking; a read that fails lists none, since archiving needs no answer
   * from it.
   */
  usage: ArchiveDialogUsage | null;
}

const NO_USAGE: ArchiveDialogUsage = { settings: [], people: [] };

/*
 * Where the reader sees their own settings of a table of people's own
 * settings, for a value of `type`: their on-call rules, on the tab of the
 * kind of record the value is of, or their notification settings. Null for
 * a table the product has no page of the reader's own for.
 */
export const getOwnSettingsRoute: (
  type: ArchivableValueType,
  tableName: string,
) => Route | null = (
  type: ArchivableValueType,
  tableName: string,
): Route | null => {
  if (tableName === "UserNotificationRule") {
    return RouteUtil.getPageRoute(PageMap.USER_SETTINGS_ON_CALL_RULES, {
      query: getOnCallRuleKindQuery(
        type === ArchivableValueType.AlertSeverity
          ? OnCallRuleKind.Alerts
          : OnCallRuleKind.Incidents,
      ),
    });
  }

  if (tableName === "UserNotificationSetting") {
    return RouteUtil.getPageRoute(PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS);
  }

  return null;
};

const readName: (item: BaseModel) => string = (item: BaseModel): string => {
  const name: unknown = item.getColumnValue("name");

  return typeof name === "string" ? name : "";
};

const readId: (item: BaseModel) => ObjectID | null = (
  item: BaseModel,
): ObjectID | null => {
  const id: unknown = item._id || item.id;

  if (!id) {
    return null;
  }

  return id instanceof ObjectID ? id : new ObjectID(id.toString());
};

export const ARCHIVED_SECTION_TEST_ID: string = "archived-values-section";

export interface UseArchivableValuesOptions<T extends BaseModel> {
  modelType: { new (): T };
  type: ArchivableValueType;
  /*
   * How the page's own table draws a value's name, for the Archived
   * section's Name column; and the columns that needs beside the name and
   * colour. Left out, the name is the coloured pill states and severities
   * are drawn with.
   */
  getNameElement?: ((item: T) => ReactElement) | undefined;
  nameSelect?: Select<T> | undefined;
  /*
   * What the page's own table calls one value and several ("Case Status",
   * "Case Statuses"), when that is shorter than the model's name: the
   * Archived section's table and the dialogs say the same.
   */
  singularName?: string | undefined;
  pluralName?: string | undefined;
}

const useArchivableValues: <T extends BaseModel>(
  data: UseArchivableValuesOptions<T>,
) => ArchivableValues<T> = <T extends BaseModel>(
  data: UseArchivableValuesOptions<T>,
): ArchivableValues<T> => {
  const translator: Translator = useTranslator();

  const definition: ArchivableValueDefinition = ARCHIVABLE_VALUES[data.type];
  const copy: ArchivableValueCopy = ARCHIVABLE_VALUE_COPY[data.type];
  const model: T = useMemo(() => {
    return new data.modelType();
  }, [data.modelType]);

  const [refreshToggle, setRefreshToggle] = useState<string>(
    Date.now().toString(),
  );
  const [archivedCount, setArchivedCount] = useState<number>(0);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [archiveDialog, setArchiveDialog] =
    useState<ArchiveDialogState<T> | null>(null);
  const [isArchiving, setIsArchiving] = useState<boolean>(false);
  const [archiveError, setArchiveError] = useState<string>("");

  const updateGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Update,
  );

  /*
   * How many values are archived - the Archived section shows only when
   * there are any - and how many are not, for the kinds a project keeps one
   * live value of. Read again whenever a value is archived or unarchived.
   */
  useEffect(() => {
    let cancelled: boolean = false;

    const count: () => Promise<void> = async (): Promise<void> => {
      try {
        const [archived, live] = await Promise.all([
          ModelAPI.count<T>({
            modelType: data.modelType,
            query: { [ARCHIVED_COLUMN]: true } as never,
          }),
          definition.keepsOneLiveReason
            ? ModelAPI.count<T>({
                modelType: data.modelType,
                query: { [ARCHIVED_COLUMN]: false } as never,
              })
            : Promise.resolve(null),
        ]);

        if (!cancelled) {
          setArchivedCount(archived);
          setLiveCount(live);
        }
      } catch {
        // Someone who may not count them sees no Archived section.
        if (!cancelled) {
          setArchivedCount(0);
          setLiveCount(null);
        }
      }
    };

    void count();

    return () => {
      cancelled = true;
    };
  }, [refreshToggle, data.modelType, definition.keepsOneLiveReason]);

  // Everything that lists the values reads them again.
  const refresh: VoidFunction = useCallback((): void => {
    ModelListCache.invalidate(data.modelType);
    setRefreshToggle(Date.now().toString());
  }, [data.modelType]);

  const setArchived: (item: T, isArchived: boolean) => Promise<void> =
    useCallback(
      async (item: T, isArchived: boolean): Promise<void> => {
        const id: ObjectID | null = readId(item);

        if (!id) {
          return;
        }

        await ModelAPI.updateById<T>({
          modelType: data.modelType,
          id: id,
          data: {
            [ARCHIVED_COLUMN]: isArchived,
          },
        });

        refresh();
      },
      [data.modelType, refresh],
    );

  /*
   * Why a row's Archive is locked - a value OneUptime relies on, or a
   * project's last live one of a kind it keeps - in English: the row's menu
   * looks the reason up in the reader's language (RowActions).
   */
  const getArchiveLockedReason: (item: T) => string | undefined = (
    item: T,
  ): string | undefined => {
    const reason: string | null = getArchiveProtectionReason({
      definition: definition,
      row: item,
    });

    if (reason) {
      return reason;
    }

    if (definition.keepsOneLiveReason && liveCount !== null && liveCount <= 1) {
      return definition.keepsOneLiveReason;
    }

    return undefined;
  };

  // English: the row's menu looks it up (RowActions).
  const archiveAction: ActionButtonSchema<T> = {
    title: ARCHIVE_ACTION,
    icon: IconProp.Archive,
    buttonStyleType: ButtonStyleType.NORMAL,
    placement: ActionButtonPlacement.MoreMenu,
    disabled: !updateGate.isAllowed,
    tooltip: updateGate.isAllowed ? undefined : updateGate.disabledReason,
    getDisabledReason: getArchiveLockedReason,
    onClick: async (item: T, onCompleteAction: VoidFunction): Promise<void> => {
      const id: ObjectID | null = readId(item);

      // The dialog opens at once; what still uses the value follows.
      setArchiveError("");
      setArchiveDialog({ item: item, usage: id ? null : NO_USAGE });
      onCompleteAction();

      if (!id) {
        return;
      }

      // Only for the dialog still open on this value.
      const showUsage: (usage: ArchiveDialogUsage) => void = (
        usage: ArchiveDialogUsage,
      ): void => {
        setArchiveDialog(
          (
            current: ArchiveDialogState<T> | null,
          ): ArchiveDialogState<T> | null => {
            return current && current.item === item
              ? { item: item, usage: usage }
              : current;
          },
        );
      };

      try {
        showUsage(
          getArchiveDialogUsage(
            await fetchArchivableValueUsage({
              modelType: data.modelType,
              valueId: id,
            }),
          ),
        );
      } catch {
        /*
         * The list only helps: archiving changes no setting, so a read that
         * fails leaves the dialog as it is, without one.
         */
        showUsage(NO_USAGE);
      }
    },
  };

  const unarchiveAction: ActionButtonSchema<T> = {
    title: UNARCHIVE_ACTION,
    icon: IconProp.Unarchive,
    buttonStyleType: ButtonStyleType.OUTLINE,
    placement: ActionButtonPlacement.Primary,
    disabled: !updateGate.isAllowed,
    tooltip: updateGate.isAllowed ? undefined : updateGate.disabledReason,
    onClick: async (
      item: T,
      onCompleteAction: VoidFunction,
      onError: ErrorFunction,
    ): Promise<void> => {
      try {
        await setArchived(item, false);
        onCompleteAction();
      } catch (err) {
        onError(err as Error);
      }
    },
  };

  /*
   * The Delete dialog: what deleting the value would do to everything that
   * uses it, read from the server first. A value nothing uses gets the
   * usual question.
   */
  const getDeleteConfirmationFor: (
    isArchivedList: boolean,
  ) => (item: T) => Promise<DeleteConfirmation> = (
    isArchivedList: boolean,
  ): ((item: T) => Promise<DeleteConfirmation>) => {
    return async (item: T): Promise<DeleteConfirmation> => {
      const id: ObjectID | null = readId(item);

      const usage: Array<ArchivableValueUsageItem> = id
        ? await fetchArchivableValueUsage({
            modelType: data.modelType,
            valueId: id,
          })
        : [];

      const question: ReactElement = (
        <DeleteConfirmationMessage
          kind="question"
          name={readName(item)}
          typeLabel={data.singularName || model.singularName || ""}
          isIrreversible={usage.length === 0}
        />
      );

      if (usage.length === 0) {
        return { description: question };
      }

      const groups: Array<UsageGroup> = getDeleteDialogGroups(usage);
      const refused: boolean = isDeleteRefused(usage);

      const canArchiveInstead: boolean =
        !isArchivedList &&
        updateGate.isAllowed &&
        !getArchiveLockedReason(item);

      const closing: string = refused
        ? isArchivedList
          ? DELETE_REFUSED_ALREADY_ARCHIVED
          : canArchiveInstead
            ? DELETE_REFUSED_ARCHIVE_INSTEAD
            : ""
        : canArchiveInstead
          ? DELETE_CHANGES_ARCHIVE_INSTEAD
          : DELETE_CHANGES_CANNOT_UNDO;

      const name: string = readName(item).trim();

      return {
        description: refused ? (
          /*
           * Records still have it, so the delete cannot go through: no
           * question, only why, what has it, and what to do instead.
           */
          <div data-testid="archivable-value-delete-confirmation">
            <p className="font-medium text-gray-900">
              {name ? (
                <NamedSentence template={DELETE_REFUSED_NAMED} name={name} />
              ) : (
                translator.translateText(DELETE_REFUSED_INTRO)
              )}
            </p>
            <UsageList
              items={groups.flatMap((group: UsageGroup) => {
                return group.items;
              })}
              dataTestId="archivable-value-delete-refused-by"
            />
            {closing ? (
              <p className="mt-3">{translator.translateText(closing)}</p>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <div data-testid="archivable-value-delete-confirmation">
            <p>{question}</p>
            <p className="mt-3 font-medium text-gray-900">
              {translator.translateText(DELETE_CHANGES_INTRO)}
            </p>
            <UsageGroups groups={groups} showLabels={true} />
            {closing ? (
              <p className="mt-3">{translator.translateText(closing)}</p>
            ) : (
              <></>
            )}
          </div>
        ),
        isDeleteBlocked: refused,
        alternative: canArchiveInstead
          ? {
              title: ARCHIVE_INSTEAD,
              onClick: async (): Promise<void> => {
                await setArchived(item, true);
              },
            }
          : undefined,
      };
    };
  };

  /*
   * Bulk Actions > Delete: what deleting the selected values would do, read
   * when its dialog opens, and the values records still have left out of
   * the run with why - one set for each list, as only one dialog is open at
   * a time. See ArchivableValuesBulkDeleteDetails.
   */
  const liveRefusedIds: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );
  const archivedRefusedIds: MutableRefObject<Set<string>> = useRef<
    Set<string>
  >(new Set<string>());

  const getBulkActions: (isArchivedList: boolean) => BulkActionProps<T> = (
    isArchivedList: boolean,
  ): BulkActionProps<T> => {
    const refusedIds: MutableRefObject<Set<string>> = isArchivedList
      ? archivedRefusedIds
      : liveRefusedIds;

    return {
      buttons: [],
      deleteConfirmationDetails: (
        items: Array<T>,
        controls: BulkActionConfirmControls,
      ): ReactElement => {
        // A new dialog: nothing is known to be refused until it is read.
        refusedIds.current = new Set<string>();

        return (
          <ArchivableValuesBulkDeleteDetails
            modelType={data.modelType}
            items={items}
            controls={controls}
            isArchivedList={isArchivedList}
            onRefusedValueIds={(valueIds: Array<string>) => {
              refusedIds.current = new Set<string>(valueIds);
            }}
          />
        );
      },
      getDeleteRefusal: (item: T): string | undefined => {
        const id: ObjectID | null = readId(item);

        return id && refusedIds.current.has(id.toString().toLowerCase())
          ? translator.translateText(BULK_DELETE_REFUSAL_REASON)
          : undefined;
      },
      // The counts the page keeps - archived, live - read again.
      onDeleteEnd: refresh,
    };
  };

  const archivedColumns: Columns<T> = [
    {
      field: { name: true } as never,
      title: "Name",
      type: FieldType.Text,
      isNotCustomizable: true,
      getElement: (item: T): ReactElement => {
        if (data.getNameElement) {
          return data.getNameElement(item);
        }

        return (
          <Pill
            isMinimal={true}
            color={(item.getColumnValue("color") as Color) || Gray500}
            text={readName(item)}
          />
        );
      },
    },
    ...getArchivedColumns<T>(),
  ];

  const archiveDialogName: string = archiveDialog
    ? readName(archiveDialog.item)
    : "";

  const element: ReactElement = (
    <>
      {archivedCount > 0 ? (
        <div className="mt-5" data-testid={ARCHIVED_SECTION_TEST_ID}>
          <FoldedSection
            title={copy.archivedTitle}
            icon={IconProp.Archive}
            description={copy.archivedDescription}
            summary={copy.archivedDescription}
            badge={translator.translateTemplate(ARCHIVED_COUNT, {
              count: translator.formatNumber(archivedCount),
            })}
            defaultCollapsed={true}
            isElevated={true}
            isBodyFlush={true}
          >
            <CardSections>
              <ModelTable<T>
                modelType={data.modelType}
                singularName={data.singularName}
                pluralName={data.pluralName}
                id={`${definition.tableName}-archived-table`}
                userPreferencesKey={`${definition.tableName}-archived-table`}
                name={`${copy.archivedTitle}`}
                /*
                 * A section of the fold (CardSections), never a framed table
                 * inside it. The fold's header names it, so the section
                 * draws no header of its own: the table starts under the
                 * fold's divider.
                 */
                cardProps={{ title: "", description: "", isHeaderHidden: true }}
                query={{ [ARCHIVED_COLUMN]: true } as never}
                isDeleteable={true}
                isEditable={false}
                isCreateable={false}
                showViewIdButton={true}
                disableColumnCustomization={true}
                refreshToggle={refreshToggle}
                sortBy={"archivedAt" as keyof T}
                sortOrder={SortOrder.Descending}
                selectMoreFields={
                  { color: true, ...(data.nameSelect || {}) } as never
                }
                actionButtons={[unarchiveAction]}
                getDeleteConfirmation={getDeleteConfirmationFor(true)}
                bulkActions={getBulkActions(true)}
                onItemDeleted={() => {
                  refresh();
                }}
                filters={[]}
                columns={archivedColumns}
              />
            </CardSections>
          </FoldedSection>
        </div>
      ) : (
        <></>
      )}

      {archiveDialog ? (
        <ConfirmModal
          title={translator.translateTemplate(ARCHIVE_DIALOG_TITLE, {
            name:
              archiveDialogName ||
              data.singularName ||
              model.singularName ||
              "",
          })}
          description={
            <div data-testid="archivable-value-archive-confirmation">
              <p>{translator.translateText(copy.archiveMessage)}</p>
              {archiveDialog.usage === null ? (
                <InlineLoadingLine
                  className="mt-3"
                  text={CHECKING_WHAT_USES_IT}
                  dataTestId="archivable-value-checking"
                />
              ) : (
                <>
                  {archiveDialog.usage.settings.length > 0 ? (
                    <>
                      <p className="mt-3 font-medium text-gray-900">
                        {translator.translateText(STILL_SET_UP_TO_USE_IT)}
                      </p>
                      <UsageList
                        items={archiveDialog.usage.settings}
                        dataTestId="archivable-value-still-used-by"
                      />
                    </>
                  ) : (
                    <></>
                  )}
                  <PersonalUsageNotes
                    type={data.type}
                    people={archiveDialog.usage.people}
                    getOwnSettingsRoute={(tableName: string): Route | null => {
                      return getOwnSettingsRoute(data.type, tableName);
                    }}
                  />
                </>
              )}
            </div>
          }
          isLoading={isArchiving}
          error={archiveError || undefined}
          submitButtonText={ARCHIVE_ACTION}
          submitButtonType={ButtonStyleType.PRIMARY}
          onClose={() => {
            setArchiveDialog(null);
            setArchiveError("");
          }}
          onSubmit={async () => {
            setIsArchiving(true);
            setArchiveError("");

            try {
              await setArchived(archiveDialog.item, true);
              setArchiveDialog(null);
            } catch (err) {
              setArchiveError(API.getFriendlyMessage(err));
            } finally {
              setIsArchiving(false);
            }
          }}
        />
      ) : (
        <></>
      )}
    </>
  );

  return {
    query: { [ARCHIVED_COLUMN]: false } as Query<T>,
    actionButtons: [archiveAction],
    getDeleteConfirmation: getDeleteConfirmationFor(false),
    bulkActions: getBulkActions(false),
    refreshToggle: refreshToggle,
    element: element,
  };
};

export default useArchivableValues;
