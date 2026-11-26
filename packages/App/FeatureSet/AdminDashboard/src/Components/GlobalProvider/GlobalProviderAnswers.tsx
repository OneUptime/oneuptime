import Icon from "Common/UI/Components/Icon/Icon";
import {
  getSsoGlobalReachAnswerDescription,
  getSsoGlobalReachAnswerTitle,
  getSsoGlobalSignUpAnswer,
  getSsoGlobalSignUpAnswerDescription,
  getSsoGlobalSignUpAnswerTitle,
  SSO_GLOBAL_SIGN_UP_ANYONE,
} from "Common/UI/Components/Sso/SsoProviderFormFields";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * ---------------------------------------------------------------------------
 * A SERVER PROVIDER'S TWO QUESTIONS, ON ITS PAGE, AS WHAT THEY DO (#11149).
 *
 * The provider of the report said, on its page:
 *
 *   People without an account          Get one on their first sign-in
 *   Where this sign-in counts as SSO   Every project
 *
 * and gave nobody an account, and added nobody to a project. A server's own
 * provider adds people only to the projects attached to it, with the teams
 * they join there, and it had none: "Get one on their first sign-in" could
 * put nobody anywhere, so the sign-in turned everyone new away
 * (Identity/Utils/GlobalSsoProvisioning) - and "Every project", read on
 * its own, looked like access to every project, where it only says which
 * projects accept the sign-in as SSO.
 *
 * So each answer is drawn with the line the edit form gives it, and while
 * "Get one on their first sign-in" can give nobody an account - no
 * attached project on, with teams - one amber line under it names the
 * break and the way out, as a setting that does nothing yet does
 * (Docs/ux/README.md#settings-and-danger): something to look at, not
 * something broken, and not a banner, since a provider that only signs in
 * people who already have accounts is a sound choice.
 * ---------------------------------------------------------------------------
 */

export const NOBODY_NEW_CAN_SIGN_IN_NOTE: string = translationKey(
  "Nobody new can sign in yet. Attach a project, with the teams they join, under Attached Projects.",
);

export const NOBODY_NEW_CAN_SIGN_IN_NOTE_TEST_ID: string =
  "global-provider-nobody-new-note";

// An attachment as the page's Attached Projects table reads it.
export interface GlobalProviderAttachmentRow {
  isEnabled?: boolean | undefined;
  teams?: Array<unknown> | undefined;
}

/*
 * Whether an attached project takes people who sign in for the first time:
 * one that is on, with teams. Null when the table's rows cannot tell - it
 * holds more than one page and none on this one takes them - so the page
 * never says nobody can sign in when it does not know.
 */
export const canAttachmentsTakeNewcomers: (
  rows: Array<GlobalProviderAttachmentRow>,
  totalCount: number,
) => boolean | null = (
  rows: Array<GlobalProviderAttachmentRow>,
  totalCount: number,
): boolean | null => {
  const takesThem: boolean = rows.some(
    (row: GlobalProviderAttachmentRow): boolean => {
      return row.isEnabled !== false && (row.teams || []).length > 0;
    },
  );

  if (takesThem) {
    return true;
  }

  return totalCount > rows.length ? null : false;
};

export interface SignUpAnswerProps {
  // The provider, as its page read it.
  provider: unknown;
  /*
   * Whether an attached project takes newcomers (canAttachmentsTakeNewcomers),
   * or null while that is not known.
   */
  attachmentsTakeNewcomers: boolean | null;
}

const AnswerWithLine: FunctionComponent<{
  title: string;
  line: string;
  children?: ReactElement | undefined;
}> = (props: {
  title: string;
  line: string;
  children?: ReactElement | undefined;
}): ReactElement => {
  const { t } = useTranslation();

  return (
    <div className="space-y-1 whitespace-normal">
      <span className="block">{t(props.title)}</span>
      {props.line ? (
        <span className="block text-sm text-gray-500">{t(props.line)}</span>
      ) : (
        <></>
      )}
      {props.children || <></>}
    </div>
  );
};

// "People without an account": the answer, what it does, and the break.
export const GlobalProviderSignUpAnswer: FunctionComponent<
  SignUpAnswerProps
> = (props: SignUpAnswerProps): ReactElement => {
  const { t } = useTranslation();

  const givesAccounts: boolean =
    getSsoGlobalSignUpAnswer(props.provider) === SSO_GLOBAL_SIGN_UP_ANYONE;

  return (
    <AnswerWithLine
      title={getSsoGlobalSignUpAnswerTitle(props.provider)}
      line={getSsoGlobalSignUpAnswerDescription(props.provider)}
    >
      {givesAccounts && props.attachmentsTakeNewcomers === false ? (
        // A div, not a p: the icon draws a div of its own.
        <div
          role="note"
          data-testid={NOBODY_NEW_CAN_SIGN_IN_NOTE_TEST_ID}
          className="flex items-start gap-1.5 text-xs font-normal leading-5 text-amber-700"
        >
          <div aria-hidden="true" className="mt-0.5 shrink-0 text-amber-500">
            <Icon icon={IconProp.Alert} className="h-3.5 w-3.5" />
          </div>
          <span className="min-w-0">{t(NOBODY_NEW_CAN_SIGN_IN_NOTE)}</span>
        </div>
      ) : undefined}
    </AnswerWithLine>
  );
};

// "Where this sign-in counts as SSO": the answer, and what it does.
export const GlobalProviderReachAnswer: FunctionComponent<{
  provider: unknown;
}> = (props: { provider: unknown }): ReactElement => {
  return (
    <AnswerWithLine
      title={getSsoGlobalReachAnswerTitle(props.provider)}
      line={getSsoGlobalReachAnswerDescription(props.provider)}
    />
  );
};
