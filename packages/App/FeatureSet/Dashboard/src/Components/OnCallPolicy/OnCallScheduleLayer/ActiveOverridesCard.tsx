import HandOffTimes from "./HandOffTimes";
import { SECTION_LABEL_CLASS_NAME } from "./FinalScheduleSummary";
import { formatHandOffInstant } from "./LayerSummary";
import { getUserAvatarStyle, getUserInitials } from "./LayerUserColors";
import {
  OverrideScopeKind,
  OverrideSummaryRow,
  OverrideUserDisplayInfo,
  getUserDisplayName,
} from "./OverridePresentation";
import { notifyScheduleUserOverridesChanged } from "./ScheduleOverrides";
import { getGlobalUserOverrideLock } from "../UserOverrides/GlobalUserOverrideLock";
import UserOverrideFormModal, {
  UserOverrideEditTarget,
} from "../UserOverrides/UserOverrideFormModal";
import UserOverrideOverlapsMark, {
  getUserOverrideOverlapsText,
} from "../UserOverrides/UserOverrideOverlapsMark";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";

/*
 * The substitutions in force on this schedule, stated in full above the grid
 * they explain.
 *
 * The calendar can only ever show the RESULT of an override — a block in the
 * substitute's colour — and a block cannot say what it would have said without
 * the override. That leaves the reader of a correct calendar unable to tell a
 * substitution from an ordinary rotation, which is the complaint this card
 * answers: it names the person who is away, the person covering - who their
 * alerts now reach - the window, and whether the swap applies everywhere or
 * to one policy. "Away" and "Covering" are the words the Add User Override
 * form asks with ("Who is away?", "Who covers?"). An override that names
 * nobody to cover says the rotation covers: "Next person in the rotation",
 * with the rotation's icon where a person's initials would be.
 *
 * Rows come from OverridePresentation.buildOverrideSummaryRows, so this
 * component holds no wording of its own about the substitutions.
 *
 * Each row has an Edit (issue #7631): the override's own dialog
 * (UserOverrideFormModal), the one its User Overrides page opens - who
 * covers, and the times as far as they may still change. Saved, every
 * schedule on the page reads its overrides again
 * (notifyScheduleUserOverridesChanged). A global override's Edit is locked
 * for a reader whose permission covers only some policies, saying why
 * (GlobalUserOverrideLock). Two overrides saved before overlaps were
 * refused are marked "Overlaps", saying which is used (issue #7630).
 */

export interface ComponentProps {
  rows: Array<OverrideSummaryRow>;
  // Display info for both sides of every row, keyed by user id.
  userById: Dictionary<OverrideUserDisplayInfo>;
  // The zone instants are rendered in; matches the grid below.
  timezone?: string | undefined;
  id?: string | undefined;
}

/*
 * How many rows to list before collapsing the rest into a count. A schedule
 * under heavy hand-off churn can carry dozens of future overrides, and a wall
 * of them above the calendar would push the thing they explain off the screen.
 * In-force overrides sort first (see buildOverrideSummaryRows), so the ones that
 * survive the cut are always the ones that matter now.
 */
export const MAX_SHOWN_OVERRIDE_ROWS: number = 4;

/*
 * The words under each side's name, "Away" and "Covering", in the reading's
 * own case like every label of the Final schedule around this card
 * (SECTION_LABEL_CLASS_NAME): they were letter-spaced capitals.
 */
export const OVERRIDE_PARTY_CAPTION_CLASS_NAME: string =
  "text-[11px] font-medium";

const ActiveOverridesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();

  // The override whose Edit is open, if any.
  const [editing, setEditing] = useState<UserOverrideEditTarget | null>(null);

  if (props.rows.length === 0) {
    return null;
  }

  /*
   * Edit, as a policy's User Overrides page gates it: shown locked, naming
   * the permission, to a reader who may not edit overrides; hidden while
   * the permissions are not known.
   */
  const editGate: PermissionGateResult = PermissionGate.check(
    new OnCallDutyPolicyUserOverride(),
    ModelAction.Update,
  );

  const getEditLock: (row: OverrideSummaryRow) => string | null = (
    row: OverrideSummaryRow,
  ): string | null => {
    if (!editGate.isAllowed) {
      return editGate.disabledReason || null;
    }

    return row.onCallDutyPolicyId
      ? null
      : getGlobalUserOverrideLock(ModelAction.Update);
  };

  const getEditButton: (row: OverrideSummaryRow) => ReactElement = (
    row: OverrideSummaryRow,
  ): ReactElement => {
    if (!row.overrideId || (!editGate.isAllowed && !editGate.disabledReason)) {
      return <></>;
    }

    const lock: string | null = getEditLock(row);

    return (
      <Button
        dataTestId="active-override-edit"
        title="Edit"
        ariaLabel={translator.translateTemplate(
          "Edit the override for {{name}}",
          { name: row.originalName },
        )}
        isAriaLabelTranslated={true}
        buttonStyle={ButtonStyleType.LINK}
        buttonSize={ButtonSize.ExtraSmall}
        className="ml-auto"
        disabled={Boolean(lock)}
        tooltip={lock || undefined}
        onClick={() => {
          setEditing({
            id: row.overrideId,
            onCallDutyPolicyId: row.onCallDutyPolicyId || null,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
          });
        }}
      />
    );
  };

  // "Overlaps", on an override saved before overlaps were refused.
  const getOverlapsMark: (row: OverrideSummaryRow) => ReactElement = (
    row: OverrideSummaryRow,
  ): ReactElement => {
    if (!row.overlapNote) {
      return <></>;
    }

    const otherCoverId: string =
      row.overlapNote.other.routeAlertsToUserId || "";

    return (
      <UserOverrideOverlapsMark
        text={getUserOverrideOverlapsText({
          translator: translator,
          note: row.overlapNote,
          awayName: row.originalName,
          otherCoverName: otherCoverId
            ? getUserDisplayName(props.userById[otherCoverId])
            : "",
          // As each row writes its own times (HandOffTimes).
          from: formatHandOffInstant(
            new Date(row.overlapNote.other.startsAt),
            props.timezone,
            OneUptimeDate.getCurrentDate(),
          ),
          until: formatHandOffInstant(
            new Date(row.overlapNote.other.endsAt),
            props.timezone,
            OneUptimeDate.getCurrentDate(),
          ),
        })}
      />
    );
  };

  const shownRows: Array<OverrideSummaryRow> = props.rows.slice(
    0,
    MAX_SHOWN_OVERRIDE_ROWS,
  );
  const hiddenCount: number = props.rows.length - shownRows.length;

  const getAvatar: (userId: string) => ReactElement = (
    userId: string,
  ): ReactElement => {
    // Nobody named: the rotation covers.
    if (!userId) {
      return (
        <span
          data-testid="active-override-rotation-avatar"
          className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 ring-1 ring-inset ring-gray-200"
        >
          <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
        </span>
      );
    }

    const info: OverrideUserDisplayInfo | undefined = props.userById[userId];
    return (
      <span
        className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
        style={getUserAvatarStyle(userId)}
      >
        {getUserInitials(info?.name || "", info?.email || "")}
      </span>
    );
  };

  /*
   * One side of the swap. The caption under the name is what makes the row
   * self-explanatory: "Alice -> Bob" alone still needs the reader to know which
   * direction an override runs, and getting that backwards means calling the
   * wrong person at 3am.
   */
  const getParty: (data: {
    userId: string;
    name: string;
    caption: string;
    captionClassName: string;
  }) => ReactElement = (data: {
    userId: string;
    name: string;
    caption: string;
    captionClassName: string;
  }): ReactElement => {
    return (
      <div className="flex min-w-0 items-center gap-2">
        {getAvatar(data.userId)}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900">
            {data.name}
          </div>
          <div
            className={`${OVERRIDE_PARTY_CAPTION_CLASS_NAME} ${data.captionClassName}`}
          >
            {translator.translateText(data.caption)}
          </div>
        </div>
      </div>
    );
  };

  const getRow: (row: OverrideSummaryRow) => ReactElement = (
    row: OverrideSummaryRow,
  ): ReactElement => {
    return (
      <li
        key={row.key}
        data-testid="active-override-row"
        className="rounded-lg border border-gray-200 bg-white px-3 py-2.5"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {getParty({
            userId: row.originalUserId,
            name: row.originalName,
            caption: "Away",
            captionClassName: "text-gray-500",
          })}

          <Icon
            icon={IconProp.ArrowRight}
            className="h-4 w-4 flex-shrink-0 text-indigo-500"
            ariaLabel={translator.translateText("alerts routed to")}
          />

          {getParty({
            userId: row.substituteUserId,
            name: row.substituteName,
            caption: "Covering",
            captionClassName: "text-indigo-600",
          })}

          {row.isActiveNow && (
            <span className="ml-auto inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-500" />
              </span>
              {translator.translateText("In force now")}
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
          <HandOffTimes
            start={row.startsAt}
            end={row.endsAt}
            timezone={props.timezone}
          />
          <span className="text-gray-300">
            <InlineSeparator markOnly />
          </span>
          {/*
           * The scope pill is the answer to "will this cover the page I care
           * about". A global override is the wide, reassuring case and is drawn
           * neutrally; a policy-scoped one is the narrow, surprising case and is
           * drawn in amber, because a reader who assumes it is global will be
           * paged by every OTHER policy that escalates here.
           */}
          <span
            data-testid="override-scope-pill"
            title={row.scope.detail}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
              row.scope.kind === OverrideScopeKind.Global
                ? "bg-gray-50 text-gray-600 ring-gray-200"
                : "bg-amber-50 text-amber-800 ring-amber-200"
            }`}
          >
            <Icon
              icon={
                row.scope.kind === OverrideScopeKind.Global
                  ? IconProp.Globe
                  : IconProp.Alert
              }
              className="h-3 w-3"
            />
            {row.scope.label}
          </span>
          {getOverlapsMark(row)}
          {getEditButton(row)}
        </div>
      </li>
    );
  };

  return (
    <div
      id={props.id}
      data-testid="active-overrides-card"
      className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4"
    >
      <div className={`${SECTION_LABEL_CLASS_NAME} text-indigo-700`}>
        <Icon icon={IconProp.ArrowUturnRight} className="h-3.5 w-3.5" />
        {translator.translatePlural(
          {
            one: "{{count}} user override on this schedule",
            other: "{{count}} user overrides on this schedule",
          },
          props.rows.length,
        )}
      </div>
      {/*
       * Deliberately not "during these windows the calendar shows the
       * substitute": an override only takes effect where its window actually
       * overlaps a shift of the person it overrides, and one booked over a day
       * they were not rostered anyway changes nothing. It is still listed -
       * somebody configured it and would go looking for it - so the wording has
       * to describe what an override DOES without promising every row below
       * changed the grid.
       */}
      <p className="mt-1 text-xs text-gray-600">
        {translator.translateText(
          "An override sends the pages of someone who is away to the person who covers for them. With nobody named, each of their turns goes to the next person in the rotation instead. The calendar below shows who has each shift.",
        )}
      </p>

      <ul className="mt-3 space-y-2">{shownRows.map(getRow)}</ul>

      {hiddenCount > 0 && (
        <div className="mt-2 text-xs text-gray-500">
          {translator.translatePlural(
            {
              one: "+ {{count}} more override scheduled later in this window.",
              other:
                "+ {{count}} more overrides scheduled later in this window.",
            },
            hiddenCount,
          )}
        </div>
      )}

      {editing ? (
        <UserOverrideFormModal
          key={editing.id}
          overrideToEdit={editing}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            notifyScheduleUserOverridesChanged();
          }}
          onEditOverride={(target: UserOverrideEditTarget) => {
            setEditing(target);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default ActiveOverridesCard;
