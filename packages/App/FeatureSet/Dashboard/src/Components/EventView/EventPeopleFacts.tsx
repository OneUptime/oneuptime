import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import PeopleAvatar, {
  PeopleAvatarItem,
} from "Common/UI/Components/PeoplePicker/PeopleAvatar";
import PeopleSearchPopup, {
  PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX,
  PEOPLE_SEARCH_POPUP_WIDTH_PX,
} from "Common/UI/Components/PeoplePicker/PeopleSearchPopup";
import {
  getPeoplePickerOptionKey,
  PeoplePickerKind,
  PeoplePickerOption,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import useAnchoredFieldPopup, {
  AnchoredFieldPopup,
  getAnchoredPopupTriggerProps,
} from "Common/UI/Types/UseAnchoredFieldPopup";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useMemo,
  useRef,
} from "react";
import AppLink from "../AppLink/AppLink";
import {
  ADD_OWNERS_TEXT,
  getOwnerKeys,
  OwnersChange,
  OwnersTarget,
} from "../Owners/AddOwners";
import AddOwnersPopup, { useAddOwnersPopup } from "../Owners/AddOwnersPopup";
import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";
import { EventStatusFact } from "./EventStatusPanel";
import { EVENT_HEADER_FACT_EDITOR_ATTRIBUTE } from "./EventHeaderLayout";
import {
  EventRoleMember,
  MAX_HEADER_OWNERS,
  PrimaryRoleHolding,
  getEventOwnerName,
} from "../../Utils/EventPeople";
import { VisibleItems, splitVisibleItems } from "../../Utils/EventOverview";

/*
 * Who is on it, in the header of an incident, an alert, an episode or a
 * scheduled maintenance event: who commands the response and who owns it,
 * so nobody has to open the roles card or the Owners page to find out (the
 * customer's "Easy to see Incident Commander and Team(s)").
 *
 * Both are drawn as an avatar and a name, the way the Owners page and the
 * owners column draw people and teams (PeopleAvatar), under their label in
 * the header's facts. The avatar and the empty place are 24px but take a
 * text line's 20px in the row (-my-0.5), so a name sits where the words of
 * the facts beside it do, level with them, and a fact with people is no
 * taller than one with words.
 *
 * While the record is open, a role nobody holds and a record nobody owns
 * show the empty place itself - a dashed circle with a plus where the avatar
 * would be, as the Owners page offers its next owner - with the word that
 * fills it, "Assign" or "Add", the two together one control that lights up
 * as a whole. A record that has owners ends their list with the same "Add",
 * on a line of its own, to add more. Both are done right there: Add opens
 * the Add owners list (the Owners page's own), Assign a list of the
 * project's people, under the control - nobody leaves the page to fill
 * either. They are offered only to a reader who may add an owner or give
 * the role. Once the record is over, they say "Not assigned" and "None", and
 * offer nothing.
 *
 * Once somebody holds the role, their name hands it on (#10195): pointed
 * at, it lights up with a pencil after its label and "Click to reassign",
 * and pressed it opens the same list of people, the holder ticked
 * (ReassignablePerson). It is offered to a reader who may hand a role on
 * while the record is open; to anyone else the name is plain text.
 */

const LINK_CLASS_NAME: string =
  "rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

/*
 * Assign / Add: the empty place and its word as one control, laid out like
 * a person (avatar, gap, name), its circle lined up with the avatars of the
 * facts beside it. The whole control lights up on hover, so it reads as
 * something to press rather than a word that happens to be blue - and
 * stays lit while its list is open, so the reader sees which Add or Assign
 * the list under it belongs to. Its colours are one set or the other, never
 * both: the Dashboard's Tailwind would let whichever rule it wrote last win.
 */
export const EVENT_EMPTY_PLACE_ACTION_CLASS_NAME: string =
  "group -my-0.5 -ms-1 inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pe-2.5 ps-1 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export const EVENT_EMPTY_PLACE_ACTION_IDLE_CLASS_NAME: string =
  "text-gray-700 hover:bg-indigo-50 hover:text-indigo-700";

