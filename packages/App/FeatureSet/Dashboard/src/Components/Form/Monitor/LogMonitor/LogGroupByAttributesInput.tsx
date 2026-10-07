import React, { FunctionComponent, ReactElement, useState } from "react";
import AutocompleteTextInput from "Common/UI/Components/AutocompleteTextInput/AutocompleteTextInput";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import {
  MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTES,
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";

export interface ComponentProps {
  initialValue?: Array<string> | undefined;
  // Called with the cleaned-up keys: trimmed, de-duplicated, no blanks.
  onChange?: ((groupByAttributes: Array<string>) => void) | undefined;
  // Log attribute keys the project has seen, offered as you type.
  suggestions?: Array<string> | undefined;
  isLoadingSuggestions?: boolean | undefined;
  ariaLabelledby?: string | undefined;
}

/*
 * The Logs monitor's "Group by Attributes" input: one row per attribute
 * key, each with the same key picker the "Filter by Attributes" field
 * uses. Typing is free, not limited to the suggestions - a key a log
 * pipeline is only about to start extracting (`sophos.con_name`) has not
 * been seen on a log yet, and has to be enterable all the same.
 */
const LogGroupByAttributesInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rows, setRows] = useState<Array<string>>((): Array<string> => {
    return Array.isArray(props.initialValue)
      ? props.initialValue.filter((key: unknown): key is string => {
          return typeof key === "string";
        })
      : [];
  });

  const updateRows: (nextRows: Array<string>) => void = (
    nextRows: Array<string>,
  ): void => {
    setRows(nextRows);
    props.onChange?.(
      MonitorStepLogMonitorUtil.getGroupByAttributes({
        groupByAttributes: nextRows,
      }),
    );
  };

  return (
    <div data-testid="log-group-by-attributes">
      {rows.map((row: string, index: number) => {
        return (
          <div key={index} className="mb-2 flex items-center gap-2">
            <div className="flex-1">
              <AutocompleteTextInput
                value={row}
                placeholder="e.g. con_name"
                suggestions={(props.suggestions || []).filter(
                  (suggestion: string) => {
                    // A key already grouped by is not offered twice.
                    return suggestion === row || !rows.includes(suggestion);
                  },
                )}
                isLoadingSuggestions={props.isLoadingSuggestions}
                loadingMessage="Loading attributes..."
                disableSpellCheck={true}
                ariaLabelledby={props.ariaLabelledby}
                dataTestId={`log-group-by-attribute-${index}`}
                onChange={(value: string) => {
                  const nextRows: Array<string> = [...rows];
                  nextRows[index] = value;
                  updateRows(nextRows);
                }}
              />
            </div>
            <Button
              dataTestId={`remove-log-group-by-attribute-${index}`}
              title="Remove"
              buttonStyle={ButtonStyleType.ICON}
              icon={IconProp.Trash}
              onClick={() => {
                updateRows(
                  rows.filter((_row: string, rowIndex: number) => {
                    return rowIndex !== index;
                  }),
                );
              }}
            />
          </div>
        );
      })}
      {rows.length < MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTES && (
        <div className="-ml-3">
          <Button
            dataTestId="add-log-group-by-attribute"
            title="Add Attribute"
            icon={IconProp.Add}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              // A blank row changes nothing until a key is typed into it.
              setRows([...rows, ""]);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default LogGroupByAttributesInput;
