import React, { FunctionComponent, ReactElement } from "react";
import DefaultDashboardSize from 'Common/Types/Dashboard/DashboardSize'
import BlankRowElement from "./BlankRow";

export interface ComponentProps {
    onDrop: (top: number, left: number) => void;
}

const BlankCanvasElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps,
): ReactElement => {
    const defaultHeight = DefaultDashboardSize.heightInDashboardUnits;

    return (
        <div className="">
            {Array.from(Array(defaultHeight).keys()).map((_, index) => {
                return (
                    <BlankRowElement
                        key={index}
                        rowNumber={index}
                        onDrop={props.onDrop}
                    />
                );
            })}
        </div>
    )

};

export default BlankCanvasElement;
