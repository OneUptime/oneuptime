import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import Icon, { IconProp, SizeProp, ThickProp } from '../Icon/Icon';

export interface ComponentProps {
    title?: string | undefined;
    description?: string | undefined;
    onClose?: undefined | (() => void);
    onClick?: (() => void) | undefined;
    onOpen?: undefined | (() => void);
    children: ReactElement | Array<ReactElement>;
    rightElement?: ReactElement | undefined;
    isLastElement?: boolean | undefined;
}

const Accordian: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [isOpen, setIsOpen] = useState<boolean>(false);

    useEffect(() => {
        if (!props.title) {
            setIsOpen(true)
        } else {
            setIsOpen(false)
        }
    },[props.title])

    useEffect(() => {
        props.onClick && props.onClick();

        if (isOpen) {
            props.onOpen && props.onOpen();
        }

        if (!isOpen) {
            props.onClose && props.onClose();
        }
    }, [isOpen]);

    return (
        <div className="row accordian-row" style={props.isLastElement ? {
            borderBottomWidth: "0px"
        } : {}}>
            <div className="col-xl-12 accordian-body">
                <div
                    className={`pointer accordian-header`}
                    role="alert"
                    onClick={() => {
                        setIsOpen(!isOpen);
                    }}
                >
                    <div className='accordian-left-elements'>
                        {props.title && <span style={{ height: '10px' }}>
                            {isOpen && (
                                <Icon
                                    thick={ThickProp.LessThick}
                                    icon={IconProp.ChevronDown}
                                    size={SizeProp.Large}
                                />
                            )}
                            {!isOpen && (
                                <Icon
                                    thick={ThickProp.LessThick}
                                    icon={IconProp.ChevronRight}
                                    size={SizeProp.Large}
                                />
                            )}

                        </span>}
                        {props.title && <div
                            className={`flex ${props.onClick ? 'pointer' : ''}`}
                            style={{
                                marginLeft: '5px',
                                marginTop: '1px',
                            }}
                        >
                            <div>
                                <strong>{props.title}</strong>{' '}
                            </div>
                            <div>
                                {props.description}
                            </div>
                        </div>}
                    </div>
                    <div className='accordian-right-element'>
                        {props.rightElement}
                    </div>
                </div>
                {isOpen && <div className='accordian-children'>
                    {props.children}
                </div>}
            </div>
        </div>
    );
};

export default Accordian;
