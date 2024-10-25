import React, { FunctionComponent, ReactElement } from "react";
import DashboardTextComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTextComponent";

export interface ComponentProps {
    component: DashboardTextComponent;
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
