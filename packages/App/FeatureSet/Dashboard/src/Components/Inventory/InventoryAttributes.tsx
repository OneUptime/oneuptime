import Card from "Common/UI/Components/Card/Card";
import Input from "Common/UI/Components/Input/Input";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import { JSONObject } from "Common/Types/JSON";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * The attribute inspector on an inventory item's overview.
 *
 * A pod carries dozens of resource attributes and the old page rendered every
 * one of them as an undifferentiated definition list, which is unreadable past
 * about ten rows — so this one filters. The filter matches keys and values
 * both, because "which attribute has this value in it" is at least as common a
 * question as "what is the value of this key".
 *
 * The identifying/descriptive split is kept visible and explained rather than
 * flattened: it is the difference between what the thing *is* (changing it
 * would make it a different thing) and what merely happens to be true of it
 * right now, and that distinction is why an item survives a redeploy.
 */

export interface ComponentProps {
  identifyingAttributes?: JSONObject | undefined;
  descriptiveAttributes?: JSONObject | undefined;
}

type MatchesFilterFunction = (
  key: string,
  value: unknown,
  filter: string,
) => boolean;

const matchesFilter: MatchesFilterFunction = (
  key: string,
  value: unknown,
  filter: string,
): boolean => {
  if (!filter) {
    return true;
  }

  const needle: string = filter.toLowerCase();

  return (
    key.toLowerCase().includes(needle) ||
    String(value).toLowerCase().includes(needle)
  );
};

const InventoryAttributes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [filter, setFilter] = useState<string>("");

  const identifying: JSONObject = props.identifyingAttributes || {};
  const descriptive: JSONObject = props.descriptiveAttributes || {};

  const totalCount: number =
    Object.keys(identifying).length + Object.keys(descriptive).length;

  if (totalCount === 0) {
    return <></>;
  }

  type RenderRowsFunction = (
    attributes: JSONObject,
    testId: string,
  ) => ReactElement;

  const renderRows: RenderRowsFunction = (
    attributes: JSONObject,
    testId: string,
  ): ReactElement => {
    const keys: Array<string> = Object.keys(attributes)
      .filter((key: string): boolean => {
        return matchesFilter(key, attributes[key], filter);
      })
      .sort();

    if (keys.length === 0) {
      return (
        <p className="py-2 text-sm text-gray-500">
          Nothing here matches &quot;{filter}&quot;.
        </p>
      );
    }

    return (
      <dl data-testid={testId} className="divide-y divide-gray-100">
        {keys.map((key: string): ReactElement => {
          const value: string = String(attributes[key]);

          return (
            <div
              key={key}
              className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3"
            >
              <dt className="break-all font-mono text-sm text-gray-500">
                {key}
              </dt>
              <dd className="flex items-start gap-x-2 break-all text-sm text-gray-900 sm:col-span-2">
                <span className="min-w-0">{value}</span>
                <CopyTextButton
                  textToBeCopied={value}
                  iconOnly={true}
                  title={`Copy ${key}`}
                />
              </dd>
            </div>
          );
        })}
      </dl>
    );
  };

  return (
    <Card
      title="Attributes"
      description="Everything OneUptime knows about this item, straight from the data it came in on."
    >
      <Fragment>
        {totalCount > 8 ? (
          <div className="mb-4 max-w-md">
            <Input
              placeholder="Filter attributes by name or value..."
              value={filter}
              onChange={(value: string) => {
                setFilter(value);
              }}
            />
          </div>
        ) : null}

        {Object.keys(identifying).length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Identity</h3>
            <p className="mb-2 text-xs text-gray-500">
              What makes this thing itself. These never change — change one and
              it becomes a different item.
            </p>
            {renderRows(identifying, "inventory-identifying-attributes")}
          </div>
        ) : null}

        {Object.keys(descriptive).length > 0 ? (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-900">Details</h3>
            <p className="mb-2 text-xs text-gray-500">
              Everything else — version, image tag, address. These change freely
              without the item becoming something else.
            </p>
            {renderRows(descriptive, "inventory-descriptive-attributes")}
          </div>
        ) : null}
      </Fragment>
    </Card>
  );
};

export default InventoryAttributes;
