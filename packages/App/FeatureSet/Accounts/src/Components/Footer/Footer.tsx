import URL from "Common/Types/API/URL";
import {
  HelpPageLink,
  getHelpPageLink,
} from "Common/Types/HelpAndSupport/HelpAndSupport";
import Footer from "Common/UI/Components/Footer/Footer";
import HelpAndSupport from "Common/UI/Utils/HelpAndSupport";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "../LanguageSwitcher/LanguageSwitcher";

export interface ComponentProps {
  /*
   * A form on its owner's own domain (Utils/FormDomainPage): the language
   * picker alone - no OneUptime copyright, contact or legal links on a page
   * that is the customer's.
   */
  isOnFormDomain?: boolean | undefined;
}

const AccountsFooter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  if (props.isOnFormDomain) {
    return (
      <Footer
        className="border-t border-gray-100 px-8"
        /*
         * Centred under the form at every width, as the form is: alone, the
         * picker would sit at the far start of a wide footer.
         */
        innerClassName="mx-auto w-full py-6 px-6 md:flex md:items-center md:justify-center lg:px-8"
        links={[
          {
            content: <LanguageSwitcher />,
          },
        ]}
      />
    );
  }

  /*
   * Contact: OneUptime's support page by default, the server's own help page
   * where its admins set one, or nothing where they hid it (Admin Dashboard
   * > Settings > Help and Support, #10864). Read from env.js, so the link is
   * right before anyone signs in.
   */
  const helpPage: HelpPageLink | null = getHelpPageLink(
    HelpAndSupport.getSettings(),
  );

  return (
    <Footer
      /*
       * On the page's own ground, under a hairline: the quietest thing on
       * the sign-in pages, in either theme. A tint of its own (the shared
       * footer's bg-gray-50/50) is the page's colour on the light page but
       * a lighter band across the bottom of the dark one.
       */
      className="border-t border-gray-100 px-8"
      copyright={t("footer.copyright")}
      links={[
        ...(helpPage
          ? [
              {
                title: t("footer.contact"),
                to: URL.fromStringLenient(helpPage.url),
                openInNewTab: true,
              },
            ]
          : []),
        {
          title: t("footer.privacyAndTerms"),
          to: URL.fromString("https://oneuptime.com/legal"),
          openInNewTab: true,
        },
        {
          content: <LanguageSwitcher />,
        },
      ]}
    />
  );
};

export default AccountsFooter;
