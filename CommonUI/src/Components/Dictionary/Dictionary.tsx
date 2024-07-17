import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import Icon, { SizeProp } from "../Icon/Icon";
import Input, { InputType } from "../Input/Input";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import NumberUtil from "Common/Utils/Number";
import BooleanUtil from "Common/Utils/Boolean";

export enum ValueType {
  Text = "Text",
  Number = "Number",
  Boolean = "Boolean",
}

export interface ComponentProps {
  onChange?:
    | undefined
    | ((value: Dictionary<string | boolean | number>) => void);
  initialValue?: Dictionary<string | boolean | number>;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addButtonSuffix?: string;
  valueTypes?: Array<ValueType>; // by default it'll be Text
  autoConvertValueTypes?: boolean | undefined;
}

interface Item {
  key: string;
  value: string | number | boolean;
  type: ValueType;
}

const DictionaryForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const valueTypes: Array<ValueType> =
    props.valueTypes && props.valueTypes.length > 0
      ? props.valueTypes
      : [ValueType.Text];
  const dropdownOptionsForValueTypes: Array<DropdownOption> = valueTypes.map(
    (valueType: ValueType) => {
      return {
        label: valueType,
        value: valueType,
      };
    },
  );

  const [data, setData] = useState<Array<Item>>([]);
  const [isInitialValueSet, setIsInitialValueSet] = useState<boolean>(false);

  type UpdateDataFunction = (
    json: Dictionary<string | number | boolean>,
  ) => void;

  const updateData: UpdateDataFunction = (
    json: Dictionary<string | number | boolean>,
  ): void => {
    const newData: Array<Item> = Object.keys(json).map((key: string) => {
      // check if the value type is in data

      const valueTypeInData: ValueType | undefined = data.find((item: Item) => {
        return item.key === key;
      })?.type;

      let valueType: ValueType = valueTypeInData || ValueType.Text;

      if (!valueTypeInData) {
        if (typeof json[key] === "number") {
          valueType = ValueType.Number;
        }

        if (typeof json[key] === "boolean") {
          valueType = ValueType.Boolean;
        }
      }

      return {
        key: key,
        value: json[key] || "",
        type: valueType,
      };
    });

    setData(newData);
  };

  useEffect(() => {
    if (
      props.initialValue &&
      !isInitialValueSet &&
      Object.keys(props.initialValue).length > 0
    ) {
      setIsInitialValueSet(true);
      updateData(props.initialValue);
    }
  }, [props.initialValue]);

  type OnDataChangeFunction = (data: Array<Item>) => void;

  const onDataChange: OnDataChangeFunction = (data: Array<Item>): void => {
    const result: Dictionary<string | number | boolean> = {};
    data.forEach((item: Item) => {
      if (props.autoConvertValueTypes) {
        if (NumberUtil.canBeConvertedToNumber(item.value)) {
          item.value = Number(item.value);
        }

        if (BooleanUtil.canBeConvertedToBoolean(item.value)) {
          item.value = Boolean(item.value);
        }
      }
      result[item.key] = item.value;
    });
    if (props.onChange) {
      props.onChange(result);
    }
  };

  const trueDropdownOption: DropdownOption = {
    label: "True",
    value: "True",
  };

  const falseDropdownOption: DropdownOption = {
    label: "False",
    value: "False",
  };

  return (
    <div>
      <div>
        {data.map((item: Item, index: number) => {
          return (
            <div key={index} className="flex">
              <div className="mr-1">
                <Input
                  value={item.key}
                  placeholder={props.keyPlaceholder}
                  onChange={(value: string) => {
                    const newData: Array<Item> = [...data];
                    newData[index]!.key = value;
                    setData(newData);
                    onDataChange(newData);
                  }}
                />
              </div>
              <div className="mr-1 ml-1 mt-auto mb-auto">
                <Icon
                  className="h-3 w-3"
                  icon={IconProp.Equals}
                  size={SizeProp.Small}
                />
              </div>
              {valueTypes.length > 1 && (
                <div className="ml-1">
                  <Dropdown
                    value={dropdownOptionsForValueTypes.find(
                      (dropdownOption: DropdownOption) => {
                        return dropdownOption.value === item.type;
                      },
                    )}
                    options={dropdownOptionsForValueTypes}
                    isMultiSelect={false}
                    onChange={(
                      selectedOption:
                        | DropdownValue
                        | Array<DropdownValue>
                        | null,
                    ) => {
                      const newData: Array<Item> = [...data];
                      newData[index]!.type =
                        (selectedOption as ValueType) || valueTypes[0];
                      setData(newData);
                      onDataChange(newData);
                    }}
                  />
                </div>
              )}
              <div className="ml-1">
                {item.type === ValueType.Text && (
                  <Input
                    value={item.value.toString()}
                    placeholder={props.valuePlaceholder}
                    onChange={(value: string) => {
                      const newData: Array<Item> = [...data];
                      newData[index]!.value = value;
                      setData(newData);
                      onDataChange(newData);
                    }}
                  />
                )}

                {item.type === ValueType.Number && (
                  <Input
                    value={item.value.toString()}
                    placeholder={props.valuePlaceholder}
                    onChange={(value: string) => {
                      const newData: Array<Item> = [...data];

                      if (typeof value === "string" && value.length > 0) {
                        newData[index]!.value = parseInt(value);
                      } else {
                        delete newData[index];
                      }

                      setData(newData);
                      onDataChange(newData);
                    }}
                    type={InputType.NUMBER}
                  />
                )}

                {item.type === ValueType.Boolean && (
                  <Dropdown
                    value={
                      item.value === true
                        ? trueDropdownOption
                        : falseDropdownOption
                    }
                    options={[trueDropdownOption, falseDropdownOption]}
                    isMultiSelect={false}
                    onChange={(
                      selectedOption:
                        | DropdownValue
                        | Array<DropdownValue>
                        | null,
                    ) => {
                      const newData: Array<Item> = [...data];
                      if (selectedOption === "True") {
                        newData[index]!.value = true;
                      }

                      if (selectedOption === "False") {
                        newData[index]!.value = false;
                      }

                      setData(newData);
                      onDataChange(newData);
                    }}
                  />
                )}
              </div>
              <div className="ml-1 mt-1">
                <Button
                  dataTestId={`delete-${item.key}`}
                  title="Delete"
                  buttonStyle={ButtonStyleType.ICON}
                  icon={IconProp.Trash}
                  onClick={() => {
                    const newData: Array<Item> = [...data];
                    newData.splice(index, 1);
                    setData(newData);
                    onDataChange(newData);
                  }}
                />
              </div>
            </div>
          );
        })}
        <div className="-ml-3 mt-4">
          <Button
            title={`Add ${props.addButtonSuffix || "Item"}`}
            icon={IconProp.Add}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              setData([
                ...data,
                {
                  key: "",
                  value: "",
                  type: valueTypes[0] as ValueType,
                },
              ]);
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default DictionaryForm;
