import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PeopleAvatar, {
  PeopleAvatarItem,
} from "Common/UI/Components/PeoplePicker/PeopleAvatar";
import { PeoplePickerKind } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
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
 * The people row of an incident's, alert's or episode's header: who commands
 * the response and who owns it, beside its state and severity, so nobody has
 * to open the roles card or the Owners page to find out (the customer's
 * "Easy to see Incident Commander and Team(s)").
 *
 * Both are drawn as an avatar and a name, the way the Owners page and the
 * owners column draw people and teams (PeopleAvatar). The avatar is 24px but
 * takes a text line's 20px in the row (-my-0.5), so a fact with people is as
 * tall as one with words and the row never jumps when they arrive.
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

const LINK_CLASS_NAME: string =
  "rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

// A quiet "Not assigned" / "None": a fact with nothing to name.
const EMPTY_VALUE_CLASS_NAME: string = "font-normal text-gray-500";

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
      <span data-testid="event-person-name" className="min-w-0 truncate">
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
   * Offered while the record is still open: takes the reader to the roles
   * card, where the role is given. A record that is over says only that
   * nobody held it.
   */
  onAssign?: (() => void) | undefined;
}

export const CommanderFactValue: FunctionComponent<CommanderFactValueProps> = (
  props: CommanderFactValueProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.members.length === 0) {
    return (
      <span
        data-testid="event-commander"
        className="inline-flex flex-wrap items-center gap-x-2"
      >
        <span className={EMPTY_VALUE_CLASS_NAME}>
          {translator.translateText("Not assigned")}
        </span>
        {props.onAssign ? (
          <button
            type="button"
            data-testid="event-commander-assign"
            onClick={props.onAssign}
            aria-label={translator.translateTemplate("Assign {{role}}", {
              role: props.roleName,
            })}
            className={LINK_CLASS_NAME}
          >
            {translator.translateText("Assign")}
          </button>
        ) : (
          <></>
        )}
      </span>
    );
  }

  return (
    <span
      data-testid="event-commander"
      className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1"
    >
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
  // Offered while the record is still open, when it has no owners.
  canAddOwners?: boolean | undefined;
}

export const OwnersFactValue: FunctionComponent<OwnersFactValueProps> = (
  props: OwnersFactValueProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.owners.length === 0) {
    return (
      <span
        data-testid="event-owners"
        className="inline-flex flex-wrap items-center gap-x-2"
      >
        <span className={EMPTY_VALUE_CLASS_NAME}>
          {translator.translateText("None")}
        </span>
        {props.canAddOwners ? (
          <AppLink to={props.ownersRoute} className={LINK_CLASS_NAME}>
            {/*
             * "Add" beside "Owners: None" reads whole; a screen reader,
             * which may list the link on its own, hears "Add owners".
             */}
            <span data-testid="event-owners-add">
              <span aria-hidden="true">{translator.translateText("Add")}</span>
              <span className="sr-only">
                {translator.translateText("Add owners")}
              </span>
            </span>
          </AppLink>
        ) : (
          <></>
        )}
      </span>
    );
  }

  const shown: VisibleItems<ResourceOwnerEntry> = splitVisibleItems(
    props.owners,
    MAX_HEADER_OWNERS,
  );

  return (
    <span
      data-testid="event-owners"
      className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1"
    >
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
