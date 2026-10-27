import AppLink from "../AppLink/AppLink";
import RankedBars, {
  RANKED_BAR_LABEL_HOVER_CLASS_NAME,
  RankedBarItem,
} from "./RankedBars";
import {
  ENTITY_RISK_EMPTY_TITLE,
  RISKIEST_ENTITIES_OPEN_ENTITY_RISK,
  RISKIEST_ENTITIES_READ_FAILED,
  RISKIEST_ENTITIES_TEST_IDS,
  RISKIEST_ENTITIES_VIEW_ALL,
} from "../SecurityEvents/EntityRisk/EntityRiskCopy";
import { EntityRiskLevelPill } from "../SecurityEvents/EntityRisk/EntityRiskScore";
import { getEntityRiskRoute } from "../SecurityEvents/EntityRisk/EntityRiskModel";
import {
  RiskiestEntityRow,
  getMoreRiskyEntityCount,
  getRiskiestEntityRows,
} from "../SecurityEvents/EntityRisk/RiskiestEntitiesModel";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityRiskiestEntities } from "Common/Types/SecurityCase/SecurityEntityRisk";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CARD_GRID_CENTERED_STATE_CLASS_NAME } from "Common/UI/Components/Card/CardGridLayout";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * An entity's value, in the monospace every Security Events value is drawn
 * in, cut short at its own end: the isolate carries the value's direction,
 * so a right-to-left page cuts an address or an account where it ends, not
 * where it starts. It is as wide as the value and no wider than its line,
 * so it starts where the line does on either page - a block as wide as its
 * kind under it set a short "web-03" off the start of a Persian line,
 * aligned to its own left. Its own box, so it is underlined with the row
 * it is in (the link's underline does not reach into an inline-block).
 */
export const RISKIEST_ENTITY_VALUE_CLASS_NAME: string = `inline-block max-w-full truncate align-top font-mono ${RANKED_BAR_LABEL_HOVER_CLASS_NAME}`;

// The way on to Entity Risk, under the list.
export const RISKIEST_ENTITIES_LINK_CLASS_NAME: string =
  "rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export interface ComponentProps {
  // Null when the overview could not read them.
  riskiest: SecurityRiskiestEntities | null;
  // A read is in flight: Try again spins.
  isReading: boolean;
  onTryAgain: () => void;
}

/*
 * The Overview's Riskiest Entities: the top of Entity Risk's list, by the
 * same scores, so the Overview and Entity Risk never name two different
 * riskiest entities. Each row reads as Entity Risk draws the entity: its
 * value with its kind under it, its score with the level it reads as
 * beside it (the level's pill, as Entity Risk's Risk column has it - never
 * beside the kind, where Entity Risk puts how much an entity matters), and
 * a bar filled as Entity Risk's meter is (the mark halfway along is where
 * a case opens), in its level's colour. The whole row opens the entity's
 * own page - why it is risky, its cases, its activity. Under the list, the
 * way on to Entity Risk: all of them when it lists more than the card
 * shows, its page when the card shows them all.
 *
 * Risk that could not be read is said to be, with Try again: never "no
 * risk" for a project whose risk is unknown.
 */
const RiskiestEntities: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.riskiest) {
    return (
      <div
        data-testid={RISKIEST_ENTITIES_TEST_IDS.error}
        className={`${CARD_GRID_CENTERED_STATE_CLASS_NAME} items-center gap-3 py-6`}
      >
        <p className="text-sm text-gray-500">
          {translator.translateText(RISKIEST_ENTITIES_READ_FAILED)}
        </p>
        <Button
          title="Try again"
          icon={IconProp.Refresh}
          buttonStyle={ButtonStyleType.NORMAL}
          className="!ml-0 !w-auto"
          isLoading={props.isReading}
          disabled={props.isReading}
          dataTestId={RISKIEST_ENTITIES_TEST_IDS.tryAgain}
          onClick={props.onTryAgain}
        />
      </div>
    );
  }

  const rows: Array<RiskiestEntityRow> = getRiskiestEntityRows(props.riskiest);

  const items: Array<RankedBarItem> = rows.map(
    (row: RiskiestEntityRow): RankedBarItem => {
      return {
        key: row.value,
        /*
         * A value someone's systems wrote - an account, a host, an address
         * - read the way it is written on a right-to-left page too, and cut
         * short at its own end (IsolatedText); whole under the pointer.
         */
        label: (
          <IsolatedText
            text={row.value}
            className={RISKIEST_ENTITY_VALUE_CLASS_NAME}
          />
        ),
        title: row.value,
        count: row.score,
        // The level the score reads as, in words and colour, as on Entity Risk.
        badge: <EntityRiskLevelPill level={row.level} />,
        color: row.color,
        fillPercent: row.fillPercent,
        // Its kind, under it, as Entity Risk's list names it.
        hint: row.type
          ? translator.translateText(row.type) || row.type
          : undefined,
        to: getEntityRiskRoute(row.value, row.type),
      };
    },
  );

  // Nothing ranked: the sentence takes the card's room, as the other lists' do.
  if (items.length === 0) {
    return <RankedBars items={[]} emptyText={ENTITY_RISK_EMPTY_TITLE} />;
  }

  const moreCount: number = getMoreRiskyEntityCount(props.riskiest);

  return (
    <div data-testid={RISKIEST_ENTITIES_TEST_IDS.list}>
      <RankedBars
        items={items}
        emptyText={ENTITY_RISK_EMPTY_TITLE}
        hasThresholdMark={true}
      />
      {/*
       * The way on to the whole list, as every card of a few rows offers
       * it: all of them, counted, when Entity Risk lists more than the card
       * shows; Entity Risk itself - who found each, when, the filters and
       * the lookup - when the card shows them all.
       */}
      <div className="mt-4 text-sm">
        <AppLink
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.SECURITY_EVENTS_ENTITY_RISK] as Route,
          )}
          dataTestId={RISKIEST_ENTITIES_TEST_IDS.viewAll}
          className={RISKIEST_ENTITIES_LINK_CLASS_NAME}
        >
          {moreCount > 0
            ? translator.translatePlural(
                RISKIEST_ENTITIES_VIEW_ALL,
                props.riskiest.total,
              )
            : translator.translateText(RISKIEST_ENTITIES_OPEN_ENTITY_RISK) ||
              RISKIEST_ENTITIES_OPEN_ENTITY_RISK}
        </AppLink>
      </div>
    </div>
  );
};

export default RiskiestEntities;
