import React, {
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ALERT_TEMPLATE_CHANGE,
  ALERT_TEMPLATE_PICKED_LABEL,
  ALERT_TEMPLATE_PICKER_ARIA_LABEL,
  ALERT_TEMPLATE_PICKER_INTRO,
  ALERT_TEMPLATE_SHOW_LESS,
  ALERT_TEMPLATE_SHOW_MORE,
  AlertTemplateCategory,
  AlertTemplateGroup,
  AlertTemplatePickerTemplate,
  getAlertTemplateIdAfterKey,
  getAlertTemplateTabStopId,
  getAlertTemplatesInDrawnOrder,
  getPickedAlertTemplate,
  groupAlertTemplates,
  hasAlertTemplateDetails,
  isCriticalAlertTemplate,
  isNewAlertTemplatePick,
} from "./AlertTemplateGroups";

/*
 * Quick Setup's template list, shared by every infrastructure monitor type.
 *
 * Nothing picked: one compact row per template - its name, its severity,
 * and one line that says when it fires - under the type's headings.
 *
 * Picked: the list folds into the picked template, the way the monitor
 * type picker on this form folds into the type. Its row stays with a Change
 * button, its full description (the metric, the formula, the caveats) waits
 * behind Show more, and what the template still asks for - the Time Range,
 * handed in as children - sits right under it. Unfolded, that was under
 * every other row: seventeen of them on Kubernetes, a phone's whole screen
 * and more away from the row just tapped.
 *
 * The list is a radio group: one tab stop, arrows move between the rows,
 * Enter or Space picks. Picking replaces the criteria below, so a row is
 * never picked just by arrowing past it. After Change, picking the template
 * already picked - or Escape - only folds the list again: picking it anew
 * would rebuild the criteria and throw away whatever was changed in them.
 */

export interface ComponentProps<T extends AlertTemplatePickerTemplate> {
  templates: Array<T>;
  // Headings to group the rows under; a flat list without them.
  categories?: Array<AlertTemplateCategory> | undefined;
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: T) => void;
  // What the picked template still asks for, under it once the list folds.
  children?: ReactNode | undefined;
}

/*
 * Where keyboard focus goes once the next render is on screen: Change after
 * a pick (the row that had focus is gone with the list), the picked row
 * after Change.
 */
type PendingFocus = "change" | "list";

