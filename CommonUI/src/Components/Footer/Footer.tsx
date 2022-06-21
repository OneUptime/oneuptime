import React, { FunctionComponent, ReactElement } from 'react';
import Link from 'Common/Types/Link'
import UILink from '../Link/Link';

export interface ComponentProps {
    copyright: string,
    links: Array<Link>
}

const Footer: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {
    return (
        <React.Fragment>
            <footer className="footer">
                <div className="container-fluid">
                    <div className="row">
                        {props.copyright && (
                            <div className="col-md-6"><p>{new Date().getFullYear()} © {props.copyright}</p></div>
                        )}
                        {props.links && props.links.length > 1 && (
                            <div className="col-md-6">
                                <div className="text-sm-end d-none d-sm-block">
                                {props.links && props.links.map((link) => {
                                    return (<><UILink
                                        className="ms-1 underline-on-hover"
                                        to={link.to}
                                    >
                                        {link.title}
                                    </UILink>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</>)
                                })}
                                    </div>
                            </div>
                        )}
                    </div>
                </div>
            </footer>
        </React.Fragment>
    );
};

export default Footer;
