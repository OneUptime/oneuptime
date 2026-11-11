import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import IconProp from "Common/Types/Icon/IconProp";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Icon from "Common/UI/Components/Icon/Icon";
import PeopleAvatar from "Common/UI/Components/PeoplePicker/PeopleAvatar";
import PeopleSearchPopup, {
  PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX,
  PEOPLE_SEARCH_POPUP_WIDTH_PX,
} from "Common/UI/Components/PeoplePicker/PeopleSearchPopup";
import {
  getPeoplePickerOptionKey,
  PeoplePickerKind,
  PeoplePickerOption,
  PeoplePickerValue,
  replacePeoplePickerValue,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import usePeopleOptions, {
  PeopleOptionsLookup,
} from "Common/UI/Components/PeoplePicker/usePeopleOptions";
import useAnchoredFieldPopup, {
  AnchoredFieldPopup,
  getAnchoredPopupTriggerProps,
} from "Common/UI/Types/UseAnchoredFieldPopup";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  ExceptionAssignmentWrite,
  getExceptionAssigneeValue,
  getExceptionAssignmentWrite,
  isSameAssignment,
} from "../../Utils/ExceptionAssignment";
import {
  EmptyPlace,
  getEmptyPlaceActionClassName,
} from "../EventView/EventPeopleFacts";

/*
 * Who owns the exception, as the Assignee fact of its header: one person or
 * one team, drawn as an avatar and a name - the way an incident's header
 * names its commander (EventPeopleFacts) - and changed right there.
 *
 *   - Nobody: the empty place, a dashed circle and "Assign", opens a list
 *     of the project's people and teams under it; a pick is saved at once.
 *   - Somebody: their name opens the same list to hand it to someone else,
 *     and the × beside it unassigns.
 *   - Someone who may not update exceptions reads who owns it, or
 *     "Unassigned", and is offered nothing.
 *
 * Names are looked up from the ids the exception holds (usePeopleOptions),
 * and a pick's name is known at once, so the fact never blinks to
 * "Loading..." after a pick.
 */

export const ASSIGNEE_KINDS: Array<PeoplePickerKind> = [
  PeoplePickerKind.User,
  PeoplePickerKind.Team,
];

export const EXCEPTION_ASSIGNEE_TEST_IDS: {
  assignee: string;
  assign: string;
  change: string;
  unassign: string;
  name: string;
} = {
  assignee: "exception-assignee",
  assign: "exception-assignee-assign",
  change: "exception-assignee-change",
  unassign: "exception-assignee-unassign",
  name: "exception-assignee-name",
};

/*
 * The name as a control: laid out like a person (avatar, gap, name), its
 * avatar lined up with the words of the facts beside it, the whole of it
 * lit on hover and while its list is open, as the empty place is.
 */
export const EXCEPTION_ASSIGNEE_CHANGE_CLASS_NAME: string =
  "-my-0.5 -ms-1 inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full py-0.5 pe-2 ps-1 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

const CHANGE_IDLE_CLASS_NAME: string = "text-gray-900";

const CHANGE_HOVER_CLASS_NAME: string = "hover:bg-gray-100";

const CHANGE_OPEN_CLASS_NAME: string = "bg-gray-100 text-gray-900";

const UNASSIGN_CLASS_NAME: string =
  "flex flex-shrink-0 items-center justify-center rounded-full p-1 text-gray-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export interface ComponentProps {
  exception: Pick<TelemetryException, "assignToUserId" | "assignToTeamId">;
  // An assignment is being saved: the controls wait.
  isSaving?: boolean | undefined;
  /*
   * Save a pick: the person or the team picked, the other cleared, or
   * nobody. Called only when it changes something. A promise keeps the
   * picked row busy until it settles.
   */
  onAssign: (write: ExceptionAssignmentWrite) => void | Promise<void>;
}

interface AssigneePick {
  kind: PeoplePickerKind;
  id: string;
}

// The exception's one pick, of either kind, or nobody.
export function getExceptionAssigneePick(
  exception: Pick<TelemetryException, "assignToUserId" | "assignToTeamId">,
): AssigneePick | null {
  const value: PeoplePickerValue = getExceptionAssigneeValue(exception);

  for (const kind of ASSIGNEE_KINDS) {
    const id: string | undefined = value[kind]?.[0];

    if (id) {
      return { kind, id };
    }
  }

  return null;
}

