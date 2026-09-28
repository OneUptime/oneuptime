import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import RowActions from "../ActionButton/RowActions";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement, useState, useEffect } from "react";

export interface ComponentProps<T extends GenericObject> {
  item: T;
  actionButtons?: undefined | Array<ActionButtonSchema<T>>;
  titleField: keyof T;
  descriptionField?: keyof T | undefined;
  getTitleElement?: ((item: T) => ReactElement) | undefined;
  getDescriptionElement?: ((item: T) => ReactElement) | undefined;
}

type ItemFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const Item: ItemFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  // Track mobile view for responsive behavior
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const checkMobile: () => void = (): void => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  return (
    <div className="text-center border border-gray-300 rounded p-10 space-y-4 w-fit">
      {!props.getTitleElement && (
        <div>
          {props.item[props.titleField]
            ? (props.item[props.titleField] as string)
            : ""}
        </div>
      )}
      {props.getTitleElement && (
        <div className="justify-center flex">
          {props.getTitleElement(props.item)}
        </div>
      )}
      <div className="text-gray-500">
        {props.getDescriptionElement && (
          <div className="justify-center flex">
            {props.getDescriptionElement(props.item)}
          </div>
        )}
        {!props.getDescriptionElement && (
          <div>
            {props.descriptionField && props.item[props.descriptionField]
              ? (props.item[props.descriptionField] as string)
              : ""}
          </div>
        )}
      </div>
      <RowActions<T>
        item={props.item}
        actionButtons={props.actionButtons}
        isMobile={isMobile}
        className="justify-center"
      />
    </div>
  );
};

export default Item;
