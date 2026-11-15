import Dictionary from "../../../Types/Dictionary";
import Table from "../Table/Table";
import FieldType from "../Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import IsolatedText from "../IsolatedText/IsolatedText";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  value?: Dictionary<string>;
  /*
   * A value drawn by its holder, in place of the value as written: a
   * Kubernetes request's "250m" beside what it means (KubernetesContainersTab).
   * Asked only for a value that is not empty.
   */
  renderValue?: ((key: string, value: string) => ReactElement) | undefined;
}

interface Item {
  key: string;
  value: string;
}

const DictionaryOfStringsViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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
      <div className="text-gray-400 text-sm py-2">
        {translator.translateText("No items to display.")}
      </div>
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
                <IsolatedText text={item.key} />
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
            if (item.value && props.renderValue) {
              return props.renderValue(item.key, item.value);
            }

            return (
              /*
               * A key and its value as they were written: "region" and
               * "us-east-1*" keep their own order on a Persian page.
               */
              <span className="font-mono text-gray-600">
                {item.value ? (
                  <IsolatedText text={item.value} />
                ) : (
                  <span className="text-gray-400 italic">
                    {translator.translateText("empty")}
                  </span>
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
