import React, { ReactElement, FunctionComponent } from 'react';
import './MenuItem.tsx';

export interface ComponentProps {
    legend?: string;
    items: Array<ReactElement>;
}

const TopbarMenu: FunctionComponent<ComponentProps> = ({
    legend,
    items,
}: ComponentProps): ReactElement => {
    return (
        <div className="lists">
            <p className="legend">{legend}</p>
            <>
                {items.map((item: ReactElement, index: number) => {
                    return <React.Fragment key={index}>{item}</React.Fragment>;
                })}
            </>
        </div>
    );
};

export default TopbarMenu;
