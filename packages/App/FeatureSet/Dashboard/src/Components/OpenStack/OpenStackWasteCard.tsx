import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { OpenStackSpendSnapshot } from "Common/Types/OpenStack/OpenStackSpendSnapshot";
import {
  OPENSTACK_WASTE_CANNOT_TELL_TEXT,
  OPENSTACK_WASTE_RULES,
  OpenStackWasteFinding,
  OpenStackWasteFrees,
  OpenStackWasteItem,
  OpenStackWasteRuleId,
} from "Common/Types/OpenStack/OpenStackWaste";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
} from "./Part/OpenStackPartRoutes";
import {
  formatOpenStackSpendMoney,
  formatOpenStackUsageNumber,
} from "../../Pages/OpenStack/Utils/OpenStackSpendView";
import { joinList } from "Common/UI/Utils/ListSeparator";

/*
 * WHAT COULD BE RECLAIMED, AS RECOMMENDATIONS.
 *
 * Each rule says what it found, what that would free, and the command that lists it, so a person
 * can see it for themselves. Nothing here does anything, and nothing on this page can. What a rule
 * finds is a question for its owner: a volume nobody's attached may be a backup someone needs. A rule
 * that can't be sure on this cloud says so, rather than naming what might be in use.
 */

const KIND_OF_RULE: Readonly<
  Record<OpenStackWasteRuleId, OpenStackResourceKind>
> = {
  [OpenStackWasteRuleId.UnattachedVolume]: OpenStackResourceKind.Volume,
  [OpenStackWasteRuleId.SpareFloatingIp]: OpenStackResourceKind.FloatingIp,
  [OpenStackWasteRuleId.ShutOffInstance]: OpenStackResourceKind.Instance,
  [OpenStackWasteRuleId.UnusedImage]: OpenStackResourceKind.Image,
  [OpenStackWasteRuleId.OldSnapshot]: OpenStackResourceKind.Snapshot,
  [OpenStackWasteRuleId.MovableHost]: OpenStackResourceKind.Hypervisor,
};

// What a rule would free, in a person's words. What it can't size is simply not said.
export function getOpenStackWasteFreesText(data: {
  frees: OpenStackWasteFrees;
  translator: Translator;
}): string {
  const { frees, translator } = data;
  const parts: Array<string> = [];
  const number: (value: number) => string = (value: number): string => {
    return formatOpenStackUsageNumber(value, translator);
  };

  if (frees.hosts > 0) {
    parts.push(
      translator.translatePlural(
        { one: "{{count}} host", other: "{{count}} hosts" },
        frees.hosts,
      ),
    );
  }
  if (frees.vcpus > 0) {
    parts.push(
      translator.translatePlural(
        { one: "{{count}} vCPU", other: "{{count}} vCPUs" },
        frees.vcpus,
      ),
    );
  }
  if (frees.memoryGb > 0) {
    parts.push(
      translator.translateTemplate(translationKey("{{count}} GB of memory"), {
        count: number(frees.memoryGb),
      }),
    );
  }
  if (frees.diskGb > 0) {
    parts.push(
      translator.translateTemplate(
        translationKey("{{count}} GB of local disk"),
        { count: number(frees.diskGb) },
      ),
    );
  }
  if (frees.storageGb > 0) {
    parts.push(
      translator.translateTemplate(translationKey("{{count}} GB of storage"), {
        count: number(frees.storageGb),
      }),
    );
  }
  if (frees.floatingIps > 0) {
    parts.push(
      translator.translatePlural(
        { one: "{{count}} floating IP", other: "{{count}} floating IPs" },
        frees.floatingIps,
      ),
    );
  }

  return joinList(parts);
}

