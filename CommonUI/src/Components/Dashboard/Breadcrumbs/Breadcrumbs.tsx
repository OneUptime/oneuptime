import React, { FunctionComponent, ReactElement } from 'react';
import './Breadcrumbs.scss';
import Icon, { IconProp } from '../../Basic/Icon/Icon';

export interface ComponentProps {
    icon: IconProp;
    children: ReactElement | Array<ReactElement>;
}

const Breadcrumbs: FunctionComponent<ComponentProps> = ({
    icon,
    children,
}: ComponentProps): ReactElement => {
    if (!Array.isArray(children)) {
        children = [children];
    }

    return (
        <div className="breadcrumb-container">
            <div className="breadcrumb_detail">
                <div className="breadcrumb_detail__crumbs">
                    {children.map((child: ReactElement, index: number) => {
                        const isLastItem = index >= (children as Array<ReactElement>).length - 1;
                        return (
                            <React.Fragment key={index}>
                                <span className="crumb">
                                    <span className="breadcrumbs_first_icon">{icon && index === 0 && <Icon icon={icon} />}</span>
                                    <span className="breadcrumb_text" style={{
                                        color: isLastItem ? "black !important" : "rgb(144, 139, 139)"
                                    }}>{child}</span>
                                </span>
                                {!isLastItem && <span className="breadcrumbs_chevron_icon"><Icon icon={IconProp.ChevronRight} /></span>}

                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default Breadcrumbs;
