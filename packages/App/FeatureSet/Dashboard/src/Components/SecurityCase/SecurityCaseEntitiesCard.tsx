import SecurityEventSeverityPill from "../SecurityEvents/SecurityEventSeverityPill";
import SecurityCaseApi, { EntityActivity } from "./SecurityCaseApi";
import { SecurityEntityChip } from "./SecurityEntityChips";
import OneUptimeDate from "Common/Types/Date";
import OcsfSeverity, {
  ocsfSeverityFromId,
} from "Common/Types/SecurityEvent/OcsfSeverity";
import { SecurityEntity } from "Common/Types/SecurityCase/SecurityEntity";
import Card from "Common/UI/Components/Card/Card";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// How far back the card looks: a week, long enough to see an attack's run-up.
export const ENTITY_ACTIVITY_HOURS: number = 24 * 7;

export interface ComponentProps {
  entities: Array<SecurityEntity>;
}

/*
 * Who and what the case is about, and how busy each has been across all the
 * project's security events this past week: a user with thousands of events
 * and findings from other rules is a different case from one seen twice.
 */
const SecurityCaseEntitiesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [activity, setActivity] = useState<Map<string, EntityActivity>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const valuesKey: string = props.entities
    .map((entity: SecurityEntity): string => {
      return entity.value;
    })
    .join("\n");

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      if (props.entities.length === 0) {
        setActivity(new Map());
        return;
      }

      setIsLoading(true);
      setError("");

      try {
        const rows: Array<EntityActivity> =
          await SecurityCaseApi.getEntityActivity({
            values: props.entities.map((entity: SecurityEntity): string => {
              return entity.value;
            }),
            hours: ENTITY_ACTIVITY_HOURS,
          });

        if (!isCurrent) {
          return;
        }

        const byValue: Map<string, EntityActivity> = new Map();

        for (const row of rows) {
          byValue.set(row.value.toLowerCase(), row);
        }

        setActivity(byValue);
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
  }, [valuesKey]);

  return (
    <Card
      title="Entities"
      description="Who and what this case is about, with their activity across all security events in the last 7 days. Open one in Correlate to see everything it touched."
    >
      {props.entities.length === 0 ? (
        <p className="text-sm text-gray-500">
          {translator.translateText(
            "This case names no users, hosts or addresses.",
          )}
        </p>
      ) : (
        <div className="-mx-1 space-y-1.5">
          {error ? (
            <p className="px-1 pb-1 text-xs text-amber-700">
              {translator.translateTemplate(
                "Activity is not available: {{reason}}",
                { reason: error },
              )}
            </p>
          ) : (
            <></>
          )}
          {props.entities.map(
            (entity: SecurityEntity, index: number): ReactElement => {
              const row: EntityActivity | undefined = activity.get(
                entity.value.toLowerCase(),
              );
              const severity: OcsfSeverity | undefined =
                row && row.findingCount > 0
                  ? ocsfSeverityFromId(row.maxSeverityId)
                  : undefined;

              return (
                <div
                  key={`${entity.type}-${entity.value}-${index}`}
                  className="flex items-center justify-between gap-3 rounded-md px-1 py-1 hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <SecurityEntityChip entity={entity} />
                    <div className="mt-0.5 pl-0.5 text-[11px] text-gray-500">
                      {translator.translateText(entity.type)}
                      {row?.lastSeen ? (
                        <>
                          {" · "}
                          {translator.translateTemplate("last seen {{when}}", {
                            when: OneUptimeDate.fromNow(row.lastSeen),
                          })}
                        </>
                      ) : (
                        <></>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2 text-right">
                    {isLoading && !row ? (
                      <span className="h-3 w-12 animate-pulse rounded bg-gray-100" />
                    ) : (
                      <span
                        className="text-xs tabular-nums text-gray-600"
                        title={translator.translateText(
                          "Security events naming it in the last 7 days",
                        )}
                      >
                        {translator.translatePlural(
                          { one: "{{count}} event", other: "{{count}} events" },
                          row?.eventCount || 0,
                        )}
                      </span>
                    )}
                    {severity ? (
                      <span
                        title={translator.translatePlural(
                          {
                            one: "{{count}} finding names it",
                            other: "{{count}} findings name it",
                          },
                          row?.findingCount || 0,
                        )}
                      >
                        <SecurityEventSeverityPill severityName={severity} />
                      </span>
                    ) : (
                      <></>
                    )}
                  </div>
                </div>
              );
            },
          )}
        </div>
      )}
    </Card>
  );
};

export default SecurityCaseEntitiesCard;
