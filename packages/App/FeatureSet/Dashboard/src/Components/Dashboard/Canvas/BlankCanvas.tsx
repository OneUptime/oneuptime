import React, { FunctionComponent, ReactElement } from "react";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  isEditMode: boolean;
  /*
   * Starts the board with its first widget: edit mode, with the Add Widget
   * dialog open. Handed in only to someone who may edit the dashboard
   * (DashboardView's edit gate), so a reader is never offered it.
   */
  onAddWidgetClick?: (() => void) | undefined;
}

/**
 * Empty state shown when the dashboard has no widgets yet.
 *
 * A dashboard made from Blank Dashboard opens here (Pages/Dashboards), so
 * for someone who may edit it the next step is right on the empty canvas:
 * Add Widget, which goes into edit mode with the widget catalog open. The
 * toolbar's Edit Dashboard is in its ⋯ menu, where a first-time user would
 * not look. While editing, the toolbar's own Add Widget is the way in.
 */
const BlankCanvasElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const offersAddWidget: boolean =
    !props.isEditMode && Boolean(props.onAddWidgetClick);

  let description: string;

  if (props.isEditMode) {
    description = translator.translateText(
      "Add your first widget from the toolbar above. You can drag and resize widgets anywhere on the grid.",
    );
  } else if (offersAddWidget) {
    description = translator.translateText(
      "Add a chart, a number or a list to start this dashboard.",
    );
  } else {
    description = translator.translateText(
      "This dashboard does not have any widgets.",
    );
  }

  return (
    <div
      className={`mx-3 mt-4 mb-4 rounded-2xl border border-dashed text-center py-20 px-10 ${
        props.isEditMode
          ? "border-blue-200 bg-blue-50/30"
          : "border-gray-200 bg-gray-50/50"
      }`}
      style={{
        boxShadow: "var(--ou-card-shadow, 0 2px 8px -2px rgba(0, 0, 0, 0.06))",
      }}
      data-testid="dashboard-blank-canvas"
    >
      <div
        className="mx-auto w-14 h-14 rounded-full bg-white border border-gray-200 flex items-center justify-center mb-4"
        style={{
          boxShadow: "var(--ou-card-shadow, 0 1px 3px 0 rgba(0, 0, 0, 0.04))",
        }}
      >
        <svg
          className="w-6 h-6 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
          />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-gray-700 mb-1">
        {translator.translateText("No widgets yet")}
      </h3>
      <p className="text-sm text-gray-400 max-w-sm mx-auto">{description}</p>
      {offersAddWidget ? (
        <div className="mt-5 flex justify-center">
          <Button
            title="Add Widget"
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.PRIMARY}
            dataTestId="dashboard-blank-canvas-add-widget"
            onClick={() => {
              props.onAddWidgetClick?.();
            }}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default BlankCanvasElement;
