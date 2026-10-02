import PageComponentProps from "../PageComponentProps";
import Card from "Common/UI/Components/Card/Card";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import AppLink from "../../Components/AppLink/AppLink";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import {
  INVENTORY_SOURCE_ORDER,
  InventorySourceDescriptor,
  getInventorySourceDescriptor,
} from "../../Components/Inventory/InventorySource";
import {
  INVENTORY_CATEGORY_ORDER,
  InventoryCategory,
  InventoryTypeDescriptor,
  getEntityTypesInCategory,
  getInventoryTypeDescriptor,
} from "../../Components/Inventory/InventoryTypeCatalog";
import {
  INVENTORY_LIVE_WINDOW_MINUTES,
  INVENTORY_STALE_AFTER_MINUTES,
} from "../../Components/Inventory/InventoryLiveness";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

/*
 * What Inventory is and where its rows come from.
 *
 * Written from the catalog rather than hand-listed, so the "kinds of thing"
 * table cannot fall out of step with what the product actually recognises —
 * a stale docs page listing types that no longer exist is worse than none.
 */

const InventoryDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <Fragment>
      <Card
        title="What is Inventory?"
        description="One list of everything OneUptime knows about your estate."
      >
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            {translator.translateText(
              "Inventory is the catalog behind every other product here. When a trace mentions a pod, when a monitor watches a switch, when you register a vendor API by hand — they all end up as one item in this list, with a stable identity OneUptime can join telemetry against.",
            )}
          </p>
          <p>
            <TranslatedSentence
              template="That identity is the {{identityKey}}: a hash of the handful of attributes that make the thing what it is (its name, its cluster, its container id). Everything else about an item — versions, image tags, IP addresses — can change freely without changing what it is."
              slots={{
                identityKey: (
                  <strong>{translator.translateText("identity key")}</strong>
                ),
              }}
            />
          </p>
        </div>
      </Card>

      <Card
        title="Finding and understanding items"
        description="Inventory uses the same navigation and filtering patterns as the rest of OneUptime."
      >
        <ul className="space-y-3 text-sm text-gray-600">
          <li>
            {translator.translateText(
              "Use search for a name or identity key, then narrow the list with the Type, Source, Last Seen and custom-field facets. Facets stay in the URL, so a filtered view can be bookmarked or shared.",
            )}
          </li>
          <li>
            {translator.translateText(
              "Open an item to see its connections and each telemetry signal on its own page. Editing, archiving and deletion also live inside the item instead of in the table row menu.",
            )}
          </li>
          <li>
            <TranslatedSentence
              template="{{link}} to see service dependencies, infrastructure containment and network links together."
              slots={{
                link: (
                  <AppLink
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.TOPOLOGY] as Route,
                    )}
                    className="font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    {translator.translateTemplate("Explore the full topology")}
                  </AppLink>
                ),
              }}
            />
          </li>
        </ul>
      </Card>

      <Card
        title="Where items come from"
        description="Three sources, and the difference between them decides what you can do with a row."
      >
        <div className="space-y-4">
          {INVENTORY_SOURCE_ORDER.map((source: EntitySource): ReactElement => {
            const descriptor: InventorySourceDescriptor | null =
              getInventorySourceDescriptor(source);

            if (!descriptor) {
              return <Fragment key={source}></Fragment>;
            }

            return (
              <div
                key={source}
                className="rounded-lg border border-gray-200 p-4"
              >
                <div className="flex items-center gap-x-2">
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${descriptor.pillClassName}`}
                  >
                    {translator.translateText(descriptor.label)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-600">
                  {translator.translateText(descriptor.description)}
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  {descriptor.isDeletePermanent
                    ? translator.translateText(
                        "Deleting one of these removes it for good.",
                      )
                    : translator.translateText(descriptor.deleteCaveat)}
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="When an item is 'Gone Quiet'"
        description="How OneUptime decides that something has stopped reporting."
      >
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            <TranslatedSentence
              template="Discovered items carry a heartbeat: every time telemetry arrives for one, its last-seen time moves forward. An item seen in the last {{liveWindow}} is shown as {{live}}; one seen within the last day is {{recent}}; past {{staleAfter}} it is flagged as {{goneQuiet}}."
              slots={{
                liveWindow: (
                  <strong>
                    {translator.translatePlural(
                      { one: "{{count}} minute", other: "{{count}} minutes" },
                      INVENTORY_LIVE_WINDOW_MINUTES,
                    )}
                  </strong>
                ),
                live: <strong>{translator.translateText("Live")}</strong>,
                recent: <strong>{translator.translateText("Recent")}</strong>,
                staleAfter: (
                  <strong>
                    {translator.translatePlural(
                      { one: "{{count}} hour", other: "{{count}} hours" },
                      Math.round(INVENTORY_STALE_AFTER_MINUTES / 60),
                    )}
                  </strong>
                ),
                goneQuiet: (
                  <strong>{translator.translateText("Gone Quiet")}</strong>
                ),
              }}
            />
          </p>
          <p>
            {translator.translateText(
              "Mirrored and hand-added items have no heartbeat — nothing was ever going to bump their last-seen time — so they are never flagged. Their status column is deliberately blank rather than alarming.",
            )}
          </p>
        </div>
      </Card>

      <Card
        title="Kinds of thing OneUptime recognises"
        description="Anything in this list is cataloged automatically when it appears in your data."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INVENTORY_CATEGORY_ORDER.map(
            (category: InventoryCategory): ReactElement => {
              return (
                <div
                  key={category}
                  className="rounded-lg border border-gray-200 p-4"
                >
                  <h3 className="text-sm font-semibold text-gray-900">
                    {translator.translateText(category)}
                  </h3>
                  <ul className="mt-3 space-y-2">
                    {getEntityTypesInCategory(category).map(
                      (entityType: string): ReactElement => {
                        const descriptor: InventoryTypeDescriptor | null =
                          getInventoryTypeDescriptor(entityType);

                        if (!descriptor) {
                          return <Fragment key={entityType}></Fragment>;
                        }

                        return (
                          <li
                            key={entityType}
                            className="flex items-start gap-x-2 text-sm"
                          >
                            <Icon
                              icon={descriptor.icon}
                              size={SizeProp.Smaller}
                              className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
                            />
                            <span>
                              <span className="font-medium text-gray-900">
                                {translator.translateText(descriptor.label)}
                              </span>
                              <span className="block text-xs text-gray-500">
                                {translator.translateText(
                                  descriptor.description,
                                )}
                              </span>
                            </span>
                          </li>
                        );
                      },
                    )}
                  </ul>
                </div>
              );
            },
          )}
        </div>
      </Card>

      <Card
        title="Getting data in"
        description="Nothing here needs configuring — it fills itself as your data arrives."
      >
        <ul className="space-y-3 text-sm">
          <li className="flex items-center gap-x-2">
            <Icon
              icon={IconProp.Waterfall}
              size={SizeProp.Smaller}
              className="h-4 w-4 text-gray-400"
            />
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.TRACES_DOCUMENTATION] as Route,
              )}
              className="font-medium text-indigo-600 hover:text-indigo-800"
            >
              {translator.translateTemplate(
                "Send OpenTelemetry traces, logs and metrics",
              )}
            </AppLink>
          </li>
          <li className="flex items-center gap-x-2">
            <Icon
              icon={IconProp.Signal}
              size={SizeProp.Smaller}
              className="h-4 w-4 text-gray-400"
            />
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_DEVICES] as Route,
              )}
              className="font-medium text-indigo-600 hover:text-indigo-800"
            >
              {translator.translateTemplate("Register network devices")}
            </AppLink>
          </li>
          <li className="flex items-center gap-x-2">
            <Icon
              icon={IconProp.Cloud}
              size={SizeProp.Smaller}
              className="h-4 w-4 text-gray-400"
            />
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_RESOURCES] as Route,
              )}
              className="font-medium text-indigo-600 hover:text-indigo-800"
            >
              {translator.translateTemplate("Connect a cloud account")}
            </AppLink>
          </li>
          <li className="flex items-center gap-x-2">
            <Icon
              icon={IconProp.Add}
              size={SizeProp.Smaller}
              className="h-4 w-4 text-gray-400"
            />
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.INVENTORY_ITEMS] as Route,
              )}
              className="font-medium text-indigo-600 hover:text-indigo-800"
            >
              {translator.translateTemplate("Add something by hand")}
            </AppLink>
          </li>
        </ul>
      </Card>
    </Fragment>
  );
};

export default InventoryDocumentation;
