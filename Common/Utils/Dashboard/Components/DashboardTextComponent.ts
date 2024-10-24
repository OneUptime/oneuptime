import DashboardTextComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTextComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

export default class DashboardViewConfigUtil {
    public static getDefaultDashboardTextComponent(): DashboardTextComponent {
        return {
            _type: ObjectType.DashboardTextComponent,
            widthInDashboardUnits: 3,
            heightInDashboardUnits: 1,
            topInDashboardUnits: 0,
            leftInDashboardUnits: 0,
            text: "Hello, World!",
            componentId: ObjectID.generate()
        };
    }
}
