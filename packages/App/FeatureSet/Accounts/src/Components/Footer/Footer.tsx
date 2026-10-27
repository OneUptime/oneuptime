import URL from "Common/Types/API/URL";
import Footer from "Common/UI/Components/Footer/Footer";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "../LanguageSwitcher/LanguageSwitcher";

const AccountsFooter: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

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
        {
          title: t("footer.contact"),
          to: URL.fromString("https://oneuptime.com/support"),
          openInNewTab: true,
        },
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
