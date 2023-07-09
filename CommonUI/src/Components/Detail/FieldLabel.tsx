import React, { FunctionComponent, ReactElement } from 'react';
import { DetailSideLink } from './Field';
import Link from '../Link/Link';

export enum Size {
    Normal = 'text-sm',
    Medium = 'text-base',
    Large = 'text-=lg',
}

export interface ComponentProps {
    title?: string | undefined;
    description?: string | undefined;
    alignClassName?: string | undefined;
    sideLink?: DetailSideLink | undefined;
    size?: Size | undefined;
}

const FieldLabelElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <>
            {props.title && (
                <label
                    className={`${
                        props.size || 'text-sm'
                    } font-medium text-gray-500`}
                >
                    <span className={props.alignClassName}>{props.title}</span>
                    {props.sideLink &&
                        props.sideLink?.text &&
                        props.sideLink?.url && (
                            <span>
                                <Link
                                    to={props.sideLink?.url}
                                    className="hover:underline"
                                >
                                    {props.sideLink?.text}
                                </Link>
                            </span>
                        )}
                </label>
            )}
            {props.description && (
                <p className={`${props.alignClassName} text-sm text-gray-400`}>
                    {props.description}
                </p>
            )}
        </>
    );
};

export default FieldLabelElement;
