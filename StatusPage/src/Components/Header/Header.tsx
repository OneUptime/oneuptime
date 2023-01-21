import Link from 'Common/Types/Link';
import React, { FunctionComponent, ReactElement } from 'react';
import Logo from '../Logo/Logo';
import UILink from 'CommonUI/src/Components/Link/Link';
import File from 'Model/Models/File';
import Header from 'CommonUI/src/Components/Header/Header';

export interface ComponentProps {
    links: Array<Link>;
    logo?: File | undefined;
}

const StatusPageHeader: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (!props.logo && props.links.length === 0) {
        return <></>;
    }

    return (
        <div>
            
            {(props.logo || props.links?.length > 0) && <Header
                leftComponents={<>
                    {props.logo && (
                        <div className="d-flex">
                            <Logo file={props.logo} onClick={() => { }} />
                        </div>
                    )}
                </>}
                rightComponents={<>
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
                </>} />}
        </div>
    )
};

export default StatusPageHeader;
