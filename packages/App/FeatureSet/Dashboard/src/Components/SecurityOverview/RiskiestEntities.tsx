import AppLink from "../AppLink/AppLink";
import RankedBars, { RankedBarItem } from "./RankedBars";
import {
  ENTITY_RISK_EMPTY_TITLE,
  RISKIEST_ENTITIES_READ_FAILED,
  RISKIEST_ENTITIES_TEST_IDS,
  RISKIEST_ENTITIES_VIEW_ALL,
} from "../SecurityEvents/EntityRisk/EntityRiskCopy";
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
 * An entity's value: its own line, in the monospace every Security Events
 * value is drawn in, cut short at its own end - the isolate carries the
 * value's direction, so a right-to-left page cuts an address or an account
 * where it ends, not where it starts.
 */
export const RISKIEST_ENTITY_VALUE_CLASS_NAME: string = "block truncate font-mono";

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
 * riskiest entities. Each row is the entity, its kind and level, its score
 * and a bar filled as Entity Risk's meter is (the mark halfway along is
 * where a case opens), in its level's colour, and opens the entity's own
 * page - why it is risky, its cases, its activity. Under the list, the way
 * to the rest of them on Entity Risk, when there are more.
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
         * short at its own end (IsolatedText).
         */
        label: (
          <IsolatedText
            text={row.value}
            className={RISKIEST_ENTITY_VALUE_CLASS_NAME}
          />
        ),
        count: row.score,
        color: row.color,
        fillPercent: row.fillPercent,
        // Its kind and its level, in words: the colour is not all it says.
        hint: [
          row.type ? translator.translateText(row.type) || row.type : "",
          translator.translateText(row.level) || row.level,
        ]
          .filter(Boolean)
          .join(" · "),
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
      {moreCount > 0 ? (
        <div className="mt-4 text-sm">
          <AppLink
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.SECURITY_EVENTS_ENTITY_RISK] as Route,
            )}
            dataTestId={RISKIEST_ENTITIES_TEST_IDS.viewAll}
            className="rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {translator.translatePlural(
              RISKIEST_ENTITIES_VIEW_ALL,
              props.riskiest.total,
            )}
          </AppLink>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default RiskiestEntities;
