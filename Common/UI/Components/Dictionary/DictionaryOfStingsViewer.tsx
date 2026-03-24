import Dictionary from "../../../Types/Dictionary";
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
    <div className="px-4 py-3">
      <div className="flex flex-wrap gap-2">
        {data.map((item: Item, index: number) => {
          return (
            <div
              key={index}
              className="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 text-sm overflow-hidden"
            >
              <span className="px-2.5 py-1.5 font-mono font-medium text-gray-700 bg-gray-100 border-r border-gray-200">
                {item.key}
              </span>
              <span className="px-2.5 py-1.5 font-mono text-gray-600">
                {item.value || (
                  <span className="text-gray-400 italic">empty</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DictionaryOfStringsViewer;
