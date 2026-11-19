import IconProp from "../../../../Types/Icon/IconProp";
import Button, { ButtonSize, ButtonStyleType } from "../../Button/Button";
import Input from "../../Input/Input";
import Clipboard from "../../../Utils/Clipboard";
import Toast from "../../../Utils/Toast";
import { Translator, translationKey } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * COPY LINK, FOR ONE LOG LINE (#9794).
 *
 * A line's details - a row opened in the logs explorer's list, or the line
 * a link opened above it (OpenedLogLine) - copy a link to that very line:
 * the Logs page's address naming it by its id and when it was written,
 * which the app builds (LogsViewer's getLogLink). Whoever opens the link
 * reads the line with their own permissions: the address carries the line's
 * id and time, the list's filters and its window, and nothing that lets
 * anyone in.
 *
 * It is the shared Button, so Tab reaches it and Enter or Space presses it.
 * What happened is said in a toast, which a screen reader hears (the toast
 * region's live regions): "Link copied" only once the link is on the
 * clipboard (Clipboard.copyToClipboard), and otherwise that it could not
 * be copied, with the link shown in a field, selected as it takes the
 * focus, to copy by hand. That toast stays until it is closed.
 */

export const COPY_LOG_LINE_LINK_TEST_ID: string = "log-details-copy-link";
export const LOG_LINE_LINK_COPIED_TOAST_TEST_ID: string =
  "log-line-link-copied";
export const LOG_LINE_LINK_NOT_COPIED_TOAST_TEST_ID: string =
  "log-line-link-not-copied";
export const LOG_LINE_LINK_FIELD_TEST_ID: string = "log-line-link-field";

export const COPY_LOG_LINE_LINK: string = translationKey("Copy Link");
export const LOG_LINE_LINK_COPIED: string = translationKey("Link copied");
export const LOG_LINE_LINK_NOT_COPIED: string = translationKey(
  "Could not copy to the clipboard",
);
export const LOG_LINE_LINK_COPY_BY_HAND: string = translationKey(
  "The clipboard is not available here; copy the link by hand:",
);

interface LinkByHandProps {
  link: string;
}

// The link that could not be copied, to copy by hand: selected as it takes the focus.
const LinkByHand: FunctionComponent<LinkByHandProps> = (
  props: LinkByHandProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = useId();

  return (
    <div
      className="mt-1 space-y-1"
      onFocus={(event: React.FocusEvent<HTMLDivElement>) => {
        if (event.target instanceof HTMLInputElement) {
          event.target.select();
        }
      }}
    >
      <p id={labelId}>
        {translator.translateText(LOG_LINE_LINK_COPY_BY_HAND) ||
          LOG_LINE_LINK_COPY_BY_HAND}
      </p>
      <Input
        value={props.link}
        readOnly={true}
        ariaLabelledby={labelId}
        dataTestId={LOG_LINE_LINK_FIELD_TEST_ID}
      />
    </div>
  );
};

/*
 * Copies `link`, and says in a toast whether it was copied. Resolves
 * whether it was: what a keyboard press, a click and a test all wait on.
 */
export async function copyLogLineLink(data: {
  link: string;
  translator: Translator;
}): Promise<boolean> {
  const hasCopied: boolean = await Clipboard.copyToClipboard(data.link);

  if (hasCopied) {
    Toast.success(
      data.translator.translateText(LOG_LINE_LINK_COPIED) ||
        LOG_LINE_LINK_COPIED,
      { dataTestId: LOG_LINE_LINK_COPIED_TOAST_TEST_ID },
    );

    return true;
  }

  Toast.error(
    data.translator.translateText(LOG_LINE_LINK_NOT_COPIED) ||
      LOG_LINE_LINK_NOT_COPIED,
    {
      description: <LinkByHand link={data.link} />,
      dataTestId: LOG_LINE_LINK_NOT_COPIED_TOAST_TEST_ID,
    },
  );

  return false;
}

export interface ComponentProps {
  // The link to the line, as the app builds it.
  link: string;
}

const CopyLogLineLinkButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Button
      title={COPY_LOG_LINE_LINK}
      icon={IconProp.Link}
      buttonStyle={ButtonStyleType.OUTLINE}
      buttonSize={ButtonSize.Small}
      dataTestId={COPY_LOG_LINE_LINK_TEST_ID}
      onClick={() => {
        void copyLogLineLink({ link: props.link, translator });
      }}
    />
  );
};

export default CopyLogLineLinkButton;
