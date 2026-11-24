import Log from "../../../../Models/AnalyticsModels/Log";
import IconProp from "../../../../Types/Icon/IconProp";
import Button, { ButtonSize, ButtonStyleType } from "../../Button/Button";
import {
  COPY_TEXT_BUTTON_COPIED_MS,
  COPY_TEXT_BUTTON_ICON_SIZES,
  getCopyTextButtonClassName,
} from "../../CopyTextButton/CopyTextButton";
import Icon from "../../Icon/Icon";
import Input from "../../Input/Input";
import Clipboard from "../../../Utils/Clipboard";
import Toast from "../../../Utils/Toast";
import { Translator, translationKey } from "../../../Utils/TranslateTemplate";
import useClipboardCopy, {
  ClipboardCopy,
  ClipboardCopyStatus,
} from "../../../Utils/UseClipboardCopy";
import useTranslator from "../../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  memo,
  useId,
  useMemo,
} from "react";

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
 *
 * A row of the list has Copy Link too (#9944, CopyLogRowLinkButton), so a
 * line's link is copied without opening it, and so has the keyboard: `l`
 * copies the link of the row it is on (LogsViewer). Each builds the link
 * with the same getLogLink, as it is pressed, so a row's link and its
 * details' are the same link, and each says what happened the same way.
 */

export const COPY_LOG_LINE_LINK_TEST_ID: string = "log-details-copy-link";
export const COPY_LOG_ROW_LINK_TEST_ID: string = "logs-table-row-copy-link";
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
 * Says in a toast whether `link` was copied: "Link copied", or that it
 * could not be, with the link to copy by hand.
 */
export function sayLogLineLinkCopied(data: {
  link: string;
  hasCopied: boolean;
  translator: Translator;
}): void {
  if (data.hasCopied) {
    Toast.success(
      data.translator.translateText(LOG_LINE_LINK_COPIED) ||
        LOG_LINE_LINK_COPIED,
      { dataTestId: LOG_LINE_LINK_COPIED_TOAST_TEST_ID },
    );

    return;
  }

  Toast.error(
    data.translator.translateText(LOG_LINE_LINK_NOT_COPIED) ||
      LOG_LINE_LINK_NOT_COPIED,
    {
      description: <LinkByHand link={data.link} />,
      dataTestId: LOG_LINE_LINK_NOT_COPIED_TOAST_TEST_ID,
    },
  );
}

/*
 * Copies `link`, and says in a toast whether it was copied. Resolves
 * whether it was: what a keyboard press, a click and a test all wait on.
 */
export async function copyLogLineLink(data: {
  link: string;
  translator: Translator;
}): Promise<boolean> {
  const hasCopied: boolean = await Clipboard.copyToClipboard(data.link);

  sayLogLineLinkCopied({ ...data, hasCopied });

  return hasCopied;
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

export interface CopyLogRowLinkButtonProps {
  // The row's line.
  log: Log;
  // How the app links a line, as its details link it (LogsViewer's getLogLink).
  getLogLink: (log: Log) => string | null | undefined;
  // How the row shows and hides its own actions (LogsTable).
  className?: string | undefined;
}

/*
 * COPY LINK ON A LOG ROW ITSELF (#9944): the line's link, copied without
 * opening the line. It sits beside the row's Copy log message and is drawn
 * like it (the small copy box, CopyTextButton's, with a link in it), and
 * says what happened as the details' Copy Link does: "Link copied" in a
 * toast a screen reader hears, or that it could not be copied, with the
 * link to copy by hand. Its box turns to a tick for a moment as the link
 * lands, for the eye; the toast is what is heard.
 *
 * A row the app cannot link - the viewer gives no getLogLink, or the line
 * has no id the Logs page opens - has none, as its details have none. The
 * link is built as it is pressed, with the getLogLink the details use, so
 * the two are the same link. Pressing it leaves the row as it was: open or
 * closed.
 */
const CopyLogRowLinkButtonElement: FunctionComponent<
  CopyLogRowLinkButtonProps
> = (props: CopyLogRowLinkButtonProps): ReactElement => {
  const translator: Translator = useTranslator();
  const clipboard: ClipboardCopy = useClipboardCopy({
    copiedForMs: COPY_TEXT_BUTTON_COPIED_MS,
  });
  const { getLogLink, log } = props;

  // Drawn only for a line the app can link; memo, so a busy list builds it once a row.
  const canLink: boolean = useMemo((): boolean => {
    return Boolean(getLogLink(log));
  }, [getLogLink, log]);

  if (!canLink) {
    return <></>;
  }

  const name: string =
    translator.translateText(COPY_LOG_LINE_LINK) || COPY_LOG_LINE_LINK;
  const iconSize: string = COPY_TEXT_BUTTON_ICON_SIZES.xs;

  return (
    <button
      type="button"
      className={`${getCopyTextButtonClassName({
        size: "xs",
        variant: "ghost",
        status: clipboard.status,
      })} ${props.className || ""}`}
      title={name}
      aria-label={name}
      data-testid={COPY_LOG_ROW_LINK_TEST_ID}
      data-copy-state={clipboard.status}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        // The row's own action, not a press on the row: it stays as it is.
        event.stopPropagation();

        const link: string = getLogLink(log) || "";

        if (!link) {
          return;
        }

        void clipboard.copy(link).then((hasCopied: boolean): void => {
          sayLogLineLinkCopied({ link, hasCopied, translator });
        });
      }}
    >
      <span aria-hidden="true" className="flex items-center justify-center">
        {clipboard.status === ClipboardCopyStatus.Copied ? (
          <Icon
            icon={IconProp.Check}
            className={`${iconSize} text-emerald-400`}
          />
        ) : clipboard.status === ClipboardCopyStatus.Failed ? (
          <Icon icon={IconProp.Alert} className={iconSize} />
        ) : (
          <Icon icon={IconProp.Link} className={iconSize} />
        )}
      </span>
    </button>
  );
};

/*
 * A list redraws every row as the keyboard moves through it (j and k):
 * a row's Copy Link draws again only when its line or the link's maker do.
 */
export const CopyLogRowLinkButton: React.NamedExoticComponent<CopyLogRowLinkButtonProps> =
  memo(CopyLogRowLinkButtonElement);

export default CopyLogLineLinkButton;
