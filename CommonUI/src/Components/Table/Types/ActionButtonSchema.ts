import { ButtonStyleType } from "../../Button/Button";
import { IconProp } from "../../Icon/Icon";

export enum ActionType { 
    View, Edit, Delete
}

interface ActionButtonSchema { 
    title: string; 
    icon: IconProp;
    buttonStyleType: ButtonStyleType;
    actionType: ActionType; 
}

export default ActionButtonSchema;