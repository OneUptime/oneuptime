import React, { FunctionComponent, ReactElement, useEffect } from "react";
import DashboardTextComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTextComponent";
import { DashboardCommonComponentProps } from "./DashboardBaseComponent";
import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import ComponentToolbarIconButton from "./ComponentToolbarIconButton";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";

export interface ComponentProps extends DashboardCommonComponentProps {
  component: DashboardTextComponent;
}

const DashboardTextComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [editToolbarElements, setEditToolbarElements] = React.useState<
    Array<ReactElement>
  >([]);

  const getBoldButton: GetReactElementFunction = () => {
    return (
      <ComponentToolbarIconButton
        tooltip="Bold"
        isSelected={props.component.isBold}
      >
        <Icon
          size={SizeProp.Small}
          icon={IconProp.Bold}
          onClick={() => {
            const component: DashboardTextComponent = { ...props.component };
            component.isBold = !component.isBold;
            props.onComponentUpdate(component);
          }}
        />
      </ComponentToolbarIconButton>
    );
  };

  const getItalicButton: GetReactElementFunction = () => {
    return (
      <ComponentToolbarIconButton
        tooltip="Italic"
        isSelected={props.component.isItalic}
      >
        <Icon
          size={SizeProp.Small}
          icon={IconProp.Italic}
          onClick={() => {
            const component: DashboardTextComponent = { ...props.component };
            component.isItalic = !component.isItalic;
            props.onComponentUpdate(component);
          }}
        />
      </ComponentToolbarIconButton>
    );
  };

  const getUnderlineButton: GetReactElementFunction = () => {
    return (
      <ComponentToolbarIconButton
        tooltip="Underline"
        isSelected={props.component.isUnderline}
      >
        <Icon
          size={SizeProp.Small}
          icon={IconProp.Underline}
          onClick={() => {
            const component: DashboardTextComponent = { ...props.component };
            component.isUnderline = !component.isUnderline;
            props.onComponentUpdate(component);
          }}
        />
      </ComponentToolbarIconButton>
    );
  };

  useEffect(() => {
    const toolbarElements: Array<ReactElement> = []; // Add toolbar elements here

    toolbarElements.push(getBoldButton());
    toolbarElements.push(getItalicButton());
    toolbarElements.push(getUnderlineButton());

    setEditToolbarElements(toolbarElements);
  }, [props.component]);

  const textClassName: string = `truncate ${props.component.isBold ? "font-medium" : ""} ${props.component.isItalic ? "italic" : ""} ${props.component.isUnderline ? "underline" : ""}`;

  return (
    <div>
      {props.editToolbarComponentElements(editToolbarElements)}
      <div className={textClassName}>{props.component.text}</div>
    </div>
  );
};

export default DashboardTextComponentElement;
