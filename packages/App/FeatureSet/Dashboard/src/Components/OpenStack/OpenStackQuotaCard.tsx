import Card from "Common/UI/Components/Card/Card";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { OpenStackProjectQuota } from "Common/Types/OpenStack/OpenStackQuota";
import React, { FunctionComponent, ReactElement } from "react";
import { OPENSTACK_QUOTA_TITLES } from "../../Pages/OpenStack/Utils/OpenStackHealth";

/*
 * What a project may use and has used, or how to start reading that. Most clouds do not
 * read it, since it costs a call per project on every scrape, so a page with no quota
 * data says what turning it on gives and costs rather than looking empty.
 */

export const OPENSTACK_QUOTA_DISABLE_FLAGS: ReadonlyArray<string> = [
  "--disable-metric=nova-limits_vcpus_max",
  "--disable-metric=cinder-limits_volume_max_gb",
  "--disable-metric=neutron-quota_network",
];

// Nova one, Cinder two and Neutron one, for each project, on each scrape.
export const OPENSTACK_QUOTA_CALLS_PER_PROJECT: number = 4;

export interface SetupProps {
  // How many projects the reader's cloud has, so the cost is its own.
  projectCount?: number | undefined;
}

export const OpenStackQuotaSetup: FunctionComponent<SetupProps> = (
  props: SetupProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      data-testid="openstack-quota-setup"
      className="space-y-3 px-4 py-3 text-sm text-gray-700"
    >
      <p>
        {translator.translateText(
          "Quotas are not being read. With them on, this page shows how much of each quota a project has used, and a project at 90% of one appears under Needs attention.",
        )}
      </p>
      <p data-testid="openstack-quota-cost">
        {props.projectCount
          ? translator.translateTemplate(
              "They are off by default because of what they cost: four API calls per project on every read (Nova one, Cinder two, Neutron one), which is {{calls}} calls on this cloud.",
              {
                calls: translator.formatNumber(
                  props.projectCount * OPENSTACK_QUOTA_CALLS_PER_PROJECT,
                ),
              },
            )
          : translator.translateText(
              "They are off by default because of what they cost: four API calls per project on every read (Nova one, Cinder two, Neutron one).",
            )}
      </p>
      <div>
        <p>
          {translator.translateText(
            "To turn them on, delete these lines from the exporter's command in the agent's docker-compose.yml, or from ExecStart in oneuptime-openstack-exporter.service without Docker, then restart the exporter:",
          )}
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-gray-50 p-3 font-mono text-xs text-gray-800">
          <bdi>{OPENSTACK_QUOTA_DISABLE_FLAGS.join("\n")}</bdi>
        </pre>
      </div>
    </div>
  );
};

export interface ComponentProps {
  quotas: Array<OpenStackProjectQuota>;
  projectCount?: number | undefined;
}

function barClassName(quota: OpenStackProjectQuota): string {
  if (quota.isStale) {
    return "bg-gray-300";
  }
  return quota.isAtLine ? "bg-amber-500" : "bg-indigo-500";
}

const OpenStackQuotaCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const regions: Set<string> = new Set<string>(
    props.quotas.map((quota: OpenStackProjectQuota): string => {
      return quota.regionName;
    }),
  );
  const isStale: boolean = props.quotas.some(
    (quota: OpenStackProjectQuota): boolean => {
      return quota.isStale;
    },
  );

  const amountOf: (quota: OpenStackProjectQuota) => string = (
    quota: OpenStackProjectQuota,
  ): string => {
    const used: string = translator.formatNumber(quota.used);

    // -1 is OpenStack's word for no limit, and it is never a share of anything.
    if (quota.limit < 0) {
      return translator.translateTemplate("{{used}}, no limit", { used });
    }

    return translator.translateTemplate("{{used}} of {{limit}}", {
      used,
      limit: translator.formatNumber(quota.limit),
    });
  };

  return (
    <Card
      title="Quotas"
      description="What this project may use and has used. One at 90% or past it is marked, because its next instance or volume is about to be refused."
    >
      {props.quotas.length === 0 ? (
        <OpenStackQuotaSetup projectCount={props.projectCount} />
      ) : (
        <div data-testid="openstack-quotas">
          {isStale ? (
            <p
              data-testid="openstack-quotas-stale"
              className="px-4 py-3 text-sm text-amber-800"
            >
              {translator.translateText(
                "These were last read more than three hours ago, so nothing is marked on them. Quotas may have been turned off.",
              )}
            </p>
          ) : null}
          <ul className="divide-y divide-gray-100">
            {props.quotas.map((quota: OpenStackProjectQuota): ReactElement => {
              const percent: number | null = quota.percent;

              return (
                <li
                  key={`${quota.resource}/${quota.regionName}`}
                  data-testid={`openstack-quota-${quota.resource}`}
                  data-at-line={quota.isAtLine ? "true" : "false"}
                  className="px-4 py-3 text-sm"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="font-medium text-gray-900">
                      {translator.translateText(
                        OPENSTACK_QUOTA_TITLES[quota.resource],
                      )}
                      {regions.size > 1 ? (
                        <span className="ms-2 text-gray-500">
                          <bdi>{quota.regionName}</bdi>
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={
                        quota.isAtLine
                          ? "font-medium text-amber-700"
                          : "text-gray-600"
                      }
                    >
                      {amountOf(quota)}
                    </span>
                  </div>
                  {percent !== null ? (
                    <div
                      aria-hidden={true}
                      className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
                    >
                      <div
                        className={`h-full rounded-full ${barClassName(quota)}`}
                        style={{ width: `${Math.min(100, percent)}%` }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
};

export default OpenStackQuotaCard;
