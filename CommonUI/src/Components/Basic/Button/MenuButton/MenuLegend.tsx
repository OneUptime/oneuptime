import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    title: string;
}

const MenuLegend: FunctionComponent<ComponentProps> = ({
    title,
}: ComponentProps): ReactElement => {
    return (
        <div className="lists">
            <p className="legend">{title}</p>
        </div>
    );
};

export default MenuLegend;
