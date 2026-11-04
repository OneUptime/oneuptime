import DataObservabilityApi from "./DataObservabilityApi";
import { formatPriceInUSD } from "Common/Types/Billing/PayAsYouGoPricing";
import { DataObservabilityWatchedTables } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  // Reads again when this changes, as after a database is connected.
  refreshToken?: number | undefined;
}

/*
 * How many tables this project watches and what they cost, where tables are
 * billed. On a self-hosted install it says nothing. Connecting a database watches
 * every table in it, so this also shows on the form that does it.
 */
const WatchedTablesCost: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [watched, setWatched] = useState<DataObservabilityWatchedTables | null>(
    null,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getWatchedTables()
      .then((found: DataObservabilityWatchedTables): void => {
        if (isCurrent) {
          setWatched(found);
        }
      })
      .catch((): void => {
        // Someone who may not read this sees the rest of the page without it.
      });

    return () => {
      isCurrent = false;
    };
  }, [props.refreshToken]);

  if (!watched || !watched.isBilled) {
    return <></>;
  }

  const values: { count: string; cost: string } = {
    count: translator.formatNumber(watched.tableCount),
    cost: `$${translator.formatNumber(watched.monthlyCostInUSD)}`,
  };

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      <p>
        {watched.isCharging
          ? translator.translateTemplate(
              "Tables watched: {{count}}, about {{cost}} a month.",
              values,
            )
          : translator.translateTemplate(
              "Tables watched: {{count}}. Not charged yet: at the listed price, about {{cost}} a month.",
              values,
            )}
      </p>
      <p className="mt-1 text-gray-500">
        {translator.translateTemplate(
          "The first {{included}} tables are free, then {{price}} a table a month, and {{volumePrice}} above {{threshold}}. Views are free.",
          {
            included: translator.formatNumber(watched.pricing.includedTables),
            price: formatPriceInUSD(watched.pricing.pricePerTableInUSD),
            volumePrice: formatPriceInUSD(
              watched.pricing.volumePricePerTableInUSD,
            ),
            threshold: translator.formatNumber(
              watched.pricing.volumeThresholdInTables,
            ),
          },
        )}
      </p>
      {watched.canAddTables ? (
        <></>
      ) : (
        <p className="mt-1 text-amber-700">
          {translator.translateText(
            "This project has used its free tables. Add a payment method under Project Settings > Billing to watch more.",
          )}
        </p>
      )}
    </div>
  );
};

export default WatchedTablesCost;
