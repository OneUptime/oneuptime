import React, { FunctionComponent, ReactElement } from 'react';

const ProjectPicker: FunctionComponent = (): ReactElement => {
    return (
        <div className="navbar-brand-box">
            <a className="logo logo-dark" href="/dashboard">
                <span className="logo-sm"></span>
                <span className="logo-lg">
                    <img
                        src="/static/media/logo-sm.87ff5472.svg"
                        alt=""
                        height={24}
                    />
                    <span className="logo-txt">Minia</span>
                </span>
            </a>
            <a className="logo logo-light" href="/dashboard">
                <span className="logo-sm">
                    <img
                        src="/static/media/logo-sm.87ff5472.svg"
                        alt=""
                        height={24}
                    />
                </span>
                <span className="logo-lg">
                    <span className="logo-txt">Project Name</span>
                </span>
            </a>
        </div>
    );
};

export default ProjectPicker;
