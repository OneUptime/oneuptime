import React, { ReactElement, FC } from 'react';
import './MenuItem.tsx';

export interface ComponentProps {
    legend?: string;
    items: Array<ReactElement>;
}

const TopbarMenu: FC<ComponentProps> = ({ legend, items }): ReactElement => {
    return (
        <div className="lists">
            <p className="legend">{legend}</p>
            <>
                {items.map((item, index) => {
                    return <React.Fragment key={index}>{item}</React.Fragment>;
                })}
            </>
        </div>
    );
};

export default TopbarMenu;
