import React, { ReactElement, useId, useMemo, useRef } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ALERT_TEMPLATE_PICKER_ARIA_LABEL,
  ALERT_TEMPLATE_PICKER_INTRO,
  AlertTemplateCategory,
  AlertTemplateGroup,
  AlertTemplatePickerTemplate,
  getAlertTemplateIdAfterKey,
  getAlertTemplateTabStopId,
  getAlertTemplatesInDrawnOrder,
  groupAlertTemplates,
  isCriticalAlertTemplate,
} from "./AlertTemplateGroups";

/*
 * Quick Setup's template list, shared by every infrastructure monitor type.
 *
 * One compact row per template: its name, its severity, and one line that
 * says when it fires. The long description (the metric, the formula, the
 * caveats) is the picked template's, under Template Configuration - it used
 * to sit on every card, up to five lines of grey text each, seventeen cards
 * to a screen.
 *
 * A radio group: one tab stop, arrows move between the rows, Enter or Space
 * picks. Picking replaces the criteria below, so a row is never picked just
 * by arrowing past it.
 */

export interface ComponentProps<T extends AlertTemplatePickerTemplate> {
  templates: Array<T>;
  // Headings to group the rows under; a flat list without them.
  categories?: Array<AlertTemplateCategory> | undefined;
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: T) => void;
}

function AlertTemplatePicker<T extends AlertTemplatePickerTemplate>(
  props: ComponentProps<T>,
): ReactElement {
  const translator: Translator = useTranslator();
  const listRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const introId: string = useId();

  const groups: Array<AlertTemplateGroup<T>> = useMemo(() => {
    return groupAlertTemplates(props.templates, props.categories);
  }, [props.templates, props.categories]);

  const templateIds: Array<string> = useMemo(() => {
    return getAlertTemplatesInDrawnOrder(groups).map((template: T): string => {
      return template.id;
    });
  }, [groups]);

  const tabStopId: string | undefined = getAlertTemplateTabStopId({
    templateIds,
    selectedTemplateId: props.selectedTemplateId,
  });

  const focusTemplate: (templateId: string) => void = (
    templateId: string,
  ): void => {
    const row: HTMLElement | null =
      listRef.current?.querySelector(
        `[data-alert-template-id="${CSS.escape(templateId)}"]`,
      ) || null;

    row?.focus();
  };

  const onRowKeyDown: (event: React.KeyboardEvent, template: T) => void = (
    event: React.KeyboardEvent,
    template: T,
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onTemplateSelected(template);
      return;
    }

    const nextId: string | undefined = getAlertTemplateIdAfterKey({
      templateIds,
      fromTemplateId: template.id,
      key: event.key,
    });

    if (nextId === undefined) {
      return;
    }

    event.preventDefault();

    if (nextId !== template.id) {
      focusTemplate(nextId);
    }
  };

  const renderRow: (template: T) => ReactElement = (
    template: T,
  ): ReactElement => {
    const isSelected: boolean = props.selectedTemplateId === template.id;
    const isCritical: boolean = isCriticalAlertTemplate(template);

    return (
      <div
        key={template.id}
        role="radio"
        aria-checked={isSelected}
        tabIndex={template.id === tabStopId ? 0 : -1}
        data-alert-template-id={template.id}
        data-testid={`alert-template-${template.id}`}
        onClick={() => {
          props.onTemplateSelected(template);
        }}
        onKeyDown={(event: React.KeyboardEvent) => {
          onRowKeyDown(event, template);
        }}
        className={`relative flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
          isSelected
            ? "border-indigo-500 bg-indigo-50/50"
            : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-gray-50"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-gray-900">
              {template.name}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                isCritical
                  ? "bg-red-100 text-red-800"
                  : "bg-yellow-100 text-yellow-800"
              }`}
              data-testid={`alert-template-severity-${template.id}`}
            >
              {translator.translateText(template.severity)}
            </span>
          </div>
          <p
            className="mt-0.5 text-xs leading-5 text-gray-500"
            data-testid={`alert-template-summary-${template.id}`}
          >
            {template.summary}
          </p>
        </div>
        {isSelected ? (
          <Icon
            icon={IconProp.CheckCircle}
            className="h-5 w-5 flex-shrink-0 text-indigo-500"
          />
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="alert-template-picker">
      <p id={introId} className="text-sm text-gray-500">
        {translator.translateText(ALERT_TEMPLATE_PICKER_INTRO)}
      </p>

      <div
        ref={listRef}
        role="radiogroup"
        aria-label={translator.translateText(ALERT_TEMPLATE_PICKER_ARIA_LABEL)}
        aria-describedby={introId}
        className="space-y-5"
      >
        {groups.map((group: AlertTemplateGroup<T>, index: number) => {
          const headingId: string = `${introId}-group-${index}`;

          return (
            <div
              key={group.category || "templates"}
              role={group.label ? "group" : undefined}
              aria-labelledby={group.label ? headingId : undefined}
              data-testid={
                group.category
                  ? `alert-template-group-${group.category}`
                  : "alert-template-group"
              }
            >
              {group.label ? (
                <div className="mb-2 flex items-center gap-2">
                  {group.icon ? (
                    <Icon icon={group.icon} className="h-4 w-4 text-gray-400" />
                  ) : (
                    <></>
                  )}
                  <h4
                    id={headingId}
                    className="text-sm font-semibold text-gray-700"
                  >
                    {translator.translateText(group.label)}
                  </h4>
                </div>
              ) : (
                <></>
              )}
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {group.templates.map(renderRow)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AlertTemplatePicker;
