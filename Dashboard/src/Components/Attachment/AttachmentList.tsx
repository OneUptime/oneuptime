import React, { FunctionComponent, ReactElement } from "react";
import FileModel from "Common/Models/DatabaseModels/File";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";

export interface AttachmentListProps {
  modelId?: string | null;
  attachments?: Array<FileModel> | null | undefined;
  attachmentApiPath: string;
  title?: string;
  className?: string;
  buildAttachmentUrl?: (fileId: string) => string;
}

const AttachmentList: FunctionComponent<AttachmentListProps> = (
  props: AttachmentListProps,
): ReactElement | null => {
  const {
    modelId,
    attachments,
    attachmentApiPath,
    title = "Attachments",
    className = "space-y-1",
    buildAttachmentUrl,
  } = props;

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const attachmentLinks: Array<ReactElement> = [];

  for (const file of attachments) {
    const fileIdentifier = file._id || file.id;

    if (!fileIdentifier) {
      continue;
    }

    const fileIdAsString: string = fileIdentifier.toString();

    let downloadUrl: string | null = null;

    if (buildAttachmentUrl) {
      downloadUrl = buildAttachmentUrl(fileIdAsString);
    } else if (modelId) {
      downloadUrl = URL.fromURL(APP_API_URL)
        .addRoute(attachmentApiPath)
        .addRoute(`/${modelId}`)
        .addRoute(`/${fileIdAsString}`)
        .toString();
    }

    if (!downloadUrl) {
      continue;
    }

    attachmentLinks.push(
      <li key={fileIdAsString}>
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-indigo-600 hover:text-indigo-500"
        >
          {file.name || "Download attachment"}
        </a>
      </li>,
    );
  }

  if (!attachmentLinks.length) {
    return null;
  }

  return (
    <div className={className}>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </div>
      <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
        {attachmentLinks}
      </ul>
    </div>
  );
};

export default AttachmentList;
