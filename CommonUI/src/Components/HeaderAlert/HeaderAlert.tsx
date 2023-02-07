import React, { ReactElement } from 'react';
import Icon from '../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';

export interface ComponentProps {
    icon: IconProp;
    onClick?: (() => void) | undefined;
    title: string;
    className?: string | undefined;
}

const HeaderAlert: Function = (props: ComponentProps): ReactElement => {
    return (
        <div
            className={`rounded-md ${props.className} p-3 pr-4`}
            onClick={() => {
                props.onClick && props.onClick();
            }}
        >
            <div className="flex ">
                <div className="flex-shrink-0">
                    <Icon icon={props.icon} className="h-5 w-5 text-white" />
                </div>
                <div className="ml-1 flex-1 md:flex md:justify-between">
                    <p className={`text-sm text-white`}>{props.title}</p>
                </div>
            </div>
        </div>
    );
};

export default HeaderAlert;
