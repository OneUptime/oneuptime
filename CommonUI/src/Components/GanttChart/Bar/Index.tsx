import React, { FunctionComponent, ReactElement } from 'react';
import Color from 'Common/Types/Color';
import BarLabel from './BarLabel';

export interface ComponentProps {
    barColor: Color;
    barTitle: string;
    barTitleColor: Color;   
    width: number;
}

const Bar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        // rectangle div with curved corners and text inside in tailwindcss

        <div className="h-10 rounded" style={{
            width: `${props.width}`,
            backgroundColor: `${props.barColor}`,
        }}>
            <BarLabel title={props.barTitle} titleColor={props.barTitleColor} />
        </div>
    );
};

export default Bar;
