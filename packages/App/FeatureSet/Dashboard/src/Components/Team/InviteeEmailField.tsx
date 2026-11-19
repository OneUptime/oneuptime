import InviteSuggestionsApi from "./InviteSuggestionsApi";
import { Yellow } from "Common/Types/BrandColors";
import {
  InviteSuggestion,
  InviteSuggestionStanding,
  isInviteSuggestionPickable,
} from "Common/Types/Team/InviteSuggestions";
import { PROJECT_MEMBER_SEARCH_MIN_LENGTH } from "Common/Types/Team/ProjectMemberSearch";
import {
  MenuPosition,
  SUGGESTIONS_MENU_MAX_HEIGHT_IN_PX,
  SUGGESTIONS_MENU_Z_INDEX,
  getMenuPosition,
} from "Common/UI/Components/AutocompleteTextInput/AutocompleteTextInput";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/*
 * AN INVITATION'S EMAIL BOX THAT SUGGESTS PEOPLE AS IT IS TYPED IN (#9701).
 *
 * Invite New Team Member and Invite New User asked for an email and nothing
 * more: inviting a colleague already in the project to another team meant
 * finding their address somewhere else. As two letters or more are typed,
 * the box now lists the people they could mean - the project's people the
 * reader may see, and on a server somebody runs, its other accounts for its
 * master admin (Common/Types/Team/InviteSuggestions says who, and why
 * nobody of another project ever is) - each by name and address, with
 * where they stand:
 *
 *   - Invited: in the project, their invitation not accepted yet;
 *   - Not in this project yet: an account of the server's;
 *   - Already in this team, or Already invited to this team: listed so the
 *     reader knows, and not offered: the invitation would be refused.
 *
 * Picking one fills their address in. Typing any other address works as it
 * always did: nothing has to be picked, and a failed or refused read just
 * suggests nobody.
 *
 * It is the form's own text box (Input), as a combobox: the arrow keys move
 * through the list, Enter picks, Escape closes the list (and not the dialog
 * behind it), and the list is portalled over the dialog, as the other
 * suggestion lists are (AutocompleteTextInput), so a dialog's scroll never
 * clips it.
 */

// How long the box waits after a key before it asks the server.
export const INVITE_SUGGESTIONS_DEBOUNCE_IN_MS: number = 250;

// What each standing says, beside the person.
export const ALREADY_IN_THIS_TEAM_TEXT: string = translationKey(
  "Already in this team",
);

export const ALREADY_INVITED_TO_THIS_TEAM_TEXT: string = translationKey(
  "Already invited to this team",
);

export const INVITED_TEXT: string = translationKey("Invited");

export const NOT_IN_THIS_PROJECT_YET_TEXT: string = translationKey(
  "Not in this project yet",
);

// The list, named for a screen reader.
export const INVITE_SUGGESTIONS_LIST_LABEL: string = translationKey(
  "People you can invite",
);

export interface StandingWords {
  text: string;
  tone: PillTone | null;
}

// What a standing says, or null for a member, who needs no word.
export const getStandingWords: (
  standing: InviteSuggestionStanding,
) => StandingWords | null = (
  standing: InviteSuggestionStanding,
): StandingWords | null => {
  switch (standing) {
    case InviteSuggestionStanding.InThisTeam:
      return { text: ALREADY_IN_THIS_TEAM_TEXT, tone: PillTone.Neutral };
    case InviteSuggestionStanding.InvitedToThisTeam:
      return {
        text: ALREADY_INVITED_TO_THIS_TEAM_TEXT,
        tone: PillTone.Neutral,
      };
    // As a team's Members list draws an invitation not accepted yet.
    case InviteSuggestionStanding.Invited:
      return { text: INVITED_TEXT, tone: null };
    case InviteSuggestionStanding.NotInProject:
      return { text: NOT_IN_THIS_PROJECT_YET_TEXT, tone: PillTone.Neutral };
    default:
      return null;
  }
};

// The next suggestion the arrow keys land on, skipping those not offered.
export const getNextPickableIndex: (data: {
  suggestions: ReadonlyArray<InviteSuggestion>;
  from: number;
  step: 1 | -1;
}) => number = (data: {
  suggestions: ReadonlyArray<InviteSuggestion>;
  from: number;
  step: 1 | -1;
}): number => {
  const count: number = data.suggestions.length;

  for (let moved: number = 1; moved <= count; moved++) {
    const index: number =
      (((data.from + data.step * moved) % count) + count) % count;

    if (isInviteSuggestionPickable(data.suggestions[index]!)) {
      return index;
    }
  }

  return -1;
};

