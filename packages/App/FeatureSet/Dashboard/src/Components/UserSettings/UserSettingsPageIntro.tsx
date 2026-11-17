import LearnMoreLink from "Common/UI/Components/Link/LearnMoreLink";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * THE FIRST LINE OF A NOTIFICATION PAGE IN USER SETTINGS.
 *
 * Alerts & Notifications holds four pages whose names sound alike -
 * Notification Methods, How to Reach Me, Notification Settings and Email
 * Preferences - and each answers a different question: where OneUptime can
 * reach you, how you are paged on call, which updates reach you, and how
 * much email they add up to (#8887). Each opens on a line that says which
 * question it answers, links the pages it is mistaken for, and links its
 * docs, as How to Reach Me's own intro does (OnCallRulesTabs).
 *
 * A line of the page, in the page's grey, not a banner: it is what the page
 * is for, true on every visit (NoAlwaysOnInfoBannersGuard).
 */

export interface ComponentProps {
  // The sentence, its page names as links (TranslatedSentence slots).
  children: ReactNode;
  // The page's docs, as "/docs/<category>/<page>".
  docsPath: string;
  dataTestId: string;
}

export const USER_SETTINGS_PAGE_LINK_CLASS_NAME: string =
  "font-medium text-indigo-600 hover:text-indigo-800 hover:underline";

const UserSettingsPageIntro: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="mb-4 text-sm text-gray-500" data-testid={props.dataTestId}>
      {props.children}{" "}
      <LearnMoreLink
        docsPath={props.docsPath}
        dataTestId={`${props.dataTestId}-learn-more`}
      />
    </div>
  );
};

export default UserSettingsPageIntro;