export const EVENT_EMPTY_PLACE_ACTION_OPEN_CLASS_NAME: string =
  "bg-indigo-50 text-indigo-700";

// The empty place's circle, idle and while its list is open.
const EMPTY_PLACE_CLASS_NAME: string =
  "-my-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-dashed transition-colors";

const EMPTY_PLACE_IDLE_CLASS_NAME: string =
  "border-gray-300 text-gray-400 group-hover:border-indigo-500 group-hover:text-indigo-500";

const EMPTY_PLACE_OPEN_CLASS_NAME: string = "border-indigo-500 text-indigo-500";

// A quiet "Not assigned" / "None": a fact with nothing to name.
const EMPTY_VALUE_CLASS_NAME: string = "font-normal text-gray-500";

/*
 * The value's box: one person a line, as the header lists monitors and
 * status pages, their avatars 4px apart from line to line - so a list reads
 * the same at every width, never two names side by side on one line and a
 * third under them, and the place to add another owner is the list's last
 * line, never a circle left alone after a wrap. Focus lands on it once the
 * Assign list has given the role, so the keyboard stays where it was.
 */
const VALUE_CLASS_NAME: string =
  "flex max-w-full flex-col items-start gap-2 focus:outline-none";

/*
 * The Assign list's words: it lists the project's people, each with their
 * email under their name. Short, as the Add owners list's "Search people or
 * teams...": "Search people by name or email" ran past the search box in
 * German, French, Spanish, Russian and the Nordic languages.
 */
export const ASSIGN_SEARCH_PLACEHOLDER: string =
  translationKey("Search people...");
export const ASSIGN_EMPTY_TEXT: string = translationKey("No people available.");

// What the Assign list leaves out: nobody - it opens while nobody holds the role.
const NOBODY_PICKED: Set<string> = new Set<string>();

/*
 * What pointing at the commander's name says it does (#10195), in the
 * customer's words. A tooltip shows under a pointer; the name's own label
 * says the same to a screen reader and the keyboard ("Reassign Incident
 * Commander from Maya Chen").
 */
export const CLICK_TO_REASSIGN_TEXT: string =
  translationKey("Click to reassign");

/*
 * The commander's name as a control that hands the role on (#10195): laid
 * out as the person is (avatar, gap, name), its avatar lined up with the
 * avatars of the facts beside it, as Assign's empty place is. Pointed at,
 * it shows what it does - a light ground and a thin ring around the name,
 * the pencil after the label (EventStatusFact.isEditableInPlace) and
 * "Click to reassign" - and it stays lit while its list is open. Its
 * colours are one set or the other, never both: the Dashboard's Tailwind
 * would let whichever rule it wrote last win. The dark theme draws the
 * ground and the ring as it draws Assign's (Theme.css).
 *
 * It may be as wide as the box around it and the 0.25rem it reaches back
 * past that box's start (-ms-1): held to the box alone, as max-w-full held
 * it, a name that fits on one line was cut 0.25rem short of it and broke
 * onto two ("Maya" over "Chen"), since the box is only as wide as the
 * name less that margin.
 */
export const EVENT_COMMANDER_REASSIGN_CLASS_NAME: string =
  "-my-0.5 -ms-1 inline-flex min-w-0 max-w-[calc(100%+0.25rem)] items-center rounded-full py-0.5 pe-2 ps-1 text-start transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export const EVENT_COMMANDER_REASSIGN_IDLE_CLASS_NAME: string =
  "hover:bg-indigo-50 hover:ring-1 hover:ring-indigo-300";

export const EVENT_COMMANDER_REASSIGN_OPEN_CLASS_NAME: string =
  "bg-indigo-50 ring-1 ring-indigo-300";

