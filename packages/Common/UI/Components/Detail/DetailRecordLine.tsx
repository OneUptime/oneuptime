import Icon from "../Icon/Icon";
import Link from "../Link/Link";
import Tooltip from "../Tooltip/Tooltip";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import Route from "../../../Types/API/Route";
import RecordActorType from "../../../Types/Database/RecordActor";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import DetailIdLine from "./DetailIdLine";
import {
  RecordActivity,
  RecordActivityActor,
  RecordActivityEvent,
} from "./DetailRecordActivity";
import {
  getRecordTimeFullText,
  getRecordTimeText,
  RecordTime,
  RecordTimeKind,
} from "./DetailRecordTime";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The small line a details card ends with: the record's own ID (DetailIdLine)
 * and when the record was created - and last updated, where the card says -
 * in place of the rows they used to take (DetailRecordId.ts and
 * DetailRecordTime.ts say why). And, where the read said (#10290), who
 * created it and who last modified it, and a link to its history:
 *
 *   ID dafafe92…  Created by Nawaz Dhandala · Sep 30 2026, 14:25
 *   Last modified by Terraform (API key) · Nov 19 2026, 09:12  History
 *
 *   - Each piece is one unit: its icon, its words and its value. On a narrow
 *     card a piece that does not fit moves under the others whole, so the
 *     line wraps between pieces, never inside "Created Sep 30".
 *   - A time reads as the row it replaces did, in the reader's time zone;
 *     hovering it gives it to the second, and its dateTime attribute gives
 *     it to a machine.
 *   - Who acted is what acted: a person by their name, an API key or a
 *     workflow by its own name - never a person's - an MCP client for the
 *     member it acted for, OneUptime itself (DetailRecordActivity.ts).
 *   - "Last modified" is the last change a person, a key, a workflow or an
 *     MCP client made. Where it is known it takes the place of "Updated",
 *     which OneUptime's own writes move all day.
 *   - Nothing on it is a field: no label element, no row, no divider of its
 *     own. Detail draws the one divider above it.
 */

export interface ComponentProps {
  recordId?: string | undefined;
  times?: Array<RecordTime> | undefined;
  // Who created the record and who last modified it (DetailRecordActivity).
  activity?: RecordActivity | null | undefined;
  // The record's history, for a reader who may read it.
  historyRoute?: Route | null | undefined;
  className?: string | undefined;
}

export interface RecordTimeProps {
  time: RecordTime;
}

const PIECE_CLASS_NAME: string =
  "inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-500";

// A time on the line, to the minute, with all of it on hover.
const RecordLineTime: FunctionComponent<{
  date: Date;
  testId: string;
}> = (props: { date: Date; testId: string }): ReactElement => {
  return (
    <Tooltip text={getRecordTimeFullText(props.date)}>
      <time
        data-testid={props.testId}
        dateTime={props.date.toISOString()}
        className="min-w-0 text-gray-600"
      >
        {getRecordTimeText(props.date)}
      </time>
    </Tooltip>
  );
};

export const DetailRecordTimeElement: FunctionComponent<RecordTimeProps> = (
  props: RecordTimeProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const kind: RecordTimeKind = props.time.kind;
  const testId: string = `detail-${kind}-at`;

  // Each word written out, so the translation tooling finds it.
  const label: string =
    (kind === RecordTimeKind.Updated
      ? translator.translateText("Updated")
      : translator.translateText("Created")) || "";

  return (
    <div data-testid={testId} className={PIECE_CLASS_NAME}>
      <div className="inline-flex shrink-0 items-center gap-1.5 font-medium">
        <Icon icon={IconProp.Clock} className="h-3.5 w-3.5 text-gray-400" />
        <span data-testid={`${testId}-label`}>{label}</span>
      </div>
      <RecordLineTime date={props.time.date} testId={`${testId}-value`} />
    </div>
  );
};

/*
 * Who acted, in the reader's words: a person's name as it is written, the
 * kind of anything that is not a person beside its own name, and never a
 * person in place of an API key or a workflow.
 */
export const getRecordActorText: (
  actor: RecordActivityActor,
  translator: Translator,
) => string = (actor: RecordActivityActor, translator: Translator): string => {
  const personName: string | undefined = actor.personName;
  const actorName: string | undefined = actor.actorName;

  switch (actor.type) {
    case RecordActorType.User:
      return personName || translator.translateText("Deleted user") || "";
    case RecordActorType.MasterAdmin:
      return personName
        ? translator.translateTemplate("{{name}} (Master Admin)", {
            name: personName,
          })
        : translator.translateText("Master Admin") || "";
    case RecordActorType.McpClient:
      return personName
        ? translator.translateTemplate("{{name}} via an MCP client", {
            name: personName,
          })
        : translator.translateText("An MCP client") || "";
    case RecordActorType.ApiKey:
      return actorName
        ? translator.translateTemplate("{{name}} (API key)", {
            name: actorName,
          })
        : translator.translateText("API key") || "";
    case RecordActorType.Workflow:
      return actorName
        ? translator.translateTemplate("{{name}} (workflow)", {
            name: actorName,
          })
        : translator.translateText("Workflow") || "";
    case RecordActorType.System:
      return translator.translateText("OneUptime") || "OneUptime";
  }

  return "";
};

export interface RecordActivityProps {
  kind: "created" | "last-modified";
  event: RecordActivityEvent;
}

/*
 * "Created by Nawaz Dhandala · Sep 30 2026, 14:25": who, as one sentence of
 * the reader's language with the name in it, then when. Without a who, the
 * words and the time alone.
 */
export const DetailRecordActivityElement: FunctionComponent<
  RecordActivityProps
> = (props: RecordActivityProps): ReactElement => {
  const translator: Translator = useTranslator();
  const testId: string = `detail-${props.kind}-by`;
  const isCreated: boolean = props.kind === "created";
  const actor: RecordActivityActor | null = props.event.by;

  const actorElement: ReactElement | null = actor ? (
    <span
      data-testid={`${testId}-actor`}
      data-actor-type={actor.type}
      className="min-w-0 font-medium text-gray-600"
    >
      {getRecordActorText(actor, translator)}
    </span>
  ) : null;

  let words: ReactElement;

  if (actorElement) {
    words = (
      <span data-testid={`${testId}-label`}>
        <TranslatedSentence
          template={
            isCreated ? "Created by {{actor}}" : "Last modified by {{actor}}"
          }
          slots={{ actor: actorElement }}
        />
      </span>
    );
  } else {
    words = (
      <span data-testid={`${testId}-label`}>
        {isCreated
          ? translator.translateText("Created")
          : translator.translateText("Last modified")}
      </span>
    );
  }

  return (
    <div data-testid={testId} className={PIECE_CLASS_NAME}>
      <div className="inline-flex min-w-0 items-center gap-1.5">
        <Icon
          icon={isCreated ? IconProp.Clock : IconProp.PencilSquare}
          className="h-3.5 w-3.5 shrink-0 text-gray-400"
        />
        {words}
      </div>
      {props.event.at ? (
        <>
          <span aria-hidden="true" className="text-gray-400">
            ·
          </span>
          <RecordLineTime date={props.event.at} testId={`${testId}-at`} />
        </>
      ) : (
        <></>
      )}
    </div>
  );
};

const DetailRecordLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const times: Array<RecordTime> = props.times || [];

  const createdTime: RecordTime | undefined = times.find(
    (time: RecordTime): boolean => {
      return time.kind === RecordTimeKind.Created;
    },
  );
  const updatedTime: RecordTime | undefined = times.find(
    (time: RecordTime): boolean => {
      return time.kind === RecordTimeKind.Updated;
    },
  );

  const created: RecordActivityEvent | null = props.activity?.created || null;
  const lastModified: RecordActivityEvent | null =
    props.activity?.lastModified || null;

  /*
   * When it was created: by whom, when the read says, else as the card
   * declares it, else as the read found it.
   */
  let createdPiece: ReactElement | null = null;

  if (created?.by) {
    createdPiece = (
      <DetailRecordActivityElement
        kind="created"
        event={{ at: created.at || createdTime?.date || null, by: created.by }}
      />
    );
  } else if (createdTime) {
    createdPiece = <DetailRecordTimeElement time={createdTime} />;
  } else if (created?.at) {
    createdPiece = (
      <DetailRecordTimeElement
        time={{ kind: RecordTimeKind.Created, date: created.at }}
      />
    );
  }

  // The last change someone made, in place of the last write of any kind.
  let modifiedPiece: ReactElement | null = null;

  if (lastModified?.at) {
    modifiedPiece = (
      <DetailRecordActivityElement kind="last-modified" event={lastModified} />
    );
  } else if (updatedTime) {
    modifiedPiece = <DetailRecordTimeElement time={updatedTime} />;
  }

  return (
    <div
      data-testid="detail-record-line"
      className={`flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500 ${
        props.className || ""
      }`}
    >
      {props.recordId ? <DetailIdLine recordId={props.recordId} /> : <></>}
      {createdPiece || <></>}
      {modifiedPiece || <></>}
      {props.historyRoute ? (
        <Link
          to={props.historyRoute}
          dataTestId="detail-record-history"
          className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [@media(pointer:coarse)]:min-h-11"
        >
          <Icon icon={IconProp.ListBullet} className="h-3.5 w-3.5" />
          <span>{translator.translateText("History")}</span>
        </Link>
      ) : (
        <></>
      )}
    </div>
  );
};

export default DetailRecordLine;
