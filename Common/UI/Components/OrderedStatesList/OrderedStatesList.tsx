import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Icon, { SizeProp } from "../Icon/Icon";
import Item from "./Item";
import Tooltip from "../Tooltip/Tooltip";
import Skeleton from "../Skeleton/Skeleton";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import React, { ReactElement } from "react";

export interface ComponentProps<T extends GenericObject> {
  data: Array<T>;
  onCreateNewItem?: ((order: number) => void) | undefined;
  /*
   * When set, the "Add New" affordances stay on screen but do nothing, and
   * hovering one explains why - the same treatment a locked Create button
   * gets on every other table.
   */
  createDisabledReason?: string | undefined;
  noItemsMessage?: string | ReactElement | undefined;
  error?: string | undefined;
  isLoading?: boolean | undefined;
  onRefreshClick?: (() => void) | undefined;
  singularLabel: string;
  id?: string;
  actionButtons?: undefined | Array<ActionButtonSchema<T>>;
  titleField: keyof T;
  descriptionField?: keyof T | undefined;
  orderField: keyof T;
  getTitleElement?: ((item: T) => ReactElement) | undefined;
  getDescriptionElement?: ((item: T) => ReactElement) | undefined;
  shouldAddItemInTheEnd?: boolean | undefined;
  shouldAddItemInTheBeginning?: boolean | undefined;
}

type OrderedStatesListFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const OrderedStatesList: OrderedStatesListFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  /*
   * A refetch with states already on screen keeps them visible and dims
   * them; the skeleton stack is only for a load with nothing to show yet.
   */
  const isRefetchingWithData: boolean =
    Boolean(props.isLoading) && props.data.length > 0;

  const isCreateDisabled: boolean = Boolean(props.createDisabledReason);

  type RenderAddNewFunction = (
    label: string,
    order: number,
    className: string,
    contentClassName: string,
  ) => ReactElement;

  /*
   * These are clickable <div>s rather than buttons, so "disabled" has to be
   * built by hand: drop the pointer cursor and the hover colours, ignore the
   * click, and hang the reason off a tooltip wrapper.
   */
  const renderAddNew: RenderAddNewFunction = (
    label: string,
    order: number,
    className: string,
    contentClassName: string,
  ): ReactElement => {
    const affordance: ReactElement = (
      <div
        className={`${className} ${
          isCreateDisabled
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer hover:bg-gray-50 hover:text-gray-600"
        }`}
        aria-disabled={isCreateDisabled}
        onClick={() => {
          if (isCreateDisabled) {
            return;
          }

          if (props.onCreateNewItem) {
            props.onCreateNewItem(order);
          }
        }}
      >
        <div className={contentClassName}>
          <Icon icon={IconProp.Add} className="m-auto h-5 w-5" />
          <span className="text-sm ml-2">{label}</span>
        </div>
      </div>
    );

    if (!props.createDisabledReason) {
      return affordance;
    }

    return <Tooltip text={props.createDisabledReason}>{affordance}</Tooltip>;
  };

  if (props.isLoading && props.data.length === 0) {
    /*
     * Three card-shaped placeholders where the ordered state cards will
     * land (matching Item's rounded bordered card), so the page keeps its
     * shape instead of collapsing to a centered spinner.
     */
    return (
      <div
        data-testid="ordered-states-list-skeleton-loader"
        role="status"
        aria-live="polite"
        className="m-32 text-center"
      >
        <span className="sr-only">Loading...</span>
        {[0, 1, 2].map((index: number) => {
          return (
            <div key={index} className="w-fit m-auto">
              <Skeleton className="h-32 w-64 rounded p-10" />
              {index < 2 && (
                <div className="items-center m-10">
                  <Skeleton className="m-auto h-5 w-5" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  /*
   * Loading still wins over error and empty (same priority as before the
   * skeletons): while a refetch is in flight the stale states render, never
   * a stale error or a premature "no items".
   */
  if (!props.isLoading && props.error) {
    return (
      <ErrorMessage
        message={props.error}
        onRefreshClick={props.onRefreshClick}
      />
    );
  }

  if (props.data.length === 0) {
    return (
      <div className="text-center">
        {/* Only show the no items message if there's no create button */}
        {!props.onCreateNewItem && (
          <ErrorMessage
            message={
              props.noItemsMessage
                ? props.noItemsMessage
                : `No ${props.singularLabel.toLocaleLowerCase()}`
            }
            onRefreshClick={props.onRefreshClick}
          />
        )}
        {props.onCreateNewItem && (
          <div className="my-10">
            {renderAddNew(
              `Add New ${props.singularLabel}`,
              1,
              "m-auto inline-flex items-center text-gray-400 border rounded-full border-gray-300 p-5",
              "flex items-center",
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="ordered-states-list-content"
      className={`m-32 text-center${
        isRefetchingWithData
          ? " opacity-60 pointer-events-none transition-opacity duration-150"
          : " transition-opacity duration-150"
      }`}
    >
      {props.error && <p>{props.error}</p>}
      {!props.error &&
        props.data &&
        props.data.length > 0 &&
        props.data.map((item: T, i: number) => {
          const isEnd: boolean = !(i + 1 < props.data.length);
          const isBeginning: boolean = !(i === 0);

          return (
            <div key={i} id={props.id} className="items-center w-fit m-auto">
              {props.onCreateNewItem &&
                isBeginning &&
                props.shouldAddItemInTheBeginning && (
                  <div className="text-center">
                    {renderAddNew(
                      "Add New Item",
                      item[props.orderField]
                        ? (item[props.orderField] as number) + 1
                        : 0,
                      "m-auto rounded-full items-center text-gray-400 border border-gray-300 p-5 w-fit",
                      "flex text-center",
                    )}

                    <div className="items-center m-10 ">
                      <Icon
                        icon={IconProp.ChevronDown}
                        size={SizeProp.Regular}
                        className="m-auto h-5 w-5 text-gray-500"
                      />
                    </div>
                  </div>
                )}
              <Item
                item={item}
                titleField={props.titleField}
                descriptionField={props.descriptionField}
                actionButtons={props.actionButtons}
                getTitleElement={props.getTitleElement}
                getDescriptionElement={props.getDescriptionElement}
              />
              {((isEnd && props.shouldAddItemInTheEnd) || !isEnd) && (
                <div className="vertical-list items-center m-10 ">
                  <Icon
                    icon={IconProp.ChevronDown}
                    size={SizeProp.Regular}
                    className="m-auto h-5 w-5 text-gray-500"
                  />
                </div>
              )}
              {props.onCreateNewItem &&
                ((isEnd && props.shouldAddItemInTheEnd) || !isEnd) && (
                  <div className="text-center">
                    {renderAddNew(
                      "Add New Item",
                      item[props.orderField]
                        ? (item[props.orderField] as number) + 1
                        : 0,
                      "m-auto items-center text-gray-400 border rounded-full border-gray-300 p-5 w-fit",
                      "flex items-center",
                    )}
                    {!isEnd && (
                      <div className="items-center m-10">
                        <Icon
                          icon={IconProp.ChevronDown}
                          size={SizeProp.Larger}
                          className="m-auto h-5 w-5 text-gray-500"
                        />
                      </div>
                    )}
                  </div>
                )}
            </div>
          );
        })}
    </div>
  );
};

export default OrderedStatesList;
