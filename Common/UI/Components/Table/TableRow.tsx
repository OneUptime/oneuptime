import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import CheckboxElement from "../Checkbox/Checkbox";
import ColorInput from "../ColorViewer/ColorViewer";
import Icon, { ThickProp } from "../Icon/Icon";
import ConfirmModal from "../Modal/ConfirmModal";
import FieldType from "../Types/FieldType";
import Column from "./Types/Column";
import Columns from "./Types/Columns";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import React, { ReactElement, useState, useEffect } from "react";
import { Draggable, DraggableProvided } from "react-beautiful-dnd";
import LongTextViewer from "../LongText/LongTextViewer";

export interface ComponentProps<T extends GenericObject> {
  item: T;
  columns: Columns<T>;
  actionButtons?: Array<ActionButtonSchema<T>> | undefined;
  enableDragAndDrop?: boolean | undefined;
  dragAndDropScope?: string | undefined;
  dragDropIdField?: keyof T | undefined;
  dragDropIndexField?: keyof T | undefined;

  // bulk actions
  isBulkActionsEnabled?: undefined | boolean;
  onItemSelected?: undefined | ((item: T) => void);
  onItemDeselected?: undefined | ((item: T) => void);
  isItemSelected?: boolean | undefined;

  // responsive
  isMobile?: boolean;
}

type TableRowFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const TableRow: TableRowFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  // Helper function to get nested property values using dot notation
  const getNestedValue: (obj: any, path: string) => any = (
    obj: any,
    path: string,
  ): any => {
    return path.split(".").reduce((current: any, key: string) => {
      return current?.[key];
    }, obj);
  };

  const [isButtonLoading, setIsButtonLoading] = useState<Array<boolean>>(
    props.actionButtons?.map(() => {
      return false;
    }) || [],
  );

  const [tooltipModalText, setTooltipModalText] = useState<string>("");

  const [error, setError] = useState<string>("");

  // Track mobile view for responsive behavior
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const checkMobile: () => void = (): void => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  type GetRowFunction = (provided?: DraggableProvided) => ReactElement;

  const getRow: GetRowFunction = (
    provided?: DraggableProvided,
  ): ReactElement => {
    // Mobile view: render as a card
    if (props.isMobile) {
      return (
        <>
          <div
            {...provided?.draggableProps}
            ref={provided?.innerRef}
            className="p-4 bg-white border-b border-gray-200"
          >
            {props.enableDragAndDrop ? (
              <div
                className="mb-3 flex justify-center"
                {...provided?.dragHandleProps}
              >
                <Icon
                  icon={IconProp.ArrowUpDown}
                  className="h-4 w-4 text-gray-400"
                />
              </div>
            ) : (
              <></>
            )}

            {props.isBulkActionsEnabled ? (
              <div className="mb-3">
                <CheckboxElement
                  value={Boolean(props.isItemSelected)}
                  onChange={(value: boolean) => {
                    if (value) {
                      props.onItemSelected?.(props.item);
                    } else {
                      props.onItemDeselected?.(props.item);
                    }
                  }}
                />
              </div>
            ) : (
              <></>
            )}

            <div className="space-y-3">
              {props.columns.map((column: Column<T>, i: number) => {
                if (column.type === FieldType.Actions) {
                  return (
                    <div key={i} className="flex flex-wrap gap-2">
                      {error && (
                        <ConfirmModal
                          title={`Error`}
                          description={error}
                          submitButtonText={"Close"}
                          onSubmit={() => {
                            return setError("");
                          }}
                        />
                      )}
                      {props.actionButtons?.map(
                        (
                          button: ActionButtonSchema<T>,
                          actionIndex: number,
                        ) => {
                          if (
                            button.isVisible &&
                            !button.isVisible(props.item)
                          ) {
                            return <div key={actionIndex}></div>;
                          }

                          if (button.hideOnMobile) {
                            return <div key={actionIndex}></div>;
                          }

                          return (
                            <Button
                              key={actionIndex}
                              buttonSize={ButtonSize.Small}
                              title={button.title}
                              icon={button.icon}
                              buttonStyle={button.buttonStyleType}
                              isLoading={isButtonLoading[actionIndex]}
                              onClick={() => {
                                if (button.onClick) {
                                  isButtonLoading[actionIndex] = true;
                                  setIsButtonLoading(isButtonLoading);

                                  button.onClick(
                                    props.item,
                                    () => {
                                      isButtonLoading[actionIndex] = false;
                                      setIsButtonLoading(isButtonLoading);
                                    },
                                    (err: Error) => {
                                      isButtonLoading[actionIndex] = false;
                                      setIsButtonLoading(isButtonLoading);
                                      setError((err as Error).message);
                                    },
                                  );
                                }
                              }}
                            />
                          );
                        },
                      )}
                    </div>
                  );
                }

                const value: any =
                  column.key && !column.getElement ? (
                    column.type === FieldType.Date ? (
                      props.item[column.key] ? (
                        OneUptimeDate.getDateAsLocalFormattedString(
                          props.item[column.key] as string,
                          true,
                        )
                      ) : (
                        column.noValueMessage || ""
                      )
                    ) : column.type === FieldType.DateTime ? (
                      props.item[column.key] ? (
                        OneUptimeDate.getDateAsLocalFormattedString(
                          props.item[column.key] as string,
                          false,
                        )
                      ) : (
                        column.noValueMessage || ""
                      )
                    ) : column.type === FieldType.USDCents ? (
                      props.item[column.key] ? (
                        ((props.item[column.key] as number) || 0) / 100 + " USD"
                      ) : (
                        column.noValueMessage || "0 USD"
                      )
                    ) : column.type === FieldType.Percent ? (
                      props.item[column.key] ? (
                        props.item[column.key] + "%"
                      ) : (
                        column.noValueMessage || "0%"
                      )
                    ) : column.type === FieldType.Color ? (
                      props.item[column.key] ? (
                        <ColorInput value={props.item[column.key] as Color} />
                      ) : (
                        column.noValueMessage || "0%"
                      )
                    ) : column.type === FieldType.LongText ? (
                      props.item[column.key] ? (
                        <LongTextViewer
                          text={props.item[column.key] as string}
                        />
                      ) : (
                        column.noValueMessage || ""
                      )
                    ) : column.type === FieldType.Boolean ? (
                      props.item[column.key] ? (
                        <Icon
                          icon={IconProp.Check}
                          className={"h-5 w-5 text-gray-500"}
                          thick={ThickProp.Thick}
                        />
                      ) : (
                        <Icon
                          icon={IconProp.False}
                          className={"h-5 w-5 text-gray-500"}
                          thick={ThickProp.Thick}
                        />
                      )
                    ) : (
                      getNestedValue(
                        props.item,
                        String(column.key),
                      )?.toString() ||
                      column.noValueMessage ||
                      ""
                    )
                  ) : column.key && column.getElement ? (
                    column.getElement(props.item)
                  ) : null;

                // Skip empty values for mobile view
                if (
                  !value ||
                  (typeof value === "string" && value.trim() === "")
                ) {
                  return null;
                }

                return (
                  <div
                    key={i}
                    className="flex flex-col space-y-1"
                    onClick={() => {
                      if (column.tooltipText) {
                        setTooltipModalText(column.tooltipText(props.item));
                      }
                    }}
                  >
                    <div className="text-sm font-medium text-gray-500">
                      {column.title}
                    </div>
                    <div className="text-sm text-gray-900">{value}</div>
                  </div>
                );
              })}
            </div>
          </div>
          {tooltipModalText && (
            <ConfirmModal
              title={`Help`}
              description={`${tooltipModalText}`}
              submitButtonText={"Close"}
              onSubmit={() => {
                setTooltipModalText("");
              }}
              submitButtonType={ButtonStyleType.NORMAL}
            />
          )}
        </>
      );
    }

    // Desktop view: render as table row
    return (
      <>
        <tr {...provided?.draggableProps} ref={provided?.innerRef}>
          {props.enableDragAndDrop && (
            <td
              className="ml-5 py-4 w-10 align-top"
              {...provided?.dragHandleProps}
            >
              <Icon
                icon={IconProp.ArrowUpDown}
                className="ml-6 h-5 w-5 text-gray-500 hover:text-indigo-800 m-auto cursor-ns-resize"
              />
            </td>
          )}
          {props.isBulkActionsEnabled && (
            <td
              className="w-10 py-3.5  align-top"
              {...provided?.dragHandleProps}
            >
              <div className="ml-5">
                <CheckboxElement
                  value={props.isItemSelected}
                  onChange={(value: boolean) => {
                    if (value) {
                      if (props.onItemSelected) {
                        props.onItemSelected(props.item);
                      }
                    } else if (props.onItemDeselected) {
                      props.onItemDeselected(props.item);
                    }
                  }}
                />
              </div>
            </td>
          )}
          {props.columns &&
            props.columns
              .filter((column: Column<T>) => {
                return !(column.hideOnMobile && isMobile);
              })
              .map((column: Column<T>, i: number) => {
                let className: string =
                  "whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-500 sm:pl-6 align-top";
                if (i === props.columns.length - 1) {
                  className =
                    "whitespace-nowrap py-4 pl-4 pr-6 text-sm font-medium text-gray-500 sm:pl-6 align-top";
                }
                return (
                  <td
                    key={i}
                    className={className}
                    style={{
                      textAlign:
                        column.type === FieldType.Actions ? "right" : "left",
                    }}
                    onClick={() => {
                      if (column.tooltipText) {
                        setTooltipModalText(column.tooltipText(props.item));
                      }
                    }}
                  >
                    {column.key && !column.getElement ? (
                      column.type === FieldType.Date ? (
                        props.item[column.key] ? (
                          OneUptimeDate.getDateAsLocalFormattedString(
                            props.item[column.key] as string,
                            true,
                          )
                        ) : (
                          column.noValueMessage || ""
                        )
                      ) : column.type === FieldType.DateTime ? (
                        props.item[column.key] ? (
                          OneUptimeDate.getDateAsLocalFormattedString(
                            props.item[column.key] as string,
                            false,
                          )
                        ) : (
                          column.noValueMessage || ""
                        )
                      ) : column.type === FieldType.USDCents ? (
                        props.item[column.key] ? (
                          ((props.item[column.key] as number) || 0) / 100 +
                          " USD"
                        ) : (
                          column.noValueMessage || "0 USD"
                        )
                      ) : column.type === FieldType.Percent ? (
                        props.item[column.key] ? (
                          props.item[column.key] + "%"
                        ) : (
                          column.noValueMessage || "0%"
                        )
                      ) : column.type === FieldType.Color ? (
                        props.item[column.key] ? (
                          <ColorInput value={props.item[column.key] as Color} />
                        ) : (
                          column.noValueMessage || "0%"
                        )
                      ) : column.type === FieldType.LongText ? (
                        props.item[column.key] ? (
                          <LongTextViewer
                            text={props.item[column.key] as string}
                          />
                        ) : (
                          column.noValueMessage || ""
                        )
                      ) : column.type === FieldType.Boolean ? (
                        props.item[column.key] ? (
                          <Icon
                            icon={IconProp.Check}
                            className={"h-5 w-5 text-gray-500"}
                            thick={ThickProp.Thick}
                          />
                        ) : (
                          <Icon
                            icon={IconProp.False}
                            className={"h-5 w-5 text-gray-500"}
                            thick={ThickProp.Thick}
                          />
                        )
                      ) : (
                        getNestedValue(
                          props.item,
                          String(column.key),
                        )?.toString() ||
                        column.noValueMessage ||
                        ""
                      )
                    ) : (
                      <></>
                    )}

                    {column.key && column.getElement ? (
                      column.getElement(props.item)
                    ) : (
                      <></>
                    )}
                    {column.type === FieldType.Actions && (
                      <div className="flex justify-end">
                        {error && (
                          <div className="text-align-left">
                            <ConfirmModal
                              title={`Error`}
                              description={error}
                              submitButtonText={"Close"}
                              onSubmit={() => {
                                return setError("");
                              }}
                            />
                          </div>
                        )}
                        {props.actionButtons?.map(
                          (button: ActionButtonSchema<T>, i: number) => {
                            if (
                              button.isVisible &&
                              !button.isVisible(props.item)
                            ) {
                              return <div key={i}></div>;
                            }

                            // Hide button on mobile if hideOnMobile is true
                            if (button.hideOnMobile && isMobile) {
                              return <div key={i}></div>;
                            }

                            return (
                              <div key={i}>
                                <Button
                                  buttonSize={ButtonSize.Small}
                                  title={button.title}
                                  icon={button.icon}
                                  buttonStyle={button.buttonStyleType}
                                  isLoading={isButtonLoading[i]}
                                  onClick={() => {
                                    if (button.onClick) {
                                      isButtonLoading[i] = true;
                                      setIsButtonLoading(isButtonLoading);

                                      button.onClick(
                                        props.item,
                                        () => {
                                          // on action complete
                                          isButtonLoading[i] = false;
                                          setIsButtonLoading(isButtonLoading);
                                        },
                                        (err: Error) => {
                                          isButtonLoading[i] = false;
                                          setIsButtonLoading(isButtonLoading);
                                          setError((err as Error).message);
                                        },
                                      );
                                    }
                                  }}
                                />
                              </div>
                            );
                          },
                        )}
                      </div>
                    )}
                  </td>
                );
              })}
        </tr>
        {tooltipModalText && (
          <ConfirmModal
            title={`Help`}
            description={`${tooltipModalText}`}
            submitButtonText={"Close"}
            onSubmit={() => {
              setTooltipModalText("");
            }}
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}
      </>
    );
  };

  if (
    props.enableDragAndDrop &&
    props.dragDropIdField &&
    props.dragDropIndexField
  ) {
    return (
      <Draggable
        draggableId={(props.item[props.dragDropIdField] as string) || ""}
        index={(props.item[props.dragDropIndexField] as number) || 0}
        key={(props.item[props.dragDropIndexField] as number) || 0}
      >
        {(provided: DraggableProvided) => {
          return getRow(provided);
        }}
      </Draggable>
    );
  }

  return getRow();
};

export default TableRow;
