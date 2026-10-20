import React, { FunctionComponent, ReactElement, useId } from "react";
import {
  DashboardWidgetSortChoice,
  DashboardWidgetSortColumnInfo,
} from "Common/Types/Dashboard/DashboardWidgetSort";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  DASHBOARD_WIDGET_SORT_SETTING_TEST_ID,
  DashboardWidgetSortCopy,
} from "../Components/DashboardWidgetSortCopy";
import {
  WidgetSortOption,
  getWidgetSortOptionValue,
  getWidgetSortOptions,
} from "./WidgetSortOptions";

/*
 * A list or table widget's Sort setting (issue #5082): the order everyone
 * sees its rows in, saved with the dashboard as the widget's own sort
 * (`arguments.sort`). Its first choice is the order the widget always had;
 * viewers can still click a column header to sort it their own way, and a
 * click on a header in the settings' live preview sets this too.
 *
 * Written straight through onChange (not through the section's BasicForm),
 * like the table's Columns editor: a preview click changes the sort from
 * outside the form, and a form's snapshot of its fields would put it back.
 */

export interface ComponentProps {
  columns: ReadonlyArray<DashboardWidgetSortColumnInfo>;
  // The order the widget always had, or null for its query's order.
  builtInSort: DashboardWidgetSortChoice | null;
  // The widget's saved sort, as its arguments hold it.
  savedSort: unknown;
  // The new sort, or null for the widget's own order.
  onChange: (sort: string | null) => void;
}

const WidgetSortEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `widget-sort-label-${useId()}`;

  const options: Array<WidgetSortOption> = getWidgetSortOptions({
    columns: props.columns,
    builtInSort: props.builtInSort,
    savedSort: props.savedSort,
    translator,
  });

  const dropdownOptions: Array<DropdownOption> = options.map(
    (option: WidgetSortOption): DropdownOption => {
      // Already in the reader's language: drawn as built.
      return { value: option.value, label: option.label, isUserContent: true };
    },
  );

  const selectedValue: string = getWidgetSortOptionValue({
    savedSort: props.savedSort,
    builtInSort: props.builtInSort,
  });

  const selected: DropdownOption | undefined = dropdownOptions.find(
    (option: DropdownOption): boolean => {
      return option.value === selectedValue;
    },
  );

  return (
    <div className="mt-4" data-testid={DASHBOARD_WIDGET_SORT_SETTING_TEST_ID}>
      <label id={labelId} className="block text-sm font-medium text-gray-700">
        {translator.translateText(DashboardWidgetSortCopy.settingLabel)}
      </label>
      <p className="mt-1 text-sm text-gray-500">
        {translator.translateText(DashboardWidgetSortCopy.settingDescription)}
      </p>
      <div className="mt-2">
        <Dropdown
          options={dropdownOptions}
          value={selected}
          ariaLabelledby={labelId}
          isClearable={false}
          dataTestId={`${DASHBOARD_WIDGET_SORT_SETTING_TEST_ID}-dropdown`}
          onChange={(
            value: DropdownValue | Array<DropdownValue> | null,
          ): void => {
            const picked: string =
              value === null || Array.isArray(value) ? "" : String(value);

            props.onChange(picked ? picked : null);
          }}
        />
      </div>
      <p className="mt-2 text-xs text-gray-400">
        {translator.translateText(DashboardWidgetSortCopy.settingPreviewHint)}
      </p>
    </div>
  );
};

export default WidgetSortEditor;
