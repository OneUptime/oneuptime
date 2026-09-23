import FileModel from "Common/Models/DatabaseModels/File";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { APP_API_URL } from "Common/UI/Config";
import { handleAuthenticatedLinkClick } from "Common/UI/Utils/OpenAuthenticatedUrl";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  noteId: string | null;
  attachments?: Array<FileModel> | null | undefined;
  // The note model's attachment route, e.g. "/incident-public-note/attachment".
  attachmentApiPath: string;
}

export function getAttachmentDownloadUrl(data: {
  attachmentApiPath: string;
  projectId: string | null;
  noteId: string | null;
  fileId: string;
}): string | null {
  if (!data.projectId || !data.noteId) {
    return null;
  }

  return URL.fromURL(APP_API_URL)
    .addRoute(data.attachmentApiPath)
    .addRoute(`/${data.projectId}`)
    .addRoute(`/${data.noteId}`)
    .addRoute(`/${data.fileId}`)
    .toString();
}

/*
 * A note's files as a row of compact chips under its text, rather than the
 * full-width download cards the rest of the dashboard uses: a feed of twenty
 * updates with a screenshot each should still read as a feed.
 */
const NoteAttachments: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const projectId: string | null =
    ProjectUtil.getCurrentProjectId()?.toString() || null;

  const links: Array<ReactElement> = [];

  for (const file of props.attachments || []) {
    const fileId: string | undefined = (file._id || file.id)?.toString();

    if (!fileId) {
      continue;
    }

    const downloadUrl: string | null = getAttachmentDownloadUrl({
      attachmentApiPath: props.attachmentApiPath,
      projectId,
      noteId: props.noteId,
      fileId,
    });

    if (!downloadUrl) {
      continue;
    }

    const name: string = file.name || "Attachment";

    links.push(
      <li key={fileId} className="min-w-0 max-w-full">
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={`Download ${name}`}
          data-testid="note-attachment"
          onClick={(event: React.MouseEvent<HTMLAnchorElement>): void => {
            /*
             * The download route authenticates with the session cookie, which
             * lapses with the access token; refresh it before the tab opens.
             */
            handleAuthenticatedLinkClick(event, downloadUrl);
          }}
          className="group inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-white hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon
            icon={IconProp.PaperClip}
            className="h-3.5 w-3.5 shrink-0 text-gray-400 group-hover:text-gray-600"
          />
          <span className="truncate">{name}</span>
          <Icon
            icon={IconProp.Download}
            className="h-3.5 w-3.5 shrink-0 text-gray-300 group-hover:text-gray-500"
          />
        </a>
      </li>,
    );
  }

  if (links.length === 0) {
    return null;
  }

  return (
    <ul
      className="flex flex-wrap gap-2"
      aria-label={`${links.length} attachment${links.length === 1 ? "" : "s"}`}
    >
      {links}
    </ul>
  );
};

export default NoteAttachments;
