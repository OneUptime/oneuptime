import PageComponentProps from "../PageComponentProps";
import SecurityEventSeverityPill from "../../Components/SecurityEvents/SecurityEventSeverityPill";
import SecurityCaseApi, {
  EntityActivity,
  EntityFindingSummary,
} from "../../Components/SecurityCase/SecurityCaseApi";
import {
  SecurityEntityChip,
  getCorrelateRouteForEntity,
} from "../../Components/SecurityCase/SecurityEntityChips";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { ocsfSeverityFromId } from "Common/Types/SecurityEvent/OcsfSeverity";
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
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export const ENTITY_WINDOWS_IN_DAYS: Array<number> = [1, 7, 30];

function toEntity(value: string): SecurityEntity {
  return { type: inferSecurityEntityType(value), value };
}

/*
 * The users, hosts, addresses and files the project's findings name most:
 * where to look first, before any case is opened. And a lookup for any
 * value, to see how busy it has been across every security event.
 */
const SecurityEntitiesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [days, setDays] = useState<number>(7);
  const [entities, setEntities] = useState<Array<EntityFindingSummary>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [lookupValue, setLookupValue] = useState<string>("");
  const [lookup, setLookup] = useState<EntityActivity | null>(null);
  const [lookupError, setLookupError] = useState<string>("");
  const [isLookingUp, setIsLookingUp] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);

      try {
        const result: Array<EntityFindingSummary> =
          await SecurityCaseApi.getTopEntities({ days, limit: 100 });

        if (isCurrent) {
          setEntities(result);
          setError("");
        }
      } catch (err) {
        if (isCurrent) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }

      if (isCurrent) {
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [days]);

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
          hours: 24 * 30,
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
      setLookupError(err instanceof Error ? err.message : String(err));
    }

    setIsLookingUp(false);
  };

  return (
    <div className="space-y-6">
      <Card
        title="Look Up an Entity"
        description="Any user, host, IP address, domain or file hash: how often it appears in your security events over the last 30 days, and in how many findings."
      >
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <Input
                placeholder="e.g. alice@example.com, web-01 or 203.0.113.7"
                value={lookupValue}
                dataTestId="security-entity-lookup-input"
                onChange={(value: string) => {
                  setLookupValue(value);
                }}
                onEnterPress={() => {
                  void runLookup();
                }}
              />
            </div>
            <Button
              title="Look Up"
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
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
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
                  {translator.translateText("Not seen in the last 30 days.")}
                </span>
              )}
              <Button
                title="Open in Correlate"
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

      <Card
        title="Riskiest Entities"
        description="The entities named by the most findings: detection rule matches, threat intelligence matches and alerts from connected products. Open one in Correlate to see everything it touched."
        headerLayout="stacked"
        rightElement={
          <div className="flex items-center gap-1">
            {ENTITY_WINDOWS_IN_DAYS.map((window: number): ReactElement => {
              const isActive: boolean = window === days;

              return (
                <button
                  key={window}
                  type="button"
                  aria-pressed={isActive}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                  onClick={() => {
                    setDays(window);
                  }}
                >
                  {translator.translatePlural(
                    { one: "{{count}} day", other: "{{count}} days" },
                    window,
                  )}
                </button>
              );
            })}
          </div>
        }
      >
        {error ? (
          <ErrorMessage message={error} />
        ) : isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((index: number): ReactElement => {
              return (
                <div
                  key={index}
                  className="h-10 animate-pulse rounded-md bg-gray-100"
                />
              );
            })}
          </div>
        ) : entities.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            {translator.translateText(
              "No finding named an entity in this window.",
            )}
          </p>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">
                    {translator.translateText("Entity")}
                  </th>
                  <th className="px-4 py-2 text-right">
                    {translator.translateText("Findings")}
                  </th>
                  <th className="px-4 py-2 text-right">
                    {translator.translateText("Rules")}
                  </th>
                  <th className="px-4 py-2">
                    {translator.translateText("Worst Severity")}
                  </th>
                  <th className="px-4 py-2">
                    {translator.translateText("Last Seen")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entities.map((entity: EntityFindingSummary): ReactElement => {
                  return (
                    <tr key={entity.value} className="hover:bg-gray-50">
                      <td className="max-w-xs px-4 py-2">
                        <SecurityEntityChip entity={toEntity(entity.value)} />
                      </td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-900">
                        {translator.formatNumber(entity.findingCount)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                        {translator.formatNumber(entity.ruleCount)}
                      </td>
                      <td className="px-4 py-2">
                        <SecurityEventSeverityPill
                          severityName={ocsfSeverityFromId(
                            entity.maxSeverityId,
                          )}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                        {entity.lastSeen
                          ? OneUptimeDate.fromNow(entity.lastSeen)
                          : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default SecurityEntitiesPage;
