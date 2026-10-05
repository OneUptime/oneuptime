import {
  AI_ACCESS_PROTECTIONS_TITLE,
  AiAccessBadge,
  AiAccessBadgeTone,
} from "./AiAccessModes";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { ReactElement, ReactNode } from "react";

/*
 * The building blocks of "What AI may do", shared by a Kubernetes
 * cluster's AI agent page and every other resource's: one row per thing AI
 * may do (an icon, a title, a badge that says where it stands, and one
 * plain sentence), the next-step hint under a row, the allowlist in
 * effect, and the every-mode protections, folded away until asked for.
 */

const BADGE_CLASSES: Readonly<Record<AiAccessBadgeTone, string>> = {
  off: "bg-gray-50 text-gray-600 ring-gray-500/20",
  on: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  automatic: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  bypass: "bg-amber-50 text-amber-800 ring-amber-600/30",
  danger: "bg-red-50 text-red-700 ring-red-600/20",
};

const BADGE_DOT_CLASSES: Readonly<Record<AiAccessBadgeTone, string>> = {
  off: "bg-gray-400",
  on: "bg-emerald-500",
  automatic: "bg-indigo-500",
  bypass: "bg-amber-500",
  danger: "bg-red-500",
};

const ROW_ICON_CLASSES: Readonly<Record<AiAccessBadgeTone, string>> = {
  off: "bg-gray-100 text-gray-500",
  on: "bg-emerald-50 text-emerald-600",
  automatic: "bg-indigo-50 text-indigo-600",
  bypass: "bg-amber-50 text-amber-600",
  danger: "bg-red-50 text-red-600",
};

export function AiAccessBadgeElement(props: {
  badge: AiAccessBadge;
  dataTestId: string;
}): ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        BADGE_CLASSES[props.badge.tone]
      }`}
      data-testid={props.dataTestId}
      data-tone={props.badge.tone}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${BADGE_DOT_CLASSES[props.badge.tone]}`}
        aria-hidden="true"
      />
      {props.badge.text}
    </span>
  );
}

export interface AiAccessRowProps {
  icon: IconProp;
  title: string;
  badge: AiAccessBadge;
  sentence: string;
  /*
   * The row's test id. The badge is `<id>-badge` and the sentence
   * `<id>-value`.
   */
  dataTestId: string;
  children?: ReactNode;
}

