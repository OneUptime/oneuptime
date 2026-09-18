import URL from "Common/Types/API/URL";
import Footer from "Common/UI/Components/Footer/Footer";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "../LanguageSwitcher/LanguageSwitcher";

const AccountsFooter: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  return (
    <Footer
      className="bg-gray-50/50 border-t border-gray-100 px-8"
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
