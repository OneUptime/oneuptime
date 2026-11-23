import {
  CANCEL,
  DRAFTED_BY_AI_ON,
  EDIT,
  EDITED_BY_ON,
  EDITED_ON,
  FACTS_CHANGED,
  SAVE,
  SAVED,
  WRITE,
} from "./ComplianceDraftsCopy";
import { ComplianceFactsToggle } from "./ComplianceFacts";
import OneUptimeDate from "Common/Types/Date";
import { ComplianceFact } from "Common/Types/DataSecurity/ComplianceFacts";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import LazyMarkdownEditor from "Common/UI/Components/Markdown.tsx/LazyMarkdownEditor";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * ONE PART OF A COMPLIANCE DOCUMENT (#10375): a part of a store's impact
 * assessment, or a requirement's paragraph of a framework's audit evidence.
 *
 * It reads like a document, not a form: its heading, a quiet line saying
 * who wrote it and when - OneUptime AI's draft, or a person's edit - its
 * words, and the facts a drafted part rests on one click away. Edit turns
 * the words into an editor in place, and Save makes them the person's own,
 * never drafted again. A part written over facts that changed since says
 * so, plainly, above its words.
 */

export interface CompliancePaperSectionProps {
  id: string;
  heading: string;
  // What the heading is in the law or the framework: "Art. 35(7)(a)", a status pill.
  aside?: ReactElement | undefined;
  // Its words: Markdown for an assessment's part, text for a paragraph.
  words: string;
  isMarkdown: boolean;
  // Written by a person; else OneUptime AI's draft.
  isEdited: boolean;
  draftedAt?: string | undefined;
  editedAt?: string | undefined;
  editorName?: string | undefined;
  isStale: boolean;
  facts: ReadonlyArray<ComplianceFact>;
  /*
   * The facts are the evidence itself - a requirement's - so they are one
   * click away under a person's words too. Left out, they are what a draft
   * rests on, and a person's words rest on nothing the page can show.
   */
  areFactsEvidence?: boolean | undefined;
  // What the part reads as while nothing is written: its facts in words, or "Not written yet."
  emptyElement: ReactElement;
  canEdit: boolean;
  onSave: (words: string) => Promise<void>;
  // Whether a person is mid-edit here, for the page to ask before it is left.
  onEditingChange?: ((isEditing: boolean) => void) | undefined;
}

export const CompliancePaperSection: FunctionComponent<
  CompliancePaperSectionProps
> = (props: CompliancePaperSectionProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [words, setWords] = useState<string>(props.words);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const hasWords: boolean = props.words.trim().length > 0;

  useEffect(() => {
    props.onEditingChange?.(isEditing && words !== props.words);
  }, [isEditing, words]);

  const save: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      await props.onSave(words);
      setIsEditing(false);
      Toast.success(translator.translateText(SAVED) || "");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const when: (value: string | undefined) => string = (
    value: string | undefined,
  ): string => {
    return value ? OneUptimeDate.fromNow(new Date(value)) : "";
  };
  const byline: string = !hasWords
    ? ""
    : props.isEdited
      ? props.editorName
        ? translator.translateTemplate(EDITED_BY_ON, {
            name: props.editorName,
            time: when(props.editedAt),
          })
        : translator.translateTemplate(EDITED_ON, {
            time: when(props.editedAt),
          })
      : translator.translateTemplate(DRAFTED_BY_AI_ON, {
          time: when(props.draftedAt),
        });

  return (
    <section
      className="space-y-3 py-6 first:pt-0"
      data-testid={props.id}
      data-edited={props.isEdited ? "true" : "false"}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h3
            className="text-base font-semibold text-gray-900"
            id={`${props.id}-heading`}
          >
            {props.heading}
          </h3>
          {byline ? (
            <p className="inline-flex items-center gap-1.5 text-xs text-gray-500">
              {props.isEdited ? (
                <></>
              ) : (
                <Icon icon={IconProp.Sparkles} className="h-3.5 w-3.5" />
              )}
              <span>{byline}</span>
            </p>
          ) : (
            <></>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {props.aside}
          {props.canEdit && !isEditing ? (
            <Button
              title={hasWords ? EDIT : WRITE}
              icon={IconProp.Edit}
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              dataTestId={`${props.id}-edit`}
              onClick={() => {
                setWords(props.words);
                setError("");
                setIsEditing(true);
              }}
            />
          ) : (
            <></>
          )}
        </div>
      </div>
      {props.isStale && hasWords && !isEditing ? (
        <p
          className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
          data-testid={`${props.id}-stale`}
        >
          <Icon
            icon={IconProp.ExclaimationCircle}
            className="mt-0.5 h-4 w-4 flex-none"
          />
          <span>{translator.translateText(FACTS_CHANGED)}</span>
        </p>
      ) : (
        <></>
      )}
      {isEditing ? (
        <div className="space-y-3">
          {props.isMarkdown ? (
            <LazyMarkdownEditor
              initialValue={props.words}
              allowImageUpload={false}
              dataTestId={`${props.id}-editor`}
              onChange={(value: string) => {
                setWords(value);
              }}
            />
          ) : (
            <TextArea
              initialValue={props.words}
              autoFocus={true}
              ariaLabelledby={`${props.id}-heading`}
              dataTestId={`${props.id}-editor`}
              onChange={(value: string) => {
                setWords(value);
              }}
            />
          )}
          {error ? <ErrorLine message={error} /> : <></>}
          <div className="flex flex-wrap gap-2">
            <Button
              title={SAVE}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              isLoading={isSaving}
              dataTestId={`${props.id}-save`}
              onClick={() => {
                void save();
              }}
            />
            <Button
              title={CANCEL}
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              dataTestId={`${props.id}-cancel`}
              onClick={() => {
                setIsEditing(false);
                setError("");
              }}
            />
          </div>
        </div>
      ) : hasWords ? (
        <div className="max-w-3xl text-sm leading-6 text-gray-800">
          {props.isMarkdown ? (
            <LazyMarkdownViewer text={props.words} safeMode={true} />
          ) : (
            <p className="whitespace-pre-line [overflow-wrap:anywhere]">
              <IsolatedText text={props.words} />
            </p>
          )}
        </div>
      ) : (
        props.emptyElement
      )}
      {!isEditing && hasWords && (props.areFactsEvidence || !props.isEdited) ? (
        <ComplianceFactsToggle
          facts={props.facts}
          dataTestId={`${props.id}-facts`}
        />
      ) : (
        <></>
      )}
    </section>
  );
};

export default CompliancePaperSection;
