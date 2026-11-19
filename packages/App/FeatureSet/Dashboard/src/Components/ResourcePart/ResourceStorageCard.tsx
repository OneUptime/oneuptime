import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import StorageUsageBar, {
  StorageUsageBarSize,
} from "Common/UI/Components/StorageUsage/StorageUsageBar";
import {
  StorageUsage,
  formatStorageBytes,
} from "Common/Utils/Storage/StorageUsage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * HOW FULL A PART'S STORE IS, ON ITS OWN PAGE.
 *
 * A storage array's bucket or file system, a cloud database or disk, a
 * Docker volume: each page draws its store the one way every list draws it
 * (#9647, #9648) - the shared reading (StorageUsage, at the product's own
 * lines) as the shared bar's detail: how much is used, how much is free and
 * how big it is, with a pill when it is nearly full and when it was
 * measured.
 *
 * Where what is used cannot be known, the card says why in words
 * (noUsageText), never with an empty bar - and still says the store's size
 * when that is known (capacityBytes): an EBS volume is 100 GiB, whatever its
 * guest wrote on it.
 */

export interface ComponentProps {
  usage: StorageUsage | null;
  // What the store is, English, looked up by the card: one short sentence.
  description: string;
  // English, looked up where it is drawn: why there is no reading.
  noUsageText?: string | undefined;
  // Its size, drawn beside noUsageText when there is no reading.
  capacityBytes?: number | null | undefined;
  measuredAt?: Date | undefined;
  // How an amount is written: binary bytes ("36.2 GiB") by default.
  formatAmount?: ((amount: number) => string) | undefined;
  testId?: string | undefined;
}

const ResourceStorageCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const testId: string = props.testId || "resource-storage";
  const formatAmount: (amount: number) => string =
    props.formatAmount ||
    ((amount: number): string => {
      return formatStorageBytes(amount, translator.language);
    });

  const capacity: number | null =
    props.capacityBytes !== null &&
    props.capacityBytes !== undefined &&
    Number.isFinite(props.capacityBytes) &&
    props.capacityBytes > 0
      ? props.capacityBytes
      : null;

  return (
    <Card title="Storage" description={props.description}>
      {!props.usage && capacity !== null ? (
        <div data-testid={testId} className="space-y-2">
          <dl>
            <dt className="text-xs font-medium text-gray-500">
              {translator.translateText("Capacity")}
            </dt>
            <dd
              data-testid={`${testId}-capacity`}
              className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900"
            >
              <bdi>{formatAmount(capacity)}</bdi>
            </dd>
          </dl>
          {props.noUsageText ? (
            <p data-testid={`${testId}-none`} className="text-sm text-gray-600">
              {translator.translateText(props.noUsageText)}
            </p>
          ) : null}
        </div>
      ) : (
        <StorageUsageBar
          usage={props.usage}
          size={StorageUsageBarSize.Detail}
          noUsageText={props.noUsageText}
          measuredAt={props.usage ? props.measuredAt : undefined}
          formatAmount={props.formatAmount}
          dataTestId={testId}
        />
      )}
    </Card>
  );
};

export default ResourceStorageCard;
