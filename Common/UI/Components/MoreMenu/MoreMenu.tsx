import React, {
  forwardRef,
  ReactElement,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import IconProp from "../../../Types/Icon/IconProp";
import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";
import Button, { ButtonStyleType } from "../Button/Button";

export interface ComponentProps {
  children: Array<ReactElement>;
  elementToBeShownInsteadOfButton?: ReactElement | undefined;
  menuIcon?: IconProp | undefined;
  text?: string | undefined;
}

const MoreMenu: React.ForwardRefExoticComponent<
  ComponentProps & React.RefAttributes<unknown>
> = forwardRef(
  (props: ComponentProps, componentRef: React.ForwardedRef<unknown>) => {
    const { ref, isComponentVisible, setIsComponentVisible } =
      useComponentOutsideClick(false);

    useImperativeHandle(componentRef, () => {
      return {
        closeDropdown() {
          setIsComponentVisible(false);
        },
        openDropdown() {
          setIsComponentVisible(true);
        },
        flipDropdown() {
          setIsComponentVisible(!isDropdownVisible);
        },
      };
    });

    const [isDropdownVisible, setDropdownVisible] = useState<boolean>(false);

    useEffect(() => {
      setDropdownVisible(isComponentVisible);
    }, [isComponentVisible]);

    return (
      <div className="relative inline-block text-left">
        {!props.elementToBeShownInsteadOfButton && (
          <Button
            icon={props.menuIcon || IconProp.More}
            title={props.text || ""}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={() => {
              setIsComponentVisible(!isDropdownVisible);
            }}
          />
        )}

        {props.elementToBeShownInsteadOfButton && (
          <div>{props.elementToBeShownInsteadOfButton}</div>
        )}

        {isComponentVisible && (
          <div
            ref={ref}
            className="absolute right-0 z-10 mt-2 w-56 origin-top-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"
            role="menu"
            aria-orientation="vertical"
            aria-labelledby="menu-button"
          >
            {props.children.map((child: ReactElement, index: number) => {
              return (
                <div
                  key={index}
                  role="menuitem"
                  onClick={() => {
                    if (isComponentVisible) {
                      setIsComponentVisible(false);
                    }
                  }}
                >
                  {child}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);

MoreMenu.displayName = "MoreMenu";

export default MoreMenu;