export const getCommanderReassignClassName: (isOpen: boolean) => string = (
  isOpen: boolean,
): string => {
  return `${EVENT_COMMANDER_REASSIGN_CLASS_NAME} ${
    isOpen
      ? EVENT_COMMANDER_REASSIGN_OPEN_CLASS_NAME
      : EVENT_COMMANDER_REASSIGN_IDLE_CLASS_NAME
  }`;
};

/*
 * Where the avatar would be: a dashed circle with a plus. Decoration - the
 * word beside it, or the control's name, says what it does.
 */
export interface EmptyPlaceProps {
  // Its control's list is open: the circle is lit with it.
  isOpen?: boolean | undefined;
}

export const EmptyPlace: FunctionComponent<EmptyPlaceProps> = (
  props: EmptyPlaceProps,
): ReactElement => {
  return (
    <span
      aria-hidden="true"
      data-testid="event-empty-place"
      className={`${EMPTY_PLACE_CLASS_NAME} ${
        props.isOpen ? EMPTY_PLACE_OPEN_CLASS_NAME : EMPTY_PLACE_IDLE_CLASS_NAME
      }`}
    >
      <Icon icon={IconProp.Add} className="h-3.5 w-3.5" />
    </span>
  );
};

export const getEmptyPlaceActionClassName: (isOpen: boolean) => string = (
  isOpen: boolean,
): string => {
  return `${EVENT_EMPTY_PLACE_ACTION_CLASS_NAME} ${
    isOpen
      ? EVENT_EMPTY_PLACE_ACTION_OPEN_CLASS_NAME
      : EVENT_EMPTY_PLACE_ACTION_IDLE_CLASS_NAME
  }`;
};

interface PersonProps {
  item: PeopleAvatarItem;
  dataTestId: string;
}

// A person's name beside their avatar: wrapped rather than cut short.
export const EVENT_PERSON_NAME_CLASS_NAME: string = "min-w-0 break-words";

// An avatar and a name. The avatar is decoration: the name is read out.
const Person: FunctionComponent<PersonProps> = (
  props: PersonProps,
): ReactElement => {
  return (
    <span
      data-testid={props.dataTestId}
      data-kind={props.item.kind}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5"
    >
      <span aria-hidden="true" className="-my-0.5 inline-flex flex-shrink-0">
        <PeopleAvatar item={props.item} size="chip" />
      </span>
      {/*
       * A long name wraps beside its avatar rather than being cut short: in
       * a phone's two columns of facts "Database Reliability" had a few
       * letters and an ellipsis. It reads the way it is written
       * (IsolatedLine): an English name on an Arabic page wraps from its own
       * start, as wide as its words beside the avatar, and keeps its
       * brackets and full stops where they were typed.
       */}
      <IsolatedLine
        as="span"
        text={props.item.name}
        className={EVENT_PERSON_NAME_CLASS_NAME}
        dataTestId="event-person-name"
      />
    </span>
  );
};

const toMemberAvatar: (member: EventRoleMember) => PeopleAvatarItem = (
  member: EventRoleMember,
): PeopleAvatarItem => {
  return {
    kind: PeoplePickerKind.User,
    name: member.name || member.email || "",
    userId: member.userId ? new ObjectID(member.userId) : undefined,
    hasProfilePicture: member.hasProfilePicture,
  };
};

const toOwnerAvatar: (owner: ResourceOwnerEntry) => PeopleAvatarItem = (
  owner: ResourceOwnerEntry,
): PeopleAvatarItem => {
  if (owner.kind === "team") {
    return {
      kind: PeoplePickerKind.Team,
      name: getEventOwnerName(owner),
      hasProfilePicture: false,
    };
  }

  return {
    kind: PeoplePickerKind.User,
    name: getEventOwnerName(owner),
    userId: owner.user.id ?? undefined,
    hasProfilePicture: Boolean(owner.user.profilePictureId),
  };
};

/*
 * Hands the role from `member` to `person` in one change (Reassign).
 * Rejects with why it was refused, which the list says.
 */
export type CommanderReassign = (
  member: EventRoleMember,
  person: PeoplePickerOption,
) => Promise<void>;

