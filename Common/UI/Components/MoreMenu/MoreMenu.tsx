import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Button, { ButtonStyleType } from "../Button/Button";
import IconProp from "../../../Types/Icon/IconProp";
import useComponentOutsideClick from "../../Types/UseComponentOutsideClick";

export interface ComponentProps {
  children: Array<ReactElement> | ReactElement;
}

const MoreMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const [isDropdownVisible, setDropdownVisible] = useState<boolean>(false);

  useEffect(() => {
    setDropdownVisible(isComponentVisible);
  }, [isComponentVisible]);

  return (
    <div className="relative inline-block text-left">
      <div>
        <Button
          icon={IconProp.More}
          buttonStyle={ButtonStyleType.ICON}
          onClick={() => {
            setIsComponentVisible(!isDropdownVisible);
          }}
        />
      </div>

      {isComponentVisible && (
        <div
          ref={ref}
          className="absolute right-0 z-10 mt-2 w-56 origin-top-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="menu-button"
        >
          {props.children}
        </div>
      )}
    </div>
  );
};

export default MoreMenu;
