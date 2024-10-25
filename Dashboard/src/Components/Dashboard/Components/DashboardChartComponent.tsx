import React, { FunctionComponent, ReactElement } from "react";
import DashboardChartComponent from "Common/Types/Dashboard/DashboardComponents/DashboardChartComponent";

export interface ComponentProps {
    component: DashboardChartComponent;
    isEditMode: boolean
}

const DashboardTextComponentElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps,
): ReactElement => {

    const widthOfComponent: number = props.component.widthInDashboardUnits;
    const heightOfComponent: number = props.component.heightInDashboardUnits;

    let className = `col-span-${widthOfComponent} row-span-${heightOfComponent}`;


    return (
        <div className={
            className
        }>
            Text Component
        </div>
    );
};

export default DashboardTextComponentElement;
