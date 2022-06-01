import { IconProp } from '@fortawesome/fontawesome-svg-core';
import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { FunctionComponent, ReactElement } from 'react';
import './Breadcrumb.scss';

export interface ComponentProps {
    icon: IconProp;
    title: string;
    children: Array<ReactElement>;
}

const Breadcrumb: FunctionComponent<ComponentProps> = ({
    icon,
    title,
    children,
}): ReactElement => {
    return (
        <div className="breadcrumb-container">
            <div className="breadcrumb_detail">
                <div className="breadcrumb_detail__summary">
                    <FontAwesomeIcon icon={icon} />
                    <h2>{title}</h2>
                </div>
                <div className="breadcrumb_detail__crumbs">
                    {children.map((child, index) => (
                        <React.Fragment key={index}>
                            {child}
                            <FontAwesomeIcon icon={faChevronRight} />
                        </React.Fragment>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Breadcrumb;
