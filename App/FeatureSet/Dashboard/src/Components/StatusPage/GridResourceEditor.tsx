import MonitorElement from "../Monitor/Monitor";
import MonitorGroupElement from "../MonitorGroup/MonitorGroupElement";
import BulkAddStatusPageMonitorsModal from "./BulkAddStatusPageMonitorsModal";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModelField, FormType } from "Common/UI/Components/Forms/ModelForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon, { ThickProp } from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import Project from "Common/Models/DatabaseModels/Project";
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
  currentProject: Project;
  canCreateStatusPageResource: boolean;
  baseFormFields: Array<ModelField<StatusPageResource>>;
  formSteps: Array<{ title: string; id: string }>;
  /*
   * The group's ancestors and its own name - "Corporate › Region 1000". Groups
   * nest and two of them at different levels very often share a name, so the
   * Resources tab titles every section with its path. Falls back to the
   * group's own name.
   */
  groupPathLabel?: string | undefined;
  /*
   * Set by a caller that can close this editor back down to a header, which is
   * what keeps a status page with a thousand groups from mounting a thousand
   * editors. Omitted, no collapse control is shown.
   */
  onCollapse?: (() => void) | undefined;
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

const GridResourceEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { group, statusPageId, projectId, currentProject, baseFormFields } =
    props;

  const groupId: ObjectID | undefined = group.id || undefined;
  const isGrid: boolean = group.viewMode === StatusPageGroupViewMode.Grid;

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

  type ResourcesByCell = Map<string, Array<StatusPageResource>>;
  type CellKey = (row: string, col: string) => string;

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
    if (!currentProject || !currentProject._id) {
      throw new BadDataException("Project ID cannot be null");
    }
    item.statusPageId = statusPageId;
    item.projectId = new ObjectID(currentProject._id);
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

  const cardTitle: string = `${
    props.groupPathLabel || group.name || ""
  } - Status Page Resources`;
  const cardDescription: string = isGrid
    ? "Click a cell to add a monitor at that row × column intersection."
    : "Resources that will be shown on the page";

  const hasGridAxes: boolean = rowValues.length > 0 && columnValues.length > 0;
  const cardButtons: Array<CardButtonSchema | ReactElement> = [];

  if (props.canCreateStatusPageResource && hasGridAxes) {
    cardButtons.push(
      {
        title: "Create Status Page Resource",
        icon: IconProp.Add,
        buttonStyle: ButtonStyleType.NORMAL,
        onClick: () => {
          openCreateForCell(null, null);
        },
      },
      <MoreMenu
        key="status-page-grid-resource-more-menu"
        menuIcon={IconProp.EllipsisHorizontal}
        text=""
      >
        {[
          <MoreMenuItem
            key="add-multiple-monitors"
            text="Add Multiple Monitors"
            icon={IconProp.Add}
            onClick={() => {
              setShowBulkAddModal(true);
            }}
          />,
        ]}
      </MoreMenu>,
    );
  }

  if (props.onCollapse) {
    cardButtons.push({
      title: "Hide",
      icon: IconProp.ChevronUp,
      buttonStyle: ButtonStyleType.OUTLINE,
      onClick: props.onCollapse,
    });
  }

  if (rowValues.length === 0 || columnValues.length === 0) {
    return (
      <Card
        title={cardTitle}
        description={cardDescription}
        buttons={cardButtons}
      >
        <div className="p-6 text-center border border-dashed border-gray-300 rounded-md text-sm text-gray-600">
          Define <span className="font-medium">{rowLabel.toLowerCase()}</span>{" "}
          values and{" "}
          <span className="font-medium">{columnLabel.toLowerCase()}</span>{" "}
          values on this group before adding resources to the grid.
        </div>
      </Card>
    );
  }

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
      <div className="flex flex-col gap-2 min-h-[3.5rem]">
        {list.map((resource: StatusPageResource) => {
          return (
            <div
              key={resource.id?.toString()}
              className="group flex items-center justify-between gap-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-md px-2 py-1.5 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900 truncate">
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
                  <div className="text-gray-500 text-[11px] truncate">
                    {resource.displayName}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  title="Edit"
                  aria-label="Edit resource"
                  className="p-1 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800"
                  onClick={() => {
                    if (resource.id) {
                      setEditResourceId(resource.id);
                    }
                  }}
                >
                  <Icon icon={IconProp.Edit} className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete"
                  aria-label="Delete resource"
                  className="p-1 rounded hover:bg-red-100 text-gray-500 hover:text-red-600"
                  onClick={() => {
                    setDeleteResource(resource);
                  }}
                >
                  <Icon icon={IconProp.Trash} className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => {
            openCreateForCell(rowValue, columnValue);
          }}
          className="flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-dashed border-gray-300 hover:border-indigo-400 rounded-md py-1.5 transition-colors"
        >
          <Icon
            icon={IconProp.Add}
            className="w-3.5 h-3.5"
            thick={ThickProp.Thick}
          />
          <span>Add monitor</span>
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

  return (
    <>
      <Card
        title={cardTitle}
        description={cardDescription}
        buttons={cardButtons}
      >
        <>
          {isLoading ? (
            <ComponentLoader />
          ) : error ? (
            <ErrorMessage message={error} />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700">
                      {rowLabel}
                    </th>
                    {columnValues.map((col: string) => {
                      return (
                        <th
                          key={col}
                          className="border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700 min-w-[12rem]"
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
                        <th className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-3 py-3 text-left text-xs font-semibold text-gray-800 align-top">
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
          )}

          {!isLoading && !error && orphanResources.length > 0 ? (
            <div className="mt-6 border-t border-gray-200 pt-4">
              <div className="text-xs font-semibold text-amber-700 mb-2">
                Unassigned resources ({orphanResources.length})
              </div>
              <div className="text-xs text-gray-500 mb-3">
                These resources do not match a defined {rowLabel.toLowerCase()}{" "}
                or {columnLabel.toLowerCase()}. Edit them to place them on the
                grid.
              </div>
              <div className="flex flex-col gap-2">
                {orphanResources.map((resource: StatusPageResource) => {
                  return (
                    <div
                      key={resource.id?.toString()}
                      className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs"
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
                            <span>Unknown</span>
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
      </Card>

      {createModalState.isOpen ? (
        <ModelFormModal<StatusPageResource>
          modelType={StatusPageResource}
          name="Status Page > Resources"
          title="Create Status Page Resource"
          description="Add a monitor to this cell of the grid."
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
            fetchResources().catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
            });
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
            fetchResources().catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
            });
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
            fetchResources().catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
            });
          }}
        />
      ) : null}
    </>
  );
};

export default GridResourceEditor;
