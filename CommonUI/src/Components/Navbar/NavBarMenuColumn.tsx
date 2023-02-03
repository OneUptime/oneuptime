import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    title?: undefined | string;
}

const NavBarMenuColumn: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div>
            {props.title && <div className="menu-title">{props.title}</div>}
            <div className="row">
                <div className="col-lg-12">
                    <div>{props.children}</div>
                </div>
            </div>
        </div>
    );
};

export default NavBarMenuColumn;
