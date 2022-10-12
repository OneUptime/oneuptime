import React, { FunctionComponent, ReactElement } from 'react';
import Logo from '../Logo/Logo';

const StatusPageHeader: FunctionComponent = (): ReactElement => {

    return (<header id="page-topbar" style={{
        maxWidth: "880px",
        paddingLeft: "5px",
        margin: "auto"
    }}>
        <div className="navbar-header" style={{
            padding: "0px",
            margin: "5px"
        }}>
            <div className="d-flex"><Logo onClick={() => {

            }} /></div>

        </div>
    </header>)

};

export default StatusPageHeader;
