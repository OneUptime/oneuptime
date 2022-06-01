import { IconProp } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { FunctionComponent, ReactElement } from 'react';
import './Breadcrumb.scss';

export interface ComponentProps {
    icon: IconProp;
    title: string;
}

const Breadcrumb: FunctionComponent<ComponentProps> = ({
    icon,
    title,
}): ReactElement => {
    return (
        <div className="breadcrumb-container">
            <div className="breadcrumb_detail">
                <div className="breadcrumb_detail__summary">
                    <FontAwesomeIcon icon={icon} />
                    <h2>{title}</h2>
                </div>
            </div>
        </div>
    );
};

export default Breadcrumb;