export function AiAccessRow(props: AiAccessRowProps): ReactElement {
  // Children left out with `cond ? <X /> : null` are not children.
  const hasChildren: boolean =
    React.Children.toArray(props.children).length > 0;

  return (
    <div
      className="flex gap-4 py-5 first:pt-0 last:pb-0"
      data-testid={props.dataTestId}
    >
      <div
        className={`flex h-10 w-10 flex-none items-center justify-center rounded-lg ${
          ROW_ICON_CLASSES[props.badge.tone]
        }`}
        aria-hidden="true"
      >
        <Icon icon={props.icon} className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="text-sm font-semibold text-gray-900">{props.title}</h3>
          <AiAccessBadgeElement
            badge={props.badge}
            dataTestId={`${props.dataTestId}-badge`}
          />
        </div>
        <p
          className="mt-1 text-sm leading-6 text-gray-600"
          data-testid={`${props.dataTestId}-value`}
        >
          {props.sentence}
        </p>
        {hasChildren ? (
          <div className="mt-3 space-y-3">{props.children}</div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
}

// The rows, divided by a hairline.
export function AiAccessRows(props: { children: ReactNode }): ReactElement {
  return (
    <div className="divide-y divide-gray-100" data-testid="ai-access-rows">
      {props.children}
    </div>
  );
}

/*
 * A row's next step, in a quieter voice than the row's sentence. A div,
 * not a p: Icon renders its svg inside a div.
 */
export function AiAccessHint(props: {
  text: string;
  dataTestId: string;
}): ReactElement {
  return (
    <div
      className="flex items-start gap-1.5 text-sm leading-6 text-gray-500"
      data-testid={props.dataTestId}
    >
      <Icon
        icon={IconProp.LightBulb}
        className="mt-1 h-4 w-4 flex-none text-gray-400"
      />
      <span>{props.text}</span>
    </div>
  );
}

export const AI_ACCESS_ALLOWLIST_EMPTY_TEXT: string =
  "None — riskier fixes always wait for approval.";

export const AI_ACCESS_ALLOWLIST_INTRO_TEXT: string =
  "A riskier fix that matches one of these also runs on its own:";

/*
 * The allowlist the command policy actually uses. Only Automatic mode
 * reads it (Bypass approval runs every allowed change anyway), so the
 * pages show it in Automatic mode only.
 */
export function AiAccessAllowlist(props: {
  title: string;
  patterns: ReadonlyArray<string>;
  dataTestId: string;
}): ReactElement {
  return (
    <div data-testid={props.dataTestId}>
      <p className="text-xs font-medium text-gray-700">{props.title}</p>
      {props.patterns.length > 0 ? (
        <>
          <p className="mt-0.5 text-xs leading-5 text-gray-500">
            {AI_ACCESS_ALLOWLIST_INTRO_TEXT}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {props.patterns.map(
              (pattern: string, index: number): ReactElement => {
                return (
                  <li
                    key={`${index}:${pattern}`}
                    className="break-all rounded-md bg-gray-100 px-2 py-1 font-mono text-xs text-gray-800 ring-1 ring-inset ring-gray-200"
                  >
                    {pattern}
                  </li>
                );
              },
            )}
          </ul>
        </>
      ) : (
        <p className="mt-0.5 text-xs leading-5 text-gray-500">
          {AI_ACCESS_ALLOWLIST_EMPTY_TEXT}
        </p>
      )}
    </div>
  );
}

/*
 * What holds whatever mode is chosen, Bypass approval included. Folded by
 * default: it answers "what could go wrong?", which not everyone asks
 * before choosing a mode.
 */
export function AiAccessProtections(props: {
  protections: ReadonlyArray<string>;
}): ReactElement {
  return (
    <details
      className="group rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
      data-testid="ai-access-protections"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-gray-700 [&::-webkit-details-marker]:hidden">
        <Icon
          icon={IconProp.ShieldCheck}
          className="h-4 w-4 flex-none text-gray-500"
        />
        <span>{AI_ACCESS_PROTECTIONS_TITLE}</span>
        {/* Icon wraps its svg in a div: the wrapper takes the margin. */}
        <span className="ml-auto flex-none">
          <Icon
            icon={IconProp.ChevronDown}
            className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180"
          />
        </span>
      </summary>
      <ul
        className="mt-3 list-disc space-y-1.5 pl-5 text-xs leading-5 text-gray-600"
        data-testid="ai-access-protections-list"
      >
        {props.protections.map((protection: string): ReactElement => {
          return <li key={protection}>{protection}</li>;
        })}
      </ul>
    </details>
  );
}

/*
 * The Change modal's note for an editor who may tighten but not loosen:
 * what they can change first, then what needs more.
 */
export function AiAccessPermissionNote(props: {
  canText: string;
  cannotText: string;
  dataTestId: string;
}): ReactElement {
  return (
    <div
      className="flex gap-3 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5"
      data-testid={props.dataTestId}
    >
      <Icon
        icon={IconProp.InformationCircle}
        className="h-5 w-5 flex-none text-blue-500"
      />
      <div className="text-xs leading-5">
        <p className="text-gray-800">{props.canText}</p>
        <p className="text-gray-600">{props.cannotText}</p>
      </div>
    </div>
  );
}

/*
 * A step the user must take before a setting can work (the agent is
 * read-only while fixes are on): amber, so it reads as "to do", not as
 * fine print.
 */
export function AiAccessActionPanel(props: {
  title: string;
  dataTestId: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3"
      data-testid={props.dataTestId}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
        <Icon
          icon={IconProp.Alert}
          className="h-4 w-4 flex-none text-amber-600"
        />
        <span>{props.title}</span>
      </div>
      {props.children}
    </div>
  );
}