interface ReassignablePersonProps {
  member: EventRoleMember;
  // The role's name as the label shows it, for what the name is heard as.
  roleName: string;
  onReassign: CommanderReassign;
}

/*
 * THE COMMANDER'S NAME, WHICH HANDS THE ROLE ON (#10195).
 *
 * Changing the commander used to mean scrolling to the Incident Roles card
 * in the middle of an incident. The name in the header is the control now:
 * pressed - or Enter, Space or Down from the keyboard - it opens the list
 * the header's Assign opens (PeopleSearchPopup), right under it, with the
 * person who holds the role ticked. Picking someone else hands the role to
 * them at once, in one change (CommanderReassign): it can be handed back
 * the same way, and the feed says who did it, so nothing asks again.
 * Picking the person ticked keeps them. A refusal is said in the list,
 * which stays open; Escape or a press outside closes it, and the focus
 * goes back to the name.
 *
 * Inline rather than the roles card's Reassign dialog: it is where the
 * reader is already looking, two presses instead of four, and the same
 * list as Assign, so giving the role and handing it on look and work
 * alike.
 */
const ReassignablePerson: FunctionComponent<ReassignablePersonProps> = (
  props: ReassignablePersonProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const popup: AnchoredFieldPopup = useAnchoredFieldPopup({
    popupMaxHeight: PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX,
    popupWidth: PEOPLE_SEARCH_POPUP_WIDTH_PX,
    revealRoomOnOpen: true,
  });

  const memberName: string = props.member.name || props.member.email || "";

  /*
   * The role's name as the header's label shows it: the seeded "Incident
   * Commander" in the reader's language, a project's own name as written.
   */
  const roleText: string =
    translator.translateText(props.roleName) || props.roleName;

  // What the name does, heard whole: "Reassign Incident Commander from Maya Chen".
  const reassignText: string = translator.translateTemplate(
    "Reassign {{role}} from {{member}}",
    { role: roleText, member: memberName },
  );

  // The list's name: "Reassign Incident Commander".
  const listText: string = translator.translateTemplate("Reassign {{role}}", {
    role: roleText,
  });

  // The person who holds the role: ticked in the list.
  const holderKeys: Set<string> = useMemo((): Set<string> => {
    return new Set<string>([
      getPeoplePickerOptionKey(PeoplePickerKind.User, props.member.userId),
    ]);
  }, [props.member.userId]);

  return (
    <div className="flex max-w-full">
      <div ref={popup.anchorRef} className="flex min-w-0 max-w-full">
        {/*
         * Under the name, so it never covers the role's label and the
         * pencil after it; gone while the list it leads to is open.
         */}
        <Tooltip
          text={CLICK_TO_REASSIGN_TEXT}
          placement="bottom"
          isHidden={popup.isPopupOpen}
        >
          <button
            type="button"
            data-testid="event-commander-reassign"
            {...{ [EVENT_HEADER_FACT_EDITOR_ATTRIBUTE]: "true" }}
            {...getAnchoredPopupTriggerProps(popup)}
            aria-label={reassignText}
            className={getCommanderReassignClassName(popup.isPopupOpen)}
          >
            <Person
              item={toMemberAvatar(props.member)}
              dataTestId="event-commander-person"
            />
          </button>
        </Tooltip>
      </div>
      <PeopleSearchPopup
        popup={popup}
        kinds={[PeoplePickerKind.User]}
        selectedKeys={holderKeys}
        selectionMode="single"
        onPick={async (
          person: PeoplePickerOption,
          isPicked: boolean,
        ): Promise<void> => {
          // The person who holds it already keeps it.
          if (!isPicked) {
            await props.onReassign(props.member, person);
          }

          popup.closePopup(true);
        }}
        searchPlaceholder={ASSIGN_SEARCH_PLACEHOLDER}
        emptyText={ASSIGN_EMPTY_TEXT}
        ariaLabel={listText}
        isAriaLabelTranslated={true}
      />
    </div>
  );
};

