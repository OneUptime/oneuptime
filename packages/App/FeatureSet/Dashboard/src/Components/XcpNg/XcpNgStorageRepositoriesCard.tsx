import React, { FunctionComponent, ReactElement } from "react";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import StorageUsageBar, {
  StorageUsageBarSize,
} from "Common/UI/Components/StorageUsage/StorageUsageBar";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import ResourcePartRow from "../ResourcePart/ResourcePartRow";
import { XCP_NG_PAGE_DESCRIPTIONS } from "./XcpNgPageDescriptions";
import {
  getXcpNgAllocationPercent,
  getXcpNgStorageUsage,
  isXcpNgStorageOverAllocated,
} from "../../Pages/XcpNg/Utils/XcpNgHealth";
import {
  getXcpNgContentTypeWord,
  getXcpNgStorageTypeLabel,
  sortXcpNgStorageForGlance,
} from "../../Pages/XcpNg/Utils/XcpNgPartFacts";
import { getXcpNgDisplayName } from "../../Pages/XcpNg/Utils/XcpNgResourceUtils";

/*
 * THE POOL'S STORAGE REPOSITORIES AT A GLANCE, on its Overview: each one's
 * fill bar (the shared storage bar, amber past 90% where its alert fires,
 * red past 95%), whether every host shares it or which host it belongs to,
 * its type and what it holds, and - when thin provisioning took it past its
 * size - how far, in amber. The repositories that hold VM disks first, the
 * fullest first, so the one about to fill is the first a reader sees; each
 * a step from its own page.
 */

// How many repositories the card lists before it points to the Storage list.
export const XCP_NG_STORAGE_CARD_SHOWN: number = 8;

const SHARED: string = translationKey("Shared");
const OVER_PROVISIONED: string = translationKey("{{percent}} allocated");
const NOT_MEASURED: string = translationKey("Not measured");

export interface ComponentProps {
  rows: Array<XcpNgResource>;
  getStorageRoute: (externalId: string) => Route;
  storageRoute: Route;
}

const XcpNgStorageRepositoriesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const repositories: Array<XcpNgResource> = sortXcpNgStorageForGlance(
    props.rows.filter((row: XcpNgResource): boolean => {
      return row.kind === XcpNgResourceKind.StorageRepository;
    }),
  );

  if (repositories.length === 0) {
    return <></>;
  }

  const shown: Array<XcpNgResource> = repositories.slice(
    0,
    XCP_NG_STORAGE_CARD_SHOWN,
  );

  return (
    <div className="mb-6" data-testid="xcp-ng-storage-card">
      <Card
        title="Storage Repositories"
        description="How full each storage repository is at its latest report, the fullest first. Those that hold VM disks come before ISO libraries."
        buttons={[
          <Link
            key="all-storage"
            to={props.storageRoute}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            dataTestId="xcp-ng-storage-card-all"
          >
            {translator.translatePlural(
              {
                one: "View {{count}} storage repository",
                other: "View all {{count}} storage repositories",
              },
              repositories.length,
            )}
          </Link>,
        ]}
      >
        <ul className={listClassName}>
          {shown.map((repository: XcpNgResource): ReactElement => {
            const externalId: string = repository.externalId || "";
            const name: string = getXcpNgDisplayName(repository);
            const allocationPercent: number | null =
              getXcpNgAllocationPercent(repository);
            const facts: Array<string> = [];
            if (repository.srType) {
              // A storage technology's name, the same in every language.
              facts.push(getXcpNgStorageTypeLabel(repository.srType));
            }
            if (repository.contentType) {
              facts.push(tx(getXcpNgContentTypeWord(repository.contentType)));
            }

            return (
              <li
                key={externalId || name}
                data-testid="xcp-ng-storage-card-item"
                data-storage-repository={name}
              >
                <ResourcePartRow
                  to={
                    externalId ? props.getStorageRoute(externalId) : undefined
                  }
                  className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6"
                >
                  <div className="flex min-w-0 items-start gap-3 md:w-2/5">
                    <div
                      className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
                      aria-hidden="true"
                    >
                      <Icon icon={IconProp.Database} className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          data-testid="xcp-ng-storage-card-name"
                          className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
                        >
                          <BreakableName text={name} />
                        </span>
                        {repository.isShared === true ? (
                          <Pill
                            text={SHARED}
                            tone={PillTone.Neutral}
                            dataTestId="xcp-ng-storage-card-shared"
                          />
                        ) : repository.parentHostName ? (
                          <Pill
                            text={repository.parentHostName}
                            isUserContent={true}
                            tone={PillTone.Neutral}
                            icon={IconProp.ServerStack}
                            dataTestId="xcp-ng-storage-card-host"
                          />
                        ) : (
                          <></>
                        )}
                        {isXcpNgStorageOverAllocated(repository) &&
                        allocationPercent !== null ? (
                          <Pill
                            text={translator.translateTemplate(
                              OVER_PROVISIONED,
                              {
                                percent: formatReaderFigure(
                                  Math.round(allocationPercent),
                                  {
                                    decimals: 0,
                                    isPercent: true,
                                    language: translator.language,
                                  },
                                ),
                              },
                            )}
                            isUserContent={true}
                            tone={PillTone.Warning}
                            tooltip={
                              XCP_NG_PAGE_DESCRIPTIONS.storageTableAllocated
                            }
                            dataTestId="xcp-ng-storage-card-over-provisioned"
                          />
                        ) : (
                          <></>
                        )}
                      </div>
                      {facts.length > 0 ? (
                        <div className="mt-0.5 text-xs text-gray-500">
                          {facts.join(" · ")}
                        </div>
                      ) : (
                        <></>
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 pl-10 md:pl-0">
                    <StorageUsageBar
                      usage={getXcpNgStorageUsage(repository)}
                      size={StorageUsageBarSize.Compact}
                      noUsageText={NOT_MEASURED}
                      dataTestId="xcp-ng-storage-card-usage"
                    />
                  </div>
                </ResourcePartRow>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
};

export default XcpNgStorageRepositoriesCard;
