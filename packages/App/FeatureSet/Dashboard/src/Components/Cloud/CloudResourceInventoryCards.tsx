import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  flattenCloudProperties,
  readCloudEndpoints,
  readCloudRelationships,
  readCloudTags,
} from "Common/Types/Cloud/CloudInventory";
import {
  CloudLinkedResource,
  CloudResolvedRelationship,
  resolveCloudRelationships,
} from "Common/Types/Cloud/CloudResourceIndex";
import { getCloudResourceTypeLabel } from "Common/Types/Cloud/CloudResourceCatalog";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getCloudAccountResourcesQuery } from "./CloudAccountScope";
import {
  CLOUD_NEIGHBOUR_READ_LIMIT,
  CloudConnectionGroup,
  groupCloudConnections,
} from "./CloudConnectionGroups";
import { getCloudRelationshipLabel } from "./CloudRelationshipWords";

/*
 * What a cloud account's inventory says about one of its resources, beyond
 * its metrics: what it is connected to, both ways, named after the
 * resources OneUptime holds; the host names it answers on; its tags; and a
 * few of its settings. Everything here is the cloud's own words, shown as
 * written.
 *
 * Its neighbours are read from the same account - at most
 * CLOUD_NEIGHBOUR_READ_LIMIT of them, with a line saying so when the
 * account holds more - and grouped by CloudConnectionGroups.
 */

export interface ComponentProps {
  resource: CloudResource;
}

