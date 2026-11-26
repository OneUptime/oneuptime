import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  StorageArrayCollectionArraySummary,
  StorageArrayCollectionSummary,
} from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import { PowerMaxKind } from "Common/Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxSeries";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Includes from "Common/Types/BaseDatabase/Includes";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  PerformanceState,
  getArrayLine,
  getPerformanceState,
  getPerformanceWords,
} from "./StorageArrayConnectionView";

/*
 * The arrays behind a storage array connection (#11004), as its last
 * collection found them: each local array with its model and version, how
 * many storage groups and volumes it has, whether Unisphere collects its
 * performance (and in real time for which storage groups), what could not
 * be read, and a link to it in Storage Arrays. Remote arrays - the ones
 * this Unisphere sees through SRDF - say where they are collected instead.
 */

export interface ComponentProps {
  storageSystem: string;
  summary: StorageArrayCollectionSummary | null | undefined;
}

function performanceTone(array: StorageArrayCollectionArraySummary): PillTone {
  switch (getPerformanceState(array)) {
    case PerformanceState.On:
    case PerformanceState.RealTime:
      return PillTone.Success;
    case PerformanceState.Off:
      return PillTone.Warning;
    default:
      return PillTone.Neutral;
  }
}

const StorageArrayConnectionArraysCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [arraysById, setArraysById] = useState<Map<string, StorageArray>>(
    new Map(),
  );

  const arrays: Array<StorageArrayCollectionArraySummary> = [
    ...(props.summary?.arrays || []),
  ].sort(
    (
      a: StorageArrayCollectionArraySummary,
      b: StorageArrayCollectionArraySummary,
    ): number => {
      return Number(b.isLocal) - Number(a.isLocal) || a.id.localeCompare(b.id);
    },
  );
  const localIds: Array<string> = arrays
    .filter((array: StorageArrayCollectionArraySummary): boolean => {
      return array.isLocal;
    })
    .map((array: StorageArrayCollectionArraySummary): string => {
      return array.id;
    });

  // The arrays' rows in Storage Arrays, by their own identifier.
  useEffect(() => {
    if (localIds.length === 0) {
      return;
    }
    ModelAPI.getList<StorageArray>({
      modelType: StorageArray,
      query: {
        storageSystem: props.storageSystem,
        systemId: new Includes(localIds),
      },
      select: {
        _id: true,
        name: true,
        systemId: true,
      },
      limit: localIds.length * 2,
      skip: 0,
      sort: {},
    })
      .then((result: ListResult<StorageArray>) => {
        const map: Map<string, StorageArray> = new Map();
        for (const array of result.data) {
          if (array.systemId && !map.has(array.systemId)) {
            map.set(array.systemId, array);
          }
        }
        setArraysById(map);
      })
      .catch(() => {
        // The card still lists the arrays, without their links.
      });
  }, [localIds.join(",")]);

  return (
    <Card
      title="Arrays"
      description="Every array this Unisphere manages, as the last collection found it. Each local array appears in Storage Arrays under its Symmetrix ID."
    >
      {arrays.length === 0 ? (
        <EmptyState
          id="storage-array-connection-arrays-empty"
          icon={IconProp.StorageArray}
          title="No arrays yet"
          description="The arrays appear here, and in Storage Arrays, after the probe's first collection."
        />
      ) : (
        <ul
          className="divide-y divide-gray-200"
          data-testid="storage-array-connection-arrays"
        >
          {arrays.map((array: StorageArrayCollectionArraySummary) => {
            const row: StorageArray | undefined = arraysById.get(array.id);
            const route: Route | null = row?._id
              ? RouteUtil.populateRouteParams(
                  RouteMap[PageMap.STORAGE_ARRAY_VIEW] as Route,
                  { modelId: new ObjectID(row._id.toString()) },
                )
              : null;
            const storageGroups: number | undefined =
              array.counts[PowerMaxKind.StorageGroup];
            const volumes: number | undefined =
              array.counts[StorageArrayResourceKind.Volume];
            return (
              <li key={array.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon
                        icon={IconProp.StorageArray}
                        className="h-4 w-4 flex-none text-gray-500"
                      />
                      {route ? (
                        <AppLink
                          to={route}
                          className="text-sm font-medium text-gray-900 hover:underline"
                        >
                          {row?.name || array.id}
                        </AppLink>
                      ) : (
                        <span className="text-sm font-medium text-gray-900">
                          {array.id}
                        </span>
                      )}
                      {row?.name && row.name !== array.id ? (
                        <span className="font-mono text-xs text-gray-500">
                          {array.id}
                        </span>
                      ) : (
                        <></>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {[
                        getArrayLine(array),
                        array.isLocal && storageGroups !== undefined
                          ? translator.translatePlural(
                              {
                                one: "{{count}} storage group",
                                other: "{{count}} storage groups",
                              },
                              storageGroups,
                            )
                          : "",
                        array.isLocal && volumes !== undefined
                          ? translator.translatePlural(
                              {
                                one: "{{count}} volume",
                                other: "{{count}} volumes",
                              },
                              volumes,
                            )
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  {array.isLocal ? (
                    <Pill
                      text={getPerformanceWords(array, translator)}
                      isUserContent={true}
                      tone={performanceTone(array)}
                    />
                  ) : (
                    <Pill
                      text={
                        translator.translateText(
                          "Remote: not collected here",
                        ) as string
                      }
                      isUserContent={true}
                      tone={PillTone.Neutral}
                    />
                  )}
                </div>
                {array.warnings.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-gray-600">
                    {array.warnings.map((warning: string) => {
                      return (
                        <li key={warning} className="flex items-start gap-1.5">
                          <Icon
                            icon={IconProp.Info}
                            className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-600"
                          />
                          <span className="break-words">{warning}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};

export default StorageArrayConnectionArraysCard;
