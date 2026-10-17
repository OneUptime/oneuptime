import URL from "Common/Types/API/URL";
import Link from "Common/Types/Link";
import Footer, { FooterLink } from "Common/UI/Components/Footer/Footer";
import { getPoweredByLink } from "Common/UI/Utils/ProductBranding";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "../LanguageSwitcher/LanguageSwitcher";
import ThemeSwitch from "../ThemeSwitch/ThemeSwitch";
import { useStatusPageTheme } from "../../Utils/StatusPageTheme";
import { doesStatusPageThemeFollowDevice } from "Common/Types/StatusPage/StatusPageTheme";

export interface ComponentProps {
  copyright?: string | undefined;
  links: Array<Link>;
  className?: string | undefined;
  innerClassName?: string | undefined;
  copyrightClassName?: string | undefined;
  hidePoweredByOneUptimeBranding?: boolean | undefined;
  enabledLanguages?: Array<string> | null | undefined;
}

const StatusPageFooter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const { theme } = useStatusPageTheme();
  const links: Array<FooterLink> = [...props.links];

  if (!props.hidePoweredByOneUptimeBranding) {
    /*
     * "Powered by" the product: OneUptime, linking to oneuptime.com, or the
     * name the installation goes by (ProductBranding - the sentence is
     * translated with it), linking to its website, or to nothing when it
     * has none.
     */
    const poweredBy: { name: string; url: string | null } = getPoweredByLink();

    if (poweredBy.url) {
      links.push({
        title: t("footer.poweredBy"),
        to: URL.fromString(poweredBy.url),
        openInNewTab: true,
      });
    } else {
      links.push({
        content: <span>{t("footer.poweredBy")}</span>,
      });
    }
  }

  links.push({
    content: (
      <LanguageSwitcher enabledLanguages={props.enabledLanguages || null} />
    ),
  });

  /*
   * The visitor's light / dark switch, only on a page that follows their
   * device: a Light or Dark page's footer is as it was, with no empty slot.
   */
  if (doesStatusPageThemeFollowDevice(theme)) {
    links.push({
      content: <ThemeSwitch />,
    });
  }

  return (
    <Footer
      className={props.className}
      innerClassName={props.innerClassName}
      copyrightClassName={props.copyrightClassName}
      copyright={props.copyright}
      links={links}
    />
  );
};

export default StatusPageFooter;
