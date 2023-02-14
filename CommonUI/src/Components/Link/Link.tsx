/* eslint-disable jsx-a11y/anchor-is-valid */

import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import Navigation from '../../Utils/Navigation';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement> | string;
    className?: undefined | string;
    to: Route | URL | null | undefined;
    onClick?: undefined | (() => void);
    onNavigateComplete?: (() => void) | undefined;
    openInNewTab?: boolean | undefined;
    style?: React.CSSProperties | undefined;
    onMouseOver?: (() => void) | undefined;
    onMouseOut?: (() => void) | undefined;
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

    const linkProps: JSONObject = {};

    if (props.openInNewTab) {
        linkProps['target'] = '_blank';
        linkProps['href'] = props.to?.toString();
    }

    return (
        <a
            className={`cursor-pointer ${props.className || ''}`}
            onMouseOver={props.onMouseOver}
            onMouseOut={props.onMouseOut}
            style={props.style}
            onClick={() => {
                if (props.openInNewTab) {
                    return;
                }

                if (props.to) {
                    Navigation.navigate(props.to);
                }

                if (props.onClick) {
                    props.onClick();
                }

                if (props.onNavigateComplete) {
                    props.onNavigateComplete();
                }
            }}
            {...linkProps}
        >
            {children}
        </a>
    );
};

export default Link;
