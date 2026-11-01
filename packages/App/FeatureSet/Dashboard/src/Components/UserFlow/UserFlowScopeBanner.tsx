import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { UserFlowScopeDto } from "Common/Types/Rum/UserFlow";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SessionReplayUserAvatar from "../SessionReplay/SessionReplayUserAvatar";
import { SessionUserDescription } from "../SessionReplay/SessionReplayUserIdentity";
import {
  describeUserFlowScopePerson,
  describeUserFlowSessionOwner,
  getUserFlowScopeOfSessionOwner,
  UserFlowScope,
} from "./UserFlowScope";

/*
 * Says who the page is narrowed to, so one person's map is never mistaken for
 * everyone's, and is the way back to everyone. For a session it also says
 * whose it is, one click from the rest of that person's journeys.
 */

export interface ComponentProps {
  scope: UserFlowScope;
  /* What the server said it narrowed to; null while the read is running. */
  applied: UserFlowScopeDto | null;
  sessionsInWindow: number | null;
  onChange: (scope: UserFlowScope | null) => void;
}

function nameOf(
  person: SessionUserDescription,
  translator: Translator,
): string {
  if (person.kind === "hidden") {
    return translator.translateText("Hidden") as string;
  }

  return person.text || (translator.translateText("This user") as string);
}

const UserFlowScopeBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const person: SessionUserDescription | null = describeUserFlowScopePerson(
    props.scope,
    props.applied,
  );
  const owner: SessionUserDescription | null = describeUserFlowSessionOwner(
    props.applied,
  );
  const ownerScope: UserFlowScope | null = getUserFlowScopeOfSessionOwner(
    props.applied,
  );

  const name: string = person
    ? nameOf(person, translator)
    : translator.translateTemplate("Session {{id}}", {
        id:
          props.scope.kind === "session"
            ? props.scope.sessionId.slice(0, 8)
            : "",
      });

  const kindLabel: string =
    props.scope.kind === "session"
      ? owner
        ? translator.translateTemplate("One session from {{name}}", {
            name: nameOf(owner, translator),
          })
        : (translator.translateText("One session") as string)
      : props.scope.kind === "visitor"
        ? (translator.translateText("Anonymous visitor") as string)
        : (translator.translateText("Identified user") as string);

  return (
    <div
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3"
      data-testid="user-flow-scope"
      data-kind={props.scope.kind}
    >
      <div className="flex min-w-0 items-center gap-3">
        {person ? (
          <SessionReplayUserAvatar
            initials={person.initials}
            hue={person.hue}
            size="md"
          />
        ) : (
          <Icon
            icon={IconProp.Film}
            className="h-5 w-5 flex-none text-indigo-500"
          />
        )}
        <div className="min-w-0">
          <p
            className="truncate text-sm font-semibold text-gray-900"
            data-testid="user-flow-scope-name"
            title={name}
          >
            {name}
          </p>
          <p
            className="truncate text-xs text-gray-600"
            data-testid="user-flow-scope-detail"
          >
            {kindLabel}
            {props.scope.kind !== "session" && props.sessionsInWindow !== null
              ? ` · ${translator.translatePlural(
                  {
                    one: "{{count}} session in this range",
                    other: "{{count}} sessions in this range",
                  },
                  props.sessionsInWindow,
                )}`
              : ""}
          </p>
        </div>
      </div>

      {/* Button's own left margin is a dialog footer's. */}
      <div className="flex flex-wrap items-center gap-2 [&>*>button]:ml-0 [&>*>button]:md:ml-0 [&>button]:ml-0 [&>button]:md:ml-0">
        {ownerScope ? (
          <Button
            title="See all their journeys"
            icon={IconProp.User}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            dataTestId="user-flow-scope-owner"
            onClick={(): void => {
              props.onChange(ownerScope);
            }}
          />
        ) : (
          <></>
        )}
        <Button
          title="Show all users"
          icon={IconProp.Close}
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          dataTestId="user-flow-scope-clear"
          onClick={(): void => {
            props.onChange(null);
          }}
        />
      </div>
    </div>
  );
};

export default UserFlowScopeBanner;
