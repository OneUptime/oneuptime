import React, { FunctionComponent, ReactElement } from 'react';
import URL from 'Common/Types/API/URL';
import Link from '../Link/Link';

export interface ComponentProps {
    title: string;
    description: string;
    link: URL;
    openInNewTab: boolean;
}

const Banner: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="flex border-gray-200 rounded-xl border-2 py-2.5 px-6 sm:px-3.5">
            <p className="text-sm text-gray-500">
                <Link to={props.link} openInNewTab={props.openInNewTab}>
                    <>
                        <strong className="font-semibold">{props.title}</strong>
                        <svg
                            viewBox="0 0 2 2"
                            className="mx-2 inline h-0.5 w-0.5 fill-current"
                            aria-hidden="true"
                        >
                            <circle cx="1" cy="1" r="1" />
                        </svg>
                        {props.description}&nbsp;
                        <span aria-hidden="true">&rarr;</span>
                    </>
                </Link>
            </p>
        </div>
    );
};

export default Banner;
