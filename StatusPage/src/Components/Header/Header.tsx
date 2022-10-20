import Link from 'Common/Types/Link';
import React, { FunctionComponent, ReactElement } from 'react';
import Banner from '../Banner/Banner';
import Logo from '../Logo/Logo';
import UILink from 'CommonUI/src/Components/Link/Link';

export interface ComponentProps { 
    links: Array<Link>;
}

const StatusPageHeader: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {
    return (
        <header
            id="page-topbar"
            style={{
                maxWidth: '880px',
                paddingLeft: '5px',
                margin: 'auto',
                zIndex: 0,
                position: 'unset',
            }}
        >
            <Banner />
            <div
                className="navbar-header"
                style={{
                    padding: '0px',
                    display: "flex",
                    maxWidth: "100%",
                    justifyContent: "space-between"
                }}
            >
                <div className="d-flex">
                    <Logo onClick={() => {}} />
                </div>
                {props.links && props.links.length > 1 && (
                            <div className="col-md-6" key={'links'}>
                                <div className="text-sm-end d-none d-sm-block">
                                    {props.links &&
                                        props.links.map(
                                            (link: Link, i: number) => {
                                                return (
                                                    <span key={i}>
                                                        <UILink
                                                            className="ms-1 underline-on-hover"
                                                            to={link.to}
                                                            openInNewTab={
                                                                link.openInNewTab
                                                            }
                                                        >
                                                            {link.title}
                                                        </UILink>
                                                        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                                                    </span>
                                                );
                                            }
                                        )}
                                </div>
                            </div>
                        )}
            </div>
        </header>
    );
};

export default StatusPageHeader;