export interface CommanderFactValueProps {
  members: Array<EventRoleMember>;
  // The role's name, for what Assign says to a screen reader.
  roleName: string;
  /*
   * Offered while the record is still open, to a reader who may give the
   * role: Assign opens a list of the project's people right under it, and
   * the person picked is given the role. Rejects with why it was refused,
   * which the list says. A record that is over says only that nobody held
   * it.
   */
  onAssign?: ((person: PeoplePickerOption) => Promise<void>) | undefined;
  /*
   * Offered while the record is still open, to a reader who may hand the
   * role on (#10195): the name of whoever holds it opens the same list,
   * and the person picked takes the role over (ReassignablePerson). Left
   * out - a reader who may not, a record that is over - the name is plain
   * text, as it always was.
   */
  onReassign?: CommanderReassign | undefined;
}

export const CommanderFactValue: FunctionComponent<CommanderFactValueProps> = (
  props: CommanderFactValueProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const popup: AnchoredFieldPopup = useAnchoredFieldPopup({
    popupMaxHeight: PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX,
    popupWidth: PEOPLE_SEARCH_POPUP_WIDTH_PX,
    revealRoomOnOpen: true,
  });

  // Where the keyboard goes once the list has given the role.
  const valueRef: MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  /*
   * The role's name as the header's label shows it: the panel looks a
   * fact's label up, so the seeded "Incident Commander" reads in the
   * reader's language and a project's own name as written.
   */
  const assignText: string = translator.translateTemplate("Assign {{role}}", {
    role: translator.translateText(props.roleName) || props.roleName,
  });

  /*
   * Drawn whatever the value shows, so the list stays put while the header
   * swaps Assign for the person it was just given to.
   */
  const assignList: ReactElement = props.onAssign ? (
    <PeopleSearchPopup
      popup={popup}
      kinds={[PeoplePickerKind.User]}
      selectedKeys={NOBODY_PICKED}
      selectionMode="single"
      onPick={async (person: PeoplePickerOption): Promise<void> => {
        await props.onAssign!(person);
        popup.closePopup(false);
        valueRef.current?.focus({ preventScroll: true });
      }}
      searchPlaceholder={ASSIGN_SEARCH_PLACEHOLDER}
      emptyText={ASSIGN_EMPTY_TEXT}
      ariaLabel={assignText}
      isAriaLabelTranslated={true}
    />
  ) : (
    <></>
  );

  if (props.members.length === 0) {
    if (!props.onAssign) {
      return (
        <span data-testid="event-commander" className={EMPTY_VALUE_CLASS_NAME}>
          {translator.translateText("Not assigned")}
        </span>
      );
    }

    return (
      <div
        ref={valueRef}
        tabIndex={-1}
        data-testid="event-commander"
        className={VALUE_CLASS_NAME}
      >
        <div ref={popup.anchorRef} className="flex max-w-full">
          <button
            type="button"
            data-testid="event-commander-assign"
            {...getAnchoredPopupTriggerProps(popup)}
            aria-label={assignText}
            className={getEmptyPlaceActionClassName(popup.isPopupOpen)}
          >
            <EmptyPlace isOpen={popup.isPopupOpen} />
            <span>{translator.translateText("Assign")}</span>
          </button>
        </div>
        {assignList}
      </div>
    );
  }

  return (
    <div
      ref={valueRef}
      tabIndex={props.onAssign ? -1 : undefined}
      data-testid="event-commander"
      className={VALUE_CLASS_NAME}
    >
      {props.members.map((member: EventRoleMember, index: number) => {
        /*
         * Keyed by the row that gives the role: handed on, it is the same
         * row naming someone else, so the name keeps its place - and the
         * keyboard's - as it changes.
         */
        const key: string = member.memberId || `${member.userId}-${index}`;

        /*
         * Handed on by the row that gives it: a holder named the moment
         * Assign gave them the role is plain until the roles card has read
         * that row, a moment later.
         */
        if (props.onReassign && member.memberId) {
          return (
            <ReassignablePerson
              key={key}
              member={member}
              roleName={props.roleName}
              onReassign={props.onReassign}
            />
          );
        }

        return (
          <Person
            key={key}
            item={toMemberAvatar(member)}
            dataTestId="event-commander-person"
          />
        );
      })}
      {assignList}
    </div>
  );
};

