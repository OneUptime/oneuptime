import URL from "Common/Types/API/URL";
import Link from "Common/Types/Link";
import Footer, { FooterLink } from "Common/UI/Components/Footer/Footer";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "../LanguageSwitcher/LanguageSwitcher";

export interface ComponentProps {
  copyright?: string | undefined;
  links: Array<Link>;
  className?: string | undefined;
  hidePoweredByOneUptimeBranding?: boolean | undefined;
  enabledLanguages?: Array<string> | null | undefined;
}

const StatusPageFooter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const links: Array<FooterLink> = [...props.links];

  if (!props.hidePoweredByOneUptimeBranding) {
    links.push({
      title: "Powered by OneUptime",
      to: URL.fromString("https://oneuptime.com"),
      openInNewTab: true,
    });
  }

  links.push({
    content: (
      <LanguageSwitcher enabledLanguages={props.enabledLanguages || null} />
    ),
  });

  return (
    <Footer
      className={props.className}
      copyright={props.copyright}
      links={links}
    />
  );
};

export default StatusPageFooter;
