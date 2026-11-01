import React, { FunctionComponent, ReactElement, useState } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import AppLink from "../AppLink/AppLink";
import SessionReplayUserAvatar from "../SessionReplay/SessionReplayUserAvatar";
import { UserFlowPersonDescription, UserFlowView } from "./UserFlowPerson";

/*
 * Who the User Flows page is narrowed to, and the way back: a search box when
 * it shows everyone, and when it shows one person a bar naming them, a switch
 * between their journeys and their flow map, and the × that returns to
 * everyone's flows.
 */

export interface SearchProps {
  onSearch: (identifier: string) => void;
}

/*
 * One box, so nobody has to know what kind of id they are holding: the server
 * tries the value as a user reference, a visitor id and a session id. Applied
 * on Enter, because a half-typed value is a read of ClickHouse for nothing.
 */
export const UserFlowPersonSearch: FunctionComponent<SearchProps> = (
  props: SearchProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [value, setValue] = useState<string>("");
  const label: string =
    translator.translateText("Find a user or session") ||
    "Find a user or session";

  return (
    <form
      className="relative w-full sm:w-72"
      role="search"
      data-testid="user-flow-person-search"
      onSubmit={(event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();

        const identifier: string = value.trim();

        if (identifier) {
          props.onSearch(identifier);
        }
      }}
    >
      <Icon
        icon={IconProp.Search}
        className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-gray-400"
      />
      <input
        type="search"
        className="block w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        placeholder={label}
        aria-label={label}
        title={translator.translateText(
          "A user's email or ID as your application sent it, a visitor ID or a session ID. Press Enter.",
        )}
        data-testid="user-flow-person-input"
        value={value}
        onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
          setValue(event.target.value);
        }}
      />
    </form>
  );
};

export interface BarProps {
  description: UserFlowPersonDescription;
  /* Null until the first answer, while there is nothing to count. */
  sessionCount: number | null;
  view: UserFlowView;
  onViewChange: (view: UserFlowView) => void;
  onClear: () => void;
  /* The session list, narrowed to the same person. */
  sessionListRoute: Route | null;
  /* From one session, the same page for everything that person did. */
  onShowOwner?: (() => void) | undefined;
}

function nameOf(
  description: UserFlowPersonDescription,
  translator: Translator,
): string {
  switch (description.kind) {
    case "visitor":
      return translator.translateTemplate("Visitor {{id}}", {
        id: description.value,
      });
    case "session":
      return translator.translateTemplate("Session {{id}}", {
        id: description.value,
      });
    case "hidden":
      return translator.translateText("Hidden user") || "Hidden user";
    case "unknown-user":
      return translator.translateText("This user") || "This user";
    default:
      return description.value;
  }
}

const VIEWS: Array<{ id: UserFlowView; label: string }> = [
  { id: "journeys", label: "Journeys" },
  { id: "map", label: "Flow map" },
];

export const UserFlowPersonBar: FunctionComponent<BarProps> = (
  props: BarProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const name: string = nameOf(props.description, translator);

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2"
      data-testid="user-flow-person"
      data-kind={props.description.kind}
    >
      {/* Wide enough to read: on a phone the switch moves to its own line. */}
      <div className="flex min-w-[15rem] flex-1 items-center gap-2.5">
        <SessionReplayUserAvatar
          initials={props.description.initials}
          hue={props.description.hue}
          size="md"
        />
        <div className="min-w-0">
          <p
            className="truncate text-sm font-semibold text-gray-900"
            title={props.description.title}
            data-testid="user-flow-person-name"
          >
            {name}
          </p>
          <p className="flex flex-wrap gap-x-3 text-xs text-gray-600">
            {props.sessionCount === null ? (
              <></>
            ) : (
              <span data-testid="user-flow-person-count">
                {translator.translatePlural(
                  {
                    one: "{{count}} session in this range",
                    other: "{{count}} sessions in this range",
                  },
                  props.sessionCount,
                )}
              </span>
            )}
            {props.onShowOwner ? (
              <button
                type="button"
                className="font-medium text-indigo-700 hover:underline"
                data-testid="user-flow-person-owner"
                onClick={props.onShowOwner}
              >
                {translator.translateText("Everything this person did")}
              </button>
            ) : (
              <></>
            )}
            {props.sessionListRoute ? (
              <AppLink
                to={props.sessionListRoute}
                className="font-medium text-indigo-700 hover:underline"
                dataTestId="user-flow-person-sessions"
              >
                {translator.translateText("Open in session list")}
              </AppLink>
            ) : (
              <></>
            )}
          </p>
        </div>
      </div>

      <div
        className="inline-flex rounded-md shadow-sm"
        role="group"
        aria-label={translator.translateText("View")}
      >
        {VIEWS.map(
          (
            item: { id: UserFlowView; label: string },
            index: number,
          ): ReactElement => {
            const isActive: boolean = item.id === props.view;

            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isActive}
                data-testid={`user-flow-view-${item.id}`}
                className={`border px-3 py-1.5 text-sm font-medium ${
                  index === 0 ? "rounded-l-md" : "-ml-px"
                } ${index === VIEWS.length - 1 ? "rounded-r-md" : ""} ${
                  isActive
                    ? "z-10 border-indigo-600 bg-indigo-600 text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
                onClick={(): void => {
                  props.onViewChange(item.id);
                }}
              >
                {translator.translateText(item.label)}
              </button>
            );
          },
        )}
      </div>

      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-gray-600 hover:bg-indigo-100 hover:text-gray-900"
        data-testid="user-flow-person-clear"
        onClick={props.onClear}
      >
        <Icon icon={IconProp.Close} className="h-4 w-4" />
        <span>{translator.translateText("All users")}</span>
      </button>
    </div>
  );
};