const OpenStackWasteRule: FunctionComponent<{
  finding: OpenStackWasteFinding;
  currency: string | null;
  routes: OpenStackPartRoutes;
}> = (props: {
  finding: OpenStackWasteFinding;
  currency: string | null;
  routes: OpenStackPartRoutes;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const { finding, routes } = props;
  const words: (typeof OPENSTACK_WASTE_RULES)[OpenStackWasteRuleId] =
    OPENSTACK_WASTE_RULES[finding.rule];
  const kind: OpenStackResourceKind = KIND_OF_RULE[finding.rule];
  const frees: string = getOpenStackWasteFreesText({
    frees: finding.frees,
    translator,
  });

  return (
    <div
      className="border-t border-gray-100 py-4 first:border-t-0 first:pt-0 last:pb-0"
      data-testid="openstack-waste-rule"
      data-rule={finding.rule}
      data-count={finding.count}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-medium text-gray-900">
          {translator.translateText(words.title)}
        </h3>
        {finding.count > 0 ? (
          <span
            className="text-sm font-medium text-gray-900"
            data-testid="openstack-waste-count"
          >
            {translator.translateTemplate(
              finding.isPartial
                ? translationKey("At least {{count}}")
                : translationKey("{{count}} found"),
              { count: finding.count.toLocaleString() },
            )}
          </span>
        ) : (
          <></>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-600">
        {translator.translateText(words.description)}
      </p>

      {finding.cannotTell ? (
        <p
          className="mt-2 text-sm text-gray-600"
          data-testid="openstack-waste-cannot-tell"
        >
          {translator.translateText(
            OPENSTACK_WASTE_CANNOT_TELL_TEXT[finding.cannotTell],
          )}
        </p>
      ) : finding.count === 0 ? (
        <p
          className="mt-2 inline-flex items-center gap-1 text-sm text-emerald-700"
          data-testid="openstack-waste-nothing"
        >
          <Icon icon={IconProp.CheckCircle} className="h-4 w-4" />
          {translator.translateText(translationKey("Nothing found."))}
        </p>
      ) : (
        <>
          <p
            className="mt-2 text-sm text-gray-900"
            data-testid="openstack-waste-frees"
          >
            {frees
              ? translator.translateTemplate(
                  translationKey("Would free {{what}}."),
                  { what: frees },
                )
              : ""}{" "}
            {finding.monthlyAmount !== null
              ? translator.translateTemplate(
                  translationKey("About {{amount}} a month at your prices."),
                  {
                    amount: formatOpenStackSpendMoney({
                      amount: finding.monthlyAmount,
                      currency: props.currency,
                      translator,
                    }),
                  },
                )
              : ""}
          </p>
          <pre
            className="mt-2 overflow-x-auto rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-800"
            data-testid="openstack-waste-command"
          >
            <code>{words.command}</code>
          </pre>
          <button
            type="button"
            className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            aria-expanded={isOpen}
            data-testid="openstack-waste-toggle"
            onClick={() => {
              setIsOpen(!isOpen);
            }}
          >
            {translator.translateText(
              isOpen
                ? translationKey("Hide what it found")
                : translationKey("Show what it found"),
            )}
          </button>
          {isOpen ? (
            <ul className="mt-2 divide-y divide-gray-100 text-sm">
              {finding.items.map((item: OpenStackWasteItem): ReactElement => {
                const route: Route | undefined =
                  finding.rule === OpenStackWasteRuleId.MovableHost
                    ? routes.getHypervisorRoute(item.regionName, item.id)
                    : routes.getPartRoute(kind, item.id);

                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap justify-between gap-x-4 py-2"
                    data-testid="openstack-waste-item"
                    data-item={item.name || item.id}
                  >
                    {route ? (
                      <Link
                        to={route}
                        className="break-all font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                      >
                        <bdi>{item.name || item.id}</bdi>
                      </Link>
                    ) : (
                      <bdi className="break-all font-medium text-gray-900">
                        {item.name || item.id}
                      </bdi>
                    )}
                    <span className="text-gray-500">
                      {item.since
                        ? translator.translateTemplate(
                            translationKey("Since {{date}}"),
                            {
                              date: new Date(item.since).toLocaleDateString(),
                            },
                          )
                        : item.instanceCount !== undefined
                          ? translator.translateTemplate(
                              translationKey("{{count}} instances to move"),
                              { count: item.instanceCount.toString() },
                            )
                          : ""}
                    </span>
                  </li>
                );
              })}
              {finding.count > finding.items.length ? (
                <li className="py-2 text-gray-500">
                  {translator.translateTemplate(
                    translationKey(
                      "And {{count}} more. The command above lists them all.",
                    ),
                    {
                      count: (
                        finding.count - finding.items.length
                      ).toLocaleString(),
                    },
                  )}
                </li>
              ) : (
                <></>
              )}
            </ul>
          ) : (
            <></>
          )}
        </>
      )}
    </div>
  );
};

export interface ComponentProps {
  openStackCloudId: ObjectID;
  snapshot: OpenStackSpendSnapshot;
}

const OpenStackWasteCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const routes: OpenStackPartRoutes = getOpenStackPartRoutes(
    props.openStackCloudId,
  );
  const findings: Array<OpenStackWasteFinding> = props.snapshot.waste || [];

  return (
    <Card
      title={translationKey("What Could Be Reclaimed")}
      description={translationKey(
        "What's been sitting unused, what it would free, and the command that lists it. OneUptime never removes anything. Each of these is for its owner to decide, and what's in use is never named.",
      )}
    >
      <div data-testid="openstack-waste">
        {findings.length === 0 ? (
          <p className="text-sm text-gray-600">
            <span data-testid="openstack-waste-not-yet">
              {translator.translateText(
                translationKey(
                  "These are checked once an hour, and haven't been yet.",
                ),
              )}
            </span>
          </p>
        ) : (
          findings.map((finding: OpenStackWasteFinding): ReactElement => {
            return (
              <OpenStackWasteRule
                key={finding.rule}
                finding={finding}
                currency={props.snapshot.currency}
                routes={routes}
              />
            );
          })
        )}
      </div>
    </Card>
  );
};

export default OpenStackWasteCard;
