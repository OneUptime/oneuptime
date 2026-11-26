import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  getSplitIntoNoticeExceptions,
  isSplitNoticeShown,
  mergeSplitException,
  mergeSplitExceptions,
} from "../../Utils/ExceptionMerge";
import AppLink from "../AppLink/AppLink";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";

/*
 * AN EXCEPTION A SCRUB RULE SPLIT, AND MERGE ONE CLICK AWAY (#10618, #10897).
 *
 * Before #10434 a scrub rule that hid part of an exception found in logs
 * split it in two: from the rule on, its occurrences made a new exception
 * (New Exception fired again) while the one they had been counted in went
 * quiet. Ingest records the pair once it sees it, and a note at the top of
 * each one's every page says so plainly, naming the other, linked, and why:
 *
 *  - the split one's page names the exception it was split from;
 *  - the page of the one it was split from - the older, often resolved by
 *    then - names each exception split from it (#10897).
 *
 * Someone who may edit exceptions merges them with one click, no OneUptime
 * AI needed: the older one is kept, and the page then shows the merge and
 * its Unmerge. Nothing is merged unless they press it.
 */

export interface ComponentProps {
  // The exception this page is about.
  exception: TelemetryException;
  // The exception a scrub rule split it from, as far as it was read.
  splitFrom?: TelemetryException | null | undefined;
  // The exceptions a scrub rule split from it, as far as they were read.
  splitInto?: Array<TelemetryException> | null | undefined;
  // Called once they are merged, so the page reads itself again.
  onMerged: () => void;
}

function exceptionRoute(id: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.EXCEPTIONS_VIEW] as Route,
    { modelId: id },
  );
}

function exceptionName(
  exception: TelemetryException,
  translator: Translator,
): string {
  const type: string = exception.exceptionType || "";
  const message: string = (exception.message || "").split("\n")[0] || "";

  if (type && message) {
    return `${type}: ${message}`;
  }

  return (
    type || message || (translator.translateText("another exception") as string)
  );
}

interface SplitNoteProps {
  // The test id of the note, and the prefix of its parts'.
  testId: string;
  // What the note says, which names the other exceptions.
  sentence: ReactElement;
  // The other exceptions, listed under the sentence, when there are several.
  list?: ReactElement | undefined;
  // Said to someone who may merge them.
  mergeHint: string;
  mergeTestId: string;
  merge: () => Promise<void>;
}

// One note: what happened and why, and Merge Exceptions for an editor.
const SplitNote: FunctionComponent<SplitNoteProps> = (
  props: SplitNoteProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isMerging, setIsMerging] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const canMerge: boolean = PermissionGate.check(
    new TelemetryException(),
    ModelAction.Update,
  ).isAllowed;

  const merge: () => Promise<void> = async (): Promise<void> => {
    setIsMerging(true);
    setError(undefined);

    try {
      await props.merge();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsMerging(false);
  };

  return (
    <div
      className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3"
      data-testid={props.testId}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2 text-sm text-indigo-900">
          <Icon
            icon={IconProp.Scissors}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-500"
          />
          <div className="min-w-0 space-y-1">
            <p>{props.sentence}</p>
            {props.list || <></>}
            <p className="text-indigo-800" data-testid={`${props.testId}-hint`}>
              {canMerge
                ? props.mergeHint
                : translator.translateText(
                    "Someone who can edit exceptions can merge them into one.",
                  )}
            </p>
          </div>
        </div>
        {canMerge ? (
          <Button
            title="Merge Exceptions"
            icon={IconProp.Link}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            isLoading={isMerging}
            disabled={isMerging}
            dataTestId={props.mergeTestId}
            onClick={() => {
              void merge();
            }}
          />
        ) : (
          <></>
        )}
      </div>
      {error ? (
        <p
          className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
          data-testid={`${props.mergeTestId}-error`}
        >
          <ErrorInSentence message={error} showWhereToLook={true} />
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

const ExceptionSplitNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const splitFrom: TelemetryException | null =
    props.splitFrom &&
    isSplitNoticeShown({
      exception: props.exception,
      splitFrom: props.splitFrom,
    })
      ? props.splitFrom
      : null;
  const splitInto: Array<TelemetryException> = getSplitIntoNoticeExceptions({
    exception: props.exception,
    splitInto: props.splitInto,
  });

  if (!splitFrom && splitInto.length === 0) {
    return <></>;
  }

  const link: (
    exception: TelemetryException,
    testId: string,
  ) => ReactElement = (
    exception: TelemetryException,
    testId: string,
  ): ReactElement => {
    return (
      <AppLink
        className="font-medium underline"
        to={exceptionRoute(exception.id!.toString())}
        dataTestId={testId}
      >
        {exceptionName(exception, translator)}
      </AppLink>
    );
  };

  const merged: () => void = (): void => {
    Toast.success(translator.translateText("Exceptions merged") as string);
    props.onMerged();
  };

  return (
    <>
      {splitFrom ? (
        <SplitNote
          testId="exception-split-from"
          sentence={
            <TranslatedSentence
              template="A scrub rule split this exception from {{exception}}. Once the rule hid part of what it says, its occurrences were counted here instead of there."
              slots={{
                exception: link(splitFrom, "exception-split-from-link"),
              }}
            />
          }
          mergeHint={
            translator.translateText(
              "Merge them to count every occurrence as one exception again. The older one is kept, and you can unmerge them later.",
            ) as string
          }
          mergeTestId="exception-split-merge"
          merge={async (): Promise<void> => {
            await mergeSplitException(props.exception.id!.toString());
            merged();
          }}
        />
      ) : (
        <></>
      )}
      {splitInto.length > 0 ? (
        <SplitNote
          testId="exception-split-into"
          sentence={
            splitInto.length === 1 ? (
              <TranslatedSentence
                template="A scrub rule split {{exception}} from this exception. Once the rule hid part of what it says, its occurrences were counted there instead of here."
                slots={{
                  exception: link(splitInto[0]!, "exception-split-into-link"),
                }}
              />
            ) : (
              <>
                {translator.translateText(
                  "A scrub rule split these exceptions from this one. Once the rule hid part of what it says, its occurrences were counted there instead of here.",
                )}
              </>
            )
          }
          list={
            splitInto.length > 1 ? (
              <ul
                className="list-disc space-y-0.5 ps-5"
                data-testid="exception-split-into-list"
              >
                {splitInto.map(
                  (exception: TelemetryException): ReactElement => {
                    return (
                      <li key={exception.id!.toString()}>
                        {link(exception, "exception-split-into-link")}
                      </li>
                    );
                  },
                )}
              </ul>
            ) : undefined
          }
          mergeHint={
            (splitInto.length === 1
              ? translator.translateText(
                  "Merge them to count every occurrence as one exception again. The older one is kept, and you can unmerge them later.",
                )
              : translator.translateText(
                  "Merge them to count every occurrence as one exception again. The oldest one is kept, and you can unmerge them later.",
                )) as string
          }
          mergeTestId="exception-split-into-merge"
          merge={async (): Promise<void> => {
            await mergeSplitExceptions(
              splitInto.map((exception: TelemetryException): string => {
                return exception.id!.toString();
              }),
            );
            merged();
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default ExceptionSplitNotice;
