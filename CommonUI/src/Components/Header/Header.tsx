import React, { ReactElement } from 'react';

export interface ComponentProps {
    leftComponents?: Array<ReactElement> | ReactElement;
    rightComponents?: Array<ReactElement> | ReactElement;
}

const Header = (props: ComponentProps) => {
    return (
        <React.Fragment>
            <header id="page-topbar">
                <div className="navbar-header">
                    <div className="d-flex">{props.leftComponents}</div>
                    <div className="d-flex">{props.rightComponents}</div>
                </div>
            </header>
        </React.Fragment>
    );
};

export default Header;
