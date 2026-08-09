import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import IconProp from "../../../Types/Icon/IconProp";
import StatusPageResourceExplorerUtil, {
  StatusPageResourceGridModel,
} from "../../../Utils/StatusPage/ResourceExplorer";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Icon, { ThickProp } from "../Icon/Icon";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export interface ComponentProps {
  rowLabel: string;
  columnLabel: string;
  rowValues: Array<string>;
  columnValues: Array<string>;

  statusPageResources: Array<StatusPageResource>;

  /* See ResourceList: the monitor element lives in the dashboard. */
  getResourceElement: (statusPageResource: StatusPageResource) => ReactElement;

  isCreateable: boolean;
  isEditable: boolean;
  isDeleteable: boolean;

  onAddToCell: (rowValue: string | null, columnValue: string | null) => void;
  onEdit: (statusPageResource: StatusPageResource) => void;
  onDelete: (statusPageResource: StatusPageResource) => void;
}

/*
 * A group whose view mode is Grid, edited as the matrix it renders as on the
 * public status page: one column per column axis value, one row per row axis
 * value, and every cell a place to put monitors.
 *
 * Nothing here is chrome of its own. The group's name, its counts, its create
 * buttons and its search all live in the pane header above, exactly as they do
 * for a list group - the two are the same thing arranged differently, and an
 * operator switching a group's view mode should not find the screen around it
 * has changed too.
 */