const CloudResourceInventoryCards: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const resource: CloudResource = props.resource;
  const provider: string = (resource.cloudProvider as string) || "";
  const accountId: string = (resource.cloudAccountId as string) || "";
  const resourceId: string = resource._id?.toString() || "";

  const relationships: ReturnType<typeof readCloudRelationships> =
    useMemo(() => {
      return readCloudRelationships(resource.cloudRelationships);
    }, [resource.cloudRelationships]);
  const tags: Record<string, string> = useMemo(() => {
    return readCloudTags(resource.cloudTags);
  }, [resource.cloudTags]);
  const properties: Record<string, string> = useMemo(() => {
    return flattenCloudProperties(resource.cloudProperties);
  }, [resource.cloudProperties]);
  const endpoints: Array<string> = useMemo(() => {
    return readCloudEndpoints(resource.cloudEndpoints);
  }, [resource.cloudEndpoints]);

  const [neighbours, setNeighbours] =
    useState<Array<CloudLinkedResource> | null>(null);
  const [neighbourCount, setNeighbourCount] = useState<number>(0);
  const [neighbourError, setNeighbourError] = useState<string>("");

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    let ignore: boolean = false;

    setNeighbours(null);
    setNeighbourError("");

    if (!projectId || !provider || !accountId || !resourceId) {
      setNeighbours([]);
      return;
    }

    ModelAPI.getList<CloudResource>({
      modelType: CloudResource,
      query: getCloudAccountResourcesQuery({
        projectId,
        provider,
        accountId,
      }),
      select: {
        _id: true,
        name: true,
        providerResourceId: true,
        cloudResourceType: true,
        cloudRelationships: true,
      },
      sort: { _id: SortOrder.Ascending },
      skip: 0,
      limit: CLOUD_NEIGHBOUR_READ_LIMIT,
    })
      .then((result: ListResult<CloudResource>): void => {
        if (ignore) {
          return;
        }

        setNeighbourCount(result.count ?? result.data.length);
        setNeighbours(
          result.data
            .filter((row: CloudResource): boolean => {
              return Boolean(row._id);
            })
            .map((row: CloudResource): CloudLinkedResource => {
              return {
                id: new ObjectID(row._id!.toString()),
                name: (row.name as string) || "",
                providerResourceId: (row.providerResourceId as string) || "",
                type: (row.cloudResourceType as string) || "",
                relationships: readCloudRelationships(row.cloudRelationships),
              };
            }),
        );
      })
      .catch((err: unknown): void => {
        if (!ignore) {
          setNeighbourError(API.getFriendlyMessage(err));
          setNeighbours([]);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [provider, accountId, resourceId]);

  const groups: Array<CloudConnectionGroup> = useMemo(() => {
    if (!resourceId) {
      return [];
    }

    return groupCloudConnections(
      resolveCloudRelationships({
        resource: {
          id: new ObjectID(resourceId),
          providerResourceId: (resource.providerResourceId as string) || "",
          type: (resource.cloudResourceType as string) || "",
        },
        relationships,
        neighbours: neighbours || [],
      }),
    );
  }, [resourceId, relationships, neighbours]);

  const isListed: boolean = Boolean(resource.inventoriedAt);

  const renderEnd: (relationship: CloudResolvedRelationship) => ReactElement = (
    relationship: CloudResolvedRelationship,
  ): ReactElement => {
    const typeLabel: string = relationship.otherType
      ? getCloudResourceTypeLabel(provider, relationship.otherType)
      : "";

    return (
      <li
        key={`${relationship.direction}-${relationship.kind}-${
          relationship.other?.id.toString() || relationship.otherName
        }`}
        className="min-w-0"
      >
        {relationship.other ? (
          <AppLink
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
              { modelId: relationship.other.id },
            )}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 break-all"
          >
            <span>{relationship.otherName}</span>
          </AppLink>
        ) : (
          <span className="text-sm font-mono text-gray-700 break-all">
            {relationship.otherName}
          </span>
        )}
        {typeLabel ? (
          <span className="ml-2 text-xs text-gray-500">{typeLabel}</span>
        ) : (
          <></>
        )}
      </li>
    );
  };

  const renderPairs: (
    pairs: Record<string, string>,
    mono: boolean,
  ) => ReactElement = (
    pairs: Record<string, string>,
    mono: boolean,
  ): ReactElement => {
    return (
      <dl className="divide-y divide-gray-100">
        {Object.keys(pairs)
          .sort((a: string, b: string): number => {
            return a.localeCompare(b);
          })
          .map((key: string): ReactElement => {
            return (
              <div
                key={key}
                className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3 sm:gap-4"
              >
                <dt className="text-sm text-gray-500 break-all">{key}</dt>
                <dd
                  className={`text-sm text-gray-900 break-all sm:col-span-2 ${
                    mono ? "font-mono" : ""
                  }`}
                >
                  {pairs[key] || "—"}
                </dd>
              </div>
            );
          })}
      </dl>
    );
  };

  const hasConnections: boolean = groups.length > 0;
  const showConnections: boolean =
    isListed || relationships.length > 0 || hasConnections;

  return (
    <>
      {showConnections ? (
        <div className="mt-6">
          <Card
            title="Connected Resources"
            description="What it runs in, is part of and sends traffic to, and what connects to it, as its cloud's inventory lists them."
          >
            {neighbours === null ? (
              <ComponentLoader />
            ) : (
              <div>
                {neighbourError ? (
                  <p className="mb-3 text-sm text-amber-700">
                    {translator.translateText(
                      "The account's other resources could not be read, so only what this resource names is shown.",
                    )}
                  </p>
                ) : (
                  <></>
                )}
                {hasConnections ? (
                  <dl className="divide-y divide-gray-100">
                    {groups.map((group: CloudConnectionGroup): ReactElement => {
                      return (
                        <div
                          key={`${group.direction}-${group.kind}`}
                          className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3 sm:gap-4"
                        >
                          <dt className="text-sm text-gray-500">
                            {translator.translateText(
                              getCloudRelationshipLabel(
                                group.kind,
                                group.direction,
                              ),
                            )}
                          </dt>
                          <dd className="sm:col-span-2">
                            <ul className="space-y-1">
                              {group.relationships.map(renderEnd)}
                            </ul>
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                ) : (
                  <p className="text-sm text-gray-500">
                    {translator.translateText(
                      "Its cloud's inventory lists nothing it is connected to.",
                    )}
                  </p>
                )}
                {neighbours.length < neighbourCount ? (
                  <p className="mt-3 text-xs text-gray-500">
                    {translator.translateTemplate(
                      "The account has {{count}} resources: the first {{shown}} were read to name this one's connections.",
                      {
                        count: translator.formatNumber(neighbourCount),
                        shown: translator.formatNumber(neighbours.length),
                      },
                    )}
                  </p>
                ) : (
                  <></>
                )}
              </div>
            )}
          </Card>
        </div>
      ) : (
        <></>
      )}

      {endpoints.length > 0 ? (
        <div className="mt-6">
          <Card
            title="Endpoints"
            description="The host names and addresses it answers on. A monitor that checks one of them can be linked to it."
          >
            <ul className="space-y-1">
              {endpoints.map((endpoint: string): ReactElement => {
                return (
                  <li
                    key={endpoint}
                    className="text-sm font-mono text-gray-900 break-all"
                  >
                    {endpoint}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      ) : (
        <></>
      )}

      {isListed || Object.keys(tags).length > 0 ? (
        <div className="mt-6">
          <Card
            title="Tags"
            description="Its tags, as its cloud lists them. Label rules and owner rules can match them."
          >
            {Object.keys(tags).length > 0 ? (
              renderPairs(tags, false)
            ) : (
              <p className="text-sm text-gray-500">
                {translator.translateText("It has no tags.")}
              </p>
            )}
          </Card>
        </div>
      ) : (
        <></>
      )}

      {Object.keys(properties).length > 0 ? (
        <div className="mt-6">
          <Card
            title="Configuration"
            description="A few of its settings, as its cloud's inventory lists them. Nothing that can hold a secret is kept."
          >
            {renderPairs(properties, true)}
          </Card>
        </div>
      ) : (
        <></>
      )}
    </>
  );
};

export default CloudResourceInventoryCards;
