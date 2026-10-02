import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import IconProp from "../../../Types/Icon/IconProp";
import StatusPageResourceExplorerUtil, {
  StatusPageResourceGridModel,
} from "../../../Utils/StatusPage/ResourceExplorer";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import CheckboxElement from "../Checkbox/Checkbox";
import Icon, { ThickProp } from "../Icon/Icon";
import MoreMenu from "../MoreMenu/MoreMenu";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
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

  /*
   * See ResourceList: a checkbox whose only action is removing, so it is drawn
   * only for somebody who may remove. A grid group is the same resources as a
   * list group in a different arrangement, and clearing twenty seven of them
   * one at a time is no better here than it is there (issue #3419) - so the
   * chips carry the same box the rows do, and the bulk bar the pane draws above
   * is shared between the two.
   */
  isSelectable: boolean;
  selectedResourceIds: Set<string>;
  onToggleResourceSelected: (statusPageResource: StatusPageResource) => void;

  onAddToCell: (rowValue: string | null, columnValue: string | null) => void;
  onEdit: (statusPageResource: StatusPageResource) => void;
  onDelete: (statusPageResource: StatusPageResource) => void;
  /*
   * See ResourceList: a list row's ⋯ menu offers the resource's id, and a grid
   * chip is the same resource, so its menu offers it too.
   */
  onShowId: (statusPageResource: StatusPageResource) => void;
}

/*
 * The chip's actions fade in on hover and on keyboard focus, so a cell full of
 * monitors reads as names rather than as a column of icons. Neither of those
 * holds while the ⋯ menu is open, though: the menu is drawn in the body, so the
 * pointer leaves the chip to reach it and focus moves into it - and the trigger
 * the menu hangs from would fade out from under it. The trigger says it is
 * expanded for as long as the menu is open, so that is what keeps it shown.
 */
const CHIP_ACTIONS_CLASS_NAME: string =
  "flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100";

