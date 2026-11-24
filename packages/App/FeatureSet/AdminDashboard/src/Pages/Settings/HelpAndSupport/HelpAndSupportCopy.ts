import { HelpChoice, HelpItem } from "Common/Types/HelpAndSupport/HelpAndSupport";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF ADMIN DASHBOARD > SETTINGS > HELP AND SUPPORT
 * (#10864, #10865, #10866).
 *
 * Kept free of React so the page and its tests read these exact strings.
 * Each is a key of the Admin Dashboard's locales, in every language
 * (Tests/App/AdminDashboard/AdminHelpAndSupportLocales).
 *
 * The page reads like a short checklist of what people see: each place
 * that offers help, in the card of where it is, says where it appears,
 * what it does by default and what it does now.
 */

export const HelpAndSupportCopy: {
  helpMenuTitle: string;
  helpMenuDescription: string;
  footerTitle: string;
  footerDescription: string;
  mobileAppTitle: string;
  mobileAppDescription: string;
  signInTitle: string;
  signInDescription: string;
  defaultPill: string;
  ownPill: string;
  hiddenPill: string;
  shownPill: string;
  change: string;
  save: string;
  saved: string;
  loadError: string;
  previewLabel: string;
  helpMenuPreviewNote: string;
  signInPreviewNote: string;
  oneUptimeChat: string;
  oneUptimeApp: string;
  helpPageHiddenWhileRenamed: string;
  feedbackToOneUptimeTeam: string;
  feedbackToAdmins: string;
  feedbackKeptForAdmins: string;
  feedbackOpensPage: string;
  feedbackCannotSend: string;
  choiceDefault: string;
  choiceEmail: string;
  choiceLink: string;
  choiceText: string;
  choiceHidden: string;
  feedbackChoiceEmail: string;
  feedbackChoiceEmailDescription: string;
  feedbackChoiceLink: string;
  feedbackChoiceLinkDescription: string;
  feedbackChoiceHidden: string;
  emailPlaceholder: string;
  linkPlaceholder: string;
  messagePlaceholder: string;
  linkHint: string;
  messageHint: string;
  chatOnSlack: string;
  chatWithTeams: string;
  chatWithSupport: string;
  toggleShown: string;
} = {
  helpMenuTitle: translationKey("Help Menu"),
  helpMenuDescription: translationKey(
    "What everyone on this server finds under ? in the header, after the docs and guides.",
  ),
  footerTitle: translationKey("Footer and Products Menu"),
  footerDescription: translationKey(
    "The links at the foot of every page and of the products menu.",
  ),
  mobileAppTitle: translationKey("Mobile App"),
  mobileAppDescription: translationKey(
    "Where the Get the mobile app steps send people to install the app.",
  ),
  signInTitle: translationKey("Single Sign-On"),
  signInDescription: translationKey(
    "What this server's single sign-on says to someone who still needs an invitation.",
  ),
  defaultPill: translationKey("Default"),
  ownPill: translationKey("Your Own"),
  hiddenPill: translationKey("Hidden"),
  shownPill: translationKey("Shown"),
  change: translationKey("Change"),
  save: translationKey("Save"),
  saved: translationKey("Saved"),
  loadError: translationKey(
    "The help and support settings could not be read. Reload the page to try again.",
  ),
  previewLabel: translationKey("Preview"),
  helpMenuPreviewNote: translationKey("What people see under ?"),
  signInPreviewNote: translationKey("What the sign-in screen says"),
  oneUptimeChat: translationKey("OneUptime's community on Slack"),
  oneUptimeApp: translationKey(
    "OneUptime On-Call, from the App Store and Google Play",
  ),
  helpPageHiddenWhileRenamed: translationKey(
    "Not shown while this server goes by its own name.",
  ),
  feedbackToOneUptimeTeam: translationKey("The OneUptime team, at {{email}}"),
  feedbackToAdmins: translationKey("This server's admins, at {{email}}"),
  feedbackKeptForAdmins: translationKey(
    "This server's admins, in Admin Dashboard › Feedback",
  ),
  feedbackOpensPage: translationKey("Opens {{address}}"),
  feedbackCannotSend: translationKey(
    "This server can't send email yet, so Give feedback is not offered until it can. Set up email in Settings › Emails.",
  ),
  choiceDefault: translationKey("Default"),
  choiceEmail: translationKey("Your own address"),
  choiceLink: translationKey("Your own link"),
  choiceText: translationKey("Your own message"),
  choiceHidden: translationKey("Hide it"),
  feedbackChoiceEmail: translationKey("An email address"),
  feedbackChoiceEmailDescription: translationKey(
    "Sent through this server's email settings, with the person's name and address, so your team can reply.",
  ),
  feedbackChoiceLink: translationKey("A page of your own"),
  feedbackChoiceLinkDescription: translationKey(
    "Give feedback opens it in a new tab, such as your help desk's form. Nothing is sent from OneUptime.",
  ),
  feedbackChoiceHidden: translationKey("Hide Give feedback"),
  emailPlaceholder: translationKey("email@yourcompany.com"),
  linkPlaceholder: translationKey("https://help.yourcompany.com"),
  messagePlaceholder: translationKey(
    "Ask the IT service desk to invite you: email@yourcompany.com or https://help.yourcompany.com",
  ),
  linkHint: translationKey(
    "A link that starts with https://, http:// or mailto:.",
  ),
  messageHint: translationKey(
    "Plain text, up to 1000 characters. Links and email addresses become links.",
  ),
  /*
   * Help's chat entry as the Dashboard names it, for the preview: worded as
   * the Dashboard's own help.chatSlack in every language.
   */
  chatOnSlack: translationKey("Chat on Slack"),
  chatWithTeams: translationKey("Chat on Microsoft Teams"),
  chatWithSupport: translationKey("Chat with Support"),
  toggleShown: translationKey("Show it"),
};

// Where each place is, as a card of the page.
export enum HelpCard {
  HelpMenu = "help-menu",
  Footer = "footer",
  MobileApp = "mobile-app",
  SignIn = "sign-in",
}

export interface HelpItemCopy {
  title: string;
  // Where people see it, in one sentence.
  where: string;
  icon: IconProp;
  card: HelpCard;
}

export const HELP_ITEM_COPY: Readonly<Record<HelpItem, HelpItemCopy>> = {
  [HelpItem.SupportEmail]: {
    title: translationKey("Support Email"),
    where: translationKey(
      "Help › Support Email, Contact Support on Page not found, and the address an error screen asks people to send a support bundle to.",
    ),
    icon: IconProp.Email,
    card: HelpCard.HelpMenu,
  },
  [HelpItem.Chat]: {
    title: translationKey("Chat"),
    where: translationKey(
      "Help › Chat on Slack. A link of your own is named for the chat it opens: Slack, Microsoft Teams, or Chat with Support.",
    ),
    icon: IconProp.ChatBubbleLeftRight,
    card: HelpCard.HelpMenu,
  },
  [HelpItem.RequestDemo]: {
    title: translationKey("Request Demo"),
    where: translationKey(
      "Help › Request Demo, which opens OneUptime's page to book a demo.",
    ),
    icon: IconProp.Window,
    card: HelpCard.HelpMenu,
  },
  [HelpItem.GiveFeedback]: {
    title: translationKey("Give Feedback"),
    where: translationKey(
      "Help › Give feedback and Give feedback in Search: where what people write goes.",
    ),
    icon: IconProp.ChatBubbleLeft,
    card: HelpCard.HelpMenu,
  },
  [HelpItem.HelpLink]: {
    title: translationKey("Help and Support"),
    where: translationKey(
      "The Help and Support link in the footer, and Contact on the sign-in pages.",
    ),
    icon: IconProp.Help,
    card: HelpCard.Footer,
  },
  [HelpItem.GitHub]: {
    title: translationKey("Report a Bug or Request a Feature"),
    where: translationKey(
      "The link to OneUptime's GitHub at the foot of the products menu, and the public GitHub issue offered after feedback.",
    ),
    icon: IconProp.GitHub,
    card: HelpCard.Footer,
  },
  [HelpItem.MobileApp]: {
    title: translationKey("Get the Mobile App"),
    where: translationKey(
      "How to Reach Me, the on-call setup, a new member's first steps on Home, and Project Settings › Mobile Apps.",
    ),
    icon: IconProp.DevicePhoneMobile,
    card: HelpCard.MobileApp,
  },
  [HelpItem.InviteMessage]: {
    title: translationKey("Message for People Who Need an Invitation"),
    where: translationKey(
      "Shown on the “You need to be invited.” and “No project access.” screens, with whom to ask, in place of the default sentence.",
    ),
    icon: IconProp.Lock,
    card: HelpCard.SignIn,
  },
};

// The cards, in the order the page draws them, with their words.
export const HELP_CARDS: ReadonlyArray<{
  card: HelpCard;
  title: string;
  description: string;
}> = [
  {
    card: HelpCard.HelpMenu,
    title: HelpAndSupportCopy.helpMenuTitle,
    description: HelpAndSupportCopy.helpMenuDescription,
  },
  {
    card: HelpCard.Footer,
    title: HelpAndSupportCopy.footerTitle,
    description: HelpAndSupportCopy.footerDescription,
  },
  {
    card: HelpCard.MobileApp,
    title: HelpAndSupportCopy.mobileAppTitle,
    description: HelpAndSupportCopy.mobileAppDescription,
  },
  {
    card: HelpCard.SignIn,
    title: HelpAndSupportCopy.signInTitle,
    description: HelpAndSupportCopy.signInDescription,
  },
];

/*
 * The title of each choice in an item's dialog. Give feedback names its
 * address and its page by what they are; every other item says "your own".
 */
export const getChoiceTitle: (item: HelpItem, choice: HelpChoice) => string = (
  item: HelpItem,
  choice: HelpChoice,
): string => {
  if (item === HelpItem.GiveFeedback) {
    switch (choice) {
      case HelpChoice.Email:
        return HelpAndSupportCopy.feedbackChoiceEmail;
      case HelpChoice.Link:
        return HelpAndSupportCopy.feedbackChoiceLink;
      case HelpChoice.Hidden:
        return HelpAndSupportCopy.feedbackChoiceHidden;
      default:
        return HelpAndSupportCopy.choiceDefault;
    }
  }

  switch (choice) {
    case HelpChoice.Email:
      return HelpAndSupportCopy.choiceEmail;
    case HelpChoice.Link:
      return HelpAndSupportCopy.choiceLink;
    case HelpChoice.Text:
      return HelpAndSupportCopy.choiceText;
    case HelpChoice.Hidden:
      return HelpAndSupportCopy.choiceHidden;
    default:
      return HelpAndSupportCopy.choiceDefault;
  }
};

// The data-testids, for the page and its suites.
export const HELP_AND_SUPPORT_PAGE_TEST_ID: string = "help-and-support";

export const getHelpItemTestId: (item: HelpItem) => string = (
  item: HelpItem,
): string => {
  return `help-and-support-${item}`;
};

export const getHelpCardTestId: (card: HelpCard) => string = (
  card: HelpCard,
): string => {
  return `help-and-support-card-${card}`;
};
