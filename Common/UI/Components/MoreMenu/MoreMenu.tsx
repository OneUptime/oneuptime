import React, {
  forwardRef,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import IconProp from "../../../Types/Icon/IconProp";
import useComponentOutsideClick from "../../Types/UseComponentOutsideClick";
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
    const uniqueId: string = useId();
    const menuId: string = `menu-${uniqueId}`;
    const buttonId: string = `menu-button-${uniqueId}`;
    const { ref, isComponentVisible, setIsComponentVisible } =
      useComponentOutsideClick(false);
    const [focusedIndex, setFocusedIndex] = useState<number>(-1);
    const menuItemRefs: React.MutableRefObject<(HTMLDivElement | null)[]> =
      useRef<(HTMLDivElement | null)[]>([]);

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
      if (isComponentVisible) {
        setFocusedIndex(0);
      } else {
        setFocusedIndex(-1);
      }
    }, [isComponentVisible]);

    useEffect(() => {
      if (focusedIndex >= 0 && menuItemRefs.current[focusedIndex]) {
        menuItemRefs.current[focusedIndex]?.focus();
      }
    }, [focusedIndex]);

    const handleKeyDown: (event: React.KeyboardEvent) => void = useCallback(
      (event: React.KeyboardEvent): void => {
        if (!isComponentVisible) {
          return;
        }

        const itemCount: number = props.children.length;

        switch (event.key) {
          case "Escape":
            event.preventDefault();
            setIsComponentVisible(false);
            break;
          case "ArrowDown":
            event.preventDefault();
            setFocusedIndex((prev: number) => {
              return (prev + 1) % itemCount;
            });
            break;
          case "ArrowUp":
            event.preventDefault();
            setFocusedIndex((prev: number) => {
              return (prev - 1 + itemCount) % itemCount;
            });
            break;
          case "Home":
            event.preventDefault();
            setFocusedIndex(0);
            break;
          case "End":
            event.preventDefault();
            setFocusedIndex(itemCount - 1);
            break;
        }
      },
      [isComponentVisible, props.children.length, setIsComponentVisible],
    );

    return (
      <div
        className="relative inline-block text-left"
        onKeyDown={handleKeyDown}
      >
        {!props.elementToBeShownInsteadOfButton && (
          <Button
            id={buttonId}
            icon={props.menuIcon || IconProp.More}
            title={props.text || ""}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={() => {
              setIsComponentVisible(!isDropdownVisible);
            }}
            ariaLabel={props.text || "More options"}
            ariaExpanded={isComponentVisible}
            ariaHaspopup="menu"
            ariaControls={isComponentVisible ? menuId : undefined}
          />
        )}

        {props.elementToBeShownInsteadOfButton && (
          <div>{props.elementToBeShownInsteadOfButton}</div>
        )}

        {isComponentVisible && (
          <div
            ref={ref}
            id={menuId}
            className="absolute right-0 z-10 mt-2 w-56 origin-top-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"
            role="menu"
            aria-orientation="vertical"
            aria-labelledby={buttonId}
          >
            {props.children.map((child: ReactElement, index: number) => {
              return (
                <div
                  key={index}
                  ref={(el: HTMLDivElement | null) => {
                    menuItemRefs.current[index] = el;
                  }}
                  role="menuitem"
                  tabIndex={focusedIndex === index ? 0 : -1}
                  onClick={() => {
                    if (isComponentVisible) {
                      setIsComponentVisible(false);
                    }
                  }}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setIsComponentVisible(false);
                      // Trigger child click
                      const clickEvent: MouseEvent = new MouseEvent("click", {
                        bubbles: true,
                      });
                      e.currentTarget.dispatchEvent(clickEvent);
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
