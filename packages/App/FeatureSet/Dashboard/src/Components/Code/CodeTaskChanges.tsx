import {
  CODE_TASK_FILE_STATUS_LABELS,
  CODE_TASK_FILE_STATUS_MARKS,
} from "./CodeTaskCopy";
import {
  CodeTaskChanges,
  CodeTaskFileChange,
  CodeTaskFileDiff,
  CodeTaskFileStatus,
} from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  // The files the turn changed (every reader sees which).
  files: Array<CodeTaskFileChange>;
  // Their diff, for people who may change this repository's code.
  changes?: CodeTaskChanges | undefined;
}

const STATUS_MARK_CLASS_NAMES: Record<CodeTaskFileStatus, string> = {
  [CodeTaskFileStatus.Added]: "bg-emerald-50 text-emerald-700",
  [CodeTaskFileStatus.Modified]: "bg-amber-50 text-amber-800",
  [CodeTaskFileStatus.Deleted]: "bg-red-50 text-red-700",
  [CodeTaskFileStatus.Renamed]: "bg-sky-50 text-sky-700",
};

// The class of one line of a unified diff, by its first character.
export const getDiffLineClassName: (line: string) => string = (
  line: string,
): string => {
  if (line.startsWith("@@")) {
    return "bg-sky-50 text-sky-800";
  }

  if (line.startsWith("+")) {
    return "bg-emerald-50 text-emerald-900";
  }

  if (line.startsWith("-")) {
    return "bg-red-50 text-red-900";
  }

  if (line.startsWith("\\")) {
    return "text-gray-400";
  }

  return "text-gray-700";
};

/*
 * What a turn changed: each file, how (added, changed, removed, renamed)
 * and by how many lines, with its diff a click away - for people who may
 * ask AI to change this code; anyone else reading the task sees which files
 * changed, and the pull request has the rest.
 */
const CodeTaskChangesView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [openPaths, setOpenPaths] = useState<Set<string>>(new Set<string>());

  if (props.files.length === 0) {
    return <></>;
  }

  const diffsByPath: Map<string, CodeTaskFileDiff> = new Map<
    string,
    CodeTaskFileDiff
  >();

  for (const file of props.changes?.files || []) {
    diffsByPath.set(file.path, file);
  }

  let additions: number = 0;
  let deletions: number = 0;

  for (const file of props.files) {
    additions += file.additions;
    deletions += file.deletions;
  }

  const toggle: (path: string) => void = (path: string): void => {
    setOpenPaths((current: Set<string>) => {
      const next: Set<string> = new Set<string>(current);

      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }

      return next;
    });
  };

  return (
    <div
      data-testid="code-task-changes"
      className="overflow-hidden rounded-lg border border-gray-200"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        <span className="font-medium text-gray-900">
          {translator.translatePlural(
            { one: "{{count}} file changed", other: "{{count}} files changed" },
            props.files.length,
          )}
        </span>
        <span className="font-mono text-emerald-700">+{additions}</span>
        <span className="font-mono text-red-700">−{deletions}</span>
        {props.changes?.isTruncated ? (
          <span className="text-gray-500">
            {translator.translateText(
              "Part of the diff is left out; the pull request has all of it.",
            )}
          </span>
        ) : (
          <></>
        )}
      </div>
      <ul className="divide-y divide-gray-100">
        {props.files.map((file: CodeTaskFileChange) => {
          const diff: CodeTaskFileDiff | undefined = diffsByPath.get(file.path);
          const hasPatch: boolean = Boolean(diff?.patch);
          const isOpen: boolean = openPaths.has(file.path);

          return (
            <li key={file.path} data-testid="code-task-changed-file">
              <button
                type="button"
                disabled={!hasPatch}
                aria-expanded={hasPatch ? isOpen : undefined}
                onClick={() => {
                  toggle(file.path);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                  hasPatch ? "hover:bg-gray-50" : "cursor-default"
                } focus:outline-none focus-visible:bg-gray-50`}
              >
                {hasPatch ? (
                  <Icon
                    icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
                    className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                  />
                ) : (
                  <span className="h-3.5 w-3.5 flex-shrink-0" />
                )}
                <span
                  title={translator.translateText(
                    CODE_TASK_FILE_STATUS_LABELS[file.status],
                  )}
                  className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold ${STATUS_MARK_CLASS_NAMES[file.status]}`}
                >
                  {CODE_TASK_FILE_STATUS_MARKS[file.status]}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-gray-800">
                  {file.previousPath
                    ? `${file.previousPath} → ${file.path}`
                    : file.path}
                </span>
                <span className="flex-shrink-0 font-mono text-emerald-700">
                  +{file.additions}
                </span>
                <span className="flex-shrink-0 font-mono text-red-700">
                  −{file.deletions}
                </span>
              </button>
              {isOpen && diff?.patch ? (
                <div
                  data-testid="code-task-diff"
                  className="max-h-96 overflow-auto border-t border-gray-100 bg-white"
                >
                  <pre className="min-w-max py-1 font-mono text-xs leading-5">
                    {diff.patch
                      .split("\n")
                      .map((line: string, index: number) => {
                        return (
                          <div
                            key={index}
                            className={`whitespace-pre px-3 ${getDiffLineClassName(line)}`}
                          >
                            {line || " "}
                          </div>
                        );
                      })}
                  </pre>
                  {diff.isPatchTruncated ? (
                    <p className="border-t border-gray-100 px-3 py-1.5 text-xs text-gray-500">
                      {translator.translateText(
                        "This file's diff is cut short here.",
                      )}
                    </p>
                  ) : (
                    <></>
                  )}
                </div>
              ) : (
                <></>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default CodeTaskChangesView;
