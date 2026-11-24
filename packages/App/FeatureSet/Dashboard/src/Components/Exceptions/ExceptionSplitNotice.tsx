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
  isSplitNoticeShown,
  mergeSplitException,
} from "../../Utils/ExceptionMerge";
import AppLink from "../AppLink/AppLink";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";

/*
 * AN EXCEPTION A SCRUB RULE SPLIT, AND MERGE ONE CLICK AWAY (#10618).
 *
 * Before #10434 a scrub rule that hid part of an exception found in logs
 * split it in two: from the rule on, its occurrences made a new exception
 * (New Exception fired again) while the one they had been counted in went
 * quiet. Ingest records the pair once it sees it, and this note, at the top
 * of the split exception's every page, says so plainly: which exception it
 * was split from, linked, and why. Someone who may edit exceptions merges
 * the two with one click, no OneUptime AI needed: the older one is kept, and
 * the page then shows the merge and its Unmerge. Nothing is merged unless
 * they press it.
 */

export interface ComponentProps {
  // The exception this page is about.
  exception: TelemetryException;
  // The exception a scrub rule split it from, as far as it was read.
  splitFrom?: TelemetryException | null | undefined;
  // Called once the two are merged, so the page reads itself again.
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

const ExceptionSplitNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isMerging, setIsMerging] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (
    !props.splitFrom ||
    !isSplitNoticeShown({
      exception: props.exception,
      splitFrom: props.splitFrom,
    })
  ) {
    return <></>;
  }

  const splitFrom: TelemetryException = props.splitFrom;
  const canMerge: boolean = PermissionGate.check(
    new TelemetryException(),
    ModelAction.Update,
  ).isAllowed;

  const merge: () => Promise<void> = async (): Promise<void> => {
    setIsMerging(true);
    setError(undefined);

    try {
      await mergeSplitException(props.exception.id!.toString());
      Toast.success(translator.translateText("Exceptions merged") as string);
      props.onMerged();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsMerging(false);
  };

  return (
    <div
      className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3"
      data-testid="exception-split-from"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2 text-sm text-indigo-900">
          <Icon
            icon={IconProp.Scissors}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-500"
          />
          <div className="min-w-0 space-y-1">
            <p>
              <TranslatedSentence
                template="A scrub rule split this exception from {{exception}}. Once the rule hid part of what it says, its occurrences were counted here instead of there."
                slots={{
                  exception: (
                    <AppLink
                      className="font-medium underline"
                      to={exceptionRoute(splitFrom.id!.toString())}
                      dataTestId="exception-split-from-link"
                    >
                      {exceptionName(splitFrom, translator)}
                    </AppLink>
                  ),
                }}
              />
            </p>
            <p
              className="text-indigo-800"
              data-testid="exception-split-from-hint"
            >
              {canMerge
                ? translator.translateText(
                    "Merge them to count every occurrence as one exception again. The older one is kept, and you can unmerge them later.",
                  )
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
            dataTestId="exception-split-merge"
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
          data-testid="exception-split-merge-error"
        >
          <ErrorInSentence message={error} showWhereToLook={true} />
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ExceptionSplitNotice;