const ResourceGrid: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const gridModel: StatusPageResourceGridModel =
    useMemo((): StatusPageResourceGridModel => {
      return StatusPageResourceExplorerUtil.buildGridModel({
        statusPageResources: props.statusPageResources,
        rowValues: props.rowValues,
        columnValues: props.columnValues,
      });
    }, [props.statusPageResources, props.rowValues, props.columnValues]);

  type RenderResourceChipFunction = (
    statusPageResource: StatusPageResource,
  ) => ReactElement;

  const renderResourceChip: RenderResourceChipFunction = (
    statusPageResource: StatusPageResource,
  ): ReactElement => {
    const name: string =
      StatusPageResourceExplorerUtil.getResourceName(statusPageResource);

    return (
      <div
        key={statusPageResource._id?.toString()}
        className="group flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs shadow-sm transition-shadow hover:shadow"
        data-testid="status-page-resource-grid-cell-item"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-gray-900">
            {props.getResourceElement(statusPageResource)}
          </div>
          {statusPageResource.displayName &&
          statusPageResource.displayName !== name ? (
            <div className="truncate text-[11px] text-gray-500">
              {statusPageResource.displayName}
            </div>
          ) : (
            <></>
          )}
        </div>

        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {props.isEditable ? (
            <Button
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.ICON}
              icon={IconProp.Edit}
              title=""
              tooltip="Edit this resource"
              ariaLabel={`Edit ${name}`}
              dataTestId="status-page-resource-grid-edit"
              className="text-gray-400 hover:bg-gray-200 hover:text-gray-700"
              onClick={() => {
                props.onEdit(statusPageResource);
              }}
            />
          ) : (
            <></>
          )}

          {props.isDeleteable ? (
            <Button
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.ICON}
              icon={IconProp.Trash}
              title=""
              tooltip="Remove this resource from the status page"
              ariaLabel={`Remove ${name}`}
              dataTestId="status-page-resource-grid-delete"
              className="text-gray-400 hover:bg-red-50 hover:text-red-600"
              onClick={() => {
                props.onDelete(statusPageResource);
              }}
            />
          ) : (
            <></>
          )}
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
    const cell: Array<StatusPageResource> =
      gridModel.resourcesByCellKey.get(
        StatusPageResourceExplorerUtil.getGridCellKey(rowValue, columnValue),
      ) || [];

    return (
      <div className="flex min-h-[3.25rem] flex-col gap-1.5">
        {cell.map((statusPageResource: StatusPageResource) => {
          return renderResourceChip(statusPageResource);
        })}

        {props.isCreateable ? (
          <button
            type="button"
            aria-label={`Add a monitor to ${rowValue} and ${columnValue}`}
            data-testid="status-page-resource-grid-cell-add"
            onClick={() => {
              props.onAddToCell(rowValue, columnValue);
            }}
            className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 py-1.5 text-xs text-gray-500 transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          >
            <Icon
              icon={IconProp.Add}
              className="h-3.5 w-3.5"
              thick={ThickProp.Thick}
            />
            <span>{cell.length > 0 ? "Add" : "Add monitor"}</span>
          </button>
        ) : (
          <></>
        )}
      </div>
    );
  };

  if (props.rowValues.length === 0 || props.columnValues.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600"
        data-testid="status-page-resource-grid-no-axes"
      >
        This group is laid out as a grid, but it has no axes yet. Set its{" "}
        <span className="font-medium">{props.rowLabel.toLowerCase()}</span> and{" "}
        <span className="font-medium">{props.columnLabel.toLowerCase()}</span>{" "}
        values on the Groups tab, then come back to fill the cells in.
      </div>
    );
  }

  return (
    <div data-testid="status-page-resource-grid">
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 rounded-tl-lg border-b border-r border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {props.rowLabel}
              </th>
              {props.columnValues.map((columnValue: string) => {
                return (
                  <th
                    key={columnValue}
                    className="min-w-[13rem] border-b border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {columnValue}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {props.rowValues.map((rowValue: string) => {
              return (
                <tr key={rowValue}>
                  <th className="sticky left-0 z-10 border-b border-r border-gray-200 bg-white px-3 py-3 text-left align-top text-xs font-semibold text-gray-800">
                    {rowValue}
                  </th>
                  {props.columnValues.map((columnValue: string) => {
                    return (
                      <td
                        key={columnValue}
                        className="border-b border-gray-200 px-2 py-2 align-top"
                      >
                        {renderCell(rowValue, columnValue)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {gridModel.orphanResources.length > 0 ? (
        <div
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3"
          data-testid="status-page-resource-grid-orphans"
        >
          <div className="text-xs font-semibold text-amber-800">
            {gridModel.orphanResources.length.toLocaleString()} resource
            {gridModel.orphanResources.length === 1 ? "" : "s"} are not on the
            grid
          </div>
          <p className="mt-0.5 text-xs text-amber-700">
            Their {props.rowLabel.toLowerCase()} or{" "}
            {props.columnLabel.toLowerCase()} is not one this group defines, so
            visitors never see them. Edit each one to put it in a cell.
          </p>

          <div className="mt-3 flex flex-col gap-2">
            {gridModel.orphanResources.map(
              (statusPageResource: StatusPageResource) => {
                const name: string =
                  StatusPageResourceExplorerUtil.getResourceName(
                    statusPageResource,
                  );

                return (
                  <div
                    key={statusPageResource._id?.toString()}
                    className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs"
                    data-testid="status-page-resource-grid-orphan"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-gray-900">
                        {props.getResourceElement(statusPageResource)}
                      </div>
                      <div className="truncate text-gray-500">
                        {props.rowLabel}:{" "}
                        {statusPageResource.rowAxisValue || "—"} ·{" "}
                        {props.columnLabel}:{" "}
                        {statusPageResource.columnAxisValue || "—"}
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-0.5">
                      {props.isEditable ? (
                        <Button
                          buttonSize={ButtonSize.Small}
                          buttonStyle={ButtonStyleType.ICON}
                          icon={IconProp.Edit}
                          title=""
                          tooltip="Put this resource on the grid"
                          ariaLabel={`Edit ${name}`}
                          className="text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                          onClick={() => {
                            props.onEdit(statusPageResource);
                          }}
                        />
                      ) : (
                        <></>
                      )}

                      {props.isDeleteable ? (
                        <Button
                          buttonSize={ButtonSize.Small}
                          buttonStyle={ButtonStyleType.ICON}
                          icon={IconProp.Trash}
                          title=""
                          tooltip="Remove this resource from the status page"
                          ariaLabel={`Remove ${name}`}
                          className="text-gray-400 hover:bg-red-50 hover:text-red-600"
                          onClick={() => {
                            props.onDelete(statusPageResource);
                          }}
                        />
                      ) : (
                        <></>
                      )}
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ResourceGrid;