/*
 * The header's Add owners: the record's owner tables, and what to do once
 * an owner was added from its list.
 */
export interface EventAddOwners {
  // The record's owner tables and the record (useEventOwners' target).
  target: OwnersTarget;
  /*
   * After a pick: the header reads the owners again (useEventOwners'
   * refresh), so it names the new owner at once, and the page reads its
   * feed, which says who added them.
   */
  onOwnersChanged: (change: OwnersChange) => void | Promise<void>;
}

export interface OwnersFactValueProps {
  owners: Array<ResourceOwnerEntry>;
  // The record's Owners page: the rest of a long list, managed in full.
  ownersRoute: Route;
  /*
   * Offered while the record is still open, to a reader who may add an
   * owner: Add opens the Add owners list right under it.
   */
  addOwners?: EventAddOwners | undefined;
}

export const OwnersFactValue: FunctionComponent<OwnersFactValueProps> = (
  props: OwnersFactValueProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const addOwnersText: string =
    translator.translateText(ADD_OWNERS_TEXT) || ADD_OWNERS_TEXT;

  /*
   * One list for both places to add from - the empty place of a record
   * nobody owns, and the line after the owners - only one of which is ever
   * drawn. It follows that line down as owners are added above it.
   */
  const popup: AnchoredFieldPopup = useAddOwnersPopup(props.owners.length);

  const ownerKeys: Set<string> = useMemo((): Set<string> => {
    return getOwnerKeys(props.owners);
  }, [props.owners]);

  const addList: ReactElement = props.addOwners ? (
    <AddOwnersPopup
      popup={popup}
      target={props.addOwners.target}
      ownerKeys={ownerKeys}
      onOwnersChanged={props.addOwners.onOwnersChanged}
      ariaLabel={ADD_OWNERS_TEXT}
    />
  ) : (
    <></>
  );

  /*
   * "Add" under "Owners" reads whole; a screen reader, which may list the
   * button on its own, hears "Add owners".
   */
  const getAddControl: (dataTestId: string) => ReactElement = (
    dataTestId: string,
  ): ReactElement => {
    return (
      <div ref={popup.anchorRef} className="flex max-w-full">
        <button
          type="button"
          data-testid={dataTestId}
          title={addOwnersText}
          {...getAnchoredPopupTriggerProps(popup)}
          className={getEmptyPlaceActionClassName(popup.isPopupOpen)}
        >
          <EmptyPlace isOpen={popup.isPopupOpen} />
          <span aria-hidden="true">{translator.translateText("Add")}</span>
          <span className="sr-only">{addOwnersText}</span>
        </button>
      </div>
    );
  };

  if (props.owners.length === 0) {
    if (!props.addOwners) {
      return (
        <span data-testid="event-owners" className={EMPTY_VALUE_CLASS_NAME}>
          {translator.translateText("None")}
        </span>
      );
    }

    return (
      <>
        <div data-testid="event-owners" className={VALUE_CLASS_NAME}>
          {getAddControl("event-owners-add")}
        </div>
        {addList}
      </>
    );
  }

  const shown: VisibleItems<ResourceOwnerEntry> = splitVisibleItems(
    props.owners,
    MAX_HEADER_OWNERS,
  );

  /*
   * The list is the fragment's second child in both shapes - the empty
   * place alone, and the owners with Add after them - so it stays open,
   * with what it said, as the first owner takes the empty place's line.
   */
  return (
    <>
      <div data-testid="event-owners" className={VALUE_CLASS_NAME}>
        {shown.visible.map((owner: ResourceOwnerEntry, index: number) => {
          const key: string =
            owner.kind === "team"
              ? `team-${owner.team._id?.toString() || index}`
              : `user-${owner.user._id?.toString() || index}`;

          return (
            <Person
              key={key}
              item={toOwnerAvatar(owner)}
              dataTestId="event-owner"
            />
          );
        })}
        {shown.hiddenCount > 0 ? (
          <AppLink to={props.ownersRoute} className={LINK_CLASS_NAME}>
            {translator.translatePlural(
              { one: "+{{count}} more", other: "+{{count}} more" },
              shown.hiddenCount,
            )}
          </AppLink>
        ) : (
          <></>
        )}
        {/*
         * The next owner's place, as the list's last line: the empty place
         * and "Add", the same control as on a record nobody owns yet, so it
         * reads as one to press on a phone too, where nothing shows under a
         * pointer.
         */}
        {props.addOwners ? getAddControl("event-owners-add-more") : <></>}
      </div>
      {addList}
    </>
  );
};

