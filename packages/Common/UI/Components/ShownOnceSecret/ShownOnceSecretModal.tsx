import CopyTextButton from "../CopyTextButton/CopyTextButton";
import ConfirmModal from "../Modal/ConfirmModal";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A SECRET SHOWN ONCE: a key OneUptime made just now and keeps only as its
 * hash - the server's master API key (Admin Dashboard > Settings > API Key,
 * #7901), a project's API key when it is created or reset (#8902).
 *
 * This is the one time anyone sees it, so Done is the only way out - no
 * Escape, no X, no click beside it - and the focus starts on the dialog,
 * not on Done, so a reflex Enter does not close it either. The secret is
 * drawn as written, left to right on every page, with a copy button. The
 * caller forgets the secret when onDone is called.
 *
 * The title, the description and the button's text are the caller's, in
 * English: ConfirmModal looks them up in the page's language - unless the
 * caller says the title is in the reader's words already
 * (isTitleTranslated), which is then drawn as given.
 */

export interface ComponentProps {
  title: string;
  /*
   * The title is in the reader's words already: drawn as given, never
   * looked up again (#8423). Left unset, ConfirmModal looks it up.
   */
  isTitleTranslated?: boolean | undefined;
  description: string;
  secret: string;
  doneButtonText: string;
  onDone: () => void;
  // The box that holds the secret, and the secret itself, for tests.
  dataTestId?: string | undefined;
  valueTestId?: string | undefined;
}

export const SHOWN_ONCE_SECRET_TEST_ID: string = "shown-once-secret";
export const SHOWN_ONCE_SECRET_VALUE_TEST_ID: string =
  "shown-once-secret-value";

const ShownOnceSecretModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ConfirmModal
      title={props.title}
      isTitleTranslated={props.isTitleTranslated}
      description={props.description}
      submitButtonText={props.doneButtonText}
      isInitialFocusOnDialog={true}
      onSubmit={props.onDone}
    >
      <div
        className="mt-4 flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
        data-testid={props.dataTestId || SHOWN_ONCE_SECRET_TEST_ID}
      >
        {/* A key reads left to right on every page. */}
        <code
          className="min-w-0 flex-1 break-all font-mono text-sm text-gray-900"
          dir="ltr"
          data-testid={props.valueTestId || SHOWN_ONCE_SECRET_VALUE_TEST_ID}
        >
          {props.secret}
        </code>
        <CopyTextButton
          textToBeCopied={props.secret}
          size="sm"
          variant="soft"
        />
      </div>
    </ConfirmModal>
  );
};

export default ShownOnceSecretModal;
