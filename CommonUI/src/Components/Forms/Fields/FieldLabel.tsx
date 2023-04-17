import React, { FunctionComponent, ReactElement } from 'react';
import Link from '../../Link/Link';
import { FormFieldSideLink } from '../Types/Field';

export interface ComponentProps {
    title: string;
    required?: boolean | undefined;
    sideLink?: FormFieldSideLink | undefined;
    description?: string | undefined;
    isHeading?: boolean | undefined;
}

const FieldLabelElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <>
            <label className={`block ${props.isHeading ? 'text-lg': 'text-sm'}  font-medium text-gray-700 flex justify-between`}>
                <span>
                    {props.title}{' '}
                    <span className="text-gray-400 text-xs">
                        {props.required ? '' : '(Optional)'}
                    </span>
                </span>
                {props.sideLink && props.sideLink?.text && props.sideLink?.url && (
                    <span data-testid="login-forgot-password">
                        <Link
                            to={props.sideLink?.url}
                            openInNewTab={props.sideLink?.openLinkInNewTab}
                            className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
                        >
                            {props.sideLink?.text}
                        </Link>
                    </span>
                )}
            </label>

            {props.description && (
                <p className="mt-1 text-sm text-gray-500">
                    {props.description}
                </p>
            )}
        </>
    );
};

export default FieldLabelElement;
