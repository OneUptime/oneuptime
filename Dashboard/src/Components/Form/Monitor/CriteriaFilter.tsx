import CriteriaFilterUiUtil from "../../../Utils/Form/Monitor/CriteriaFilter";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeOptions,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "CommonUI/src/Components/Button/Button";
import CheckboxElement from "CommonUI/src/Components/Checkbox/Checkbox";
import FieldLabelElement from "CommonUI/src/Components/Detail/FieldLabel";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "CommonUI/src/Components/Dropdown/Dropdown";
import Input from "CommonUI/src/Components/Input/Input";
import Link from "CommonUI/src/Components/Link/Link";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

export interface ComponentProps {
  initialValue: CriteriaFilter | undefined;
  onChange?: undefined | ((value: CriteriaFilter) => void);
  onDelete?: undefined | (() => void);
  monitorType: MonitorType;
}

const CriteriaFilterElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [criteriaFilter, setCriteriaFilter] = React.useState<
    CriteriaFilter | undefined
  >(props.initialValue);

  const [valuePlaceholder, setValuePlaceholder] = React.useState<string>("");

  const [checkOnOptions, setCheckOnOptions] = React.useState<
    Array<DropdownOption>
  >([]);

  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  useEffect(() => {
    setCheckOnOptions(
      CriteriaFilterUiUtil.getCheckOnOptionsByMonitorType(props.monitorType),
    );
    setIsLoading(false);
  }, [props.monitorType]);

  const [filterTypeOptions, setFilterTypeOptions] = React.useState<
    Array<DropdownOption>
  >([]);

  useEffect(() => {
    setFilterTypeOptions(
      criteriaFilter?.checkOn
        ? CriteriaFilterUiUtil.getFilterTypeOptionsByCheckOn(
            criteriaFilter?.checkOn,
          )
        : [],
    );
    setValuePlaceholder(
      criteriaFilter?.checkOn
        ? CriteriaFilterUiUtil.getFilterTypePlaceholderValueByCheckOn({
            monitorType: props.monitorType,
            checkOn: criteriaFilter?.checkOn,
          })
        : "",
    );
  }, [criteriaFilter]);

  useEffect(() => {
    if (props.onChange && criteriaFilter) {
      props.onChange(criteriaFilter);
    }
  }, [criteriaFilter]);

  if (isLoading) {
    return <></>;
  }

  const filterConditionValue: DropdownOption | undefined =
    filterTypeOptions.find((i: DropdownOption) => {
      return i.value === criteriaFilter?.filterType;
    });

  const evaluateOverTimeMinutesValue: DropdownOption | undefined =
    CriteriaFilterUiUtil.getEvaluateOverTimeMinutesOptions().find(
      (item: DropdownOption) => {
        return (
          item.value ===
          criteriaFilter?.evaluateOverTimeOptions?.timeValueInMinutes
        );
      },
    );


    const evalOverTimeDropdownOptions: Array<DropdownOption> = CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
      criteriaFilter 
    ).map((item: EvaluateOverTimeType) => {
      return {
        value: item,
        label: item,
      };
    });

  const evaluateOverTimeTypeValue: DropdownOption | undefined =
  evalOverTimeDropdownOptions.find(
      (item: DropdownOption) => {
        return (
          item.value ===
          criteriaFilter?.evaluateOverTimeOptions?.evaluateOverTimeType
        );
      },
    );

  return (
    <div>
      <div className="rounded-md p-2 bg-gray-50 my-5 border-gray-200 border-solid border-2">
        <div className="">
          <FieldLabelElement title="Filter Type" />
          <Dropdown
            value={checkOnOptions.find((i: DropdownOption) => {
              return i.value === criteriaFilter?.checkOn;
            })}
            options={checkOnOptions}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setCriteriaFilter({
                checkOn: value?.toString() as CheckOn,
                filterType: undefined,
                value: undefined,
                eveluateOverTime: false,
                evaluateOverTimeOptions: undefined,
              });
            }}
          />
        </div>

        {criteriaFilter?.checkOn &&
          criteriaFilter?.checkOn === CheckOn.DiskUsagePercent && (
            <div className="mt-1">
              <FieldLabelElement title="Disk Path" />

              <Input
                placeholder={"C:\\ or /mnt/data or /dev/sda1"}
                value={criteriaFilter?.serverMonitorOptions?.diskPath?.toString()}
                onChange={(value: string) => {
                  setCriteriaFilter({
                    ...criteriaFilter,
                    serverMonitorOptions: {
                      diskPath: value,
                    },
                  });
                }}
              />
            </div>
          )}

        {/** checkbox for evaluateOverTime */}

        {criteriaFilter?.checkOn &&
          CriteriaFilterUtil.isEvaluateOverTimeFilter(
            criteriaFilter?.checkOn,
          ) && (
            <div className="mt-3">
              <CheckboxElement
                value={criteriaFilter?.eveluateOverTime}
                title={"Evaluate this criteria over a period of time"}
                onChange={(value: boolean) => {
                  setCriteriaFilter({
                    ...criteriaFilter,
                    eveluateOverTime: value,
                  });
                }}
              />
            </div>
          )}

        {criteriaFilter?.checkOn &&
        criteriaFilter?.checkOn &&
        CriteriaFilterUtil.isEvaluateOverTimeFilter(criteriaFilter?.checkOn) &&
        criteriaFilter.eveluateOverTime ? (
          <div className="mt-1">
            <FieldLabelElement title="Evaluate" />
            <Dropdown
              value={evaluateOverTimeTypeValue}
              options={evalOverTimeDropdownOptions}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const evaluateOverTimeOption: EvaluateOverTimeOptions =
                  criteriaFilter?.evaluateOverTimeOptions
                    ? {
                        ...criteriaFilter?.evaluateOverTimeOptions,
                      }
                    : {
                        timeValueInMinutes: 5,
                        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
                      };

                setCriteriaFilter({
                  ...criteriaFilter,
                  eveluateOverTime: true,
                  evaluateOverTimeOptions: {
                    ...evaluateOverTimeOption,
                    evaluateOverTimeType:
                      value?.toString() as EvaluateOverTimeType,
                  },
                });
              }}
            />
          </div>
        ) : (
          <></>
        )}

        {criteriaFilter?.checkOn &&
        criteriaFilter?.checkOn &&
        CriteriaFilterUtil.isEvaluateOverTimeFilter(criteriaFilter?.checkOn) &&
        criteriaFilter.eveluateOverTime ? (
          <div className="mt-1">
            <FieldLabelElement title="For the last (in minutes)" />
            <Dropdown
              value={evaluateOverTimeMinutesValue}
              options={CriteriaFilterUiUtil.getEvaluateOverTimeMinutesOptions()}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const evaluateOverTimeOption: EvaluateOverTimeOptions =
                  criteriaFilter?.evaluateOverTimeOptions
                    ? {
                        ...criteriaFilter?.evaluateOverTimeOptions,
                      }
                    : {
                        timeValueInMinutes: 5,
                        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
                      };

                setCriteriaFilter({
                  ...criteriaFilter,
                  eveluateOverTime: true,
                  evaluateOverTimeOptions: {
                    ...evaluateOverTimeOption,
                    timeValueInMinutes: value as number,
                  },
                });
              }}
            />
          </div>
        ) : (
          <></>
        )}

        {!criteriaFilter?.checkOn ||
          (criteriaFilter?.checkOn && (
            <div className="mt-1">
              <FieldLabelElement title="Filter Condition" />
              <Dropdown
                value={filterConditionValue}
                options={filterTypeOptions}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setCriteriaFilter({
                    ...criteriaFilter,
                    filterType: value?.toString() as FilterType,
                    value: undefined,
                  });
                }}
              />
            </div>
          ))}

        {!criteriaFilter?.checkOn ||
          (criteriaFilter?.checkOn &&
            CriteriaFilterUiUtil.hasValueField({
              checkOn: criteriaFilter?.checkOn,
              filterType: criteriaFilter?.filterType,
            }) &&
            !CriteriaFilterUiUtil.isDropdownValueField({
              checkOn: criteriaFilter?.checkOn,
            }) && (
              <div className="mt-1">
                <FieldLabelElement title="Value" />
                <Input
                  placeholder={valuePlaceholder}
                  value={criteriaFilter?.value?.toString()}
                  onChange={(value: string) => {
                    setCriteriaFilter({
                      ...criteriaFilter,
                      value: value || "",
                    });
                  }}
                />
              </div>
            ))}

        {!criteriaFilter?.checkOn ||
          (criteriaFilter?.checkOn &&
            CriteriaFilterUiUtil.hasValueField({
              checkOn: criteriaFilter?.checkOn,
              filterType: criteriaFilter?.filterType,
            }) &&
            CriteriaFilterUiUtil.isDropdownValueField({
              checkOn: criteriaFilter?.checkOn,
            }) && (
              <div className="mt-1">
                <FieldLabelElement title="Value" />
                <Dropdown
                  options={CriteriaFilterUiUtil.getDropdownOptionsByCheckOn({
                    checkOn: criteriaFilter?.checkOn,
                  })}
                  value={CriteriaFilterUiUtil.getDropdownOptionsByCheckOn({
                    checkOn: criteriaFilter?.checkOn,
                  }).find((i: DropdownOption) => {
                    return i.value === criteriaFilter?.value;
                  })}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    setCriteriaFilter({
                      ...criteriaFilter,
                      value: value?.toString(),
                    });
                  }}
                />
              </div>
            ))}

        <div className="mt-3 -mr-2 w-full flex justify-end">
          <Button
            title="Delete Filter"
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            icon={IconProp.Trash}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              props.onDelete?.();
            }}
          />
        </div>
      </div>
      {criteriaFilter?.checkOn === CheckOn.JavaScriptExpression ? (
        <div className="mt-1 text-sm text-gray-500 underline">
          <Link
            to={Route.fromString("/docs/monitor/javascript-expression")}
            openInNewTab={true}
          >
            <p> Read documentation for using JavaScript expressions here. </p>
          </Link>{" "}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CriteriaFilterElement;
