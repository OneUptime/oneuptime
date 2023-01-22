import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Icon, { IconProp } from '../Icon/Icon';

export interface ComponentProps {
    title?: string | undefined;
    description?: string | undefined;
    onClose?: undefined | (() => void);
    onClick?: (() => void) | undefined;
    onOpen?: undefined | (() => void);
    children: ReactElement | Array<ReactElement>;
    rightElement?: ReactElement | undefined;
    isLastElement?: boolean | undefined;
    isInitiallyExpanded?: boolean | undefined;
}

const Accordian: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isOpen, setIsOpen] = useState<boolean>(false);

    useEffect(() => {
        if (props.isInitiallyExpanded) {
            setIsOpen(true);
        }
    }, [props.isInitiallyExpanded]);

    useEffect(() => {
        if (!props.title) {
            setIsOpen(true);
        } else if (!props.isInitiallyExpanded) {
            setIsOpen(false);
        }
    }, [props.title]);

    useEffect(() => {
        props.onClick && props.onClick();

        if (isOpen) {
            props.onOpen && props.onOpen();
        }

        if (!isOpen) {
            props.onClose && props.onClose();
        }
    }, [isOpen]);


    let className = "border-gray-100 border-b-2 -ml-5 -mr-5 p-5";

    if (props.isLastElement) {
        className = "-ml-5 -mr-5 p-5";
    }

    return (
        <div className={className}>
            <div>
                <div
                    className={`flex justify-between cursor-pointer`}
                    role="alert"
                    onClick={() => {
                        setIsOpen(!isOpen);
                    }}
                >
                    <div className="flex">
                        {props.title && (
                            <div>
                                {isOpen && (
                                    <Icon
                                        className='h-4 w-4 text-gray-400'
                                        icon={IconProp.ChevronDown}
                                      
                                    />
                                )}
                                {!isOpen && (
                                    <Icon
                                    className='h-4 w-4 text-gray-400'
                                        icon={IconProp.ChevronRight}
                                        
                                    />
                                )}
                            </div>
                        )}
                        {props.title && (
                            <div
                                className={` ml-4 mt-1 flex ${
                                    props.onClick ? 'cursor-pointer' : ''
                                }`}
                            >
                                <div>
                                   {props.title}{' '}
                                </div>
                                <div>{props.description}</div>
                            </div>
                        )}
                    </div>
                    {!isOpen && (
                        <div className="">
                            {props.rightElement}
                        </div>
                    )}
                </div>
                {isOpen && (
                    <div className='space-y-5'>{props.children}</div>
                )}
            </div>
        </div>
    );
};

export default Accordian;
