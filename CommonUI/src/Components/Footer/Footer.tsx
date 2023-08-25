import React, { FunctionComponent, ReactElement } from 'react';
import UILink from '../Link/Link';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';

export interface FooterLink {
    onClick?: (() => void) | undefined;
    openInNewTab?: boolean | undefined;
    to?: Route | URL | undefined;
    title: string;
}

export interface ComponentProps {
    copyright?: string | undefined;
    links: Array<FooterLink>;
    style?: React.CSSProperties | undefined;
    className?: string | undefined;
}

const Footer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <React.Fragment>
            <footer
                className={
                    props.className || 'bg-white h-16 inset-x-0 bottom-0'
                }
                style={props.style}
            >
                <div className="mx-auto w-full py-5 px-6 md:flex md:items-center md:justify-between lg:px-0">
                    <div className="flex justify-center space-x-6 md:order-2">
                        {props.links &&
                            props.links.length > 0 &&
                            props.links.map((link: FooterLink, i: number) => {
                                return (
                                    <UILink
                                        key={i}
                                        className="text-gray-400 hover:text-gray-500"
                                        to={link.to}
                                        openInNewTab={link.openInNewTab}
                                        onClick={link.onClick}
                                    >
                                        {link.title}
                                    </UILink>
                                );
                            })}
                    </div>
                    <div className="mt-8 md:order-1 md:mt-0">
                        {props.copyright && (
                            <p className="text-center text-base text-gray-400">
                                &copy; {props.copyright}
                            </p>
                        )}
                    </div>
                </div>
            </footer>
        </React.Fragment>
    );
};

export default Footer;