export interface PersonFactValueProps {
  // Who: a name, or an email address for someone without one.
  name: string;
}

/*
 * One person by name, drawn as the other people in the header are: an
 * avatar with their initials, and the name - a maintenance event's
 * "Created by".
 */
export const PersonFactValue: FunctionComponent<PersonFactValueProps> = (
  props: PersonFactValueProps,
): ReactElement => {
  return (
    <span data-testid="event-person" className={VALUE_CLASS_NAME}>
      <Person
        item={{
          kind: PeoplePickerKind.User,
          name: props.name,
          hasProfilePicture: false,
        }}
        dataTestId="event-person-entry"
      />
    </span>
  );
};

export interface CommanderFactInput {
  holding: PrimaryRoleHolding | null;
  onAssign?: ((person: PeoplePickerOption) => Promise<void>) | undefined;
  // Hands the role on from its holder's name (#10195): see CommanderFactValue.
  onReassign?: CommanderReassign | undefined;
}

/*
 * "Incident Commander  Maya Chen", named after the project's primary role -
 * a project that renamed it reads its own name - or nothing at all when the
 * project has no primary role or the roles have not been read yet, so the
 * header never says "Not assigned" about a role it has not looked at.
 */
export const getCommanderFact: (
  input: CommanderFactInput,
) => EventStatusFact | null = (
  input: CommanderFactInput,
): EventStatusFact | null => {
  if (!input.holding) {
    return null;
  }

  return {
    label: input.holding.role.name || "Incident Commander",
    // The project's own name for the role, read the way it was typed.
    isLabelTyped: true,
    icon: input.holding.role.icon || IconProp.ShieldCheck,
    // Its holder's name hands the role on: a pencil after the label then.
    isEditableInPlace: Boolean(
      input.onReassign &&
        input.holding.members.some((member: EventRoleMember): boolean => {
          return Boolean(member.memberId);
        }),
    ),
    value: (
      <CommanderFactValue
        members={input.holding.members}
        roleName={input.holding.role.name || "Incident Commander"}
        onAssign={input.onAssign}
        onReassign={input.onReassign}
      />
    ),
  };
};

export interface OwnersFactInput {
  // Undefined until read for the record on screen, or when they cannot be.
  owners: Array<ResourceOwnerEntry> | undefined;
  ownersRoute: Route;
  // Offered while the record is open, to a reader who may add an owner.
  addOwners?: EventAddOwners | undefined;
}

// "Owners  Checkout SRE, Maya Chen", or nothing until the owners are read.
export const getOwnersFact: (
  input: OwnersFactInput,
) => EventStatusFact | null = (
  input: OwnersFactInput,
): EventStatusFact | null => {
  if (!input.owners) {
    return null;
  }

  return {
    label: "Owners",
    icon: IconProp.Team,
    value: (
      <OwnersFactValue
        owners={input.owners}
        ownersRoute={input.ownersRoute}
        addOwners={input.addOwners}
      />
    ),
  };
};
