import React, { FunctionComponent, ReactElement } from 'react';
import Link from 'Common/Types/Link';
import UILink from '../Link/Link';

export interface ComponentProps {
    copyright?: string | undefined;
    links: Array<Link>;
    style?: React.CSSProperties | undefined;
}

const Footer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <React.Fragment>
            <footer
                className="bg-white fixed inset-x-0 bottom-0"
                style={props.style}
            >
                <div className="mx-auto max-w-7xl py-5 px-6 md:flex md:items-center md:justify-between lg:px-8">
                    <div className="flex justify-center space-x-6 md:order-2">
                        {props.links &&
                            props.links.length > 0 &&
                            props.links.map((link: Link, i: number) => {
                                return (
                                    <UILink
                                        key={i}
                                        className="text-gray-400 hover:text-gray-500"
                                        to={link.to}
                                        openInNewTab={link.openInNewTab}
                                    >
                                        {link.title}
                                    </UILink>
                                );
                            })}
                    </div>
                    <div className="mt-8 md:order-1 md:mt-0">
                        <p className="text-center text-base text-gray-400">
                            &copy; {props.copyright}
                        </p>
                    </div>
                </div>
            </footer>
        </React.Fragment>
    );
};

export default Footer;
