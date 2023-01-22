import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Icon, { IconProp, SizeProp } from '../Icon/Icon';
import useComponentOutsideClick from '../../Types/UseComponentOutsideClick';
import Image from '../Image/Image';
import Route from 'Common/Types/API/Route';

export interface ComponentProps {
    icon?: IconProp;
    iconImageUrl?: string;
    badge?: undefined | number;
    children?: undefined | ReactElement | Array<ReactElement>;
    title?: string | undefined;
    onClick?: (() => void) | undefined;
    name: string;
}

const HeaderIconDropdownButton: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    const { ref, isComponentVisible, setIsComponentVisible } =
        useComponentOutsideClick(false);
    const [isDropdownVisible, setDropdownVisible] = useState<boolean>(false);

    useEffect(() => {
        setDropdownVisible(isComponentVisible);
    }, [isComponentVisible]);

    return (
        <div className="relative ml-4 flex-shrink-0">
            <div>
                <button
                    type="button"
                    className="flex rounded-full bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                    id="user-menu-button"
                    aria-expanded="false"
                    aria-haspopup="true"
                    onClick={() => {
                        props.onClick && props.onClick();
                        setIsComponentVisible(!isDropdownVisible);
                    }}
                >
                    <span className="sr-only">{props.name}</span>
                    {props.iconImageUrl && (
                        <Image
                            className="h-8 w-8 rounded-full"
                            onClick={() => {
                                props.onClick && props.onClick();
                            }}
                            imageUrl={Route.fromString(`${props.iconImageUrl}`)}
                            alt={props.name}
                        />
                    )}
                    {props.icon && (
                        <Icon
                            className="text-gray-400 hover:text-indigo-500"
                            icon={props.icon}
                            size={SizeProp.Large}
                        />
                    )}
                </button>
                {props.title}
                {props.badge && props.badge > 0 && (
                    <span className="badge bg-danger rounded-pill">
                        {props.badge}
                    </span>
                )}
            </div>

            <div ref={ref}>{isComponentVisible && props.children}</div>
        </div>
    );
};

export default HeaderIconDropdownButton;
