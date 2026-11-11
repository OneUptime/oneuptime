import DataObservabilityApi from "./DataObservabilityApi";
import {
  LineageDiagramBody,
  LineageRead,
  useLineageRead,
} from "./LineageDiagram";
import { LineageHighlightSwatch, getLineageCardRoute } from "./LineageGraph";
import { LineagePlace, isLineageEmpty } from "./LineageGraphModel";
import Route from "Common/Types/API/Route";
import {
  DataAlertLineageAnswer,
  DataTableLineage,
  DataTableLineageNode,
} from "Common/Types/DataObservability/DataTableLineage";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Navigation from "Common/UI/Utils/Navigation";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export interface ComponentProps {
  alertId: ObjectID;
}

const READ_FAILED: string = translationKey(
  "Could not read this alert's lineage.",
);

const CAUSE_DRAWN: string = translationKey(
  "The way up to the alert that caused this one is highlighted.",
);
const CAUSE_NOT_DRAWN: string = translationKey(
  "The alert that caused this one is not on this diagram: it is about a whole database, or further up than the diagram reaches.",
);
const CONSEQUENCES_DRAWN: PluralTemplate = {
  one: "The way down to the alert this one caused is highlighted.",
  other:
    "The ways down to the {{count}} alerts this one caused are highlighted.",
};
const CONSEQUENCES_SOME_DRAWN: PluralTemplate = {
  one: "The ways down to {{drawn}} of the {{count}} alerts this one caused are highlighted. The rest are further down than the diagram reaches.",
  other:
    "The ways down to {{drawn}} of the {{count}} alerts this one caused are highlighted. The rest are further down than the diagram reaches.",
};
const CONSEQUENCES_NOT_DRAWN: PluralTemplate = {
  one: "The alert this one caused is further down than the diagram reaches.",
  other:
    "The {{count}} alerts this one caused are further down than the diagram reaches.",
};

export interface AlertLineageNote {
  text: string;
  // It says a way is highlighted: the highlight's own mark starts it.
  isHighlighted: boolean;
}

// What the drawing picks out, in words: the way to the cause, and to the alerts it caused.
export function getAlertLineageNotes(
  translator: Translator,
  answer: DataAlertLineageAnswer,
): Array<AlertLineageNote> {
  const notes: Array<AlertLineageNote> = [];

  if (answer.hasCause) {
    const sentence: string = answer.isCauseDrawn
      ? CAUSE_DRAWN
      : CAUSE_NOT_DRAWN;

    notes.push({
      text: translator.translateText(sentence) || sentence,
      isHighlighted: answer.isCauseDrawn,
    });
  }

  const count: number = answer.consequenceCount;
  const drawn: number = Math.min(count, answer.drawnConsequenceCount);

  if (count > 0) {
    if (drawn === count) {
      notes.push({
        text: translator.translatePlural(CONSEQUENCES_DRAWN, count, {
          count: translator.formatNumber(count),
        }),
        isHighlighted: true,
      });
    } else if (drawn > 0) {
      notes.push({
        text: translator.translatePlural(CONSEQUENCES_SOME_DRAWN, count, {
          count: translator.formatNumber(count),
          drawn: translator.formatNumber(drawn),
        }),
        isHighlighted: true,
      });
    } else {
      notes.push({
        text: translator.translatePlural(CONSEQUENCES_NOT_DRAWN, count, {
          count: translator.formatNumber(count),
        }),
        isHighlighted: false,
      });
    }
  }

  return notes;
}

// The same, as the sentences alone.
export function getAlertLineageSentences(
  translator: Translator,
  answer: DataAlertLineageAnswer,
): Array<string> {
  return getAlertLineageNotes(translator, answer).map(
    (note: AlertLineageNote): string => {
      return note.text;
    },
  );
}

/*
 * One sentence under the card's header. A sentence saying a way is
 * highlighted starts with the highlight's own mark, which is what tells the
 * reader the indigo line is that way; the others keep the mark's room when
 * one does, so the sentences line up.
 */
const AlertLineageNoteLine: FunctionComponent<{
  note: AlertLineageNote;
  hasMarkRoom: boolean;
}> = (props: {
  note: AlertLineageNote;
  hasMarkRoom: boolean;
}): ReactElement => {
  let mark: ReactElement = <></>;

  if (props.note.isHighlighted) {
    mark = (
      <span
        className="flex h-5 w-7 shrink-0 items-center"
        data-testid="lineage-highlight-mark"
      >
        <LineageHighlightSwatch />
      </span>
    );
  } else if (props.hasMarkRoom) {
    mark = <span aria-hidden="true" className="w-7 shrink-0" />;
  }

  return (
    <p className="flex items-start gap-2">
      {mark}
      <span>{props.note.text}</span>
    </p>
  );
};

