import useComponentOutsideClick from "../../Types/UseComponentOutsideClick";
import Icon from "../Icon/Icon";
import Image from "../Image/Image";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  icon?: IconProp;
  iconImageUrl?: string;
  badge?: undefined | number;
  children?: undefined | ReactElement | Array<ReactElement>;
  title?: string | undefined;
  onClick?: (() => void) | undefined;
  name: string;
  showDropdown: boolean;
}

const HeaderIconDropdownButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);
  const [isDropdownVisible, setDropdownVisible] = useState<boolean>(false);

  useEffect(() => {
    setDropdownVisible(isComponentVisible);
  }, [isComponentVisible]);

  useEffect(() => {
    setDropdownVisible(Boolean(props.showDropdown));
    setIsComponentVisible(Boolean(props.showDropdown));
  }, [props.showDropdown]);

  const hasLabel: boolean = Boolean(props.title);
  const hasDropdown: boolean = Boolean(props.children);

  const sizeClassName: string = hasLabel
    ? "h-9 gap-1.5 pl-2.5 pr-3"
    : "h-9 w-9 justify-center";

  return (
    <div className="relative ml-2 flex-shrink-0">
      <div>
        <button
          type="button"
          className={`flex items-center rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-all duration-150 ${sizeClassName}`}
          id={hasDropdown ? "user-menu-button" : undefined}
          aria-expanded={hasDropdown ? isDropdownVisible : undefined}
          aria-haspopup={hasDropdown ? "true" : undefined}
          onClick={() => {
            props.onClick?.();
            setIsComponentVisible(!isDropdownVisible);
          }}
        >
          {!hasLabel && <span className="sr-only">{props.name}</span>}
          {props.iconImageUrl && (
            <Image
              className="h-7 w-7 rounded-md object-cover"
              onClick={() => {
                props.onClick?.();
              }}
              imageUrl={Route.fromString(`${props.iconImageUrl}`)}
              alt={props.name}
            />
          )}
          {props.icon && (
            <Icon
              className={`${hasLabel ? "h-4 w-4" : "h-5 w-5"} text-gray-500`}
              icon={props.icon}
            />
          )}
          {hasLabel && (
            <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
              {props.title}
            </span>
          )}
        </button>
        {props.badge && props.badge > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-semibold text-white ring-2 ring-white">
            {props.badge}
          </span>
        )}
      </div>

      <div ref={ref}>{isComponentVisible && props.children}</div>
    </div>
  );
};

export default HeaderIconDropdownButton;
