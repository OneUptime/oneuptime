import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import { MemberRoleAssignRequest } from "Common/UI/Components/MemberRoleAssignment/MemberRoleAssignment";
import PeopleAvatar, {
  PeopleAvatarItem,
} from "Common/UI/Components/PeoplePicker/PeopleAvatar";
import { PeoplePickerKind } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import AppLink from "../AppLink/AppLink";
import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";
import { EventStatusFact } from "./EventStatusPanel";
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
 * on a line of its own, to add more - offered only to a reader who may add
 * an owner. Once the record is over, they say "Not assigned" and "None", and
 * offer nothing.
 */

/*
 * The roles card's wrapper, which the header's Assign scrolls to and focuses:
 * the card is where a role is given.
 */
export const EVENT_ROLES_CARD_ID: string = "event-roles-card";

export const scrollToEventRolesCard: () => void = (): void => {
  const rolesCard: HTMLElement | null =
    document.getElementById(EVENT_ROLES_CARD_ID);

  if (!rolesCard) {
    return;
  }

  const prefersReducedMotion: boolean =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  rolesCard.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start",
  });
  rolesCard.focus({ preventScroll: true });
};

export interface RoleAssignRequestState {
  // What the roles card is asked to open (MemberRoleAssignment).
  request: MemberRoleAssignRequest | undefined;
  /*
   * The header's Assign: takes the reader to the roles card and opens the
   * role's picker there, with the cursor in it - from the header to choosing
   * the person in one step.
   */
  requestAssign: (roleId: string) => void;
}

export const useRoleAssignRequest: () => RoleAssignRequestState =
  (): RoleAssignRequestState => {
    const [request, setRequest] = useState<MemberRoleAssignRequest | undefined>(
      undefined,
    );

    const requestAssign: (roleId: string) => void = useCallback(
      (roleId: string): void => {
        setRequest(
          (
            current: MemberRoleAssignRequest | undefined,
          ): MemberRoleAssignRequest => {
            return {
              roleId: roleId,
              requestId: (current?.requestId || 0) + 1,
            };
          },
        );
        scrollToEventRolesCard();
      },
      [],
    );

    return { request, requestAssign };
  };

const LINK_CLASS_NAME: string =
  "rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

/*
 * Assign / Add: the empty place and its word as one control, laid out like
 * a person (avatar, gap, name), its circle lined up with the avatars of the
 * facts beside it. The whole control lights up on hover, so it reads as
 * something to press rather than a word that happens to be blue.
 */
export const EVENT_EMPTY_PLACE_ACTION_CLASS_NAME: string =
  "group -my-0.5 -ms-1 inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pe-2.5 ps-1 font-medium text-gray-700 transition-colors hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

// A quiet "Not assigned" / "None": a fact with nothing to name.
const EMPTY_VALUE_CLASS_NAME: string = "font-normal text-gray-500";

/*
 * The value's box: one person a line, as the header lists monitors and
 * status pages, their avatars 4px apart from line to line - so a list reads
 * the same at every width, never two names side by side on one line and a
 * third under them, and the place to add another owner is the list's last
 * line, never a circle left alone after a wrap.
 */
const VALUE_CLASS_NAME: string = "flex max-w-full flex-col items-start gap-2";

/*
 * Where the avatar would be: a dashed circle with a plus. Decoration - the
 * word beside it, or the control's name, says what it does.
 */
const EmptyPlace: FunctionComponent = (): ReactElement => {
  return (
    <span
      aria-hidden="true"
      data-testid="event-empty-place"
      className="-my-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400 transition-colors group-hover:border-indigo-500 group-hover:text-indigo-500"
    >
      <Icon icon={IconProp.Add} className="h-3.5 w-3.5" />
    </span>
  );
};

interface PersonProps {
  item: PeopleAvatarItem;
  dataTestId: string;
}

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
       * letters and an ellipsis.
       */}
      <span data-testid="event-person-name" className="min-w-0 break-words">
        {props.item.name}
      </span>
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

export interface CommanderFactValueProps {
  members: Array<EventRoleMember>;
  // The role's name, for what Assign says to a screen reader.
  roleName: string;
  /*
   * Offered while the record is still open: opens the role's picker in the
   * roles card (useRoleAssignRequest). A record that is over says only that
   * nobody held it.
   */
  onAssign?: (() => void) | undefined;
}

