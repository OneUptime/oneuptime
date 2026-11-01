import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SessionReplayUserAvatar from "../SessionReplay/SessionReplayUserAvatar";
import {
  fetchSessionReplayUsers,
  SessionReplayUserRollup,
  SessionReplayUsersResult,
} from "../SessionReplay/SessionReplayUsersApi";
import { shortVisitorId } from "../SessionReplay/SessionReplayUserIdentity";
import {
  buildUserFlowScopeOptions,
  UserFlowScope,
  UserFlowScopeOption,
} from "./UserFlowScope";

/*
 * The box that narrows the page to one person or one session. It opens on the
 * people seen in the range, because most people do not know a reference by
 * heart; typing filters them, and Enter looks up what was typed, which reaches
 * anyone, listed or not. The list is a help, so a failure to load it leaves
 * the box working.
 */

export const USER_FLOW_SCOPE_USERS_LIMIT: number = 50;

const LIST_ID: string = "user-flow-scope-options";

export interface ComponentProps {
  rumApplicationId: ObjectID;
  timeRange: RangeStartAndEndDateTime;
  onSelect: (scope: UserFlowScope) => void;
}

function describeTyped(
  scope: UserFlowScope,
  text: string,
  translator: Translator,
): string {
  switch (scope.kind) {
    case "session":
      return translator.translateTemplate("Find session {{id}}", {
        id: scope.sessionId.slice(0, 8),
      });
    case "visitor":
      return translator.translateTemplate("Find visitor {{id}}", {
        id: shortVisitorId(scope.visitorId),
      });
    case "user":
      return translator.translateTemplate("Find user {{reference}}", {
        reference: scope.identifiedUserRef || text,
      });
  }
}

const UserFlowScopeFilter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const inputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);

  const [text, setText] = useState<string>("");
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [users, setUsers] = useState<Array<SessionReplayUserRollup>>([]);

  const usersKey: string = [
    props.rumApplicationId.toString(),
    String(props.timeRange.range),
    props.timeRange.startAndEndDate?.startValue?.toISOString() || "",
    props.timeRange.startAndEndDate?.endValue?.toISOString() || "",
  ].join("|");

  /* Read when the box is first opened, then once per window it is opened on. */
  const loadedUsersKeyRef: React.MutableRefObject<string> = useRef<string>("");

  useEffect((): void => {
    if (!isOpen || loadedUsersKeyRef.current === usersKey) {
      return;
    }

    loadedUsersKeyRef.current = usersKey;

    const bounds: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(props.timeRange);

    fetchSessionReplayUsers({
      rumApplicationId: props.rumApplicationId,
      startTime: bounds.startValue,
      endTime: bounds.endValue,
      limit: USER_FLOW_SCOPE_USERS_LIMIT,
    })
      .then((result: SessionReplayUsersResult): void => {
        if (loadedUsersKeyRef.current === usersKey) {
          setUsers(result.users);
        }
      })
      .catch((): void => {
        if (loadedUsersKeyRef.current === usersKey) {
          setUsers([]);
        }
      });
  }, [isOpen, usersKey]);

  const options: Array<UserFlowScopeOption> = useMemo(() => {
    return buildUserFlowScopeOptions(text, users);
  }, [text, users]);

  const select: (option: UserFlowScopeOption) => void = (
    option: UserFlowScopeOption,
  ): void => {
    setText("");
    setIsOpen(false);
    inputRef.current?.blur();
    props.onSelect(option.scope);
  };

  const onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current: number): number => {
        const step: number = event.key === "ArrowDown" ? 1 : -1;

        return Math.max(0, Math.min(options.length - 1, current + step));
      });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      const option: UserFlowScopeOption | undefined = options[activeIndex];

      if (option) {
        select(option);
      }

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();

      if (text) {
        setText("");
        setActiveIndex(0);
        return;
      }

      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div
      className="relative w-full sm:w-80"
      data-testid="user-flow-scope-filter"
    >
      <div className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 shadow-sm focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
        <Icon
          icon={IconProp.Search}
          className="h-4 w-4 flex-none text-gray-400"
        />
        <input
          data-unsaved-changes-ignore
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={translator.translateText("Filter by user or session ID")}
          aria-expanded={isOpen}
          aria-controls={LIST_ID}
          aria-autocomplete="list"
          aria-activedescendant={
            isOpen && options[activeIndex]
              ? `${LIST_ID}-${activeIndex}`
              : undefined
          }
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none"
          placeholder={translator.translateText("Filter by user or session ID")}
          data-testid="user-flow-scope-input"
          value={text}
          onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
            setText(event.target.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onFocus={(): void => {
            setIsOpen(true);
          }}
          onBlur={(): void => {
            setIsOpen(false);
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      {isOpen ? (
        <div
          className="absolute right-0 top-full z-20 mt-1 w-full min-w-[18rem] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          data-testid="user-flow-scope-menu"
        >
          {options.length === 0 ? (
            <p
              className="px-3 py-2 text-xs text-gray-500"
              data-testid="user-flow-scope-hint"
            >
              {translator.translateText(
                "Type a user's reference or a session ID, then press Enter.",
              )}
            </p>
          ) : (
            <ul
              id={LIST_ID}
              role="listbox"
              aria-label={translator.translateText("Users and sessions")}
            >
              {options.map(
                (option: UserFlowScopeOption, index: number): ReactElement => {
                  return (
                    <li
                      key={option.id}
                      id={`${LIST_ID}-${index}`}
                      role="option"
                      aria-selected={index === activeIndex}
                      data-testid="user-flow-scope-option"
                      data-kind={option.scope.kind}
                      className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${
                        index === activeIndex ? "bg-indigo-50" : ""
                      }`}
                      /* Keeps the focus in the box, so a click is not a blur. */
                      onMouseDown={(event: React.MouseEvent): void => {
                        event.preventDefault();
                      }}
                      onMouseEnter={(): void => {
                        setActiveIndex(index);
                      }}
                      onClick={(): void => {
                        select(option);
                      }}
                    >
                      {option.kind === "typed" ? (
                        <>
                          <Icon
                            icon={IconProp.Search}
                            className="h-4 w-4 flex-none text-gray-400"
                          />
                          <span className="min-w-0 truncate text-gray-900">
                            {describeTyped(
                              option.scope,
                              option.text,
                              translator,
                            )}
                          </span>
                        </>
                      ) : (
                        <>
                          <SessionReplayUserAvatar
                            initials={option.person.initials}
                            hue={option.person.hue}
                          />
                          <span
                            className="min-w-0 flex-1 truncate text-gray-900"
                            title={option.person.title}
                          >
                            {option.person.kind === "hidden"
                              ? translator.translateText("Hidden")
                              : option.person.text}
                          </span>
                          <span className="flex-none text-xs text-gray-500">
                            {translator.translatePlural(
                              {
                                one: "{{count}} session",
                                other: "{{count}} sessions",
                              },
                              option.sessionCount,
                            )}
                          </span>
                        </>
                      )}
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default UserFlowScopeFilter;
