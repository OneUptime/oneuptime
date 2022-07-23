/* eslint-disable jsx-a11y/anchor-is-valid */

import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import React, { FunctionComponent, ReactElement } from 'react';
import Navigation from '../../Utils/Navigation';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement> | string;
    className?: undefined | string;
    to: Route | URL | null | undefined;
    onClick?: undefined | (() => void);
}

const Link: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let children: ReactElement | Array<ReactElement>;

    if (typeof props.children === 'string') {
        children = <span>{props.children}</span>;
    } else {
        children = props.children;
    }

    return (
        <a
            className={`pointer ${props.className || ''}`}
            onClick={() => {
                if (props.to) {
                    Navigation.navigate(props.to);
                }

                if (props.onClick) {
                    props.onClick();
                }
            }}
        >
            {children}
        </a>
    );
};

export default Link;