export const CommanderFactValue: FunctionComponent<CommanderFactValueProps> = (
  props: CommanderFactValueProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.members.length === 0) {
    if (!props.onAssign) {
      return (
        <span data-testid="event-commander" className={EMPTY_VALUE_CLASS_NAME}>
          {translator.translateText("Not assigned")}
        </span>
      );
    }

    return (
      <span data-testid="event-commander" className={VALUE_CLASS_NAME}>
        <button
          type="button"
          data-testid="event-commander-assign"
          onClick={props.onAssign}
          aria-label={translator.translateTemplate("Assign {{role}}", {
            /*
             * The role's name as the header's label shows it: the panel
             * looks a fact's label up, so the seeded "Incident Commander"
             * reads in the reader's language and a project's own name as
             * written.
             */
            role: translator.translateText(props.roleName) || props.roleName,
          })}
          className={EVENT_EMPTY_PLACE_ACTION_CLASS_NAME}
        >
          <EmptyPlace />
          <span>{translator.translateText("Assign")}</span>
        </button>
      </span>
    );
  }

  return (
    <span data-testid="event-commander" className={VALUE_CLASS_NAME}>
      {props.members.map((member: EventRoleMember, index: number) => {
        return (
          <Person
            key={`${member.userId}-${index}`}
            item={toMemberAvatar(member)}
            dataTestId="event-commander-person"
          />
        );
      })}
    </span>
  );
};

export interface OwnersFactValueProps {
  owners: Array<ResourceOwnerEntry>;
  // The record's Owners page: the rest of a long list, and where owners are added.
  ownersRoute: Route;
  // Offered while the record is still open.
  canAddOwners?: boolean | undefined;
}

export const OwnersFactValue: FunctionComponent<OwnersFactValueProps> = (
  props: OwnersFactValueProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const addOwnersText: string =
    translator.translateText("Add owners") || "Add owners";

  if (props.owners.length === 0) {
    if (!props.canAddOwners) {
      return (
        <span data-testid="event-owners" className={EMPTY_VALUE_CLASS_NAME}>
          {translator.translateText("None")}
        </span>
      );
    }

    return (
      <span data-testid="event-owners" className={VALUE_CLASS_NAME}>
        <AppLink
          to={props.ownersRoute}
          className={EVENT_EMPTY_PLACE_ACTION_CLASS_NAME}
        >
          <EmptyPlace />
          {/*
           * "Add" under "Owners" reads whole; a screen reader, which may
           * list the link on its own, hears "Add owners".
           */}
          <span data-testid="event-owners-add">
            <span aria-hidden="true">{translator.translateText("Add")}</span>
            <span className="sr-only">{addOwnersText}</span>
          </span>
        </AppLink>
      </span>
    );
  }

  const shown: VisibleItems<ResourceOwnerEntry> = splitVisibleItems(
    props.owners,
    MAX_HEADER_OWNERS,
  );

  return (
    <span data-testid="event-owners" className={VALUE_CLASS_NAME}>
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
      {props.canAddOwners ? (
        <AppLink
          to={props.ownersRoute}
          className={EVENT_EMPTY_PLACE_ACTION_CLASS_NAME}
          title={addOwnersText}
          dataTestId="event-owners-add-more"
        >
          <EmptyPlace />
          <span aria-hidden="true">{translator.translateText("Add")}</span>
          <span className="sr-only">{addOwnersText}</span>
        </AppLink>
      ) : (
        <></>
      )}
    </span>
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
  onAssign?: (() => void) | undefined;
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
    icon: input.holding.role.icon || IconProp.ShieldCheck,
    value: (
      <CommanderFactValue
        members={input.holding.members}
        roleName={input.holding.role.name || "Incident Commander"}
        onAssign={input.onAssign}
      />
    ),
  };
};

export interface OwnersFactInput {
  // Undefined until read for the record on screen, or when they cannot be.
  owners: Array<ResourceOwnerEntry> | undefined;
  ownersRoute: Route;
  canAddOwners?: boolean | undefined;
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
        canAddOwners={input.canAddOwners}
      />
    ),
  };
};
