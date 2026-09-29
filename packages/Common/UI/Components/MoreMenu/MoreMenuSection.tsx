import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";
import MoreMenuDivider from "./Divider";
export interface ComponentProps {
  title: string;
  children: Array<ReactElement> | ReactElement;
}

const MoreMenuSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translatedTitle: string = translateString(props.title) ?? props.title;
  return (
    <div>
      <div className="text-gray-400 text-xs font-medium pt-2 pl-3 pr-3 pb-2">
        {translatedTitle.toUpperCase()}
      </div>
      {props.children}
      <MoreMenuDivider />
    </div>
  );
};

export default MoreMenuSection;
