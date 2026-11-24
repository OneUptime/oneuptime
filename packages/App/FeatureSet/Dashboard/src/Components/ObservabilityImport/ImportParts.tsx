import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import IconProp from "Common/Types/Icon/IconProp";
import {
  ImportAiCandidate,
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportStatusUtil,
} from "Common/Types/ObservabilityImport/ObservabilityImport";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  ImportAiAnswer,
  ImportAiTarget,
  convertImportQueryWithAi,
} from "./ObservabilityImportApi";

/*
 * THE PIECES BOTH IMPORTS DRAW (issue #7697): Import from Grafana or
 * Datadog on Dashboards, Import Alerts on Monitors. A file pasted or
 * uploaded; each item it holds with how exactly it converts and why;
 * OneUptime AI's conversion of a query, asked for and read before use.
 */

export const IMPORT_STATUS_WORDS: Readonly<Record<ImportItemStatus, string>> = {
  [ImportItemStatus.Exact]: translationKey("Converted exactly"),
  [ImportItemStatus.Approximate]: translationKey("Converted approximately"),
  [ImportItemStatus.NotConverted]: translationKey("Not converted"),
};

const STATUS_TONES: Readonly<Record<ImportItemStatus, PillTone>> = {
  [ImportItemStatus.Exact]: PillTone.Success,
  [ImportItemStatus.Approximate]: PillTone.Warning,
  [ImportItemStatus.NotConverted]: PillTone.Danger,
};

export const ImportStatusPill: FunctionComponent<{
  status: ImportItemStatus;
}> = (props: { status: ImportItemStatus }): ReactElement => {
  return (
    <span data-testid={`import-status-${props.status}`}>
      <Pill
        text={IMPORT_STATUS_WORDS[props.status]}
        tone={STATUS_TONES[props.status]}
      />
    </span>
  );
};

// How many items are in each status: "96 converted exactly · 4 ...".
export const ImportSummary: FunctionComponent<{
  statuses: ReadonlyArray<ImportItemStatus>;
}> = (props: { statuses: ReadonlyArray<ImportItemStatus> }): ReactElement => {
  const translator: Translator = useTranslator();
  const counts: Record<ImportItemStatus, number> = ImportStatusUtil.count(
    props.statuses,
  );

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="import-summary"
    >
      <Pill
        isUserContent={true}
        tone={PillTone.Success}
        text={translator.translatePlural(
          {
            one: "{{count}} converted exactly",
            other: "{{count}} converted exactly",
          },
          counts[ImportItemStatus.Exact],
        )}
      />
      <Pill
        isUserContent={true}
        tone={PillTone.Warning}
        text={translator.translatePlural(
          {
            one: "{{count}} converted approximately",
            other: "{{count}} converted approximately",
          },
          counts[ImportItemStatus.Approximate],
        )}
      />
      <Pill
        isUserContent={true}
        tone={PillTone.Danger}
        text={translator.translatePlural(
          {
            one: "{{count}} not converted",
            other: "{{count}} not converted",
          },
          counts[ImportItemStatus.NotConverted],
        )}
      />
    </div>
  );
};

const NOTE_ICONS: Readonly<Record<ImportNoteKind, IconProp>> = {
  [ImportNoteKind.Approximation]: IconProp.Alert,
  [ImportNoteKind.Info]: IconProp.Info,
  [ImportNoteKind.Reason]: IconProp.Close,
};

const NOTE_ICON_CLASSES: Readonly<Record<ImportNoteKind, string>> = {
  [ImportNoteKind.Approximation]: "text-amber-600",
  [ImportNoteKind.Info]: "text-gray-400",
  [ImportNoteKind.Reason]: "text-red-600",
};