export interface ComponentProps {
  initialValue?: string | undefined;
  onChange: (email: string) => void;
  onBlur?: (() => void) | undefined;
  /*
   * Enter with no suggestion picked out: the form's own Enter, which
   * submits it, as an email row always did.
   */
  onEnterPress?: (() => void) | undefined;
  error?: string | undefined;
  placeholder?: string | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
  // The team the invitation is for, when the form knows it.
  teamId?: string | null | undefined;
  /*
   * A suggestion picked, after its address is filled in: someone with an
   * account the reader may see, so the form has no name to ask for
   * (Common/UI/Utils/InviteeName).
   */
  onPick?: ((suggestion: InviteSuggestion) => void) | undefined;
  dataTestId?: string | undefined;
}

const InviteeEmailField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listboxId: string = `invitee-suggestions-${useId()}`;

  const [value, setValue] = useState<string>(props.initialValue || "");
  const [suggestions, setSuggestions] = useState<Array<InviteSuggestion>>([]);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const containerRef: MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const menuRef: MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const debounceRef: MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurRef: MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  // The newest text asked about: an older answer is dropped.
  const latestTextRef: MutableRefObject<string> = useRef<string>("");

  const showMenu: boolean = isOpen && suggestions.length > 0;

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      if (blurRef.current) {
        clearTimeout(blurRef.current);
      }
    };
  }, []);

  const askFor: (text: string) => void = useCallback(
    (text: string): void => {
      const trimmed: string = text.trim();
      latestTextRef.current = trimmed;

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      if (trimmed.length < PROJECT_MEMBER_SEARCH_MIN_LENGTH) {
        setSuggestions([]);
        setHighlightedIndex(-1);
        return;
      }

      debounceRef.current = setTimeout(() => {
        InviteSuggestionsApi.suggest({ text: trimmed, teamId: props.teamId })
          .then((found: Array<InviteSuggestion>): void => {
            if (latestTextRef.current !== trimmed) {
              return;
            }

            setSuggestions(found);
            setHighlightedIndex(-1);
          })
          .catch((): void => {
            if (latestTextRef.current === trimmed) {
              setSuggestions([]);
            }
          });
      }, INVITE_SUGGESTIONS_DEBOUNCE_IN_MS);
    },
    [props.teamId],
  );

  const pick: (suggestion: InviteSuggestion) => void = (
    suggestion: InviteSuggestion,
  ): void => {
    if (!isInviteSuggestionPickable(suggestion)) {
      return;
    }

    if (blurRef.current) {
      clearTimeout(blurRef.current);
      blurRef.current = null;
    }

    // Picked: nothing more to ask about until the box is typed in again.
    latestTextRef.current = suggestion.email;
    setValue(suggestion.email);
    setSuggestions([]);
    setIsOpen(false);
    setHighlightedIndex(-1);
    props.onChange(suggestion.email);
    props.onPick?.(suggestion);
  };

  const updateMenuPosition: () => void = useCallback((): void => {
    const input: HTMLInputElement | null =
      containerRef.current?.querySelector("input") || null;

    if (!input) {
      return;
    }

    setMenuPosition(
      getMenuPosition(
        input.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, []);

  // Measured before paint, and kept to the box as the dialog scrolls.
  useLayoutEffect(() => {
    if (!showMenu) {
      setMenuPosition(null);
      return;
    }

    updateMenuPosition();

    window.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("resize", updateMenuPosition);

    return () => {
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [showMenu, updateMenuPosition]);

  const onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (!showMenu) {
      return;
    }

    /*
     * The list closes, and the dialog behind it stays open: a handled
     * Escape is not the dialog's (Modal, as AutocompleteTextInput marks it).
     */
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      setHighlightedIndex(-1);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex(
        getNextPickableIndex({
          suggestions: suggestions,
          from:
            highlightedIndex >= 0
              ? highlightedIndex
              : event.key === "ArrowDown"
                ? -1
                : suggestions.length,
          step: event.key === "ArrowDown" ? 1 : -1,
        }),
      );
      return;
    }

    if (event.key === "Enter" && highlightedIndex >= 0) {
      const highlighted: InviteSuggestion | undefined =
        suggestions[highlightedIndex];

      if (highlighted && isInviteSuggestionPickable(highlighted)) {
        // A pick, never the form's submit.
        event.preventDefault();
        pick(highlighted);
      }

      return;
    }

    if (event.key === "Tab") {
      setIsOpen(false);
    }
  };

  const activeOptionId: string | undefined =
    showMenu && highlightedIndex >= 0
      ? `${listboxId}-option-${highlightedIndex}`
      : undefined;

  const getOption: (
    suggestion: InviteSuggestion,
    index: number,
  ) => ReactElement = (
    suggestion: InviteSuggestion,
    index: number,
  ): ReactElement => {
    const isActive: boolean = index === highlightedIndex;
    const isPickable: boolean = isInviteSuggestionPickable(suggestion);
    const standing: StandingWords | null = getStandingWords(
      suggestion.standing,
    );

    const content: ReactElement = (
      <>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm font-medium ${
              isActive ? "text-white" : "text-gray-900"
            }`}
            dir="auto"
          >
            {suggestion.name || suggestion.email}
          </span>
          {suggestion.name ? (
            <span
              className={`block truncate text-xs ${
                isActive ? "text-indigo-100" : "text-gray-500"
              }`}
              dir="ltr"
            >
              {suggestion.email}
            </span>
          ) : (
            <></>
          )}
        </span>
        {standing ? (
          <Pill
            text={standing.text}
            {...(standing.tone ? { tone: standing.tone } : { color: Yellow })}
            isDotHidden={standing.tone !== null}
            className="flex-shrink-0"
            dataTestId="invitee-suggestion-standing"
          />
        ) : (
          <></>
        )}
      </>
    );

    const id: string = `${listboxId}-option-${index}`;

    /*
     * Someone already in the team, or invited to it, is listed for the
     * reader to see and is not offered: not a button, so nothing presses it.
     */
    if (!isPickable) {
      return (
        <div
          key={suggestion.userId}
          id={id}
          role="option"
          aria-selected={false}
          aria-disabled={true}
          className="flex w-full items-center gap-3 px-3 py-2 text-start"
          data-testid="invitee-suggestion"
          data-standing={suggestion.standing}
        >
          {content}
        </div>
      );
    }

    return (
      <button
        key={suggestion.userId}
        id={id}
        type="button"
        role="option"
        /*
         * Out of the dialog's tab order, as the other portalled lists are:
         * the arrow keys and Enter reach them from the box.
         */
        tabIndex={-1}
        aria-selected={isActive}
        className={`flex w-full items-center gap-3 px-3 py-2 text-start ${
          isActive ? "bg-indigo-600" : "hover:bg-indigo-50"
        }`}
        data-testid="invitee-suggestion"
        data-standing={suggestion.standing}
        onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
          // Keep the box focused, so the pick lands before it blurs.
          event.preventDefault();
        }}
        onClick={() => {
          pick(suggestion);
        }}
      >
        {content}
      </button>
    );
  };

  const menu: ReactElement | null = showMenu ? (
    <div
      ref={menuRef}
      id={listboxId}
      role="listbox"
      aria-label={translator.translateText(INVITE_SUGGESTIONS_LIST_LABEL)}
      className="overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
      style={{
        position: "fixed",
        top: menuPosition?.top ?? 0,
        left: menuPosition?.left ?? 0,
        width: menuPosition?.width ?? 0,
        maxHeight: menuPosition?.maxHeight ?? SUGGESTIONS_MENU_MAX_HEIGHT_IN_PX,
        zIndex: SUGGESTIONS_MENU_Z_INDEX,
        // No flash at the corner before the box is measured.
        visibility: menuPosition ? "visible" : "hidden",
      }}
      data-testid="invitee-suggestions"
    >
      {suggestions.map(getOption)}
    </div>
  ) : null;

  return (
    <div ref={containerRef}>
      <Input
        type={"email" as InputType}
        value={value}
        initialValue={props.initialValue || ""}
        placeholder={props.placeholder}
        error={props.error}
        dataTestId={props.dataTestId}
        ariaLabelledby={props.ariaLabelledby}
        ariaDescribedby={props.ariaDescribedby}
        // The browser's own list of addresses would cover this one.
        autoComplete="off"
        disableSpellCheck={true}
        role="combobox"
        ariaAutoComplete="list"
        ariaHasPopup="listbox"
        ariaExpanded={showMenu}
        ariaControls={listboxId}
        ariaActiveDescendant={activeOptionId}
        onChange={(typed: string) => {
          setValue(typed);
          setIsOpen(true);
          props.onChange(typed);
          askFor(typed);
        }}
        onFocus={() => {
          if (blurRef.current) {
            clearTimeout(blurRef.current);
            blurRef.current = null;
          }

          setIsOpen(true);
        }}
        onBlur={() => {
          // After a click on the list has landed.
          blurRef.current = setTimeout(() => {
            setIsOpen(false);
            setHighlightedIndex(-1);
          }, 150);
          props.onBlur?.();
        }}
        onKeyDown={onKeyDown}
        // Called only when onKeyDown did not take the Enter for a pick.
        onEnterPress={props.onEnterPress}
      />
      {menu ? createPortal(menu, document.body) : <></>}
    </div>
  );
};

export default InviteeEmailField;
