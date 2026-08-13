import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import AppLink from "../AppLink/AppLink";
import IconProp from "Common/Types/Icon/IconProp";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import TelemetryEntityRelationship from "Common/Models/DatabaseModels/TelemetryEntityRelationship";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import { InventoryTypeBadge } from "./InventoryBadges";
import {
  RelationshipDirection,
  getRelationshipPhrase,
} from "./InventoryRelationshipLabels";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * "What is this connected to?" — both directions of the relationship graph
 * for one inventory item.
 *
 * Edges are queried from both ends and every other-end key is batch-resolved
 * to its registry row, so rows read as "runs on **checkout-7d9f**" rather
 * than as a pair of 16-hex hashes. An edge whose other end has no row (it was
 * pruned, or the edge outlived it) still renders, showing the raw key — the
 * connection is real even when we can no longer name what is on the far side.
 */

interface RelationshipRow {
  direction: RelationshipDirection;
  relationshipType: string;
  otherEntityKey: string;
  lastSeenAt?: Date | undefined;
}

export interface ComponentProps {
  entityKey: string;
  /** Rendered inside a Card unless the page supplies its own. */
  showCard?: boolean | undefined;
}

const InventoryRelationships: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rows, setRows] = useState<Array<RelationshipRow>>([]);
  const [relatedByKey, setRelatedByKey] = useState<
    Record<string, TelemetryEntity>
  >({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

        const [outgoing, incoming]: [
          ListResult<TelemetryEntityRelationship>,
          ListResult<TelemetryEntityRelationship>,
        ] = await Promise.all([
          ModelAPI.getList<TelemetryEntityRelationship>({
            modelType: TelemetryEntityRelationship,
            query: { projectId, fromEntityKey: props.entityKey },
            select: {
              fromEntityKey: true,
              toEntityKey: true,
              relationshipType: true,
              lastSeenAt: true,
            },
            sort: { lastSeenAt: SortOrder.Descending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          }),
          ModelAPI.getList<TelemetryEntityRelationship>({
            modelType: TelemetryEntityRelationship,
            query: { projectId, toEntityKey: props.entityKey },
            select: {
              fromEntityKey: true,
              toEntityKey: true,
              relationshipType: true,
              lastSeenAt: true,
            },
            sort: { lastSeenAt: SortOrder.Descending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          }),
        ]);

        const collected: Array<RelationshipRow> = [];

        for (const rel of outgoing.data) {
          if (!rel.toEntityKey) {
            continue;
          }

          collected.push({
            direction: "outgoing",
            relationshipType: rel.relationshipType || "",
            otherEntityKey: rel.toEntityKey,
            lastSeenAt: rel.lastSeenAt,
          });
        }

        for (const rel of incoming.data) {
          if (!rel.fromEntityKey) {
            continue;
          }

          collected.push({
            direction: "incoming",
            relationshipType: rel.relationshipType || "",
            otherEntityKey: rel.fromEntityKey,
            lastSeenAt: rel.lastSeenAt,
          });
        }

        const otherKeys: Array<string> = Array.from(
          new Set(
            collected.map((row: RelationshipRow): string => {
              return row.otherEntityKey;
            }),
          ),
        );

        const resolved: Record<string, TelemetryEntity> = {};

        if (otherKeys.length > 0) {
          const entities: ListResult<TelemetryEntity> =
            await ModelAPI.getList<TelemetryEntity>({
              modelType: TelemetryEntity,
              query: { projectId, entityKey: new Includes(otherKeys) },
              select: {
                _id: true,
                entityKey: true,
                displayName: true,
                entityType: true,
              },
              sort: {},
              skip: 0,
              limit: LIMIT_PER_PROJECT,
            });

          for (const related of entities.data) {
            if (related.entityKey) {
              resolved[related.entityKey] = related;
            }
          }
        }

        setRows(collected);
        setRelatedByKey(resolved);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

    void load();
  }, [props.entityKey]);

  type RenderBodyFunction = () => ReactElement;

  const renderBody: RenderBodyFunction = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (rows.length === 0) {
      return (
        <p className="text-sm text-gray-500">
          Nothing is connected to this item yet. Connections are worked out from
          telemetry that mentions two things at once — a span that names both a
          service and the pod it ran on, for example.
        </p>
      );
    }

    return (
      <ul
        data-testid="inventory-relationship-rows"
        className="divide-y divide-gray-100"
      >
        {rows.map((row: RelationshipRow, index: number): ReactElement => {
          const related: TelemetryEntity | undefined =
            relatedByKey[row.otherEntityKey];
          const label: string =
            related?.displayName || row.otherEntityKey.substring(0, 16);

          return (
            <li
              key={`${row.direction}-${row.relationshipType}-${row.otherEntityKey}-${index}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 py-3"
            >
              <Icon
                icon={
                  row.direction === "outgoing"
                    ? IconProp.ArrowRight
                    : IconProp.ArrowLeft
                }
                size={SizeProp.Smaller}
                className="h-4 w-4 shrink-0 text-gray-400"
              />
              <span className="text-sm text-gray-500">
                {getRelationshipPhrase(row.relationshipType, row.direction)}
              </span>
              {related?._id ? (
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.INVENTORY_VIEW] as Route,
                    { modelId: new ObjectID(related._id.toString()) },
                  )}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {label}
                </AppLink>
              ) : (
                <span className="font-mono text-sm text-gray-700">{label}</span>
              )}
              {related?.entityType ? (
                <InventoryTypeBadge entityType={related.entityType} />
              ) : null}
              <span className="ml-auto text-xs text-gray-400">
                {row.lastSeenAt
                  ? OneUptimeDate.getDateAsLocalFormattedString(row.lastSeenAt)
                  : ""}
              </span>
            </li>
          );
        })}
      </ul>
    );
  };

  if (props.showCard === false) {
    return renderBody();
  }

  return (
    <Card
      title="Connections"
      description="What this item runs on, belongs to and depends on — worked out from your telemetry. Both directions are shown."
    >
      {renderBody()}
    </Card>
  );
};

export default InventoryRelationships;
