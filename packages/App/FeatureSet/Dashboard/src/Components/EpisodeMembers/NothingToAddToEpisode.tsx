import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
} from "react";
import { EpisodeMemberKindConfig } from "./EpisodeMemberKinds";

/*
 * Add to Existing Episode and Add to New Episode on a list, when the project
 * allows one in only one episode (EpisodeSingleMembership) and every
 * selected one is in an episode already: no episode could take any of them,
 * so the dialog says that, and why, instead of asking for an episode - with
 * only Close. Drawn like the dialogs' other empty states (EpisodePickerList):
 * an icon, a short title, then the reason.
 *
 * Close is where the keyboard starts, as it is in any dialog with nothing to
 * fill in (Modal's pickInitialFocusElement). Add to Existing Episode turns
 * into this after its list has drawn, inside the same dialog, so the dialog
 * never picks a starting point again: the notice moves focus to Close
 * itself, or it stays wherever it was - outside the dialog, on a search box
 * that is gone.
 */

export const NOTHING_TO_ADD_CLOSE_BUTTON_TEST_ID: string =
  "modal-footer-close-button";

/*
 * The dialog's Close, found from inside its body: the footer is the
 * dialog's own child, so a dialog opened from this one never answers.
 */
export const findDialogCloseButton: (
  element: HTMLElement | null,
) => HTMLElement | null = (element: HTMLElement | null): HTMLElement | null => {
  const dialog: Element | null | undefined =
    element?.closest('[role="dialog"]');

  if (!dialog) {
    return null;
  }

  for (const child of Array.from(dialog.children)) {
    if (child.getAttribute("data-testid") !== "modal-footer") {
      continue;
    }

    return child.querySelector<HTMLElement>(
      `[data-testid="${NOTHING_TO_ADD_CLOSE_BUTTON_TEST_ID}"]`,
    );
  }

  return null;
};

export interface NoticeProps {
  config: EpisodeMemberKindConfig;
  // How many are selected.
  count: number;
  dataTestId: string;
}

export const NothingToAddToEpisodeNotice: FunctionComponent<NoticeProps> = (
  props: NoticeProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const noticeRef: MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  // The one thing left to do: start there.
  useEffect(() => {
    findDialogCloseButton(noticeRef.current)?.focus();
  }, []);

  return (
    <div
      ref={noticeRef}
      data-testid={props.dataTestId}
      role="status"
      className="flex flex-col items-center px-4 py-8 text-center"
    >
      <div
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100"
      >
        <Icon
          icon={props.config.episodeIcon}
          className="h-5 w-5 text-gray-500"
        />
      </div>
      <div className="mt-3 text-sm font-medium text-gray-900">
        {translator.translateText("Nothing to add")}
      </div>
      <p
        data-testid={`${props.dataTestId}-reason`}
        className="mt-1 max-w-md text-sm leading-6 text-gray-500"
      >
        {translator.translatePlural(
          props.config.singleMembershipCopy.nothingToAdd,
          props.count,
        )}
      </p>
    </div>
  );
};

export interface ComponentProps extends NoticeProps {
  // The dialog's own title: what the person asked to do.
  title: string;
  onClose: () => void;
}

const NothingToAddToEpisodeModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Modal
      title={props.title}
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      closeButtonText="Close"
    >
      <NothingToAddToEpisodeNotice
        config={props.config}
        count={props.count}
        dataTestId={props.dataTestId}
      />
    </Modal>
  );
};

export default NothingToAddToEpisodeModal;
