import MonitorElement from "../Monitor/Monitor";
import MonitorGroupElement from "../MonitorGroup/MonitorGroupElement";
import BulkAddStatusPageMonitorsModal from "./BulkAddStatusPageMonitorsModal";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModelField, FormType } from "Common/UI/Components/Forms/ModelForm";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon, { ThickProp } from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  group: StatusPageGroup;
  statusPageId: ObjectID;
  projectId: ObjectID;
  canCreateStatusPageResource: boolean;
  baseFormFields: Array<ModelField<StatusPageResource>>;
  formSteps: Array<FormStep<StatusPageResource>>;
  /*
   * How many resources this group turned out to hold, reported on every fetch.
   * The tree above uses it to keep the count on this group's collapsed row
   * honest without re-reading every resource on the status page.
   */
  onResourceCountLoaded?: ((count: number) => void) | undefined;
  testId?: string | undefined;
}

type ParseAxisValuesFunction = (raw?: string | null) => Array<string>;

const parseAxisValues: ParseAxisValuesFunction = (
  raw?: string | null,
): Array<string> => {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value: string): string => {
      return value.trim();
    })
    .filter((value: string): boolean => {
      return value.length > 0;
    });
};

/*
 * A group whose view mode is Grid, edited as the matrix it renders as on the
 * public status page: one column per column axis value, one row per row axis
 * value, and every cell a place to drop monitors into.
 *
 * Like the list panel next to it, this is mounted only while its row in the
 * Resources tree is open - it fetches on mount, and a status page with fifteen
 * hundred groups cannot afford to have every one of those fetches happen at
 * once (issue #3042).
 */
const GridResourceEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { group, statusPageId, projectId, baseFormFields } = props;

  const groupId: ObjectID | undefined = group.id || undefined;

  const rowValues: Array<string> = useMemo((): Array<string> => {
    return parseAxisValues(group.rowAxisValues);
  }, [group.rowAxisValues]);

  const columnValues: Array<string> = useMemo((): Array<string> => {
    return parseAxisValues(group.columnAxisValues);
  }, [group.columnAxisValues]);

  const rowLabel: string = group.rowAxisLabel || "Row";
  const columnLabel: string = group.columnAxisLabel || "Column";

  const [resources, setResources] = useState<Array<StatusPageResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [createModalState, setCreateModalState] = useState<{
    isOpen: boolean;
    rowValue: string | null;
    columnValue: string | null;
  }>({
    isOpen: false,
    rowValue: null,
    columnValue: null,
  });

  const [editResourceId, setEditResourceId] = useState<ObjectID | null>(null);
  const [deleteResource, setDeleteResource] =
    useState<StatusPageResource | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");
  const [showBulkAddModal, setShowBulkAddModal] = useState<boolean>(false);

  const fetchResources: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      const listResult: ListResult<StatusPageResource> =
        await ModelAPI.getList<StatusPageResource>({
          modelType: StatusPageResource,
          query: {
            statusPageId: statusPageId,
            projectId: projectId,
            statusPageGroupId: groupId!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            displayName: true,
            rowAxisValue: true,
            columnAxisValue: true,
            order: true,
            monitor: {
              _id: true,
              name: true,
              projectId: true,
            },
            monitorGroup: {
              _id: true,
              name: true,
              projectId: true,
            },
          },
          sort: {
            order: SortOrder.Ascending,
          },
          requestOptions: {},
        });

      setResources(listResult.data);

      if (props.onResourceCountLoaded) {
        props.onResourceCountLoaded(listResult.data.length);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchResources().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [groupId?.toString()]);

  type ReloadFunction = () => void;

  const reload: ReloadFunction = (): void => {
    fetchResources().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  };

  type ResourcesByCell = Map<string, Array<StatusPageResource>>;
  type CellKey = (row: string, col: string) => string;

  /*
   * A NUL separator rather than a space or a dash: axis values are free text,
   * so any separator an operator could type would let ("A B", "C") and
   * ("A", "B C") collapse into the same cell.
   */
  const cellKey: CellKey = (row: string, col: string): string => {
    return `${row}\u0000${col}`;
  };

  const resourcesByCell: ResourcesByCell = useMemo((): ResourcesByCell => {
    const map: ResourcesByCell = new Map();
    for (const resource of resources) {
      const r: string = resource.rowAxisValue || "";
      const c: string = resource.columnAxisValue || "";
      if (!r || !c || !rowValues.includes(r) || !columnValues.includes(c)) {
        continue;
      }
      const key: string = cellKey(r, c);
      const list: Array<StatusPageResource> = map.get(key) || [];
      list.push(resource);
      map.set(key, list);
    }
    return map;
  }, [resources, rowValues, columnValues]);

  const orphanResources: Array<StatusPageResource> =
    useMemo((): Array<StatusPageResource> => {
      return resources.filter((resource: StatusPageResource): boolean => {
        const r: string = resource.rowAxisValue || "";
        const c: string = resource.columnAxisValue || "";
        return !r || !c || !rowValues.includes(r) || !columnValues.includes(c);
      });
    }, [resources, rowValues, columnValues]);

  const buildFormFields: () => Array<
    ModelField<StatusPageResource>
  > = (): Array<ModelField<StatusPageResource>> => {
    const rowOptions: Array<{ label: string; value: string }> = rowValues.map(
      (v: string) => {
        return { label: v, value: v };
      },
    );
    const colOptions: Array<{ label: string; value: string }> =
      columnValues.map((v: string) => {
        return { label: v, value: v };
      });

    const rowField: ModelField<StatusPageResource> = {
      field: {
        rowAxisValue: true,
      },
      title: `${rowLabel} (Row)`,
      description: `Row this resource belongs to in the grid.`,
      fieldType:
        rowOptions.length > 0
          ? FormFieldSchemaType.Dropdown
          : FormFieldSchemaType.Text,
      dropdownOptions: rowOptions.length > 0 ? rowOptions : undefined,
      required: true,
      placeholder:
        rowOptions.length > 0
          ? `Select ${rowLabel.toLowerCase()}`
          : `Define rows on the group first`,
      stepId: "monitor-details",
    };

    const colField: ModelField<StatusPageResource> = {
      field: {
        columnAxisValue: true,
      },
      title: `${columnLabel} (Column)`,
      description: `Column this resource belongs to in the grid.`,
      fieldType:
        colOptions.length > 0
          ? FormFieldSchemaType.Dropdown
          : FormFieldSchemaType.Text,
      dropdownOptions: colOptions.length > 0 ? colOptions : undefined,
      required: true,
      placeholder:
        colOptions.length > 0
          ? `Select ${columnLabel.toLowerCase()}`
          : `Define columns on the group first`,
      stepId: "monitor-details",
    };

    return [...baseFormFields, rowField, colField];
  };

  const formFields: Array<ModelField<StatusPageResource>> = buildFormFields();

  const onBeforeCreate: (
    item: StatusPageResource,
  ) => Promise<StatusPageResource> = (
    item: StatusPageResource,
  ): Promise<StatusPageResource> => {
    if (!projectId) {
      throw new BadDataException("Project ID cannot be null");
    }
    item.statusPageId = statusPageId;
    item.projectId = projectId;
    if (groupId) {
      item.statusPageGroupId = groupId;
    }
    return Promise.resolve(item);
  };

  const closeCreateModal: () => void = (): void => {
    setCreateModalState({ isOpen: false, rowValue: null, columnValue: null });
  };

  const openCreateForCell: (row: string | null, col: string | null) => void = (
    row: string | null,
    col: string | null,
  ): void => {
    setCreateModalState({ isOpen: true, rowValue: row, columnValue: col });
  };

  const onDeleteConfirm: () => Promise<void> = async (): Promise<void> => {
    if (!deleteResource || !deleteResource.id) {
      return;
    }
    setIsDeleting(true);
    setDeleteError("");
    try {
      await ModelAPI.deleteItem<StatusPageResource>({
        modelType: StatusPageResource,
        id: deleteResource.id,
      });
      setDeleteResource(null);
      await fetchResources();
    } catch (err) {
      setDeleteError(API.getFriendlyMessage(err));
    }
    setIsDeleting(false);
  };

  const hasGridAxes: boolean = rowValues.length > 0 && columnValues.length > 0;

  type GetToolbarFunction = () => ReactElement;

  const getToolbar: GetToolbarFunction = (): ReactElement => {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
        <p className="text-xs text-gray-500">
          {hasGridAxes
            ? `Click any cell to add a monitor at that ${rowLabel.toLowerCase()} × ${columnLabel.toLowerCase()} intersection.`
            : "This group is set to grid view but has no axes yet."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {props.canCreateStatusPageResource && hasGridAxes ? (
            <>
              <Button
                title="Add Monitor"
                icon={IconProp.Add}
                buttonSize={ButtonSize.Small}
                buttonStyle={ButtonStyleType.PRIMARY}
                dataTestId="add-resource-to-grid"
                onClick={() => {
                  openCreateForCell(null, null);
                }}
              />
              <Button
                title="Add Multiple"
                icon={IconProp.Add}
                buttonSize={ButtonSize.Small}
                buttonStyle={ButtonStyleType.OUTLINE}
                dataTestId="bulk-add-resources-to-grid"
                onClick={() => {
                  setShowBulkAddModal(true);
                }}
              />
            </>
          ) : (
            <></>
          )}
          <Button
            title="Refresh"
            icon={IconProp.Refresh}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            dataTestId="refresh-grid-resources"
            onClick={() => {
              reload();
            }}
          />
        </div>
      </div>
    );
  };

  type RenderCellFunction = (
    rowValue: string,
    columnValue: string,
  ) => ReactElement;

  const renderCell: RenderCellFunction = (
    rowValue: string,
    columnValue: string,
  ): ReactElement => {
    const list: Array<StatusPageResource> =
      resourcesByCell.get(cellKey(rowValue, columnValue)) || [];

    return (
      <div className="flex min-h-[3.25rem] flex-col gap-1.5">
        {list.map((resource: StatusPageResource) => {
          return (
            <div
              key={resource.id?.toString()}
              className="group flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs shadow-sm transition-shadow hover:shadow"
              data-testid="grid-resource-cell-item"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-gray-900">
                  {resource.monitor ? (
                    <MonitorElement
                      monitor={resource.monitor}
                      showIcon={false}
                    />
                  ) : resource.monitorGroup ? (
                    <MonitorGroupElement
                      monitorGroup={resource.monitorGroup}
                      showIcon={false}
                    />
                  ) : (
                    <span className="text-gray-400">Unknown</span>
                  )}
                </div>
                {resource.displayName ? (
                  <div className="truncate text-[11px] text-gray-500">
                    {resource.displayName}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  title="Edit"
                  aria-label="Edit resource"
                  className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                  onClick={() => {
                    if (resource.id) {
                      setEditResourceId(resource.id);
                    }
                  }}
                >
                  <Icon icon={IconProp.Edit} className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete"
                  aria-label="Delete resource"
                  className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600"
                  onClick={() => {
                    setDeleteResource(resource);
                  }}
                >
                  <Icon icon={IconProp.Trash} className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          aria-label={`Add monitor to ${rowValue} and ${columnValue}`}
          data-testid="grid-cell-add-monitor"
          onClick={() => {
            openCreateForCell(rowValue, columnValue);
          }}
          className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 py-1.5 text-xs text-gray-500 transition-colors hover:border-indigo-400 hover:bg-indigo-50/60 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
        >
          <Icon
            icon={IconProp.Add}
            className="h-3.5 w-3.5"
            thick={ThickProp.Thick}
          />
          <span>{list.length > 0 ? "Add" : "Add monitor"}</span>
        </button>
      </div>
    );
  };

  const initialValuesForCreate: FormValues<StatusPageResource> =
    useMemo((): FormValues<StatusPageResource> => {
      const v: FormValues<StatusPageResource> =
        {} as FormValues<StatusPageResource>;
      if (createModalState.rowValue) {
        (v as any).rowAxisValue = createModalState.rowValue;
      }
      if (createModalState.columnValue) {
        (v as any).columnAxisValue = createModalState.columnValue;
      }
      return v;
    }, [createModalState.rowValue, createModalState.columnValue]);

  type GetBodyFunction = () => ReactElement;

  const getBody: GetBodyFunction = (): ReactElement => {
    if (!hasGridAxes) {
      return (
        <div className="px-4 py-6">
          <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600">
            Define <span className="font-medium">{rowLabel.toLowerCase()}</span>{" "}
            values and{" "}
            <span className="font-medium">{columnLabel.toLowerCase()}</span>{" "}
            values on this group before adding resources to the grid. You can
            set them on the Groups tab.
          </div>
        </div>
      );
    }

    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    return (
      <>
        <div className="overflow-x-auto px-4 py-3">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 rounded-tl-lg border-b border-r border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  {rowLabel}
                </th>
                {columnValues.map((col: string) => {
                  return (
                    <th
                      key={col}
                      className="min-w-[13rem] border-b border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500"
                    >
                      {col}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rowValues.map((row: string) => {
                return (
                  <tr key={row}>
                    <th className="sticky left-0 z-10 border-b border-r border-gray-200 bg-white px-3 py-3 text-left align-top text-xs font-semibold text-gray-800">
                      {row}
                    </th>
                    {columnValues.map((col: string) => {
                      return (
                        <td
                          key={col}
                          className="border-b border-gray-200 px-2 py-2 align-top"
                        >
                          {renderCell(row, col)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {orphanResources.length > 0 ? (
          <div className="border-t border-gray-100 px-4 py-4">
            <div className="mb-2 text-xs font-semibold text-amber-700">
              Unassigned resources ({orphanResources.length})
            </div>
            <div className="mb-3 text-xs text-gray-500">
              These resources do not match a defined {rowLabel.toLowerCase()} or{" "}
              {columnLabel.toLowerCase()}. Edit them to place them on the grid.
            </div>
            <div className="flex flex-col gap-2">
              {orphanResources.map((resource: StatusPageResource) => {
                return (
                  <div
                    key={resource.id?.toString()}
                    className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900">
                        {resource.monitor ? (
                          <MonitorElement
                            monitor={resource.monitor}
                            showIcon={false}
                          />
                        ) : resource.monitorGroup ? (
                          <MonitorGroupElement
                            monitorGroup={resource.monitorGroup}
                            showIcon={false}
                          />
                        ) : (
                          /*
                           * A resource whose monitor was deleted still has to
                           * be identifiable - its display name is the only
                           * handle left on it, and this list exists to be
                           * acted on.
                           */
                          <span>{resource.displayName || "Unknown"}</span>
                        )}
                      </div>
                      <div className="text-gray-600">
                        {rowLabel}: {resource.rowAxisValue || "—"} ·{" "}
                        {columnLabel}: {resource.columnAxisValue || "—"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        title="Edit"
                        icon={IconProp.Edit}
                        buttonSize={ButtonSize.Small}
                        buttonStyle={ButtonStyleType.NORMAL}
                        onClick={() => {
                          if (resource.id) {
                            setEditResourceId(resource.id);
                          }
                        }}
                      />
                      <Button
                        title="Delete"
                        icon={IconProp.Trash}
                        buttonSize={ButtonSize.Small}
                        buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                        onClick={() => {
                          setDeleteResource(resource);
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </>
    );
  };

  return (
    /*
     * The same surface a Card draws, because the list panel next to this one
     * is a Card and the two sit in identical rows of the same tree - a grid
     * group that looked like a different kind of thing would be reporting a
     * difference that is not there.
     */
    <div
      className="mb-5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      data-testid={props.testId || "status-page-resource-grid-panel"}
    >
      {getToolbar()}
      {getBody()}

      {createModalState.isOpen ? (
        <ModelFormModal<StatusPageResource>
          modelType={StatusPageResource}
          name="Status Page > Resources"
          title="Add Monitor to Grid"
          description="Pick the monitor to show in this cell of the grid."
          modalWidth={ModalWidth.Medium}
          initialValues={initialValuesForCreate}
          onBeforeCreate={onBeforeCreate}
          formProps={{
            modelType: StatusPageResource,
            id: `create-status-page-resource-${groupId?.toString()}`,
            fields: formFields,
            steps: props.formSteps,
            formType: FormType.Create,
          }}
          onClose={closeCreateModal}
          onSuccess={() => {
            closeCreateModal();
            reload();
          }}
        />
      ) : null}

      {editResourceId ? (
        <ModelFormModal<StatusPageResource>
          modelType={StatusPageResource}
          name="Status Page > Resources"
          title="Edit Status Page Resource"
          description="Update this resource."
          modalWidth={ModalWidth.Medium}
          modelIdToEdit={editResourceId}
          formProps={{
            modelType: StatusPageResource,
            id: `edit-status-page-resource-${groupId?.toString()}`,
            fields: formFields,
            steps: props.formSteps,
            formType: FormType.Update,
          }}
          onClose={() => {
            setEditResourceId(null);
          }}
          onSuccess={() => {
            setEditResourceId(null);
            reload();
          }}
        />
      ) : null}

      {deleteResource ? (
        <ConfirmModal
          title="Delete Status Page Resource"
          description="Are you sure you want to remove this resource from the grid? This action cannot be undone."
          submitButtonText="Delete"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isDeleting}
          error={deleteError}
          onClose={() => {
            setDeleteResource(null);
            setDeleteError("");
          }}
          onSubmit={() => {
            onDeleteConfirm().catch((err: Error) => {
              setDeleteError(API.getFriendlyMessage(err));
            });
          }}
        />
      ) : null}

      {showBulkAddModal && groupId ? (
        <BulkAddStatusPageMonitorsModal
          projectId={projectId}
          statusPageId={statusPageId}
          statusPageGroupId={groupId}
          gridPlacement={{
            rowLabel,
            rowValues,
            columnLabel,
            columnValues,
          }}
          onClose={() => {
            setShowBulkAddModal(false);
          }}
          onComplete={() => {
            reload();
          }}
        />
      ) : null}
    </div>
  );
};

export default GridResourceEditor;
