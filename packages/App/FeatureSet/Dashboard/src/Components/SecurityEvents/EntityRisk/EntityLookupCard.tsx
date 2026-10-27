import SecurityCaseApi, {
  EntityActivity,
} from "../../SecurityCase/SecurityCaseApi";
import {
  SecurityEntityChip,
  getCorrelateRouteForEntity,
} from "../../SecurityCase/SecurityEntityChips";
import { describeSetupCallFailure } from "../../SecurityOverview/SecuritySetupModel";
import {
  ENTITY_LOOKUP_BUTTON,
  ENTITY_LOOKUP_DESCRIPTION,
  ENTITY_LOOKUP_HOURS,
  ENTITY_LOOKUP_NOT_SEEN,
  ENTITY_LOOKUP_PLACEHOLDER,
  ENTITY_LOOKUP_TEST_IDS,
  ENTITY_LOOKUP_TITLE,
  OPEN_IN_CORRELATE,
} from "./EntityRiskCopy";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityEntity,
  inferSecurityEntityType,
} from "Common/Types/SecurityCase/SecurityEntity";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Input from "Common/UI/Components/Input/Input";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

function toEntity(value: string): SecurityEntity {
  return { type: inferSecurityEntityType(value), value };
}

/*
 * Look Up an Entity, under Entity Risk's list: any value - a user, a host,
 * an address, and a domain or a file hash too, which carry no risk - and
 * how busy it has been across the last 30 days of security events, in how
 * many findings, and when it was last seen; with the way into Correlate.
 *
 * It was the second card of Security Events > Entities, under a ranking of
 * values by how many findings named them. That ranking disagreed with
 * Entity Risk's scores about who is riskiest, so Entity Risk is the one
 * ranking now, and the lookup moved here with it; the Entities address
 * opens Entity Risk.
 */
const EntityLookupCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [lookupValue, setLookupValue] = useState<string>("");
  const [lookup, setLookup] = useState<EntityActivity | null>(null);
  const [lookupError, setLookupError] = useState<string>("");
  const [isLookingUp, setIsLookingUp] = useState<boolean>(false);

  const runLookup: () => Promise<void> = async (): Promise<void> => {
    const value: string = lookupValue.trim();

    if (!value) {
      return;
    }

    setIsLookingUp(true);
    setLookupError("");

    try {
      const rows: Array<EntityActivity> =
        await SecurityCaseApi.getEntityActivity({
          values: [value],
          hours: ENTITY_LOOKUP_HOURS,
        });

      setLookup(
        rows[0] || {
          value,
          eventCount: 0,
          findingCount: 0,
          maxSeverityId: 0,
          firstSeen: null,
          lastSeen: null,
        },
      );
    } catch (err) {
      // In the product's words: a role's or a plan's sentence, never a gateway's.
      setLookupError(describeSetupCallFailure(err));
    }

    setIsLookingUp(false);
  };

  return (
    <Card title={ENTITY_LOOKUP_TITLE} description={ENTITY_LOOKUP_DESCRIPTION}>
      <div className="space-y-3" data-testid={ENTITY_LOOKUP_TEST_IDS.card}>
        {/*
         * The box and Look Up on one line, the same height: the input's
         * own top and bottom margins stretched the button 12px taller
         * than the box beside it.
         */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Input
              placeholder={ENTITY_LOOKUP_PLACEHOLDER}
              outerDivClassName="relative w-full rounded-md shadow-sm"
              // Named for a screen reader as the card is: a placeholder is no name.
              ariaLabel={
                translator.translateText(ENTITY_LOOKUP_TITLE) ||
                ENTITY_LOOKUP_TITLE
              }
              value={lookupValue}
              dataTestId={ENTITY_LOOKUP_TEST_IDS.input}
              onChange={(value: string) => {
                setLookupValue(value);
              }}
              onEnterPress={() => {
                void runLookup();
              }}
            />
          </div>
          <Button
            title={ENTITY_LOOKUP_BUTTON}
            icon={IconProp.MagnifyingGlass}
            buttonStyle={ButtonStyleType.PRIMARY}
            isLoading={isLookingUp}
            disabled={!lookupValue.trim()}
            onClick={() => {
              void runLookup();
            }}
          />
        </div>
        {lookupError ? <ErrorMessage message={lookupError} /> : <></>}
        {lookup ? (
          <div
            className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
            data-testid={ENTITY_LOOKUP_TEST_IDS.result}
          >
            <SecurityEntityChip entity={toEntity(lookup.value)} />
            <span className="text-sm text-gray-700">
              {translator.translatePlural(
                { one: "{{count}} event", other: "{{count}} events" },
                lookup.eventCount,
              )}
            </span>
            <span className="text-sm text-gray-700">
              {translator.translatePlural(
                { one: "{{count}} finding", other: "{{count}} findings" },
                lookup.findingCount,
              )}
            </span>
            {lookup.lastSeen ? (
              <span className="text-sm text-gray-500">
                {translator.translateTemplate("Last seen {{when}}", {
                  when: OneUptimeDate.fromNow(lookup.lastSeen),
                })}
              </span>
            ) : (
              <span className="text-sm text-gray-500">
                {translator.translateText(ENTITY_LOOKUP_NOT_SEEN)}
              </span>
            )}
            <Button
              title={OPEN_IN_CORRELATE}
              icon={IconProp.Share}
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                Navigation.navigate(getCorrelateRouteForEntity(lookup.value));
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default EntityLookupCard;
