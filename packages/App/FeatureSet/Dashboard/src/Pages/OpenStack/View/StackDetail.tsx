import { JSONObject, JSONValue } from "Common/Types/JSON";
import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { OpenStackBlastRadius } from "Common/Types/OpenStack/OpenStackBlastRadius";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Link from "Common/UI/Components/Link/Link";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import {
  OpenStackPartAlerts,
  OpenStackPartOpenEvents,
} from "../../../Components/OpenStack/Part/OpenStackPartActivity";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../../../Components/ResourcePart/ResourceAttention";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import { getOpenStackAttentionItems } from "../Utils/OpenStackHealth";
import {
  fetchOpenStackBlastRadius,
  fetchOpenStackNames,
} from "../Utils/OpenStackPartData";
import {
  OPENSTACK_STACK_ALERT_TEMPLATE_IDS,
  getOpenStackPartExplanation,
  getOpenStackTimeInState,
} from "../Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * One Heat stack: its status in Heat's word, whose it is, and the Kubernetes cluster it was built
 * for when Magnum built it. Why it failed is only known to a probe, which reads it from Heat; the
 * agent's exporter never asks, so the page says what to run instead. So is which instances and
 * volumes it owns, which is one more read of each stack, and where nothing has read it the page says
 * what to run for that too.
 */

const WHY_NOT_KNOWN: string = translationKey(
  "The agent's exporter doesn't read why a stack failed. Run openstack stack failures list for this stack, or collect this cloud with a probe, which reads it from Heat.",
);

const WHAT_IT_OWNS_NOT_KNOWN: string = translationKey(
  "Nothing has read which instances and volumes this stack owns. Run openstack stack resource list for this stack. A probe reads it from Heat where its credential may, and the agent's exporter doesn't.",
);

const NO_PROJECT_DESCRIPTION: string = translationKey(
  "Heat only says whose a stack is to an admin. This credential sees its own project's stacks with no project on them.",
);

const StackOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: { part: OpenStackPart; row: OpenStackResource }): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();
  const { part, row } = props;
  const now: Date = OneUptimeDate.getCurrentDate();

  const radius: OpenStackRead<OpenStackBlastRadius> =
    useOpenStackRead<OpenStackBlastRadius>(() => {
      return fetchOpenStackBlastRadius({
        openStackCloudId: part.openStackCloudId,
        kind: OpenStackResourceKind.Stack,
        externalId: part.externalId,
      });
    }, [part.externalId, part.refreshToken]);

  const facts: JSONObject = (row.facts as JSONObject | undefined) || {};
  const ownedInstanceIds: JSONValue | undefined = facts["ownedInstanceIds"];
  const ownedVolumeIds: JSONValue | undefined = facts["ownedVolumeIds"];
  const listedInstances: Array<string> = Array.isArray(ownedInstanceIds)
    ? (ownedInstanceIds as Array<string>)
    : [];
  const listedVolumes: Array<string> = Array.isArray(ownedVolumeIds)
    ? (ownedVolumeIds as Array<string>)
    : [];
  // More than a label has room for: see the scan.
  const ownedInstanceCount: number = Math.max(
    Number(facts["ownedInstanceCount"]) || 0,
    listedInstances.length,
  );
  const ownedVolumeCount: number = Math.max(
    Number(facts["ownedVolumeCount"]) || 0,
    listedVolumes.length,
  );
  const notListed: number =
    ownedInstanceCount +
    ownedVolumeCount -
    listedInstances.length -
    listedVolumes.length;

  const owned: OpenStackRead<{
    instances: Record<string, string>;
    volumes: Record<string, string>;
  }> = useOpenStackRead(async () => {
    const [instances, volumes]: [
      Record<string, string>,
      Record<string, string>,
    ] = await Promise.all([
      fetchOpenStackNames({
        openStackCloudId: part.openStackCloudId,
        kind: OpenStackResourceKind.Instance,
        externalIds: listedInstances,
      }),
      fetchOpenStackNames({
        openStackCloudId: part.openStackCloudId,
        kind: OpenStackResourceKind.Volume,
        externalIds: listedVolumes,
      }),
    ]);
    return { instances, volumes };
  }, [listedInstances.join(","), listedVolumes.join(","), part.refreshToken]);

  const attention: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: [row],
    now,
    routeFor: part.routes.routeFor,
  });

  const explanation: string | null = getOpenStackPartExplanation(row, now);
  const reason: string = getOpenStackFactText(row, "statusReason");

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "id",
      label: "Stack ID",
      value: part.externalId,
      mono: true,
      copyText: part.externalId,
    },
  ];
  if (row.status) {
    detailRows.push({
      key: "status",
      label: "Status",
      value: row.status,
      description: "The stack's status in Heat's own word.",
    });
  }
  if (reason) {
    detailRows.push({
      key: "reason",
      label: "Why",
      value: <bdi>{reason}</bdi>,
      description:
        "What Heat recorded about its last action, in its own words.",
    });
  }
  for (const owner of radius.data?.belongsTo || []) {
    detailRows.push({
      key: `belongs-to-${owner.externalId}`,
      label: "Built for",
      value: (
        <Link
          to={part.routes.getPartRoute(
            OpenStackResourceKind.ContainerCluster,
            owner.externalId,
          )}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          <bdi>{owner.name || owner.externalId}</bdi>
        </Link>
      ),
      description:
        "The Kubernetes cluster Magnum built this stack for. A failure here is a failure of that cluster.",
    });
  }
  detailRows.push(
    row.openStackProjectId
      ? {
          key: "project",
          label: "Project",
          value: (
            <Link
              to={part.routes.getPartRoute(
                OpenStackResourceKind.Project,
                row.openStackProjectId,
              )}
              className="text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              <bdi>{row.openStackProjectId}</bdi>
            </Link>
          ),
        }
      : {
          key: "project",
          label: "Project",
          value: "—",
          description: NO_PROJECT_DESCRIPTION,
        },
  );
  if (row.regionName) {
    detailRows.push({ key: "region", label: "Region", value: row.regionName });
  }

  const ownedRow: (data: {
    id: string;
    kind: OpenStackResourceKind;
    label: string;
    name: string | undefined;
  }) => ReactElement = (data: {
    id: string;
    kind: OpenStackResourceKind;
    label: string;
    name: string | undefined;
  }): ReactElement => {
    return (
      <li
        key={`${data.kind}-${data.id}`}
        data-testid="openstack-stack-owns-item"
        className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm md:px-6"
      >
        <span className="text-xs text-gray-500">
          {translator.translateText(data.label)}
        </span>
        <Link
          to={part.routes.getPartRoute(data.kind, data.id)}
          className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          <bdi>{data.name || data.id}</bdi>
        </Link>
      </li>
    );
  };

  return (
    <div data-testid="openstack-stack-overview">
      {explanation ? (
        <OpenStackPartNotice
          testId="openstack-stack-explanation"
          tone="warning"
          text={explanation}
        />
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId="openstack-stack-attention"
        items={attention}
        current={{
          key: `${OpenStackResourceKind.Stack}/${part.externalId}`,
          label: translationKey("This stack"),
        }}
        description="What about this stack is broken or needs a look."
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        data-testid="openstack-stack-tiles"
      >
        <GoldenMetricTile
          title="In state for"
          icon={IconProp.Clock}
          iconColor="slate"
          value={getOpenStackTimeInState(row, now) || "—"}
          description="How long since OneUptime saw this stack's status change. One already in this state when OneUptime first saw it counts from then."
        />
      </div>

      {attention.length > 0 && !reason ? (
        <OpenStackPartNotice
          testId="openstack-stack-why-not-known"
          text={WHY_NOT_KNOWN}
        />
      ) : (
        <></>
      )}

      <OpenStackPartOpenEvents
        testId="openstack-stack-open"
        title="Open on this stack"
        description="Unresolved incidents and alerts about this stack, incidents first."
        part={part}
        row={row}
      />

      <OpenStackPartAlerts
        testId="openstack-stack-alerts"
        title="Stack alerts"
        description="The cloud's alerts that watch every stack, this one included: each is one monitor on the cloud."
        templateIds={OPENSTACK_STACK_ALERT_TEMPLATE_IDS}
        context={{ openStackServices: [OpenStackServiceType.Orchestration] }}
        part={part}
      />

      <ResourcePartDetailsCard
        testId="openstack-stack-details"
        description="What Heat reports about this stack."
        rows={detailRows}
      />

      {Array.isArray(ownedInstanceIds) && Array.isArray(ownedVolumeIds) ? (
        <div className="mb-6" data-testid="openstack-stack-owns">
          <Card
            title="What this stack owns"
            description="The instances and volumes Heat says this stack made. What happens to the stack happens to these."
          >
            {ownedInstanceCount + ownedVolumeCount === 0 ? (
              <p
                className="text-sm text-gray-600"
                data-testid="openstack-stack-owns-nothing"
              >
                {translator.translateText(
                  "Heat says this stack owns no instances or volumes.",
                )}
              </p>
            ) : (
              <ul className={listClassName}>
                {listedInstances.map((id: string): ReactElement => {
                  return ownedRow({
                    id,
                    kind: OpenStackResourceKind.Instance,
                    label: translationKey("Instance"),
                    name: owned.data?.instances[id],
                  });
                })}
                {listedVolumes.map((id: string): ReactElement => {
                  return ownedRow({
                    id,
                    kind: OpenStackResourceKind.Volume,
                    label: translationKey("Volume"),
                    name: owned.data?.volumes[id],
                  });
                })}
                {/*
                 * The list's last row: the list runs to the card's edges
                 * and its bottom, so a line drawn under it would sit in
                 * the card's padding, over the last row.
                 */}
                {notListed > 0 ? (
                  <li
                    className="px-5 py-3 text-xs text-gray-500 md:px-6"
                    data-testid="openstack-stack-owns-more"
                  >
                    {translator.translatePlural(
                      {
                        one: "and {{count}} more",
                        other: "and {{count}} more",
                      },
                      notListed,
                    )}
                  </li>
                ) : (
                  <></>
                )}
              </ul>
            )}
          </Card>
        </div>
      ) : (
        <OpenStackPartNotice
          testId="openstack-stack-owns-not-known"
          text={WHAT_IT_OWNS_NOT_KNOWN}
        />
      )}
    </div>
  );
};

const OpenStackCloudStackDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(OpenStackResourceKind.Stack);

  return (
    <OpenStackPartPage
      part={part}
      overview={(row: OpenStackResource): ReactElement => {
        return <StackOverview part={part} row={row} />;
      }}
    />
  );
};

export default OpenStackCloudStackDetail;
