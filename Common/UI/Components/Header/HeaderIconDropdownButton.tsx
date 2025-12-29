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

  return (
    <div className="relative ml-1 flex-shrink-0">
      <div>
        <button
          type="button"
          className="flex items-center justify-center h-9 w-9 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-all duration-150"
          id="user-menu-button"
          aria-expanded="false"
          aria-haspopup="true"
          onClick={() => {
            props.onClick?.();
            setIsComponentVisible(!isDropdownVisible);
          }}
        >
          <span className="sr-only">{props.name}</span>
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
            <Icon className="h-5 w-5 text-gray-500" icon={props.icon} />
          )}
        </button>
        {props.title && (
          <span className="ml-2 text-sm font-medium text-gray-700">
            {props.title}
          </span>
        )}
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
