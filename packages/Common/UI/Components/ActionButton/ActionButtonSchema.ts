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
  /*
   * A row action the viewer is not allowed to perform stays on screen, locked,
   * so the row does not silently look different from everybody else's. The
   * tooltip is what turns a dead button into an explanation.
   */
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
  onClick: (
    item: T,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ) => void;
}

export default ActionButtonSchema;
