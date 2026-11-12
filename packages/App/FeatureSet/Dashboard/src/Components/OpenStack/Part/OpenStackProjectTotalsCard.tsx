import ObjectID from "Common/Types/ObjectID";
import { OpenStackCountRow } from "Common/Types/OpenStack/OpenStackCounts";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { fetchOpenStackNames } from "../../../Pages/OpenStack/Utils/OpenStackPartData";
import { formatOpenStackBytes } from "../OpenStackResourceList";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
} from "./OpenStackPartRoutes";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * What each project holds of something, counted on the server. Most-holding first, a step
 * from the project's page. Draws nothing with nothing to say: an agent's cloud has no rows
 * of these, and the page says why.
 */
export const OPENSTACK_PROJECT_TOTALS_SHOWN: number = 20;

export interface ComponentProps {
  testId: string;
  title: string;
  description: string;
  openStackCloudId: ObjectID;
  rows: Array<OpenStackCountRow> | null;
}

const OpenStackProjectTotalsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();

  const routes: OpenStackPartRoutes = useMemo(() => {
    return getOpenStackPartRoutes(props.openStackCloudId);
  }, [props.openStackCloudId.toString()]);

  const shown: Array<OpenStackCountRow> = (props.rows || []).slice(
    0,
    OPENSTACK_PROJECT_TOTALS_SHOWN,
  );

  const names: OpenStackRead<Record<string, string>> = useOpenStackRead<
    Record<string, string>
  >(() => {
    return fetchOpenStackNames({
      openStackCloudId: props.openStackCloudId,
      kind: OpenStackResourceKind.Project,
      externalIds: shown
        .map((row: OpenStackCountRow): string => {
          return row.value || "";
        })
        .filter((value: string): boolean => {
          return Boolean(value);
        }),
    });
  }, [
    props.openStackCloudId.toString(),
    shown
      .map((row: OpenStackCountRow): string => {
        return row.value || "";
      })
      .join(","),
  ]);

  if (shown.length === 0) {
    return <></>;
  }

  return (
    <div className="mb-6" data-testid={props.testId}>
      <Card title={props.title} description={props.description}>
        <ul className={listClassName}>
          {shown.map((row: OpenStackCountRow): ReactElement => {
            const projectId: string = row.value || "";
            return (
              <li
                key={`${row.regionName || ""}/${projectId}`}
                data-testid={`${props.testId}-row`}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm md:px-6"
              >
                {projectId ? (
                  <Link
                    to={routes.getPartRoute(
                      OpenStackResourceKind.Project,
                      projectId,
                    )}
                    className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                  >
                    <bdi>{names.data?.[projectId] || projectId}</bdi>
                  </Link>
                ) : (
                  <span className="font-medium text-gray-700">
                    {translator.translateText("No project reported")}
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  {translator.translatePlural(
                    {
                      one: "{{count}} item, {{size}}",
                      other: "{{count}} items, {{size}}",
                    },
                    row.count,
                    {
                      size: formatOpenStackBytes(row.sizeBytes, {
                        language: translator.language,
                      }),
                    },
                    // "۶٫۰ TiB" keeps its number first in a Persian sentence (issue #7191).
                    { setsValuesApart: true },
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
};

export default OpenStackProjectTotalsCard;
