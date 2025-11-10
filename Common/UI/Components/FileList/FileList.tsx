import Link from "../Link/Link";
import FileModel from "../../../Models/DatabaseModels/File";
import URL from "../../../Types/API/URL";
import React, { FunctionComponent, ReactElement } from "react";
import { FILE_URL } from "../../Config";

export interface FileListProps {
  files?: Array<FileModel | undefined | null> | null | undefined;
  containerClassName?: string;
  linkClassName?: string;
  openInNewTab?: boolean;
  getFileName?: (file: FileModel, index: number) => string;
}

const DEFAULT_LINK_CLASSNAME: string = "text-primary-500 hover:underline";
const DEFAULT_CONTAINER_CLASSNAME: string = "flex flex-col space-y-2";

const FileList: FunctionComponent<FileListProps> = (
  props: FileListProps,
): ReactElement | null => {
  const files: Array<FileModel> = (props.files || []).filter(
    (file): file is FileModel => Boolean(file),
  );

  if (!files.length) {
    return null;
  }

  return (
    <div
      className={
        props.containerClassName || DEFAULT_CONTAINER_CLASSNAME
      }
    >
      {files.map((file: FileModel, index: number) => {
        const fileId: string | null =
          file.id?.toString?.() || (file as any)._id?.toString?.() || null;

        if (!fileId) {
          return null;
        }

        const fileUrl: URL = URL.fromString(FILE_URL.toString()).addRoute(
          `/image/${fileId}`,
        );

        const label: string = props.getFileName
          ? props.getFileName(file, index)
          : file.name || `Attachment ${index + 1}`;

        return (
          <Link
            key={`${fileId}-${index}`}
            to={fileUrl}
            openInNewTab={props.openInNewTab !== false}
            className={props.linkClassName || DEFAULT_LINK_CLASSNAME}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
};

export default FileList;
