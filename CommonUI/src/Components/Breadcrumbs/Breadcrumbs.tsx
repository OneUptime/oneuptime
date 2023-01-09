import Link from 'Common/Types/Link';
import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp } from '../Icon/Icon';
import UILink from '../Link/Link';

interface ComponentProps {
    links: Array<Link>;
}

const Breadcrumbs: FunctionComponent<ComponentProps> = ({
    links,
}: ComponentProps): ReactElement => {
    return (
        <nav className="flex" aria-label="Breadcrumb">
            <ol role="list" className="flex items-center space-x-1">
                {links &&
                    links.length > 0 &&
                    links.map((link: Link, i: number) => {
                        return (
                            <li key={i}>
                                {i === 0 && (
                                    <div className="-mt-1">
                                        <UILink
                                            to={link.to}
                                            className="text-gray-400 hover:text-gray-500 -mt-1"
                                        >
                                            <span className="text-sm font-medium text-gray-500 hover:text-gray-700 -mt-1">
                                                {link.title}
                                            </span>
                                        </UILink>
                                    </div>
                                )}

                                {i !== 0 && (
                                    <div className="flex items-center">
                                        <Icon
                                            className="h-5 w-5 flex-shrink-0 text-gray-400"
                                            icon={IconProp.ChevronRight}
                                        />
                                        <UILink
                                            to={link.to}
                                            className="ml-1 text-sm font-medium text-gray-500 hover:text-gray-700 -mt-1"
                                        >
                                            {link.title}
                                        </UILink>
                                    </div>
                                )}
                            </li>
                        );
                    })}
            </ol>
        </nav>
    );
};

export default Breadcrumbs;
