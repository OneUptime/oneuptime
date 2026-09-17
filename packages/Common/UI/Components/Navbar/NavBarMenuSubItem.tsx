import Link from "../Link/Link";
import Route from "../../../Types/API/Route";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
  route: Route;
}

const NavBarMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translatedTitle: string = translateString(props.title) ?? props.title;
  return (
    <Link className="dropdown-item" to={props.route}>
      {translatedTitle}
    </Link>
  );
};

export default NavBarMenuItem;
