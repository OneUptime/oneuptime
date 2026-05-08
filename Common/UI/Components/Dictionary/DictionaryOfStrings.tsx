import DictionaryForm, { ValueType } from "./Dictionary";
import { DictionaryEntryValue } from "./DictionaryFilterOperator";
import Dictionary from "../../../Types/Dictionary";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onChange?: undefined | ((value: Dictionary<string>) => void);
  initialValue?: Dictionary<string>;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addButtonSuffix?: string;
}

const DictionaryOfStrings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    // only allow text values
    <DictionaryForm
      {...props}
      valueTypes={[ValueType.Text]}
      onChange={(value: Dictionary<DictionaryEntryValue>) => {
        /*
         * Operators are not enabled here, so values come back as bare
         * strings/numbers/booleans only.
         */
        const stringDict: Dictionary<string> = {};

        for (const key of Object.keys(value)) {
          const entry: DictionaryEntryValue | undefined = value[key];
          if (entry === undefined || entry === null) {
            continue;
          }
          stringDict[key] = entry.toString();
        }

        if (props.onChange) {
          props.onChange(stringDict);
        }
      }}
    />
  );
};

export default DictionaryOfStrings;
