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
        <div className="page-title-right">
            <ol className="breadcrumb m-0">
                {links &&
                    links.length > 0 &&
                    links.map((link: Link, i: number) => {
                        return (
                            <li
                                key={i}
                                className={`breadcrumb-item padding-0 primary-on-hover ${i === links.length - 1 ? 'active' : ''
                                    }`}
                            >
                                <div className='flex'>
                                    <UILink
                                        className="primary-on-hover"
                                        to={link.to}
                                    >
                                        {link.title}
                                    </UILink>
                                    {(i !== links.length - 1) ? <Icon icon={IconProp.ChevronRight} /> : <></>}
                                </div>
                            </li>
                        );
                    })}
            </ol>
        </div>
    );
};

export default Breadcrumbs;
