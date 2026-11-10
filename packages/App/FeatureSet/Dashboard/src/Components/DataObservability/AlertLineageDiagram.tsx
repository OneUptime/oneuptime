import DataObservabilityApi from "./DataObservabilityApi";
import {
  LineageDiagramBody,
  LineageRead,
  useLineageRead,
} from "./LineageDiagram";
import { getLineageCardRoute } from "./LineageGraph";
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
import React, { FunctionComponent, ReactElement } from "react";

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

// What the drawing picks out, in words: the way to the cause, and to the alerts it caused.
export function getAlertLineageSentences(
  translator: Translator,
  answer: DataAlertLineageAnswer,
): Array<string> {
  const sentences: Array<string> = [];

  if (answer.hasCause) {
    const sentence: string = answer.isCauseDrawn
      ? CAUSE_DRAWN
      : CAUSE_NOT_DRAWN;

    sentences.push(translator.translateText(sentence) || sentence);
  }

  const count: number = answer.consequenceCount;
  const drawn: number = Math.min(count, answer.drawnConsequenceCount);

  if (count > 0) {
    if (drawn === count) {
      sentences.push(
        translator.translatePlural(CONSEQUENCES_DRAWN, count, {
          count: translator.formatNumber(count),
        }),
      );
    } else if (drawn > 0) {
      sentences.push(
        translator.translatePlural(CONSEQUENCES_SOME_DRAWN, count, {
          count: translator.formatNumber(count),
          drawn: translator.formatNumber(drawn),
        }),
      );
    } else {
      sentences.push(
        translator.translatePlural(CONSEQUENCES_NOT_DRAWN, count, {
          count: translator.formatNumber(count),
        }),
      );
    }
  }

  return sentences;
}

/*
 * A data alert's lineage, on its page under its Data card: the lineage
 * around its table - as the table's Lineage tab draws it - or around its
 * pipeline, with the way up to the alert that caused it and down to each
 * alert it caused highlighted, so the person paged sees where in the chain
 * the problem started. Nothing when there is nothing to draw: an alert
 * about a whole database, or a table no lineage has been seen for.
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
    const sentences: Array<string> = getAlertLineageSentences(
      translator,
      read.answer,
    );

    body = (
      <div className="space-y-3">
        {sentences.length > 0 ? (
          <div
            className="space-y-1 text-sm text-gray-700"
            data-testid="lineage-highlight-notes"
          >
            {sentences.map((sentence: string): ReactElement => {
              return <p key={sentence}>{sentence}</p>;
            })}
          </div>
        ) : (
          <></>
        )}
        <LineageDiagramBody lineage={lineage} place={LineagePlace.Alert} />
      </div>
    );
  }

  return (
    <Card
      title="Lineage"
      description="Where this alert's table or pipeline gets its data and where its data goes, with how each table and pipeline is now: the way to the alert that caused it and to the alerts it caused is highlighted."
      buttons={buttons}
    >
      <div className="px-6 pb-6" data-testid="alert-lineage-diagram">
        {body}
      </div>
    </Card>
  );
};

export default AlertLineageDiagram;