/*
 * A data alert's lineage, on its page under its Data card: the lineage
 * around its table - as the table's Lineage tab draws it - or around its
 * pipeline, with the way up to the alert that caused it and down to each
 * alert it caused highlighted, so the person paged sees where in the chain
 * the problem started. The drawing opens on the cause (LineageGraph), and
 * the sentences above it say which ways are highlighted, each after the
 * highlight's own mark - the diagram's legend leaves that to them. Nothing
 * when there is nothing to draw: an alert about a whole database, or a
 * table no lineage has been seen for.
 *
 * An alert from a check on one column - a null rate on
 * orders.customer_id - comes with the columns each arrow carries and the
 * column its check reads (DataAlertLineageAnswer.column): the drawing opens
 * with that column followed beside the alert's ways, first in the column
 * picker, as the table's Lineage tab follows it, and another can be picked
 * or none. An alert from a check on the whole table draws as before.
 */
const AlertLineageDiagram: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const read: LineageRead<DataAlertLineageAnswer> =
    useLineageRead<DataAlertLineageAnswer>(
      props.alertId.toString(),
      (): Promise<DataAlertLineageAnswer> => {
        return DataObservabilityApi.getAlertLineage(props.alertId);
      },
      READ_FAILED,
    );
  const lineage: DataTableLineage | null = read.answer?.lineage || null;
  // An answer from before the check's column was sent names none.
  const column: string | null = read.answer?.column || null;
  // The check's column first in the picker, the rest by name: this page has no table's own order to go by.
  const columnOrder: Array<string> = useMemo((): Array<string> => {
    return column ? [column] : [];
  }, [column]);

  if (!read.isLoading && !read.error && (!lineage || isLineageEmpty(lineage))) {
    return <></>;
  }

  // Where the lineage can be walked a step at a time: the table's Lineage tab, or the pipeline's page.
  const focus: DataTableLineageNode | undefined = lineage?.nodes.find(
    (node: DataTableLineageNode): boolean => {
      return node.id === lineage.focusNodeId;
    },
  );
  const exploreRoute: Route | null = focus
    ? getLineageCardRoute(focus, false)
    : null;
  const buttons: Array<CardButtonSchema> = exploreRoute
    ? [
        {
          title: "Explore Lineage",
          buttonStyle: ButtonStyleType.OUTLINE,
          icon: IconProp.FlowDiagram,
          onClick: (): void => {
            Navigation.navigate(exploreRoute);
          },
        },
      ]
    : [];

  let body: ReactElement;

  if (read.isLoading) {
    body = <ComponentLoader />;
  } else if (read.error || !read.answer || !lineage) {
    body = (
      <ErrorMessage message={read.error || ""} onRefreshClick={read.retry} />
    );
  } else {
    const notes: Array<AlertLineageNote> = getAlertLineageNotes(
      translator,
      read.answer,
    );
    const hasMarkRoom: boolean = notes.some(
      (note: AlertLineageNote): boolean => {
        return note.isHighlighted;
      },
    );

    body = (
      <div className="space-y-3">
        {notes.length > 0 ? (
          <div
            className="space-y-1 text-sm text-gray-700"
            data-testid="lineage-highlight-notes"
          >
            {notes.map((note: AlertLineageNote): ReactElement => {
              return (
                <AlertLineageNoteLine
                  key={note.text}
                  note={note}
                  hasMarkRoom={hasMarkRoom}
                />
              );
            })}
          </div>
        ) : (
          <></>
        )}
        <LineageDiagramBody
          lineage={lineage}
          place={LineagePlace.Alert}
          withColumns={Boolean(column)}
          columnOrder={columnOrder}
          initialColumn={column}
        />
      </div>
    );
  }

  return (
    <Card
      title="Lineage"
      description="Where this alert's data comes from and where it goes, with how each table and pipeline is now."
      buttons={buttons}
    >
      <div className="px-6 pb-6" data-testid="alert-lineage-diagram">
        {body}
      </div>
    </Card>
  );
};

export default AlertLineageDiagram;
