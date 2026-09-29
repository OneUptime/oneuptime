import Dictionary from "../../../Types/Dictionary";
import Table from "../Table/Table";
import FieldType from "../Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  value?: Dictionary<string>;
}

interface Item {
  key: string;
  value: string;
}

const DictionaryOfStringsViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [data, setData] = useState<Array<Item>>([]);

  useEffect(() => {
    setData(
      Object.keys(
        props.value || {
          "": "",
        },
      ).map((key: string) => {
        return {
          key: key!,
          value: props.value![key] || "",
        };
      }) || [
        {
          key: "",
          value: "",
        },
      ],
    );
  }, [props.value]);

  if (data.length === 0) {
    return (
      <div className="text-gray-400 text-sm py-2">No items to display.</div>
    );
  }

  return (
    <Table<Item>
      id="dictionary-viewer-table"
      data={data}
      singularLabel="Item"
      pluralLabel="Items"
      isLoading={false}
      error=""
      currentPageNumber={1}
      totalItemsCount={data.length}
      itemsOnPage={data.length}
      disablePagination={true}
      noItemsMessage="No items to display."
      onNavigateToPage={() => {}}
      sortBy={null}
      sortOrder={SortOrder.Ascending}
      onSortChanged={() => {}}
      columns={[
        {
          title: "Key",
          type: FieldType.Element,
          key: "key",
          disableSort: true,
          getElement: (item: Item): ReactElement => {
            return (
              <span className="font-mono font-medium text-gray-900">
                {item.key}
              </span>
            );
          },
        },
        {
          title: "Value",
          type: FieldType.Element,
          key: "value",
          disableSort: true,
          getElement: (item: Item): ReactElement => {
            return (
              <span className="font-mono text-gray-600">
                {item.value || (
                  <span className="text-gray-400 italic">empty</span>
                )}
              </span>
            );
          },
        },
      ]}
    />
  );
};

export default DictionaryOfStringsViewer;
