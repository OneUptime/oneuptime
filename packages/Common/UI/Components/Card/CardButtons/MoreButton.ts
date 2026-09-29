import { ButtonStyleType } from "../../Button/Button";
import { CardButtonSchema } from "../Card";
import IconProp from "../../../../Types/Icon/IconProp";

type GetButtonFunctionType = () => CardButtonSchema;

export const getMoreButton: GetButtonFunctionType = (): CardButtonSchema => {
  return {
    title: "",
    buttonStyle: ButtonStyleType.ICON,
    onClick: () => {},
    disabled: false,
    icon: IconProp.More,
  };
};
