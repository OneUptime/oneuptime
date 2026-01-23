import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Icon, { SizeProp } from "../Icon/Icon";
import Item from "./Item";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import React, { ReactElement } from "react";

export interface ComponentProps<T extends GenericObject> {
  data: Array<T>;
  onCreateNewItem?: ((order: number) => void) | undefined;
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
  if (props.isLoading) {
    return <ComponentLoader />;
  }

  if (props.error) {
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
          <div className="mt-6">
            <div
              className="m-auto inline-flex items-center cursor-pointer text-gray-400 hover:bg-gray-50 border hover:text-gray-600 rounded-full border-gray-300 p-5"
              onClick={() => {
                if (props.onCreateNewItem) {
                  props.onCreateNewItem(1);
                }
              }}
            >
              <Icon icon={IconProp.Add} className="h-5 w-5" />
              <span className="text-sm ml-2">Add New {props.singularLabel}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="m-32 text-center">
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
                    <div
                      className="m-auto rounded-full items-center cursor-pointer text-gray-400 hover:bg-gray-50 hover:text-gray-600 items-center border border-gray-300 p-5 w-fit"
                      onClick={() => {
                        if (props.onCreateNewItem) {
                          props.onCreateNewItem(
                            item[props.orderField]
                              ? (item[props.orderField] as number) + 1
                              : 0,
                          );
                        }
                      }}
                    >
                      <div className="flex text-center">
                        <Icon icon={IconProp.Add} className="m-auto h-5 w-5" />{" "}
                        <span className="text-sm ml-2">Add New Item</span>
                      </div>
                    </div>

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
                    <div
                      className="m-auto items-center cursor-pointer text-gray-400 hover:bg-gray-50 border hover:text-gray-600 rounded-full border-gray-300 p-5 w-fit"
                      onClick={() => {
                        if (props.onCreateNewItem) {
                          props.onCreateNewItem(
                            item[props.orderField]
                              ? (item[props.orderField] as number) + 1
                              : 0,
                          );
                        }
                      }}
                    >
                      <div className="flex items-center ">
                        <Icon icon={IconProp.Add} className="m-auto h-5 w-5" />{" "}
                        <span className="text-sm ml-2">Add New Item</span>
                      </div>
                    </div>
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
