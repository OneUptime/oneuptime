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

export const FOOTER_VISITOR_CONTROLS_TEST_ID: string =
  "status-page-footer-visitor-controls";

export const FOOTER_VISITOR_CONTROLS_CLASS_NAME: string =
  "flex items-center justify-center gap-4 md:justify-start";

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

  /*
   * The ways a visitor makes the page their own, as one footer entry: the
   * language switcher and, on a page that follows each visitor's device,
   * their light / dark switch beside it (ThemeSwitch draws nothing on a
   * Light or Dark page). Centred on a phone, as every other footer entry
   * is, and at the row's end from md up.
   */
  links.push({
    content: (
      <div
        className={FOOTER_VISITOR_CONTROLS_CLASS_NAME}
        data-testid={FOOTER_VISITOR_CONTROLS_TEST_ID}
        data-follows-device={
          doesStatusPageThemeFollowDevice(theme) ? "true" : "false"
        }
      >
        <LanguageSwitcher enabledLanguages={props.enabledLanguages || null} />
        <ThemeSwitch />
      </div>
    ),
  });

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
