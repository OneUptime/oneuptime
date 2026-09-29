import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import AttributesJSONView from "Common/UI/Components/AttributesJSON/AttributesJSONView";
import AttributesViewToggle from "Common/UI/Components/AttributesJSON/AttributesViewToggle";
import CopyAttributesAsJSONButton from "Common/UI/Components/AttributesJSON/CopyAttributesAsJSONButton";
import {
  AttributesView,
  useAttributesView,
} from "Common/UI/Components/AttributesJSON/AttributesJSONPreferences";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import {
  AttributeEntry,
  filterAttributeEntries,
  flattenSpanAttributes,
  pluralize,
} from "../../Utils/TraceDetailPresentation";

export interface ComponentProps {
  instance: ExceptionInstance | undefined;
  isLoading: boolean;
}

// Past this many rows a filter box earns its place above the list.
export const OCCURRENCE_ATTRIBUTE_FILTER_THRESHOLD: number = 8;

/*
 * Everything recorded with the latest occurrence - the service, host and
 * runtime it came from, the request it interrupted, and whatever the
 * application added - as a list to scan or JSON to read and copy. The rows
 * are what someone pastes into the bug report, so the JSON keeps each
 * value's type.
 */
const ExceptionOccurrenceAttributes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [view, setView] = useAttributesView();
  const [filterText, setFilterText] = useState<string>("");

  const rawAttributes: JSONObject | undefined = props.instance?.attributes as
    | JSONObject
    | undefined;

  const entries: Array<AttributeEntry> = useMemo(() => {
    return flattenSpanAttributes(rawAttributes);
  }, [rawAttributes]);

  const visibleEntries: Array<AttributeEntry> = useMemo(() => {
    return filterAttributeEntries(entries, filterText);
  }, [entries, filterText]);

  const hasAttributes: boolean = entries.length > 0;

  const renderBody: () => ReactElement = (): ReactElement => {
    if (props.isLoading && !props.instance) {
      return (
        <div className="flex h-24 items-center justify-center">
          <ComponentLoader />
        </div>
      );
    }

    if (!hasAttributes) {
      return (
        <div
          className="flex items-center gap-3 rounded-lg border border-dashed border-gray-200 px-4 py-5"
          data-testid="exception-occurrence-attributes-empty"
        >
          <Icon icon={IconProp.List} className="h-5 w-5 text-gray-400" />
          <p className="text-sm text-gray-600">
            The latest occurrence was recorded without attributes.
          </p>
        </div>
      );
    }

    if (view === "json") {
      return (
        <AttributesJSONView
          attributes={rawAttributes}
          maxHeightClassName="max-h-[32rem]"
          dataTestId="exception-occurrence-attributes-json"
        />
      );
    }

    return (
      <div className="space-y-3">
        {entries.length > OCCURRENCE_ATTRIBUTE_FILTER_THRESHOLD && (
          <div className="relative max-w-md">
            <Icon
              icon={IconProp.Search}
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
            />
            <input
              type="search"
              value={filterText}
              placeholder={`Filter ${entries.length} attributes`}
              aria-label="Filter attributes"
              className="w-full rounded-md border border-gray-200 py-1.5 pl-8 pr-2 text-sm placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setFilterText(event.target.value);
              }}
            />
          </div>
        )}
        {visibleEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
            No attributes match this filter.
          </div>
        ) : (
          <dl
            className="max-h-[32rem] divide-y divide-gray-100 overflow-auto rounded-lg ring-1 ring-inset ring-gray-200"
            data-testid="exception-occurrence-attributes"
          >
            {visibleEntries.map((entry: AttributeEntry): ReactElement => {
              return (
                <div
                  key={entry.key}
                  className="group flex flex-col gap-0.5 px-3 py-2 hover:bg-gray-50 sm:flex-row sm:gap-4"
                >
                  <dt
                    className="truncate font-mono text-xs text-gray-500 sm:w-72 sm:flex-shrink-0"
                    title={entry.key}
                  >
                    {entry.key}
                  </dt>
                  <dd className="flex min-w-0 flex-1 items-start gap-2 font-mono text-xs text-gray-900">
                    <span className="min-w-0 flex-1 break-all">
                      {entry.value}
                    </span>
                    <span className="flex-shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <CopyTextButton
                        textToBeCopied={entry.value}
                        iconOnly={true}
                        size="xs"
                        title={`Copy ${entry.key}`}
                      />
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    );
  };

  return (
    <Card
      title="Attributes"
      description={
        hasAttributes
          ? `${pluralize(entries.length, "attribute")} recorded with the latest occurrence of this exception.`
          : "Attributes recorded with the latest occurrence of this exception."
      }
      rightElement={
        hasAttributes ? (
          <div
            className="flex items-center gap-1.5"
            data-testid="exception-occurrence-attributes-actions"
          >
            <AttributesViewToggle
              value={view}
              onChange={(nextView: AttributesView) => {
                setView(nextView);
              }}
              dataTestId="exception-occurrence-attributes-view-toggle"
            />
            <CopyAttributesAsJSONButton
              attributes={rawAttributes}
              dataTestId="exception-occurrence-attributes-copy-json"
            />
          </div>
        ) : undefined
      }
    >
      {renderBody()}
    </Card>
  );
};

export default ExceptionOccurrenceAttributes;
