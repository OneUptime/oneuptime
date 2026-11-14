import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import {
  OpenStackTopConsumer,
  OpenStackTopConsumers,
} from "Common/Types/OpenStack/OpenStackOverview";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import ResourcePartReadError from "../ResourcePart/ResourcePartReadError";
import ResourcePartRow from "../ResourcePart/ResourcePartRow";
import {
  formatOpenStackBytes,
  formatOpenStackPercent,
} from "../../Pages/OpenStack/Utils/OpenStackFigures";
import {
  OpenStackBusyHypervisor,
  getOpenStackMostAllocatedHypervisors,
} from "../../Pages/OpenStack/Utils/OpenStackServices";

/*
 * Who holds the most: "whose is it?" is the second question about a cloud, after whether
 * it is healthy. What Nova and Cinder say, by project and by host: what is promised, not
 * what is busy, because how busy any of it is takes host or libvirt data. A lost host's
 * numbers are last known, so it is not ranked here, and a list with nothing to rank says
 * nothing.
 */

// A row's figure: never squeezed by a long name beside it, its digits all one width.
export const OPENSTACK_TOP_CONSUMER_VALUE_CLASS_NAME: string =
  "flex-none text-sm font-medium tabular-nums text-gray-700";

// How many a list shows. The server reads no more than this for a project's.
export const OPENSTACK_TOP_CONSUMERS_SHOWN: number = 5;

export interface ComponentProps {
  consumers: OpenStackTopConsumers | null;
  // The hypervisors the page has already read: they are few at any size.
  rows: Array<OpenStackResource>;
  getProjectRoute: (projectId: string) => Route | undefined;
  getHypervisorRoute: (row: OpenStackResource) => Route | undefined;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
}

interface ConsumerRow {
  key: string;
  name: string;
  value: string;
  to?: Route | undefined;
}

interface ConsumerList {
  key: string;
  title: string;
  rows: Array<ConsumerRow>;
}

const OpenStackTopConsumersCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  if (props.error) {
    return (
      <div className="mb-6">
        <ResourcePartReadError
          testId="openstack-top-consumers-error"
          title="Couldn't read who holds the most"
          message={props.error}
          onRetry={props.onRetry || ((): void => {})}
        />
      </div>
    );
  }

  const toProjectRows: (
    consumers: Array<OpenStackTopConsumer> | undefined,
    format: (value: number) => string,
  ) => Array<ConsumerRow> = (
    consumers: Array<OpenStackTopConsumer> | undefined,
    format: (value: number) => string,
  ): Array<ConsumerRow> => {
    return (consumers || []).map(
      (consumer: OpenStackTopConsumer): ConsumerRow => {
        return {
          key: consumer.projectId,
          name: consumer.name || consumer.projectId,
          value: format(consumer.value),
          to: props.getProjectRoute(consumer.projectId),
        };
      },
    );
  };

  const toHypervisorRows: (
    busy: Array<OpenStackBusyHypervisor>,
  ) => Array<ConsumerRow> = (
    busy: Array<OpenStackBusyHypervisor>,
  ): Array<ConsumerRow> => {
    return busy.map((one: OpenStackBusyHypervisor): ConsumerRow => {
      return {
        key: one.row.externalId || one.row.name || "",
        name: one.row.name || one.row.externalId || "",
        value: formatOpenStackPercent(one.percent, {
          language: translator.language,
        }),
        to: props.getHypervisorRoute(one.row),
      };
    });
  };

  const lists: Array<ConsumerList> = [
    {
      key: "projects-instances",
      title: "Projects by instances",
      rows: toProjectRows(
        props.consumers?.projectsByInstances,
        (value: number): string => {
          return translator.formatNumber(value);
        },
      ),
    },
    {
      key: "projects-volumes",
      title: "Projects by volume storage",
      rows: toProjectRows(
        props.consumers?.projectsByVolumeBytes,
        (value: number): string => {
          return formatOpenStackBytes(value, {
            language: translator.language,
          });
        },
      ),
    },
    {
      key: "hypervisors-vcpus",
      title: "Hypervisors by vCPUs allocated",
      rows: toHypervisorRows(
        getOpenStackMostAllocatedHypervisors({
          rows: props.rows,
          kind: "vcpu",
          limit: OPENSTACK_TOP_CONSUMERS_SHOWN,
        }),
      ),
    },
    {
      key: "hypervisors-memory",
      title: "Hypervisors by memory allocated",
      rows: toHypervisorRows(
        getOpenStackMostAllocatedHypervisors({
          rows: props.rows,
          kind: "memory",
          limit: OPENSTACK_TOP_CONSUMERS_SHOWN,
        }),
      ),
    },
  ].filter((list: ConsumerList): boolean => {
    return list.rows.length > 0;
  });

  if (lists.length === 0) {
    return <></>;
  }

  return (
    <div className="mb-6" data-testid="openstack-top-consumers">
      <Card
        title="Top consumers"
        description="Who holds the most of this cloud, as Nova and Cinder report it: what is promised, not how busy it is."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {lists.map((list: ConsumerList): ReactElement => {
            return (
              <div
                key={list.key}
                data-testid="openstack-top-consumers-list"
                data-key={list.key}
                className="min-w-0 overflow-hidden rounded-lg border border-gray-200"
              >
                <h3 className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                  {tx(list.title)}
                </h3>
                <ul className="divide-y divide-gray-100">
                  {list.rows.map((row: ConsumerRow): ReactElement => {
                    return (
                      <li
                        key={row.key}
                        data-testid="openstack-top-consumers-row"
                      >
                        <ResourcePartRow
                          to={row.to}
                          className="flex items-center justify-between gap-3"
                        >
                          <span className="min-w-0 text-sm text-gray-900 [overflow-wrap:anywhere]">
                            <bdi>
                              <BreakableName text={row.name} />
                            </bdi>
                          </span>
                          {/*
                           * A figure reads its own way: a size keeps its
                           * number before its unit on a page read from the
                           * right ("۶٫۰ TiB", not "TiB ۶٫۰"), in the
                           * reader's digits (issue #7191).
                           */}
                          <IsolatedText
                            text={row.value}
                            className={OPENSTACK_TOP_CONSUMER_VALUE_CLASS_NAME}
                            dataTestId="openstack-top-consumers-value"
                          />
                        </ResourcePartRow>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

export default OpenStackTopConsumersCard;
