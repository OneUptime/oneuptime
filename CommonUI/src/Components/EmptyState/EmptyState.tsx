import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import type { IconProp } from '../Icon/Icon';
import Icon from '../Icon/Icon';

export interface ComponentProps {
    title: string | ReactElement;
    description: string | ReactElement;
    icon: IconProp | undefined;
    footer?: ReactElement | undefined;
}

const EmnptyState: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <React.Fragment>
            <div className="flex mt-52 mb-52">
                <div className="m-auto text-center">
                    {props.icon && (
                        <Icon
                            icon={props.icon}
                            className="mx-auto h-12 w-12 text-gray-400"
                        />
                    )}

                    <h3 className="mt-2 text-sm font-medium text-gray-900">
                        {props.title}
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                        {props.description}
                    </p>
                    {props.footer && <div className="mt-6">{props.footer}</div>}
                </div>
            </div>
        </React.Fragment>
    );
};

export default EmnptyState;
