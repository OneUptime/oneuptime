import React, { FunctionComponent, ReactElement, useMemo } from "react";
import DashboardHtmlComponent from "Common/Types/Dashboard/DashboardComponents/DashboardHtmlComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import HtmlWidgetDocument from "Common/Utils/Dashboard/HtmlWidgetDocument";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import JSONFunctions from "Common/Types/JSONFunctions";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardHtmlComponent;
}

const DashboardHtmlComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { html, css, javascript, allowScripts, allowForms, allowPopups } =
    props.component.arguments;

  const sandbox: string = HtmlWidgetDocument.getSandboxAttribute({
    allowScripts,
    allowForms,
    allowPopups,
  });

  /*
   * The deps are all primitives on purpose.
   *
   * getStartAndEndDate() resolves a relative range ("past one hour") against
   * the clock, so a rebuild produces a different srcDoc every time it runs.
   * Assigning a new srcDoc reloads the frame and throws away whatever the
   * author's script had built, so a render that changes nothing the document
   * depends on — selecting the widget, toggling edit mode — must not
   * rebuild. Depending on props.variables or props.dashboardStartAndEndDate
   * directly would, since the parent hands down fresh references. Serialized
   * keys mean a rebuild happens only when a value actually changed, or on
   * refreshTick, which is the intended way to re-run the widget.
   */
  const variablesKey: string = JSON.stringify(
    HtmlWidgetDocument.resolveVariables(props.variables),
  );
  const rangeKey: string = JSON.stringify({
    range: props.dashboardStartAndEndDate.range,
    startAndEndDate: props.dashboardStartAndEndDate.startAndEndDate,
  });

  const srcDoc: string = useMemo(() => {
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(
        props.dashboardStartAndEndDate,
      );

    return HtmlWidgetDocument.build({
      html,
      css,
      javascript,
      allowScripts,
      allowForms,
      allowPopups,
      variables: props.variables,
      startDate: range.startValue,
      endDate: range.endValue,
    });
  }, [
    html,
    css,
    javascript,
    allowScripts,
    allowForms,
    allowPopups,
    variablesKey,
    rangeKey,
    props.refreshTick,
  ]);

  const isEmpty: boolean = !html && !css && !javascript;

  if (isEmpty) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-gray-300 text-sm">No HTML configured</span>
      </div>
    );
  }

  return (
    <iframe
      /*
       * Remounting on refreshTick is what actually re-runs the author's
       * script: srcDoc is unchanged by a tick alone, and assigning an
       * identical srcDoc does not reload a frame.
       */
      key={`html-widget-${props.componentId.toString()}-${props.refreshTick ?? 0}`}
      title="HTML widget"
      srcDoc={srcDoc}
      sandbox={sandbox}
      referrerPolicy="no-referrer"
      className="w-full h-full border-0 bg-transparent"
      /*
       * An iframe eats every pointer event, so in edit mode it would make
       * the widget impossible to select, drag, or resize — the canvas would
       * never see the click. Content stays visible; it just stops being
       * interactive while the dashboard is being laid out.
       */
      style={{ pointerEvents: props.isEditMode ? "none" : "auto" }}
    />
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    prev.refreshTick !== next.refreshTick
  ) {
    return false;
  }

  /*
   * Deliberately not comparing the pixel width/height the other widgets
   * compare: the iframe is sized in CSS and its content reflows on its own,
   * so a resize needs no React work here.
   */
  if (
    !JSONFunctions.deepEqual(
      prev.dashboardStartAndEndDate,
      next.dashboardStartAndEndDate,
    )
  ) {
    return false;
  }

  if (!JSONFunctions.deepEqual(prev.variables || [], next.variables || [])) {
    return false;
  }

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(DashboardHtmlComponentElement, arePropsEqual);
