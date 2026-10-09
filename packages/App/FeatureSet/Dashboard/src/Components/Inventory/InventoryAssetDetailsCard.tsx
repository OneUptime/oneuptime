import Card from "Common/UI/Components/Card/Card";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import PlaceholderText from "Common/UI/Components/Detail/PlaceholderText";
import {
  InventoryAssetDetail,
  InventoryAssetDetails,
  InventoryAssetField,
  InventoryAssetSource,
  getInventoryAssetDetails,
} from "Common/Utils/Inventory/InventoryAssetDetails";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import {
  INVENTORY_ASSET_FIELD_LABELS,
  INVENTORY_ASSET_HELP,
  INVENTORY_ASSET_UNKNOWN,
} from "./InventoryAssetLabels";

/*
 * Asset details: what a machine is and where it is, in the same terms for
 * every host and network device (OneUptime issue #4569).
 *
 * Inventory used to show a machine only as the raw attributes it came in on -
 * `host.arch` and `os.type` for a host, an IP address under
 * `net.device.hostname` for a switch - so two machines read in two
 * vocabularies, and a fact nothing had reported was simply not there. This
 * card lists the same facts, in the same order, for both, and says
 * "Unknown" where a fact is missing, so a gap is something a reader sees
 * rather than something they have to notice is absent. One line under the
 * facts says why they are unknown and where to read how each one is filled.
 *
 * The raw attributes stay on the Attributes card below, for everything this
 * card does not name.
 */

export interface ComponentProps {
  item: InventoryAssetSource;
}

const InventoryAssetDetailsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
    props.item,
  );

  if (!details) {
    return <></>;
  }

  const help: (typeof INVENTORY_ASSET_HELP)[keyof typeof INVENTORY_ASSET_HELP] =
    INVENTORY_ASSET_HELP[details.kind];
  const unknownCount: number = details.unknownFields.length;

  return (
    <Card
      title="Asset Details"
      description="What this machine is and where it is, in the same terms for every host and network device. Unknown means nothing has reported it yet."
    >
      <div data-testid="inventory-asset-details">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {details.details.map((detail: InventoryAssetDetail): ReactElement => {
            const englishLabel: string =
              INVENTORY_ASSET_FIELD_LABELS[detail.field];
            const label: string =
              translator.translateText(englishLabel) || englishLabel;

            /*
             * A sysDescr runs to a paragraph ("Cisco IOS Software [Gibraltar],
             * Catalyst L3 Switch Software (...), Version 16.12.4, ..."), so it
             * gets the whole row rather than a third of one.
             */
            const isLong: boolean =
              detail.field === InventoryAssetField.SystemDescription;

            return (
              <div
                key={detail.field}
                className={`min-w-0${isLong ? " sm:col-span-2 lg:col-span-3" : ""}`}
                data-testid={`inventory-asset-${detail.field}`}
              >
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {label}
                </dt>
                <dd className="mt-1 flex min-w-0 items-start gap-x-2 text-sm text-gray-900">
                  {detail.value ? (
                    <>
                      <span className="min-w-0 whitespace-pre-line break-words">
                        {detail.value}
                      </span>
                      <CopyTextButton
                        textToBeCopied={detail.value}
                        iconOnly={true}
                        title={translator.translateTemplate("Copy {{name}}", {
                          name: label,
                        })}
                      />
                    </>
                  ) : (
                    <PlaceholderText text={INVENTORY_ASSET_UNKNOWN} />
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        {unknownCount > 0 ? (
          <p
            className="mt-5 border-t border-gray-100 pt-4 text-sm text-gray-500"
            data-testid="inventory-asset-details-unknown"
          >
            {translator.translatePlural(help.unknown, unknownCount)}{" "}
            <a
              className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
              href={help.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {translator.translateText(help.linkText)}
            </a>
          </p>
        ) : null}
      </div>
    </Card>
  );
};

export default InventoryAssetDetailsCard;