function AlertTemplatePicker<T extends AlertTemplatePickerTemplate>(
  props: ComponentProps<T>,
): ReactElement {
  const translator: Translator = useTranslator();
  const listRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const changeButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const introId: string = useId();
  const pickedNameId: string = useId();
  const descriptionId: string = useId();

  // After Change: the list is open again, the pick still in place.
  const [isChoosingAgain, setIsChoosingAgain] = useState<boolean>(false);
  const [isDescriptionShown, setIsDescriptionShown] = useState<boolean>(false);
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);

  const groups: Array<AlertTemplateGroup<T>> = useMemo(() => {
    return groupAlertTemplates(props.templates, props.categories);
  }, [props.templates, props.categories]);

  const templateIds: Array<string> = useMemo(() => {
    return getAlertTemplatesInDrawnOrder(groups).map((template: T): string => {
      return template.id;
    });
  }, [groups]);

  const pickedTemplate: T | undefined = getPickedAlertTemplate(
    props.templates,
    props.selectedTemplateId,
  );

  const isFolded: boolean = Boolean(pickedTemplate) && !isChoosingAgain;

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

  useEffect(() => {
    if (!pendingFocus) {
      return;
    }

    if (pendingFocus === "change") {
      if (!isFolded) {
        // The form has not handed the pick back yet.
        return;
      }

      changeButtonRef.current?.focus();
    } else if (tabStopId) {
      focusTemplate(tabStopId);
    }

    setPendingFocus(null);
  }, [pendingFocus, isFolded]);

  const pick: (template: T) => void = (template: T): void => {
    setIsChoosingAgain(false);
    setIsDescriptionShown(false);
    setPendingFocus("change");

    if (
      isNewAlertTemplatePick({
        templateId: template.id,
        selectedTemplateId: props.selectedTemplateId,
      })
    ) {
      props.onTemplateSelected(template);
    }
  };

  const onRowKeyDown: (event: React.KeyboardEvent, template: T) => void = (
    event: React.KeyboardEvent,
    template: T,
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(template);
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

  const renderSeverity: (template: T, testId: string) => ReactElement = (
    template: T,
    testId: string,
  ): ReactElement => {
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
          isCriticalAlertTemplate(template)
            ? "bg-red-100 text-red-800"
            : "bg-yellow-100 text-yellow-800"
        }`}
        data-testid={testId}
      >
        {translator.translateText(template.severity)}
      </span>
    );
  };

  /*
   * The picked template, in place of the list: what it is, when it fires,
   * a way to pick another, and its full description on request.
   */
  if (isFolded && pickedTemplate) {
    const hasDetails: boolean = hasAlertTemplateDetails(pickedTemplate);

    return (
      <div className="space-y-4" data-testid="alert-template-picker">
        <div>
          <FieldLabelElement
            title={ALERT_TEMPLATE_PICKED_LABEL}
            hideOptionalLabel={true}
          />
          <div
            role="group"
            aria-labelledby={pickedNameId}
            data-testid="alert-template-picked"
            data-alert-template-id={pickedTemplate.id}
            /*
             * Change sits beside the words from sm up; on a phone it goes
             * under them, so they keep the card's whole width.
             */
            className="mt-2 flex flex-col gap-2 rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3"
          >
            <div className="min-w-0 sm:flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  id={pickedNameId}
                  className="text-sm font-medium text-gray-900"
                  data-testid="alert-template-picked-name"
                >
                  {pickedTemplate.name}
                </span>
                {renderSeverity(
                  pickedTemplate,
                  "alert-template-picked-severity",
                )}
              </div>
              <p
                className="mt-0.5 text-xs leading-5 text-gray-500"
                data-testid="alert-template-picked-summary"
              >
                {pickedTemplate.summary}
              </p>
              {hasDetails && isDescriptionShown ? (
                <p
                  id={descriptionId}
                  className="mt-1.5 text-xs leading-5 text-gray-500"
                  data-testid="alert-template-description"
                >
                  {pickedTemplate.description}
                </p>
              ) : (
                <></>
              )}
              {hasDetails ? (
                <button
                  type="button"
                  aria-expanded={isDescriptionShown}
                  aria-controls={isDescriptionShown ? descriptionId : undefined}
                  data-testid="alert-template-description-toggle"
                  className="mt-1 rounded text-xs font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  onClick={() => {
                    setIsDescriptionShown(!isDescriptionShown);
                  }}
                >
                  {translator.translateText(
                    isDescriptionShown
                      ? ALERT_TEMPLATE_SHOW_LESS
                      : ALERT_TEMPLATE_SHOW_MORE,
                  )}
                </button>
              ) : (
                <></>
              )}
            </div>
            <button
              ref={changeButtonRef}
              type="button"
              aria-describedby={pickedNameId}
              data-testid="alert-template-change"
              className="flex-shrink-0 self-start rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors duration-150 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              onClick={() => {
                setIsChoosingAgain(true);
                setPendingFocus("list");
              }}
            >
              {translator.translateText(ALERT_TEMPLATE_CHANGE)}
            </button>
          </div>
        </div>
        {props.children}
      </div>
    );
  }

  const renderRow: (template: T) => ReactElement = (
    template: T,
  ): ReactElement => {
    const isSelected: boolean = props.selectedTemplateId === template.id;

    return (
      <div
        key={template.id}
        role="radio"
        aria-checked={isSelected}
        tabIndex={template.id === tabStopId ? 0 : -1}
        data-alert-template-id={template.id}
        data-testid={`alert-template-${template.id}`}
        onClick={() => {
          pick(template);
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
            {renderSeverity(template, `alert-template-severity-${template.id}`)}
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
    <div
      className="space-y-4"
      data-testid="alert-template-picker"
      onKeyDown={(event: React.KeyboardEvent) => {
        // Escape after Change keeps the template already picked.
        if (event.key === "Escape" && isChoosingAgain && pickedTemplate) {
          event.preventDefault();
          event.stopPropagation();
          setIsChoosingAgain(false);
          setPendingFocus("change");
        }
      }}
    >
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
