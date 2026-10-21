import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export const EDIT_IN_SETTINGS_TEST_ID: string = "edit-in-settings";

/*
 * A resource's name, description, labels and identity are edited in one
 * place: the details card at the top of its Settings page
 * (ResourceDetailsCard). An overview that shows them says where that is
 * with this link, in the header of its details card, where an Edit button
 * used to open a second form for the same fields.
 *
 * A real link - an <a href> that opens in a new tab on a middle or modifier
 * click and is announced as a link - styled as the card's other buttons,
 * built only from classes Theme.css remaps for dark mode.
 */
export interface ComponentProps {
  // The resource's Settings page.
  to: Route;
}

const EditInSettingsLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span data-testid={EDIT_IN_SETTINGS_TEST_ID} className="inline-flex">
      <Link
        to={props.to}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        <Icon
          icon={IconProp.Settings}
          className="h-4 w-4 flex-shrink-0 text-gray-500"
        />
        <span>{translator.translateText("Edit in Settings")}</span>
      </Link>
    </span>
  );
};

export default EditInSettingsLink;
