import React, { FunctionComponent, ReactElement } from "react";
import DashboardTextComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardTextComponent";
import DashboardChartComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardChartComponent";
import DashboardValueComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { ObjectType } from "Common/Types/JSON";
import DashboardChartComponent from './DashboardChartComponent';
import DashboardValueComponent from './DashboardValueComponent';
import DashboardTextComponent from './DashboardTextComponent';

export interface ComponentProps {
    component: DashboardBaseComponent
    isEditMode: boolean
}

const DashboardBaseComponentElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps,
): ReactElement => {

    const widthOfComponent: number = props.component.widthInDashboardUnits;
    const heightOfComponent: number = props.component.heightInDashboardUnits;

    let className = `col-span-${widthOfComponent} row-span-${heightOfComponent}`;


    return (
        <div className={
            className
        }>
            {props.component._type === ObjectType.DashboardTextComponent && <DashboardTextComponent isEditMode={props.isEditMode} component={props.component as DashboardTextComponentType} />}
            {props.component._type === ObjectType.DashboardChartComponent && <DashboardChartComponent isEditMode={props.isEditMode} component={props.component as DashboardChartComponentType} />}
            {props.component._type === ObjectType.DashboardValueComponent && <DashboardValueComponent isEditMode={props.isEditMode} component={props.component as DashboardValueComponentType} />}
        </div>
    );
};

export default DashboardBaseComponentElement;
