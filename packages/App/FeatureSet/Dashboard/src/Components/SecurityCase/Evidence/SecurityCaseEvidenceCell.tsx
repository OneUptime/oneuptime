import {
  SECURITY_CASE_EVIDENCE_COPY,
  SECURITY_CASE_EVIDENCE_TEST_IDS,
  formatEvidenceSize,
  getEvidenceLink,
  getEvidenceMeta,
  isFileEvidence,
  shortenSha256,
} from "./SecurityCaseEvidenceCopy";
import RelativeTime from "../../EpisodeView/RelativeTime";
import SecurityCaseEvidence from "Common/Models/DatabaseModels/SecurityCaseEvidence";
import IconProp from "Common/Types/Icon/IconProp";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  item: SecurityCaseEvidence;
}

/*
 * Who added a piece of evidence, and when: "Added by Maya Chen 3 hours
 * ago", or "Added 3 hours ago" when no person did (an API key). The name
 * reads the way it is written (IsolatedText); the time is written in the
 * sentence's language, with the date and time under the pointer
 * (RelativeTime).
 */
export const SecurityCaseEvidenceAddedLine: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const name: string =
    props.item.createdByUser?.name?.toString() ||
    props.item.createdByUser?.email?.toString() ||
    "";

  if (!props.item.createdAt) {
    return <></>;
  }

  const time: ReactElement = (
    <RelativeTime date={props.item.createdAt} className="whitespace-nowrap" />
  );

  if (!name) {
    return (
      <TranslatedSentence
        template={SECURITY_CASE_EVIDENCE_COPY.addedAt}
        slots={{ time }}
      />
    );
  }

  return (
    <TranslatedSentence
      template={SECURITY_CASE_EVIDENCE_COPY.addedBy}
      slots={{ name: <IsolatedText text={name} />, time }}
    />
  );
};

/*
 * A piece of evidence, as its table's one column draws it, the way a list
 * of files reads: what it is called, with a paper clip for a file or a
 * chain link for a link; a file's own name and size, or the link's
 * address - each left out where the name already says it
 * (getEvidenceMeta); a file's SHA-256, short, the whole on hover and to
 * copy; what it shows, in two lines at most; and who added it and when.
 *
 * Who and when are a line here, not columns of their own: beside a side
 * menu a case's card is 620 to 760px wide from 1024 to 1100px, and with
 * Added By and Added beside it the table scrolled sideways there, and cut
 * a name such as "Diego Alvarez" short at 1280.
 */
const SecurityCaseEvidenceCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const item: SecurityCaseEvidence = props.item;
  const isFile: boolean = isFileEvidence(item);
  const link: string | null = getEvidenceLink(item);
  const meta: string = getEvidenceMeta({
    name: item.name,
    isFile,
    fileName: item.fileName,
    size: formatEvidenceSize(item.fileSizeInBytes),
    link,
  });
  const sha256: string = isFile ? (item.sha256 || "").trim() : "";

  return (
    <div className="grid grid-cols-1">
      <span className="flex min-w-0 items-start gap-2">
        <Icon
          icon={isFile ? IconProp.PaperClip : IconProp.Link}
          className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
        />
        <span
          className="min-w-0 break-words font-medium text-gray-900"
          data-testid={SECURITY_CASE_EVIDENCE_TEST_IDS.name}
        >
          <IsolatedText text={item.name || ""} />
        </span>
      </span>
      {meta ? (
        <span
          className="mt-0.5 truncate ps-6 text-xs text-gray-500"
          title={meta}
          data-testid={SECURITY_CASE_EVIDENCE_TEST_IDS.meta}
        >
          <IsolatedText text={meta} />
        </span>
      ) : (
        <></>
      )}
      {sha256 ? (
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 ps-6 text-xs text-gray-500">
          <span
            className="shrink-0"
            title={
              translator.translateText(
                SECURITY_CASE_EVIDENCE_COPY.sha256Tooltip,
              ) || SECURITY_CASE_EVIDENCE_COPY.sha256Tooltip
            }
          >
            {translator.translateText(
              SECURITY_CASE_EVIDENCE_COPY.sha256Label,
            ) || SECURITY_CASE_EVIDENCE_COPY.sha256Label}
          </span>
          <code
            className="truncate font-mono text-xs text-gray-700"
            dir="ltr"
            title={sha256}
            data-testid={SECURITY_CASE_EVIDENCE_TEST_IDS.sha256}
          >
            {shortenSha256(sha256)}
          </code>
          <CopyTextButton
            textToBeCopied={sha256}
            iconOnly={true}
            size="xs"
            variant="ghost"
            title={
              translator.translateText(
                SECURITY_CASE_EVIDENCE_COPY.copySha256,
              ) || SECURITY_CASE_EVIDENCE_COPY.copySha256
            }
          />
        </span>
      ) : (
        <></>
      )}
      {item.description ? (
        <span className="mt-1 line-clamp-2 break-words ps-6 text-sm text-gray-600">
          {item.description}
        </span>
      ) : (
        <></>
      )}
      {item.createdAt ? (
        <span
          className="mt-1 ps-6 text-xs text-gray-500"
          data-testid={SECURITY_CASE_EVIDENCE_TEST_IDS.added}
        >
          <SecurityCaseEvidenceAddedLine item={item} />
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityCaseEvidenceCell;
