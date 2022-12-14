import Link from 'Common/Types/Link';
import React, { FunctionComponent, ReactElement } from 'react';
import Banner from '../Banner/Banner';
import Logo from '../Logo/Logo';
import UILink from 'CommonUI/src/Components/Link/Link';
import File from 'Model/Models/File';

export interface ComponentProps {
    links: Array<Link>;
    logo?: File | undefined;
    banner?: File | undefined;
}

const StatusPageHeader: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    if (!props.banner && !props.logo && props.links.length === 0) {
        return <></>
    }

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
            {props.banner && <Banner file={props.banner} />}
            <div
                className="navbar-header"
                style={{
                    padding: '0px',
                    display: 'flex',
                    maxWidth: '100%',
                    justifyContent: 'space-between',
                }}
            >
                {props.logo && (
                    <div className="d-flex">
                        <Logo file={props.logo} onClick={() => {}} />
                    </div>
                )}
                {props.links && props.links.length > 1 && (
                    <div
                        className="col-md-6"
                        key={'links'}
                        style={{
                            textAlign: props.logo ? 'right' : 'left',
                        }}
                    >
                        <div>
                            {props.links &&
                                props.links.map((link: Link, i: number) => {
                                    return (
                                        <span key={i}>
                                            <UILink
                                                className="ms-1 underline-on-hover"
                                                style={{
                                                    fontWeight: 500,
                                                    fontSize: '16px',
                                                }}
                                                to={link.to}
                                                openInNewTab={link.openInNewTab}
                                            >
                                                {link.title}
                                            </UILink>
                                            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                                        </span>
                                    );
                                })}
                        </div>
                    </div>
                )}
            </div>
        </header>
    );
};

export default StatusPageHeader;
