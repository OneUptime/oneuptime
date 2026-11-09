import UserLanguageUtil from "Common/UI/Utils/UserLanguage";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import useAsyncEffect from "use-async-effect";
import { followUserLanguage } from "../../Utils/DashboardLanguageSwitch";

/*
 * THE DASHBOARD STARTS IN THE PERSON'S OWN LANGUAGE, ON EVERY BROWSER.
 *
 * A person's language is part of their account (Types/UserLanguage). On a
 * browser that has not shown them the Dashboard before, it starts in the
 * browser's language; once the page is up this reads theirs and, when they
 * picked one and the page shows another, switches to it - so the language
 * they picked on their laptop is the one their phone and every other
 * browser show, and the one their pages are written in.
 *
 * A person who picked none is left in the language the page shows, as
 * before: nothing is saved for them (the language menu and User Profile
 * save a pick). A read that fails changes nothing.
 */
const UserLanguageInit: FunctionComponent = (): ReactElement => {
  const { i18n } = useTranslation();

  useAsyncEffect(async () => {
    await followUserLanguage(
      i18n,
      await UserLanguageUtil.readSignedInUserLanguage(),
    );
  }, []);

  return <></>;
};

export default UserLanguageInit;
