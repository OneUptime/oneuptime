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
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Key
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Value
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {data.map((item: Item, index: number) => {
            return (
              <tr key={index} className="hover:bg-gray-50/50">
                <td className="px-4 py-2 text-sm font-mono font-medium text-indigo-700 whitespace-nowrap">
                  {item.key}
                </td>
                <td className="px-4 py-2 text-sm font-mono text-gray-600 break-all">
                  {item.value || (
                    <span className="text-gray-400 italic">empty</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default DictionaryOfStringsViewer;
