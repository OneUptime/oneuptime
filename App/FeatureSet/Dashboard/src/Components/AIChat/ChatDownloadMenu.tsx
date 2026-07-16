import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  exportConversationAsMarkdown,
  exportConversationAsPdf,
} from "./Export/ChatExport";

export interface ComponentProps {
  title: string;
  messages: Array<AIConversationMessage>;
  latestRun?: AIRun | undefined;
  onError: (error: string) => void;
  // Classes for the trigger, so the menu matches the header it sits in.
  triggerClassName?: string | undefined;
}

/*
 * "Download conversation" — Markdown for something you can read, diff or paste
 * into a ticket, PDF for something you can hand to somebody.
 *
 * The PDF path is async because it fetches the PDF library on demand, so the
 * trigger reports progress and routes any failure (an offline chunk fetch, say)
 * to the chat's error banner rather than failing silently.
 */
const ChatDownloadMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const downloadMarkdown: () => void = (): void => {
    try {
      exportConversationAsMarkdown({
        title: props.title,
        messages: props.messages,
        latestRun: props.latestRun,
      });
    } catch (error) {
      props.onError(
        error instanceof Error
          ? error.message
          : "Could not export this conversation as Markdown.",
      );
    }
  };

  const downloadPdf: () => void = (): void => {
    setIsExporting(true);

    exportConversationAsPdf({
      title: props.title,
      messages: props.messages,
      latestRun: props.latestRun,
    })
      .catch((error: unknown) => {
        props.onError(
          error instanceof Error
            ? error.message
            : "Could not export this conversation as PDF.",
        );
      })
      .finally(() => {
        setIsExporting(false);
      });
  };

  const trigger: ReactElement = isExporting ? (
    <span className="block h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500"></span>
  ) : (
    <Icon icon={IconProp.Download} className="h-4 w-4" />
  );

  /*
   * MoreMenu maps over children directly, so this must stay a literal array of
   * elements — a conditional that yields false in here would break it.
   */
  return (
    <MoreMenu
      text="Download conversation"
      elementToBeShownInsteadOfButton={trigger}
      triggerClassName={
        props.triggerClassName ||
        "rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
      }
    >
      {[
        <MoreMenuItem
          key="markdown"
          text="Download as Markdown"
          icon={IconProp.File}
          onClick={downloadMarkdown}
        />,
        <MoreMenuItem
          key="pdf"
          text="Download as PDF"
          icon={IconProp.Download}
          onClick={downloadPdf}
        />,
      ]}
    </MoreMenu>
  );
};

export default ChatDownloadMenu;
