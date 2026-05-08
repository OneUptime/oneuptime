import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import Input, { InputType } from "../Input/Input";
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AutocompleteTextInput from "../AutocompleteTextInput/AutocompleteTextInput";
import FieldLabelElement from "../Forms/Fields/FieldLabel";
import {
  DICTIONARY_FILTER_OPERATOR_OPTIONS,
  DictionaryEntryValue,
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
  buildDictionaryValue,
  detectOperatorFromValue,
  getOperatorOption,
} from "./DictionaryFilterOperator";

export enum ValueType {
  Text = "Text",
  Number = "Number",
  Boolean = "Boolean",
}

export interface ComponentProps {
  onChange?: undefined | ((value: Dictionary<DictionaryEntryValue>) => void);
  initialValue?: Dictionary<DictionaryEntryValue>;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addButtonSuffix?: string | undefined;
  valueTypes?: Array<ValueType>; // by default it'll be Text
  keys?: Array<string> | undefined;
  valueSuggestions?: Record<string, Array<string>> | undefined;
  onKeySelected?: ((key: string) => void) | undefined;
  isLoadingKeys?: boolean | undefined;
  loadingValueKeys?: Array<string> | undefined;
  /*
   * When true, render an operator dropdown (=, !=, contains, etc.)
   * between the key and value inputs. Defaults to false for backwards
   * compatibility with simple key/value forms.
   */
  enableOperators?: boolean | undefined;
}

interface Item {
  key: string;
  value: string | number | boolean;
  type: ValueType;
  operator: DictionaryFilterOperator;
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

  type UpdateDataFunction = (json: Dictionary<DictionaryEntryValue>) => void;

