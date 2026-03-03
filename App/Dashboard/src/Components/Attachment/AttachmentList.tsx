import React, { FunctionComponent, ReactElement } from "react";
import FileModel from "Common/Models/DatabaseModels/File";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";

export interface AttachmentListProps {
  modelId?: string | null;
  attachments?: Array<FileModel> | null | undefined;
  attachmentApiPath: string;
  title?: string;
  className?: string;
  buildAttachmentUrl?: (fileId: string) => string;
}

type GetFileExtensionFunction = (fileName?: string | null) => string | null;
type GetFileMetadataFunction = (file: FileModel) => string | null;
type GetAttachmentNameFunction = (file: FileModel) => string;

const AttachmentList: FunctionComponent<AttachmentListProps> = (
  props: AttachmentListProps,
): ReactElement | null => {
  const {
    modelId,
    attachments,
    attachmentApiPath,
    title = "Attachments",
    className = "",
    buildAttachmentUrl,
  } = props;

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const attachmentLinks: Array<ReactElement> = [];
  const projectId: string | null =
    ProjectUtil.getCurrentProjectId()?.toString() || null;

  const getFileExtension: GetFileExtensionFunction = (
    fileName?: string | null,
  ): string | null => {
    if (!fileName) {
      return null;
    }

    const trimmedName: string = fileName.trim();
    const lastDotIndex: number = trimmedName.lastIndexOf(".");

    if (lastDotIndex === -1 || lastDotIndex === trimmedName.length - 1) {
      return null;
    }

    return trimmedName.substring(lastDotIndex + 1).toUpperCase();
  };

  const getFileMetadata: GetFileMetadataFunction = (
    file: FileModel,
  ): string | null => {
    const metadataParts: Array<string> = [];

    if (file.fileType) {
      metadataParts.push(file.fileType.toString());
    }

    if (file.createdAt) {
      metadataParts.push(
        `Added ${OneUptimeDate.fromNow(OneUptimeDate.fromString(file.createdAt))}`,
      );
    }

    if (!metadataParts.length) {
      return null;
    }

    return metadataParts.join(" • ");
  };

  const getAttachmentName: GetAttachmentNameFunction = (
    file: FileModel,
  ): string => {
    if (file.name) {
      return file.name;
    }

    return "Download attachment";
  };

  for (const file of attachments) {
    const fileIdentifier: string | ObjectID | null | undefined =
      file._id || file.id;

    if (!fileIdentifier) {
      continue;
    }

    const fileIdAsString: string = fileIdentifier.toString();

    let downloadUrl: string | null = null;

    if (buildAttachmentUrl) {
      downloadUrl = buildAttachmentUrl(fileIdAsString);
    } else if (modelId && projectId) {
      const attachmentUrl: URL = URL.fromURL(APP_API_URL)
        .addRoute(attachmentApiPath)
        .addRoute(`/${projectId}`)
        .addRoute(`/${modelId}`)
        .addRoute(`/${fileIdAsString}`);

      downloadUrl = attachmentUrl.toString();
    }

    if (!downloadUrl) {
      continue;
    }

    const fileMetadata: string | null = getFileMetadata(file);
    const fileExtension: string | null = getFileExtension(file.name);

    attachmentLinks.push(
      <li key={fileIdAsString} className="list-none">
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white/80 px-4 py-3 text-sm text-gray-900 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
              <Icon icon={IconProp.File} className="h-5 w-5 text-gray-500" />
            </span>
            <span className="flex flex-col">
              <span className="font-medium text-gray-900">
                {getAttachmentName(file)}
              </span>
              {fileMetadata && (
                <span className="text-xs text-gray-500">{fileMetadata}</span>
              )}
            </span>
          </span>

          <span className="flex items-center gap-3">
            {fileExtension && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                {fileExtension}
              </span>
            )}
            <Icon
              icon={IconProp.Download}
              className="h-5 w-5 text-gray-400 transition group-hover:text-gray-600"
            />
          </span>
        </a>
      </li>,
    );
  }

  if (!attachmentLinks.length) {
    return null;
  }

  const containerClassName: string = `space-y-3 ${className}`.trim();

  return (
    <div className={containerClassName}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        <span>{title}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
          {attachmentLinks.length}
        </span>
      </div>
      <ul className="space-y-2">{attachmentLinks}</ul>
    </div>
  );
};

export default AttachmentList;
