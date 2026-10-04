import IconProp from "Common/Types/Icon/IconProp";
import { Indigo500 } from "Common/Types/BrandColors";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import React, { FunctionComponent, ReactElement, useId } from "react";

export interface ComponentProps {
  title: string;
  description: string;
  icon: IconProp;
  onClick: () => void;
  /*
   * Picked, and waiting for the names the project already has before the
   * create form opens with one filled in (Pages/Dashboards). Usually too
   * short to see; on a slow connection it says the click was taken.
   */
  isLoading?: boolean | undefined;
}

/*
 * One card of the "Create from Template" picker. A button named by its
 * title, with its description read as the button's description.
 */
const DashboardTemplateCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const id: string = useId();
  const titleId: string = `${id}-title`;
  const descriptionId: string = `${id}-description`;

  return (
    <div
      className={`cursor-pointer border rounded-lg p-4 hover:border-indigo-500 hover:shadow-md transition-all duration-200 bg-white ${
        props.isLoading ? "border-indigo-500 cursor-wait" : "border-gray-200"
      }`}
      onClick={props.onClick}
      role="button"
      tabIndex={0}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={props.isLoading ? true : undefined}
      data-testid="dashboard-template-card"
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          // Space would scroll the dialog as well.
          e.preventDefault();
          props.onClick();
        }
      }}
    >
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-50 mb-3">
        <Icon
          icon={props.icon}
          size={SizeProp.Large}
          className="text-indigo-500 h-5 w-5"
        />
      </div>
      <h3 id={titleId} className="text-sm font-semibold text-gray-900 mb-1">
        {props.title}
      </h3>
      <p id={descriptionId} className="text-xs text-gray-500 leading-relaxed">
        {props.description}
      </p>
      {props.isLoading ? (
        <Loader
          loaderType={LoaderType.Bar}
          size={64}
          color={Indigo500}
          className="mt-3"
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default DashboardTemplateCard;
