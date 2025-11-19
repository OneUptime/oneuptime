import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export interface EventAttachment {
  name: string;
  downloadUrl: string;
}

export interface EventAttachmentListProps {
  attachments: Array<EventAttachment>;
  title?: string;
  variant?: "section" | "inline";
  showHeader?: boolean;
  showCount?: boolean;
  className?: string;
}

function getAttachmentExtensionLabel(fileName?: string | null): string | null {
  if (!fileName) {
    return null;
  }

  const trimmedName: string = fileName.trim();
  const lastDotIndex: number = trimmedName.lastIndexOf(".");

  if (lastDotIndex === -1 || lastDotIndex === trimmedName.length - 1) {
    return null;
  }

  return trimmedName.substring(lastDotIndex + 1).toUpperCase();
}

type AttachmentCardProps = {
  attachment: EventAttachment;
};

const AttachmentCard: FunctionComponent<AttachmentCardProps> = (
  props: AttachmentCardProps,
): ReactElement => {
  const { attachment } = props;
  const extensionLabel: string | null = getAttachmentExtensionLabel(
    attachment.name,
  );

  return (
    <li>
      <a
        href={attachment.downloadUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={attachment.name}
        className="group flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white/90 px-3 py-2 text-sm text-gray-900 shadow-sm transition hover:border-gray-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
            <Icon icon={IconProp.File} className="h-4 w-4" />
          </span>
          <span className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-gray-900 truncate">
              {attachment.name || "Attachment"}
            </span>
            {extensionLabel && (
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {extensionLabel}
              </span>
            )}
          </span>
        </span>

        <span className="flex flex-shrink-0 items-center gap-1 text-indigo-600">
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-500">
            Download
          </span>
          <Icon
            icon={IconProp.Download}
            className="h-4 w-4 text-indigo-400 transition group-hover:text-indigo-600"
          />
        </span>
      </a>
    </li>
  );
};

const EventAttachmentList: FunctionComponent<EventAttachmentListProps> = (
  props: EventAttachmentListProps,
): ReactElement | null => {
  const {
    attachments,
    title = "Attachments",
    variant = "section",
    showHeader = true,
    showCount = true,
    className = "",
  } = props;

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const attachmentsList: ReactElement = (
    <ul className="space-y-2">
      {attachments.map((attachment: EventAttachment, index: number) => {
        return <AttachmentCard attachment={attachment} key={index} />;
      })}
    </ul>
  );

  if (variant === "inline") {
    return <div className={className}>{attachmentsList}</div>;
  }

  return (
    <div
      className={`mt-4 rounded-2xl border border-gray-100 bg-gray-50/80 p-4 ${className}`.trim()}
    >
      {showHeader && (
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500">
          <span>{title}</span>
          {showCount && (
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600">
              {attachments.length}
            </span>
          )}
        </div>
      )}
      <div className="mt-3">{attachmentsList}</div>
    </div>
  );
};

export default EventAttachmentList;