// What is said about an item, each line in the reader's language.
export const ImportNoteList: FunctionComponent<{
  notes: ReadonlyArray<ImportNote>;
}> = (props: { notes: ReadonlyArray<ImportNote> }): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.notes.length === 0) {
    return <></>;
  }

  return (
    <ul className="mt-1.5 space-y-1" data-testid="import-notes">
      {props.notes.map((note: ImportNote, index: number): ReactElement => {
        return (
          <li
            key={`${note.text}-${index}`}
            className="flex items-start gap-1.5 text-xs text-gray-600"
            data-note-kind={note.kind}
          >
            <span
              className={`mt-0.5 h-3.5 w-3.5 flex-none ${NOTE_ICON_CLASSES[note.kind]}`}
              aria-hidden="true"
            >
              <Icon icon={NOTE_ICONS[note.kind]} />
            </span>
            <span className="min-w-0 break-words">
              {translator.translateTemplate(note.text, note.values || {})}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

// A query, as OneUptime will run it: code, read from the left.
export const ImportQueryCode: FunctionComponent<{ query: string }> = (props: {
  query: string;
}): ReactElement => {
  return (
    <pre
      dir="ltr"
      className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-gray-50 px-2.5 py-1.5 font-mono text-xs text-gray-700"
      data-testid="import-query"
    >
      {props.query}
    </pre>
  );
};

/*
 * OneUptime AI's conversion of one query no rule converted: asked for by
 * the person, who is told first that only the query goes to the project's
 * LLM provider, and read before it is used - nothing is created with it
 * until "Use This Query".
 */
export const ImportAiConversion: FunctionComponent<{
  candidate: ImportAiCandidate;
  target: ImportAiTarget;
  onUse: (promQL: string) => void;
}> = (props: {
  candidate: ImportAiCandidate;
  target: ImportAiTarget;
  onUse: (promQL: string) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [answer, setAnswer] = useState<ImportAiAnswer | null>(null);
  const [error, setError] = useState<string>("");

  const convert: () => Promise<void> = async (): Promise<void> => {
    setIsConverting(true);
    setError("");

    try {
      setAnswer(
        await convertImportQueryWithAi({
          target: props.target,
          candidate: props.candidate,
        }),
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsConverting(false);
  };

  if (answer) {
    return (
      <div
        className="mt-2 rounded-md border border-indigo-100 bg-indigo-50/40 p-2.5"
        data-testid="import-ai-answer"
      >
        <p className="text-xs font-medium text-gray-700">
          {translator.translateText("OneUptime AI's PromQL")}
        </p>
        <ImportQueryCode query={answer.promQL} />
        {answer.explanation ? (
          // The model's own words, in the language it wrote them in.
          <p className="mt-1.5 text-xs text-gray-600">{answer.explanation}</p>
        ) : (
          <></>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            title="Use This Query"
            buttonStyle={ButtonStyleType.NORMAL}
            icon={IconProp.Check}
            dataTestId="import-ai-use"
            onClick={() => {
              props.onUse(answer.promQL);
            }}
          />
          <Button
            title="Discard"
            buttonStyle={ButtonStyleType.OUTLINE}
            dataTestId="import-ai-discard"
            onClick={() => {
              setAnswer(null);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2" data-testid="import-ai">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          title="Convert with OneUptime AI"
          buttonStyle={ButtonStyleType.OUTLINE}
          icon={IconProp.Sparkles}
          isLoading={isConverting}
          disabled={isConverting}
          dataTestId="import-ai-convert"
          onClick={() => {
            void convert();
          }}
        />
        <span className="text-xs text-gray-500">
          {translator.translateText(
            "Sends only this query to your project's LLM provider.",
          )}
        </span>
      </div>
      {error ? (
        <div className="mt-1.5 text-sm" data-testid="import-ai-error">
          <ErrorInSentence message={error} showWhereToLook={true} />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * One item of the preview: how it converts, its name and what it was, what
 * is said about it, its queries behind Show query, and OneUptime AI for a
 * query no rule converted. `control` sits before it: an alert rule's
 * switch to import it or not.
 */
export const ImportItemRow: FunctionComponent<{
  title: string;
  subtitle: string;
  status: ImportItemStatus;
  notes: ReadonlyArray<ImportNote>;
  queries: ReadonlyArray<string>;
  control?: ReactElement | undefined;
  extra?: ReactElement | undefined;
  ai?:
    | {
        candidate: ImportAiCandidate;
        target: ImportAiTarget;
        onUse: (promQL: string) => void;
      }
    | undefined;
  dataTestId?: string | undefined;
}> = (props: {
  title: string;
  subtitle: string;
  status: ImportItemStatus;
  notes: ReadonlyArray<ImportNote>;
  queries: ReadonlyArray<string>;
  control?: ReactElement | undefined;
  extra?: ReactElement | undefined;
  ai?:
    | {
        candidate: ImportAiCandidate;
        target: ImportAiTarget;
        onUse: (promQL: string) => void;
      }
    | undefined;
  dataTestId?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [showsQueries, setShowsQueries] = useState<boolean>(false);

  return (
    <li
      className="flex gap-3 border-b border-gray-100 py-3 last:border-b-0"
      data-testid={props.dataTestId || "import-item"}
      data-status={props.status}
    >
      {props.control ? (
        <div className="flex-none pt-0.5">{props.control}</div>
      ) : (
        <></>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words text-sm font-medium text-gray-900">
            {props.title || translator.translateText("Untitled")}
          </span>
          <ImportStatusPill status={props.status} />
        </div>
        <p className="mt-0.5 text-xs text-gray-500">{props.subtitle}</p>
        {props.extra || <></>}
        <ImportNoteList notes={props.notes} />
        {props.queries.length > 0 ? (
          <div className="mt-1">
            <Button
              title={showsQueries ? "Hide query" : "Show query"}
              buttonStyle={ButtonStyleType.SECONDARY_LINK}
              dataTestId="import-item-queries-toggle"
              onClick={() => {
                setShowsQueries(!showsQueries);
              }}
            />
            {showsQueries ? (
              props.queries.map((query: string, index: number) => {
                return <ImportQueryCode key={index} query={query} />;
              })
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
        {props.ai ? (
          <ImportAiConversion
            candidate={props.ai.candidate}
            target={props.ai.target}
            onUse={props.ai.onUse}
          />
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

// A section of the preview: its heading, and its rows.
export const ImportSection: FunctionComponent<{
  title: string;
  children: Array<ReactElement> | ReactElement;
  dataTestId?: string | undefined;
}> = (props: {
  title: string;
  children: Array<ReactElement> | ReactElement;
  dataTestId?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <section data-testid={props.dataTestId}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {translator.translateText(props.title)}
      </h3>
      <ul className="mt-1">{props.children}</ul>
    </section>
  );
};

/*
 * The file: pasted into the box, or read from a file the person picks.
 * Nothing leaves the browser: the import reads it here.
 */
export const ImportFileField: FunctionComponent<{
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
}> = (props: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const fileInput: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const [readError, setReadError] = useState<string>("");

  const onFile: (event: React.ChangeEvent<HTMLInputElement>) => void = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file: File | undefined = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader: FileReader = new FileReader();

    reader.onload = (): void => {
      setReadError("");
      props.onChange((reader.result as string) || "");
    };

    reader.onerror = (): void => {
      setReadError(
        "This file could not be read. Pick it again, or paste its text.",
      );
    };

    reader.readAsText(file);
    // The same file may be picked again after an edit.
    event.target.value = "";
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <FieldLabelElement title={props.label} htmlFor={props.id} />
        <Button
          title="Upload a File"
          buttonStyle={ButtonStyleType.OUTLINE}
          icon={IconProp.Upload}
          dataTestId="import-upload"
          onClick={() => {
            fileInput.current?.click();
          }}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml,text/plain"
          className="hidden"
          data-testid="import-file-input"
          onChange={onFile}
        />
      </div>
      <div className="mt-2">
        <TextArea
          id={props.id}
          value={props.value}
          className="font-mono text-xs"
          dataTestId="import-text"
          disableSpellCheck={true}
          error={props.error || readError || undefined}
          onChange={(value: string) => {
            setReadError("");
            props.onChange(value);
          }}
        />
      </div>
      <p className="mt-1.5 text-xs text-gray-500">
        {translator.translateText(props.hint)}
      </p>
    </div>
  );
};
