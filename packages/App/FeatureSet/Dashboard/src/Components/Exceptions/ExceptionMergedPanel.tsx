import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { unmergeException } from "../../Utils/ExceptionMerge";
import AppLink from "../AppLink/AppLink";

/*
 * WHAT A MERGE LEFT ON AN EXCEPTION'S PAGE, AND ITS UNDO.
 *
 * On an exception that was merged into another: a note at the top saying
 * so, linking to that one, where its occurrences count now. On an exception
 * others were merged into: a short list of them on the Overview, each with
 * its occurrences. Unmerge, beside each, gives one back its own place in the
 * list, its occurrences since included; it is offered only to someone who
 * may edit exceptions.
 */

export interface ComponentProps {
  // The exception this page is about.
  exception: TelemetryException;
  // When it was merged into another: that one, as far as it was read.
  mergedInto?: TelemetryException | null | undefined;
  // The exceptions merged into it.
  members: Array<TelemetryException>;
  // Called once an unmerge is done, so the page reads itself again.
  onChanged: () => void;
}

function exceptionRoute(id: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.EXCEPTIONS_VIEW] as Route,
    { modelId: id },
  );
}

function exceptionName(
  exception: TelemetryException | null | undefined,
  translator: Translator,
): string {
  const type: string = exception?.exceptionType || "";
  const message: string = (exception?.message || "").split("\n")[0] || "";

  if (type && message) {
    return `${type}: ${message}`;
  }

  return (
    type || message || (translator.translateText("another exception") as string)
  );
}

const ExceptionMergedPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [pendingId, setPendingId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const canEdit: boolean = PermissionGate.check(
    new TelemetryException(),
    ModelAction.Update,
  ).isAllowed;

  const unmerge: (id: string) => Promise<void> = async (
    id: string,
  ): Promise<void> => {
    setPendingId(id);
    setError(undefined);

    try {
      await unmergeException(id);
      props.onChanged();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setPendingId(undefined);
  };

  const errorLine: ReactElement = error ? (
    <p
      className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
      role="alert"
      data-testid="exception-merge-error"
    >
      {error}
    </p>
  ) : (
    <></>
  );

  const ownId: string = props.exception.id?.toString() || "";

  // A merged exception: where it went, and the way back.
  if (props.exception.mergedIntoTelemetryExceptionId) {
    const survivorId: string =
      props.exception.mergedIntoTelemetryExceptionId.toString();

    return (
      <div
        className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3"
        data-testid="exception-merged-into"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-2 text-sm text-indigo-900">
            <Icon
              icon={IconProp.Link}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-500"
            />
            <span className="min-w-0">
              <TranslatedSentence
                template="This exception was merged into {{exception}}. Its occurrences count there."
                slots={{
                  exception: (
                    <AppLink
                      className="font-medium underline"
                      to={exceptionRoute(survivorId)}
                      dataTestId="exception-merged-into-link"
                    >
                      {exceptionName(props.mergedInto, translator)}
                    </AppLink>
                  ),
                }}
              />
            </span>
          </div>
          {canEdit ? (
            <Button
              title="Unmerge"
              icon={IconProp.ArrowUturnLeft}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              isLoading={pendingId === ownId}
              disabled={Boolean(pendingId)}
              dataTestId="exception-unmerge"
              onClick={() => {
                void unmerge(ownId);
              }}
            />
          ) : (
            <></>
          )}
        </div>
        {errorLine}
      </div>
    );
  }

  if (props.members.length === 0) {
    return <></>;
  }

  return (
    <Card
      title="Merged into this exception"
      description="Exceptions merged into this one as the same bug. Their occurrences count here, on this page and in the list."
    >
      <div data-testid="exception-merged-members">
        <ul className="-mx-2 divide-y divide-gray-100">
          {props.members.map((member: TelemetryException): ReactElement => {
            const id: string = member.id?.toString() || "";

            return (
              <li
                key={id}
                className="flex items-center gap-3 px-2 py-2"
                data-testid="exception-merged-member"
              >
                <AppLink
                  className="min-w-0 flex-1 truncate text-sm text-gray-800 hover:underline"
                  to={exceptionRoute(id)}
                >
                  {exceptionName(member, translator)}
                </AppLink>
                <span className="flex-shrink-0 text-xs tabular-nums text-gray-500">
                  {translator.translatePlural(
                    {
                      one: "{{count}} occurrence",
                      other: "{{count}} occurrences",
                    },
                    member.occuranceCount || 0,
                  )}
                </span>
                {canEdit ? (
                  <Button
                    title="Unmerge"
                    icon={IconProp.ArrowUturnLeft}
                    buttonStyle={ButtonStyleType.NORMAL}
                    buttonSize={ButtonSize.Small}
                    isLoading={pendingId === id}
                    disabled={Boolean(pendingId)}
                    dataTestId="exception-merged-member-unmerge"
                    onClick={() => {
                      void unmerge(id);
                    }}
                  />
                ) : (
                  <></>
                )}
              </li>
            );
          })}
        </ul>
        {errorLine}
      </div>
    </Card>
  );
};

export default ExceptionMergedPanel;
