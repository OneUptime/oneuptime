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
import IsolatedLine from "../IsolatedText/IsolatedLine";
import IsolatedText from "../IsolatedText/IsolatedText";
import InlineSeparator from "../InlineSeparator/InlineSeparator";
import {
  RESOURCE_CHIP_NAME_CLASS_NAME,
  RESOURCE_CHIP_TEXT_CLASS_NAME,
} from "./ResourceNameClassNames";
import {
  getResourceGridClassNames,
  RESOURCE_GRID_CHIP_ACTIONS_CLASS_NAME,
  RESOURCE_GRID_CHIP_CLASS_NAME,
  ResourceGridClassNames,
} from "./ResourceGridLayout";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  getInlineSeparator,
  translatableTerm,
  Translator,
  translationKey,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

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
 * Where a stranded resource says it is (renderAxisLine): a line that wraps
 * between its two axes, and never inside one...
 */
export const RESOURCE_GRID_ORPHAN_AXES_CLASS_NAME: string =
  "whitespace-normal text-gray-500";

/*
 * ...each axis's name and value on one line, cut short at its own end when
 * it is longer than the whole line.
 */
export const RESOURCE_GRID_ORPHAN_AXIS_CLASS_NAME: string =
  "inline-block max-w-full truncate align-top";

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
  const translator: Translator = useTranslator();
  const gridModel: StatusPageResourceGridModel =
    useMemo((): StatusPageResourceGridModel => {
      return StatusPageResourceExplorerUtil.buildGridModel({
        statusPageResources: props.statusPageResources,
        rowValues: props.rowValues,
        columnValues: props.columnValues,
      });
    }, [props.statusPageResources, props.rowValues, props.columnValues]);

  /*
   * A matrix where this many columns fit the grid's box, a stack where they
   * would scroll sideways (ResourceGridLayout).
   */
  const layout: ResourceGridClassNames = getResourceGridClassNames(
    props.columnValues.length,
  );

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
          ariaLabel={translator.translateTemplate("Select {{name}}", {
            name: name,
          })}
          hoverText={translator.translateTemplate("Select {{name}}", {
            name: name,
          })}
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
            ariaLabel={translator.translateTemplate("Edit {{name}}", {
              name: name,
            })}
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
          text={translator.translateTemplate("More actions for {{name}}", {
            name: name,
          })}
          menuIcon={IconProp.EllipsisHorizontal}
          isMenuPortaled={true}
          elementToBeShownInsteadOfButton={
            <button
              type="button"
              aria-label={translator.translateTemplate(
                "More actions for {{name}}",
                {
                  name: name,
                },
              )}
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
        className={`${RESOURCE_GRID_CHIP_CLASS_NAME} ${
          isSelected
            ? "border-indigo-300 bg-indigo-50"
            : "border-gray-200 bg-white"
        }`}
        data-testid="status-page-resource-grid-cell-item"
        data-selected={isSelected}
      >
        {renderSelect(statusPageResource)}

        {/*
         * Its words never widen the column (RESOURCE_CHIP_TEXT_CLASS_NAME):
         * a name too long for it ends in "...".
         */}
        <div
          className={RESOURCE_CHIP_TEXT_CLASS_NAME}
          data-testid="status-page-resource-grid-chip-text"
        >
          {/*
           * One line that ends in "...", as a list's row draws it: the
           * bare name's span laid out as a block that truncates, on a line
           * that reads the way the name is written.
           */}
          <div
            className={RESOURCE_CHIP_NAME_CLASS_NAME}
            title={StatusPageResourceExplorerUtil.getKnownResourceName(
              statusPageResource,
            )}
            data-testid="status-page-resource-grid-name"
          >
            {props.getResourceElement(statusPageResource)}
          </div>
          {statusPageResource.displayName &&
          statusPageResource.displayName !== name ? (
            <IsolatedLine
              text={statusPageResource.displayName}
              className="truncate text-[11px] text-gray-500"
              title={statusPageResource.displayName}
              dataTestId="status-page-resource-grid-display-name"
            />
          ) : (
            <></>
          )}
        </div>

        {renderActions({
          statusPageResource,
          editTooltip: translationKey("Edit this resource"),
          className: RESOURCE_GRID_CHIP_ACTIONS_CLASS_NAME,
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
        {/*
         * The cell's column, over its chips when the grid is a stack and
         * its column heading is not drawn (ResourceGridLayout's cellLabel).
         */}
        <div
          className={layout.cellLabel}
          data-testid="status-page-resource-grid-cell-label"
        >
          {columnValue}
        </div>

        {cell.map((statusPageResource: StatusPageResource) => {
          return renderResourceChip(statusPageResource);
        })}

        {props.isCreateable ? (
          <button
            type="button"
            aria-label={translator.translateTemplate(
              "Add a monitor to {{row}} and {{column}}",
              { row: rowValue, column: columnValue },
            )}
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
            <span>
              {translator.translateText(
                cell.length > 0 ? "Add" : "Add monitor",
              )}
            </span>
          </button>
        ) : (
          <></>
        )}
      </div>
    );
  };

  type RenderAxisLineFunction = (
    statusPageResource: StatusPageResource,
  ) => ReactElement;

  /*
   * Where a stranded resource says it is: "Region: Mars · Service: API",
   * names and values as the group and the resource were given them. A line
   * of its own that reads the way its words are written (IsolatedLine), and
   * each name and value read its own way in it (IsolatedText): on an Arabic
   * or Persian page an English line too long for its chip was cut where
   * the page's lines end, its start - "...acific · Service: Search" (#7087).
   * Now it starts at its own start, and the whole of it shows on hover. On
   * a page read the line's way it has no dir.
   *
   * Either value can be the one that keeps the resource off the grid, so
   * neither is lost to the other: where the two do not fit one line, the
   * second axis starts a line of its own (each axis an inline-block), and
   * an axis longer than its line ends in "..." at its own end. One line,
   * cut short, kept only "Region: Asia Pacific · S..." on a phone.
   */
  const renderAxisLine: RenderAxisLineFunction = (
    statusPageResource: StatusPageResource,
  ): ReactElement => {
    const rowValue: string = statusPageResource.rowAxisValue || "—";
    const columnValue: string = statusPageResource.columnAxisValue || "—";
    const line: string = `${props.rowLabel}: ${rowValue}${getInlineSeparator(translator.language)}${props.columnLabel}: ${columnValue}`;

    return (
      <IsolatedLine
        text={line}
        className={RESOURCE_GRID_ORPHAN_AXES_CLASS_NAME}
        title={line}
        dataTestId="status-page-resource-grid-orphan-axes"
      >
        <span
          className={RESOURCE_GRID_ORPHAN_AXIS_CLASS_NAME}
          data-testid="status-page-resource-grid-orphan-axis"
        >
          <IsolatedText text={props.rowLabel} />
          {": "}
          <IsolatedText text={rowValue} /> <InlineSeparator markOnly={true} />
        </span>{" "}
        <span
          className={RESOURCE_GRID_ORPHAN_AXIS_CLASS_NAME}
          data-testid="status-page-resource-grid-orphan-axis"
        >
          <IsolatedText text={props.columnLabel} />
          {": "}
          <IsolatedText text={columnValue} />
        </span>
      </IsolatedLine>
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
    <div className={layout.grid} data-testid="status-page-resource-grid">
      <div className="overflow-x-auto">
        <table className={layout.table}>
          <thead className={layout.head}>
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
          <tbody className={layout.body}>
            {props.rowValues.map((rowValue: string) => {
              return (
                <tr key={rowValue} className={layout.row}>
                  <th className={layout.rowHeading}>{rowValue}</th>
                  {props.columnValues.map((columnValue: string) => {
                    return (
                      <td key={columnValue} className={layout.cell}>
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
            {translator.translatePlural(
              {
                one: "{{count}} resource is not on the grid",
                other: "{{count}} resources are not on the grid",
              },
              gridModel.orphanResources.length,
            )}
          </div>
          <p className="mt-0.5 text-xs text-amber-700">
            {translator.translateTemplate(
              "Their {{row}} or {{column}} is not one this group defines, so visitors never see them. Edit each one to put it in a cell.",
              {
                row: translatableTerm(props.rowLabel, { inSentence: true }),
                column: translatableTerm(props.columnLabel, {
                  inSentence: true,
                }),
              },
            )}
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
                      <div
                        className={RESOURCE_CHIP_NAME_CLASS_NAME}
                        title={StatusPageResourceExplorerUtil.getKnownResourceName(
                          statusPageResource,
                        )}
                        data-testid="status-page-resource-grid-orphan-name"
                      >
                        {props.getResourceElement(statusPageResource)}
                      </div>
                      {renderAxisLine(statusPageResource)}
                    </div>

                    {renderActions({
                      statusPageResource,
                      editTooltip: translationKey(
                        "Put this resource on the grid",
                      ),
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
