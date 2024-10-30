import React, { FunctionComponent, ReactElement, useEffect } from "react";
import DashboardTextComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTextComponent";
import { DashboardCommonComponentProps } from "./DashboardBaseComponent";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import { SizeProp } from "Common/UI/Components/Icon/Icon";

export interface ComponentProps extends DashboardCommonComponentProps {
  component: DashboardTextComponent;
}

const DashboardTextComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [editToolbarElements, setEditToolbarElements] = React.useState<
    Array<ReactElement>
  >([]);

  const boldButton: ReactElement = (
    <Button
      buttonStyle={ButtonStyleType.ICON}
      iconSize={SizeProp.Small}
      icon={IconProp.Bold}
      onClick={() => {
        const component: DashboardTextComponent = { ...props.component };
        component.isBold = !component.isBold;
        props.onComponentUpdate(component);
      }}
    />
  );

  const italicButton: ReactElement = (
    <Button
      buttonStyle={ButtonStyleType.ICON}
      iconSize={SizeProp.Small}
      icon={IconProp.Italic}
      onClick={() => {
        const component: DashboardTextComponent = { ...props.component };
        component.isItalic = !component.isItalic;
        props.onComponentUpdate(component);
      }}
    />
  );

  const underlineButton: ReactElement = (
    <Button
      buttonStyle={ButtonStyleType.ICON}
      iconSize={SizeProp.Small}
      icon={IconProp.Underline}
      onClick={() => {
        const component: DashboardTextComponent = { ...props.component };
        component.isUnderline = !component.isUnderline;
        props.onComponentUpdate(component);
      }}
    />
  );

  useEffect(() => {
    const toolbarElements: Array<ReactElement> = []; // Add toolbar elements here

    toolbarElements.push(boldButton);
    toolbarElements.push(italicButton);
    toolbarElements.push(underlineButton);

    setEditToolbarElements(toolbarElements);
  }, []);

  const textClassName: string = `truncate ${props.component.isBold ? "font-medium" : ""} ${props.component.isItalic ? "italic" : ""} ${props.component.isUnderline ? "underline" : ""}`;

  return (
    <div>
      {props.editToolbarComponentElements(editToolbarElements)}
      <div className={textClassName}>{props.component.text}</div>
    </div>
  );
};

export default DashboardTextComponentElement;
