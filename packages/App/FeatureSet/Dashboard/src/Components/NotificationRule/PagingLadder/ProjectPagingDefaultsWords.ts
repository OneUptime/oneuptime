import { PagingMethodChoice } from "./PagingLadderMethods";
import {
  PagingLadderStep,
  getPagingMethodColumnForChannel,
} from "Common/Types/NotificationRule/PagingLadder";
import {
  PAGING_LADDER_DEFAULT_CHANNELS,
  PagingLadderDefaultStep,
  readPagingLadderDefault,
  toPagingLadderDefaultStep,
  toPagingLadderStepOfChannel,
} from "Common/Types/NotificationRule/PagingLadderDefault";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  FOLDED_SECTION_ON,
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * HOW MEMBERS ARE PAGED BY DEFAULT (#7449): the project's default ladder and
 * its ask for a phone method, in Project Settings > Notification Channels'
 * More settings - folded away, as most projects never set either.
 *
 * The default is a ladder by channel ("push and SMS at once, then a call
 * after 5 minutes"), drawn with How to Reach Me's own editor: each "method"
 * it offers is a channel (Types/NotificationRule/PagingLadderDefault,
 * toPagingLadderStepOfChannel). React-free, so the page and the tests read
 * the same names and words.
 */

export const DEFAULT_LADDER_TITLE: string = translationKey(
  "Default Ladder for New Members",
);

export const PHONE_FOR_ON_CALL_TITLE: string = translationKey(
  "Phone for People on Call",
);

// Each card's place on the page: its title's, as in any More settings.
export const DEFAULT_LADDER_PLACE: string =
  getPageAnchorNameForTitle(DEFAULT_LADDER_TITLE);

export const PHONE_FOR_ON_CALL_PLACE: string = getPageAnchorNameForTitle(
  PHONE_FOR_ON_CALL_TITLE,
);

export const PROJECT_PAGING_DEFAULTS_COPY: {
  ladderDescription: string;
  noDefault: string;
  addLabel: string;
  saved: string;
  turnOff: string;
  readOnly: string;
  phoneCardDescription: string;
  phoneTitle: string;
  phoneDescription: string;
} = {
  // Under the card's title: what it does, and what it never does.
  ladderDescription: translationKey(
    "How a member is paged once they verify a way to be reached. It changes nobody's rules: apply it to members from On-Call Readiness.",
  ),
  // The empty ladder: what happens with no default, as it always has.
  noDefault: translationKey(
    "No default ladder: a member is paged by every method they verify, at once.",
  ),
  // The empty ladder's button, and what each step's Add says to a screen reader.
  addLabel: translationKey("Add a way to reach people"),
  saved: translationKey(
    "Saved. Members are paged this way as they verify a way to be reached.",
  ),
  turnOff: translationKey("Turn Off Default Ladder"),
  readOnly: translationKey(
    "Only a Project Owner or Project Admin can change the default ladder.",
  ),
  phoneCardDescription: translationKey(
    "Ask everyone on an on-call policy to have a verified SMS, phone call or WhatsApp number.",
  ),
  phoneTitle: translationKey("Ask people on call for a phone method"),
  phoneDescription: translationKey(
    "On-Call Readiness and Setup health name everyone on a policy without one, and a setup reminder asks them to add one. Nobody is locked out.",
  ),
};

/*
 * The "methods" a default offers: one per channel a default may name, in
 * the order the ladder lists steps that go together. Named by the channel
 * alone ("SMS", "Phone call"), as the ladder names a method with no number.
 * A push step says how it sounds, as on the person's own ladder.
 */
export const getDefaultLadderChannelChoices: () => Array<PagingMethodChoice> =
  (): Array<PagingMethodChoice> => {
    return PAGING_LADDER_DEFAULT_CHANNELS.map(
      (channel: OnCallPageChannel): PagingMethodChoice => {
        return {
          methodColumn: getPagingMethodColumnForChannel(channel)!,
          methodId: channel,
          channel: channel,
          title: channel,
          identifier: "",
          isVerified: true,
          hasPushLevel: channel === OnCallPageChannel.Push,
          isChannelOnly: true,
        };
      },
    );
  };

// The default as the editor draws it: a ladder whose methods are channels.
export const toDefaultLadderSteps: (
  value: unknown,
) => Array<PagingLadderStep> = (value: unknown): Array<PagingLadderStep> => {
  return readPagingLadderDefault(value).map(toPagingLadderStepOfChannel);
};

// What the editor saves, as the default: steps of channels.
export const toDefaultSteps: (
  steps: ReadonlyArray<PagingLadderStep>,
) => Array<PagingLadderDefaultStep> = (
  steps: ReadonlyArray<PagingLadderStep>,
): Array<PagingLadderDefaultStep> => {
  return steps
    .map(toPagingLadderDefaultStep)
    .filter(
      (
        step: PagingLadderDefaultStep | null,
      ): step is PagingLadderDefaultStep => {
        return step !== null;
      },
    );
};

/*
 * The two cards as More settings' folded header names them: the default
 * with how many steps it has, the ask for a phone as On while it is on.
 */
export const getProjectPagingDefaultsFoldedItems: (data: {
  defaultStepCount: number;
  isPhoneAsked: boolean;
}) => Array<FoldedSectionItem> = (data: {
  defaultStepCount: number;
  isPhoneAsked: boolean;
}): Array<FoldedSectionItem> => {
  return [
    foldedSectionItem(DEFAULT_LADDER_TITLE, {
      key: DEFAULT_LADDER_PLACE,
      isSet: data.defaultStepCount > 0,
      value: String(data.defaultStepCount),
    }),
    foldedSectionItem(PHONE_FOR_ON_CALL_TITLE, {
      key: PHONE_FOR_ON_CALL_PLACE,
      isSet: data.isPhoneAsked,
      value: FOLDED_SECTION_ON,
      translateValue: true,
    }),
  ];
};