const ExceptionAssignee: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const updateGate: PermissionGateResult = useMemo(() => {
    return PermissionGate.check(new TelemetryException(), ModelAction.Update);
  }, []);
  const canAssign: boolean = updateGate.isAllowed;
  const isSaving: boolean = Boolean(props.isSaving);

  const popup: AnchoredFieldPopup = useAnchoredFieldPopup({
    popupMaxHeight: PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX,
    popupWidth: PEOPLE_SEARCH_POPUP_WIDTH_PX,
    revealRoomOnOpen: true,
  });

  const value: PeoplePickerValue = getExceptionAssigneeValue(props.exception);
  const lookup: PeopleOptionsLookup = usePeopleOptions({
    kinds: ASSIGNEE_KINDS,
    value: value,
  });
  const pick: AssigneePick | null = getExceptionAssigneePick(props.exception);
  const pickKey: string = pick ? getPeoplePickerOptionKey(pick.kind, pick.id) : "";

  // What the list marks as picked: the one it holds now.
  const selectedKeys: Set<string> = useMemo((): Set<string> => {
    return new Set<string>(pickKey ? [pickKey] : []);
  }, [pickKey]);

  const assign: (write: ExceptionAssignmentWrite) => Promise<void> = async (
    write: ExceptionAssignmentWrite,
  ): Promise<void> => {
    if (isSameAssignment(props.exception, write)) {
      return;
    }

    await props.onAssign(write);
  };

  const list: ReactElement = canAssign ? (
    <PeopleSearchPopup
      popup={popup}
      kinds={ASSIGNEE_KINDS}
      selectedKeys={selectedKeys}
      selectionMode="single"
      onPick={async (
        option: PeoplePickerOption,
        isPicked: boolean,
      ): Promise<void> => {
        lookup.remember([option]);

        // Picking the one it holds keeps it.
        if (!isPicked) {
          await assign(
            getExceptionAssignmentWrite(
              replacePeoplePickerValue(option.kind, option.id),
            ),
          );
        }

        popup.closePopup(true);
      }}
      onOptionsLoaded={lookup.remember}
      searchPlaceholder="Search people and teams"
      ariaLabel="Assign"
    />
  ) : (
    <></>
  );

  if (!pick) {
    if (!canAssign) {
      return (
        <span
          data-testid={EXCEPTION_ASSIGNEE_TEST_IDS.assignee}
          className="font-normal text-gray-500"
        >
          {translator.translateText("Unassigned")}
        </span>
      );
    }

    return (
      <div
        data-testid={EXCEPTION_ASSIGNEE_TEST_IDS.assignee}
        className="flex max-w-full"
        aria-busy={isSaving ? true : undefined}
      >
        <div ref={popup.anchorRef} className="flex max-w-full">
          <button
            type="button"
            data-testid={EXCEPTION_ASSIGNEE_TEST_IDS.assign}
            disabled={isSaving}
            {...getAnchoredPopupTriggerProps(popup)}
            className={getEmptyPlaceActionClassName(popup.isPopupOpen)}
          >
            <EmptyPlace isOpen={popup.isPopupOpen} />
            <span>{translator.translateText("Assign")}</span>
          </button>
        </div>
        {list}
      </div>
    );
  }

  const option: PeoplePickerOption | undefined = lookup.getOption(
    pick.kind,
    pick.id,
  );
  const isKnown: boolean = Boolean(option && !option.isUnknown);
  const name: string = option
    ? option.isUnknown
      ? translator.translateText(option.name) || option.name
      : option.name
    : translator.translateText("Loading...") || "Loading...";

  const person: ReactElement = (
    <>
      <span aria-hidden="true" className="-my-0.5 inline-flex flex-shrink-0">
        <PeopleAvatar
          size="chip"
          item={{
            kind: pick.kind,
            name: isKnown && option ? option.name : "?",
            userId: option?.userId,
            hasProfilePicture: option?.hasProfilePicture,
          }}
        />
      </span>
      <span
        data-testid={EXCEPTION_ASSIGNEE_TEST_IDS.name}
        data-kind={pick.kind}
        className={`min-w-0 truncate ${isKnown ? "" : "italic text-gray-500"}`}
      >
        {name}
      </span>
    </>
  );

  if (!canAssign) {
    return (
      <span
        data-testid={EXCEPTION_ASSIGNEE_TEST_IDS.assignee}
        className="inline-flex min-w-0 max-w-full items-center gap-1.5"
      >
        {person}
      </span>
    );
  }

  const unassignText: string =
    translator.translateText("Unassign") || "Unassign";

  return (
    <div
      data-testid={EXCEPTION_ASSIGNEE_TEST_IDS.assignee}
      className="flex min-w-0 max-w-full items-center gap-0.5"
      aria-busy={isSaving ? true : undefined}
    >
      <div ref={popup.anchorRef} className="flex min-w-0 max-w-full">
        <button
          type="button"
          data-testid={EXCEPTION_ASSIGNEE_TEST_IDS.change}
          disabled={isSaving}
          {...getAnchoredPopupTriggerProps(popup)}
          className={`${EXCEPTION_ASSIGNEE_CHANGE_CLASS_NAME} ${
            popup.isPopupOpen
              ? CHANGE_OPEN_CLASS_NAME
              : `${CHANGE_IDLE_CLASS_NAME} ${getHandDrawnButtonStateClassName({
                  isBusy: isSaving,
                  hoverClassName: CHANGE_HOVER_CLASS_NAME,
                })}`
          }`}
        >
          {person}
          <span className="sr-only">{translator.translateText("Change")}</span>
          <Icon
            icon={IconProp.ChevronDown}
            className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
          />
        </button>
      </div>
      <button
        type="button"
        data-testid={EXCEPTION_ASSIGNEE_TEST_IDS.unassign}
        aria-label={unassignText}
        title={unassignText}
        disabled={isSaving}
        onClick={() => {
          void assign({ assignToUserId: null, assignToTeamId: null });
        }}
        className={`${UNASSIGN_CLASS_NAME} ${getHandDrawnButtonStateClassName({
          isBusy: isSaving,
          hoverClassName: "hover:bg-gray-100 hover:text-gray-700",
        })}`}
      >
        <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
      </button>
      {list}
    </div>
  );
};

export default ExceptionAssignee;
