import {
  DataTypeInfo,
  getBuiltInDataType,
} from "Common/Types/DataSecurity/DataTypeCatalog";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The data types found in a store, by the names the catalog gives them
 * (Types/DataSecurity/DataTypeCatalog): the first few, then how many more,
 * so a row of the Data Stores list stays one line. A project's own data
 * type is stored as "custom:<id>" and named as one here; its own page says
 * which.
 */

const CUSTOM_DATA_TYPE_PREFIX: string = "custom:";

// What a custom data type is called where its own name is not read.
export const CUSTOM_DATA_TYPE_NAME: string = translationKey("Custom data type");

// The catalog's name for a data type, or undefined for one it does not know.
export function getDataTypeName(dataTypeId: string): string | undefined {
  const info: DataTypeInfo | undefined = getBuiltInDataType(dataTypeId);

  if (info) {
    return info.name;
  }

  return dataTypeId.startsWith(CUSTOM_DATA_TYPE_PREFIX)
    ? CUSTOM_DATA_TYPE_NAME
    : undefined;
}

// The names to show for a store's data types: each once, in the store's order.
export function getDataTypeNames(
  dataTypeIds: ReadonlyArray<string> | undefined | null,
): Array<string> {
  const names: Array<string> = [];

  for (const dataTypeId of dataTypeIds || []) {
    const name: string = getDataTypeName(dataTypeId) || dataTypeId;

    if (!names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

export interface ComponentProps {
  dataTypeIds: ReadonlyArray<string> | undefined | null;
  // How many names to show before "+n". Three when left out.
  maxVisible?: number | undefined;
}

const StoreDataTypeList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const names: Array<string> = getDataTypeNames(props.dataTypeIds);
  const maxVisible: number = props.maxVisible || 3;

  if (names.length === 0) {
    return (
      <TableEmptyValue
        screenReaderText={translationKey("No sensitive data found.")}
      />
    );
  }

  const visible: Array<string> = names.slice(0, maxVisible);
  const hidden: Array<string> = names.slice(maxVisible);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {visible.map((name: string): ReactElement => {
        return (
          <span
            key={name}
            className="inline-flex max-w-full items-center truncate rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
          >
            {translator.translateText(name)}
          </span>
        );
      })}
      {hidden.length > 0 ? (
        <span
          className="text-xs font-medium text-gray-500"
          title={hidden
            .map((name: string): string => {
              return translator.translateText(name) || name;
            })
            .join(", ")}
        >
          {translator.translateTemplate("+{{count}}", {
            count: translator.formatNumber(hidden.length),
          })}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

export default StoreDataTypeList;
