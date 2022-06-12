import React, { FunctionComponent, ReactElement } from 'react';
import './Breadcrumbs.scss';
import Icon, { IconProp } from '../../Basic/Icon/Icon';

export interface ComponentProps {
    icon: IconProp;
    title: string;
    children: ReactElement | Array<ReactElement>;
}

const Breadcrumbs: FunctionComponent<ComponentProps> = ({
    icon,
    title,
    children,
}: ComponentProps): ReactElement => {

    if (!Array.isArray(children)) {
        children = [children];
    }

    return (
        <div className="breadcrumb-container">
            <div className="breadcrumb_detail">
                <div className="breadcrumb_detail__summary">
                    <Icon icon={icon} />
                    <h2>{title}</h2>
                </div>
                <div className="breadcrumb_detail__crumbs">
                    {children.map((child: ReactElement, index: number) => {
                        return (
                            <React.Fragment key={index}>
                                {child}
                                <Icon icon={IconProp.ChevronRight} />
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default Breadcrumbs;
