import { ComponentArgument } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import BadDataException from "../../../Types/Exception/BadDataException";
import { ObjectType } from "../../../Types/JSON";
import DashboardChartComponentUtil from "./DashboardChartComponent";
import DashboardTextComponentUtil from "./DashboardTextComponent";
import DashboardValueComponentUtil from "./DashboardValueComponent";



export default class DashboardComponentsUtil { 
    public static getComponentSettingsArguments(dashboardComponentType: ObjectType): Array<ComponentArgument<DashboardBaseComponent>> { 

        if(dashboardComponentType === ObjectType.DashboardChartComponent) {
            return DashboardChartComponentUtil.getComponentConfigArguments() as Array<ComponentArgument<DashboardBaseComponent>>;
        }

        if(dashboardComponentType === ObjectType.DashboardTextComponent) {
            return DashboardTextComponentUtil.getComponentConfigArguments() as Array<ComponentArgument<DashboardBaseComponent>>;
        }

        if(dashboardComponentType === ObjectType.DashboardValueComponent) {
            return DashboardValueComponentUtil.getComponentConfigArguments() as Array<ComponentArgument<DashboardBaseComponent>>;
        }

        throw new BadDataException(`Unknown dashboard component type: ${dashboardComponentType}`);

    }
}