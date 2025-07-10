import { ButtonStyleType } from "../Button/Button";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";

interface ActionButtonSchema<T extends GenericObject> {
  title: string;
  icon?: undefined | IconProp;
  buttonStyleType: ButtonStyleType;
  isLoading?: boolean | undefined;
  isVisible?: (item: T) => boolean | undefined;
  hideOnMobile?: boolean | undefined;
  onClick: (
    item: T,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ) => void;
}

export default ActionButtonSchema;