  const updateData: UpdateDataFunction = (
    json: Dictionary<DictionaryEntryValue>,
  ): void => {
    const newData: Array<Item> = Object.keys(json).map((key: string) => {
      // check if the value type is in data

      const valueTypeInData: ValueType | undefined = data.find((item: Item) => {
        return item.key === key;
      })?.type;

      let valueType: ValueType = valueTypeInData || ValueType.Text;

      const rawEntry: DictionaryEntryValue | undefined = json[key];

      if (!valueTypeInData) {
        if (typeof rawEntry === "number") {
          valueType = ValueType.Number;
        }

        if (typeof rawEntry === "boolean") {
          valueType = ValueType.Boolean;
        }
      }

      const detected: {
        operator: DictionaryFilterOperator;
        rawValue: string;
      } = detectOperatorFromValue(rawEntry);

      /*
       * Restore typed values (number/boolean) for the form input from
       * the stringified raw representation when the column type allows.
       */
      let restoredValue: string | number | boolean = detected.rawValue;
      if (valueType === ValueType.Number && detected.rawValue !== "") {
        const parsed: number = Number(detected.rawValue);
        restoredValue = isNaN(parsed) ? detected.rawValue : parsed;
      } else if (valueType === ValueType.Boolean) {
        if (typeof rawEntry === "boolean") {
          restoredValue = rawEntry;
        } else if (detected.rawValue.toLowerCase() === "true") {
          restoredValue = true;
        } else if (detected.rawValue.toLowerCase() === "false") {
          restoredValue = false;
        }
      }

      return {
        key: key,
        value: restoredValue,
        type: valueType,
        operator: detected.operator,
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
    const result: Dictionary<DictionaryEntryValue> = {};
    data.forEach((item: Item) => {
      /*
       * Non-text types skip the operator system — the existing
       * numeric/boolean inputs always represent equality.
       */
      if (item.type === ValueType.Number) {
        result[item.key] = item.value as number;
        return;
      }
      if (item.type === ValueType.Boolean) {
        result[item.key] = item.value as boolean;
        return;
      }

      const operatorOption: DictionaryFilterOperatorOption = getOperatorOption(
        item.operator,
      );
      if (operatorOption.hidesValueInput) {
        result[item.key] = buildDictionaryValue({
          operator: item.operator,
          rawValue: "",
        });
        return;
      }
      result[item.key] = buildDictionaryValue({
        operator: item.operator,
        rawValue: String(item.value ?? ""),
      });
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

  const getDefaultValueForType: (
    type: ValueType,
  ) => string | number | boolean = (type: ValueType) => {
    if (type === ValueType.Boolean) {
      return true;
    }

    return "";
  };

  const operatorDropdownOptions: Array<DropdownOption> =
    DICTIONARY_FILTER_OPERATOR_OPTIONS.map(
      (option: DictionaryFilterOperatorOption) => {
        return {
          label: option.symbol,
          value: option.operator,
        };
      },
    );

  return (
    <div>
      <div>
        {data.map((item: Item, index: number) => {
          const operatorOption: DictionaryFilterOperatorOption =
            getOperatorOption(item.operator);
          const showOperatorSelector: boolean = Boolean(props.enableOperators);
          const hideValueInput: boolean = Boolean(
            showOperatorSelector && operatorOption.hidesValueInput,
          );
          const valueColumnClass: string = showOperatorSelector
            ? "ml-1 w-2/5"
            : "ml-1 w-1/2";
          const keyColumnClass: string = showOperatorSelector
            ? "mr-1 w-2/5"
            : "mr-1 w-1/2";

          return (
            <div key={index} className="flex items-start mb-4 last:mb-0">
              <div className={keyColumnClass}>
                <div className="mb-1">
                  <FieldLabelElement
                    title="Key"
                    required={true}
                    hideOptionalLabel={true}
                    className="block text-xs text-gray-500 font-normal flex justify-between"
                  />
                </div>
                <AutocompleteTextInput
                  value={item.key}
                  placeholder={props.keyPlaceholder}
                  suggestions={props.keys}
                  isLoadingSuggestions={props.isLoadingKeys}
                  loadingMessage="Loading attributes..."
                  onChange={(value: string) => {
                    const newData: Array<Item> = [...data];
                    newData[index]!.key = value;
                    setData(newData);
                    onDataChange(newData);

                    // If this key matches one of the known keys, notify parent to fetch values
                    if (props.onKeySelected && props.keys?.includes(value)) {
                      props.onKeySelected(value);
                    }
                  }}
                />
              </div>

              {showOperatorSelector ? (
                <div className="mr-1 ml-1 w-1/5 min-w-[120px]">
                  <div className="mb-1">
                    <FieldLabelElement
                      title="Operator"
                      required={true}
                      hideOptionalLabel={true}
                      className="block text-xs text-gray-500 font-normal flex justify-between"
                    />
                  </div>
                  <Dropdown
                    value={operatorDropdownOptions.find(
                      (option: DropdownOption) => {
                        return option.value === item.operator;
                      },
                    )}
                    options={operatorDropdownOptions}
                    isMultiSelect={false}
                    onChange={(
                      selectedOption:
                        | DropdownValue
                        | Array<DropdownValue>
                        | null,
                    ) => {
                      const newOperator: DictionaryFilterOperator =
                        (selectedOption as DictionaryFilterOperator) ||
                        DictionaryFilterOperator.EqualTo;
                      const newOperatorOption: DictionaryFilterOperatorOption =
                        getOperatorOption(newOperator);
                      const newData: Array<Item> = [...data];
                      newData[index]!.operator = newOperator;
                      /*
                       * Reset the value when switching to a value-less
                       * operator so we don't ship stale text downstream.
                       */
                      if (newOperatorOption.hidesValueInput) {
                        newData[index]!.value = "";
                      }
                      setData(newData);
                      onDataChange(newData);
                    }}
                  />
                </div>
              ) : (
                <div className="mr-1 ml-1 flex items-center justify-center pt-8">
                  <span className="text-slate-500 text-2xl leading-none">
                    =
                  </span>
                </div>
              )}
              {valueTypes.length > 1 && (
                <div className="ml-1 w-1/2">
                  <div className="mb-1">
                    <FieldLabelElement
                      title="Type"
                      hideOptionalLabel={true}
                      required={true}
                      className="block text-xs text-gray-500 font-normal flex justify-between"
                    />
                  </div>
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
                      const newType: ValueType =
                        (selectedOption as ValueType) || valueTypes[0];
                      newData[index]!.type = newType;
                      newData[index]!.value = getDefaultValueForType(newType);
                      setData(newData);
                      onDataChange(newData);
                    }}
                  />
                </div>
              )}
              <div className={valueColumnClass}>
                <div className="mb-1">
                  <FieldLabelElement
                    title="Value"
                    hideOptionalLabel={true}
                    required={true}
                    className="block text-xs text-gray-500 font-normal flex justify-between"
                  />
                </div>
                {hideValueInput && (
                  <Input
                    value=""
                    placeholder={operatorOption.label}
                    disabled={true}
                    onChange={() => {
                      // no-op — IsEmpty/IsNotEmpty have no value
                    }}
                  />
                )}
                {!hideValueInput && item.type === ValueType.Text && (
                  <AutocompleteTextInput
                    value={item.value.toString()}
                    placeholder={
                      operatorOption.expectsNumericValue
                        ? "Number"
                        : props.valuePlaceholder
                    }
                    suggestions={
                      operatorOption.expectsNumericValue
                        ? undefined
                        : item.key && props.valueSuggestions?.[item.key]
                          ? props.valueSuggestions[item.key]
                          : undefined
                    }
                    isLoadingSuggestions={
                      operatorOption.expectsNumericValue
                        ? false
                        : Boolean(
                            item.key &&
                              props.loadingValueKeys?.includes(item.key),
                          )
                    }
                    loadingMessage="Loading values..."
                    onChange={(value: string) => {
                      const newData: Array<Item> = [...data];
                      newData[index]!.value = value;
                      setData(newData);
                      onDataChange(newData);
                    }}
                  />
                )}

                {!hideValueInput && item.type === ValueType.Number && (
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

                {!hideValueInput && item.type === ValueType.Boolean && (
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
              <div className="ml-1 flex flex-col justify-end pt-6">
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
                  value: getDefaultValueForType(valueTypes[0] as ValueType),
                  type: valueTypes[0] as ValueType,
                  operator: DictionaryFilterOperator.EqualTo,
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
