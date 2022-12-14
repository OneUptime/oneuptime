import React, { FunctionComponent, ReactElement } from 'react';
import Link from 'Common/Types/Link';
import UILink from '../Link/Link';

export interface FooterLink extends Link {
    showOnRightIfNoCopyright?: boolean | undefined;
}

export interface ComponentProps {
    copyright?: string | undefined;
    links: Array<FooterLink>;
    style?: React.CSSProperties | undefined;
}

const Footer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <React.Fragment>
            <footer className="footer">
                <div className="container-fluid" style={props.style}>
                    {props.copyright && (
                        <div className="row">
                            {props.copyright && (
                                <div className="col-md-6">
                                    <p>
                                        <span>
                                            {new Date().getFullYear()} ©{' '}
                                        </span>
                                        <span>{props.copyright}</span>
                                    </p>
                                </div>
                            )}
                            {props.links && props.links.length > 0 && (
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
                    )}

                    {!props.copyright && (
                        <div className="row">
                            <div className="col-md-6">
                                {props.links &&
                                    props.links.filter((link: FooterLink) => {
                                        return !link.showOnRightIfNoCopyright;
                                    }).length > 0 && (

                                        <p>
                                            {props.links &&
                                                props.links
                                                    .filter(
                                                        (link: FooterLink) => {
                                                            return !link.showOnRightIfNoCopyright;
                                                        }
                                                    )
                                                    .map(
                                                        (
                                                            link: Link,
                                                            i: number
                                                        ) => {
                                                            return (
                                                                <span key={i}>
                                                                    <UILink
                                                                        className="ms-1 underline-on-hover"
                                                                        to={
                                                                            link.to
                                                                        }
                                                                        openInNewTab={
                                                                            link.openInNewTab
                                                                        }
                                                                    >
                                                                        {
                                                                            link.title
                                                                        }
                                                                    </UILink>
                                                                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                                                                </span>
                                                            );
                                                        }
                                                    )}
                                        </p>

                                    )}
                            </div>
                            {props.links &&
                                props.links.filter((link: FooterLink) => {
                                    return link.showOnRightIfNoCopyright;
                                }).length > 0 && (
                                    <div className="col-md-6" key={'links'}>
                                        <div className="text-sm-end d-none d-sm-block">
                                            {props.links &&
                                                props.links
                                                    .filter(
                                                        (link: FooterLink) => {
                                                            return link.showOnRightIfNoCopyright;
                                                        }
                                                    )
                                                    .map(
                                                        (
                                                            link: Link,
                                                            i: number
                                                        ) => {
                                                            return (
                                                                <span key={i}>
                                                                    <UILink
                                                                        className="ms-1 underline-on-hover"
                                                                        to={
                                                                            link.to
                                                                        }
                                                                        openInNewTab={
                                                                            link.openInNewTab
                                                                        }
                                                                    >
                                                                        {
                                                                            link.title
                                                                        }
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
                    )}
                </div>
            </footer>
        </React.Fragment>
    );
};

export default Footer;
