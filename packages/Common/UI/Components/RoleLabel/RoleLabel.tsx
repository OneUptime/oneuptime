import Color from "../../../Types/Color";
import { Black, White } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import React, { FunctionComponent, ReactElement } from "react";
import IsolatedLine from "../IsolatedText/IsolatedLine";

export interface ComponentProps {
  name: string;
  color?: Color | undefined;
  icon?: IconProp | string | undefined;
  description?: string | undefined;
}

/*
 * The role's name. In a table's row the cell keeps it to one line
 * (whitespace-nowrap), and it ends in "..." at its own end; on a phone's
 * card it wraps, breaking a name with no place to break anywhere rather
 * than run past the card. Said to wrap ([overflow-wrap:anywhere]), a name
 * that reads the other way from the page is as wide as its words beside
 * its mark (IsolatedLine's CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME):
 * aligned to its end, as a one-line box is, an English role's wrapped
 * lines all lined up on the right of an Arabic card.
 */
export const ROLE_LABEL_NAME_CLASS_NAME: string =
  "min-w-0 overflow-hidden text-ellipsis text-sm font-medium text-gray-900 [overflow-wrap:anywhere]";

const RoleLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const resolvedColor: Color = props.color || Black;

  // Convert string icon to IconProp if needed
  const resolvedIcon: IconProp | undefined = (() => {
    if (!props.icon) {
      return undefined;
    }
    if (typeof props.icon === "string") {
      // Check if it's a valid IconProp value
      if (Object.values(IconProp).includes(props.icon as IconProp)) {
        return props.icon as IconProp;
      }
      return undefined;
    }
    return props.icon;
  })();

  const iconColor: Color = Color.shouldUseDarkText(resolvedColor)
    ? Black
    : White;

  const element: ReactElement = (
    <div className="flex min-w-0 items-center gap-2">
      {resolvedIcon ? (
        <div
          className="flex items-center justify-center h-6 w-6 rounded-md flex-shrink-0"
          style={{
            backgroundColor: resolvedColor.toString(),
          }}
        >
          <Icon icon={resolvedIcon} className="h-4 w-4" color={iconColor} />
        </div>
      ) : (
        <div
          className="h-3 w-3 rounded-full flex-shrink-0"
          style={{
            backgroundColor: resolvedColor.toString(),
          }}
          aria-hidden="true"
        />
      )}
      {/*
       * Its name reads the way it is written, its mark the page's; where its
       * box is too narrow for it - a table's cell - the name is cut short
       * at its own end (IsolatedLine), where an English role's name on an
       * Arabic page lost its start.
       */}
      <IsolatedLine
        as="span"
        text={props.name}
        className={ROLE_LABEL_NAME_CLASS_NAME}
        dataTestId="role-label-name"
      />
    </div>
  );

  if (props.description) {
    return <Tooltip text={props.description}>{element}</Tooltip>;
  }

  return element;
};

export default RoleLabel;
