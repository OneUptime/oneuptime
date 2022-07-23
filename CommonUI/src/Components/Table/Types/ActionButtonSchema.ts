import { ButtonStyleType } from "../../Button/Button";
import { IconProp } from "../../Icon/Icon";

interface ActionButtonSchema { 
    title: string; 
    icon: IconProp;
    buttonStyleType: ButtonStyleType;
    actionKey: string; 
}

export default ActionButtonSchema;