/* A stranded resource needs fixing, so its actions are not held back. */
const ORPHAN_ACTIONS_CLASS_NAME: string =
  "flex flex-shrink-0 items-center gap-0.5";

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

  type IsResourceSelectedFunction = (
    statusPageResource: StatusPageResource,
  ) => boolean;

  const isResourceSelected: IsResourceSelectedFunction = (
    statusPageResource: StatusPageResource,
  ): boolean => {
    if (!props.isSelectable) {
      return false;
    }

    const resourceId: string | null =
      StatusPageResourceExplorerUtil.getResourceId(statusPageResource);

    return Boolean(resourceId && props.selectedResourceIds.has(resourceId));
  };

  type RenderSelectFunction = (
    statusPageResource: StatusPageResource,
  ) => ReactElement;

  const renderSelect: RenderSelectFunction = (
    statusPageResource: StatusPageResource,
  ): ReactElement => {
    if (!props.isSelectable) {
      return <></>;
    }

    const resourceId: string | null =
      StatusPageResourceExplorerUtil.getResourceId(statusPageResource);
    const name: string =
      StatusPageResourceExplorerUtil.getResourceName(statusPageResource);

    return (
      <span
        className="flex flex-shrink-0 items-center"
        data-testid="status-page-resource-grid-select"
      >
        <CheckboxElement
          value={isResourceSelected(statusPageResource)}
          disabled={!resourceId}
          ariaLabel={`Select ${name}`}
          hoverText={`Select ${name}`}
          onChange={() => {
            props.onToggleResourceSelected(statusPageResource);
          }}
        />
      </span>
    );
  };

  type RenderActionsFunction = (data: {
    statusPageResource: StatusPageResource;
    editTooltip: string;
    className: string;
  }) => ReactElement;

  /*
   * The same two controls a list row carries, so that switching a group's view
   * mode moves its resources around without changing what can be done to them
   * or where: edit stays one click away, and everything else - the id, and the
   * removal that deserves a moment's thought - waits behind ⋯.
   *
   * The menu is portalled because the grid scrolls sideways inside an
   * overflow-x-auto box, which would clip a menu opened under a chip in the
   * bottom row, or under one in the last column.
   */
  const renderActions: RenderActionsFunction = (data: {
    statusPageResource: StatusPageResource;
    editTooltip: string;
    className: string;
  }): ReactElement => {
    const statusPageResource: StatusPageResource = data.statusPageResource;
    const name: string =
      StatusPageResourceExplorerUtil.getResourceName(statusPageResource);

    const menuItems: Array<ReactElement> = [
      <MoreMenuItem
        key="show-id"
        text="Show ID"
        icon={IconProp.Identification}
        onClick={() => {
          props.onShowId(statusPageResource);
        }}
      />,
    ];

    if (props.isDeleteable) {
      menuItems.push(
        <MoreMenuItem
          key="delete"
          text="Remove from status page"
          icon={IconProp.Trash}
          isDestructive={true}
          onClick={() => {
            props.onDelete(statusPageResource);
          }}
        />,
      );
    }

    return (
      <div
        className={data.className}
        data-testid="status-page-resource-grid-actions"
      >
        {props.isEditable ? (
          <Button
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.ICON}
            icon={IconProp.Edit}
            title=""
            tooltip={data.editTooltip}
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

        <MoreMenu
          text={`More actions for ${name}`}
          menuIcon={IconProp.EllipsisHorizontal}
          isMenuPortaled={true}
          elementToBeShownInsteadOfButton={
            <button
              type="button"
              aria-label={`More actions for ${name}`}
              data-testid="status-page-resource-grid-more"
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <Icon icon={IconProp.EllipsisHorizontal} className="h-5 w-5" />
            </button>
          }
        >
          {menuItems}
        </MoreMenu>
      </div>
    );
  };

  type RenderResourceChipFunction = (
    statusPageResource: StatusPageResource,
  ) => ReactElement;

  const renderResourceChip: RenderResourceChipFunction = (
    statusPageResource: StatusPageResource,
  ): ReactElement => {
    const name: string =
      StatusPageResourceExplorerUtil.getResourceName(statusPageResource);

    const isSelected: boolean = isResourceSelected(statusPageResource);

    return (
      <div
        key={statusPageResource._id?.toString()}
        className={`group flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs shadow-sm transition-shadow hover:shadow ${
          isSelected
            ? "border-indigo-300 bg-indigo-50"
            : "border-gray-200 bg-white"
        }`}
        data-testid="status-page-resource-grid-cell-item"
        data-selected={isSelected}
      >
        {renderSelect(statusPageResource)}

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

        {renderActions({
          statusPageResource,
          editTooltip: "Edit this resource",
          className: CHIP_ACTIONS_CLASS_NAME,
        })}
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

  /*
   * A grid with no axes has no cells to draw, and nothing useful to say that
   * the caller has not already said: the pane that mounts this owns the "this
   * group has no rows or columns yet" notice, because it is the thing that can
   * offer the button which fixes it. Two boxes explaining the same emptiness is
   * worse than one.
   */
  if (props.rowValues.length === 0 || props.columnValues.length === 0) {
    return <span data-testid="status-page-resource-grid-no-axes" />;
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
                return (
                  <div
                    key={statusPageResource._id?.toString()}
                    className={`flex items-center justify-between gap-2 rounded-lg border border-amber-200 px-3 py-2 text-xs ${
                      isResourceSelected(statusPageResource)
                        ? "bg-indigo-50"
                        : "bg-white"
                    }`}
                    data-testid="status-page-resource-grid-orphan"
                    data-selected={isResourceSelected(statusPageResource)}
                  >
                    {renderSelect(statusPageResource)}

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

                    {renderActions({
                      statusPageResource,
                      editTooltip: "Put this resource on the grid",
                      className: ORPHAN_ACTIONS_CLASS_NAME,
                    })}
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
