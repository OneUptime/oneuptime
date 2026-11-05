import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { isOpenStackServiceQuiet } from "Common/Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { fetchOpenStackRows } from "../../Pages/OpenStack/Utils/OpenStackPartData";
import {
  OpenStackInventorySummary,
  fetchOpenStackInventorySummary,
} from "../../Pages/OpenStack/Utils/OpenStackResourceUtils";
import { formatOpenStackDuration } from "../../Pages/OpenStack/Utils/OpenStackHealth";
import OpenStackPartNotice from "./Part/OpenStackPartNotice";
import useIsOpenStackProbeCollected from "./Part/UseIsOpenStackProbeCollected";
import useOpenStackRead, { OpenStackRead } from "./Part/UseOpenStackRead";
import {
  useOpenStackRegion,
  OpenStackRegionState,
} from "./OpenStackRegionContext";

/*
 * What this page can and can't see of Ironic, said before its numbers, because they would be
 * misread without it. Each is a thing a real cloud did:
 *
 *  - The exporter answers the same for a stopped Ironic and one taken away, so all this says is
 *    that it has gone quiet, and that these rows are as they last read. It never says down.
 *  - Ironic answers a project with the nodes that project owns. Placement answers everyone, so
 *    when it holds more nodes than Ironic listed, this list is not the whole cloud's.
 *  - The exporter has no conductors. A probe reads them where the credential may, and a project's
 *    is refused.
 */
const QUIET_NOTICE: string = translationKey(
  "OneUptime hasn't heard from Ironic for {{duration}}, while the rest of this cloud went on reporting. It may be stopped, or taken out of this cloud: what the agent's exporter answers is the same for both, and is the same as a cloud that never had it, so OneUptime can't say which. These nodes are as they last read.",
);

// A probe reads the catalog, and says a stopped Ironic is down, so quiet says less here.
const QUIET_ON_A_PROBE_NOTICE: string = translationKey(
  "OneUptime hasn't heard from Ironic for {{duration}}, while the rest of this cloud went on reporting. A probe says when Ironic's API fails, so it has probably left this region's catalog. These nodes are as they last read, and go after two weeks of this.",
);

const DOWN_NOTICE: string = translationKey(
  "Ironic's API isn't answering. These nodes are as they last read.",
);

const PARTIAL_NOTICE: { one: string; other: string } = {
  one: "Placement holds {{count}} bare metal node, and Ironic shows this credential {{nodes}}. Ironic answers a project with only the nodes that project owns, so this list isn't the whole cloud's. To read them all, use a credential Ironic shows them to.",
  other:
    "Placement holds {{count}} bare metal nodes, and Ironic shows this credential {{nodes}}. Ironic answers a project with only the nodes that project owns, so this list isn't the whole cloud's. To read them all, use a credential Ironic shows them to.",
};

const NOTHING_SHOWN_NOTICE: string = translationKey(
  "Ironic answers this credential, and shows it no nodes. It answers a project with only the nodes that project owns, so a cloud with nodes can read like this.",
);

const CONDUCTORS_ON_THE_AGENT: string = translationKey(
  "The agent's exporter reports nodes and no conductors, and it doesn't carry a node's driver, its conductor, or why it failed. A probe reads those from Ironic's API, where the credential may.",
);

const CONDUCTORS_ON_A_PROBE: string = translationKey(
  "A probe reads nodes and why they failed from Ironic's API, as far as its credential may. Ironic refuses a project's credential the list of conductors, so they read only where the cloud's policy allows it.",
);

interface BareMetalNoticeReads {
  summary: OpenStackInventorySummary | null;
  apis: Array<OpenStackResource>;
}

export interface ComponentProps {
  openStackCloudId: ObjectID;
  // On one node's page: that these are as they last read, and nothing about the whole list.
  onlyWhatChangesThisRow?: boolean | undefined;
}

const OpenStackBareMetalNotices: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { region }: OpenStackRegionState = useOpenStackRegion();
  const isProbeCollected: boolean = useIsOpenStackProbeCollected(
    props.openStackCloudId,
  );

  const read: OpenStackRead<BareMetalNoticeReads> =
    useOpenStackRead<BareMetalNoticeReads>(async () => {
      const [summary, apis]: [
        OpenStackInventorySummary | null,
        Array<OpenStackResource>,
      ] = await Promise.all([
        fetchOpenStackInventorySummary(props.openStackCloudId, region),
        fetchOpenStackRows({
          openStackCloudId: props.openStackCloudId,
          kind: OpenStackResourceKind.Api,
          query: {
            name: OpenStackServiceType.BareMetal,
            ...(region ? { regionName: region } : {}),
          },
          limit: 50,
        }),
      ]);
      return { summary, apis };
    }, [props.openStackCloudId.toString(), region]);

  if (!read.data) {
    return <></>;
  }

  const now: Date = OneUptimeDate.getCurrentDate();
  const { summary, apis } = read.data;

  const quiet: OpenStackResource | undefined = apis.find(
    (api: OpenStackResource): boolean => {
      return (
        api.status !== "down" &&
        isOpenStackServiceQuiet({
          service: api.name,
          lastSeenAt: api.lastSeenAt,
          now,
        })
      );
    },
  );
  const isDown: boolean = apis.some((api: OpenStackResource): boolean => {
    return api.status === "down";
  });
  const nodes: number = summary?.bareMetalNodeCount || 0;
  const providers: number = summary?.bareMetalProviderCount || 0;

  const quietMinutes: number = quiet?.lastSeenAt
    ? (now.getTime() - new Date(quiet.lastSeenAt).getTime()) / 60000
    : 0;

  return (
    <Fragment>
      {quiet ? (
        <OpenStackPartNotice testId="openstack-bare-metal-quiet" tone="warning">
          {translator.translateTemplate(
            isProbeCollected ? QUIET_ON_A_PROBE_NOTICE : QUIET_NOTICE,
            { duration: formatOpenStackDuration(quietMinutes) },
          )}
        </OpenStackPartNotice>
      ) : isDown ? (
        <OpenStackPartNotice
          testId="openstack-bare-metal-down"
          tone="warning"
          text={DOWN_NOTICE}
        />
      ) : (
        <></>
      )}

      {props.onlyWhatChangesThisRow ? (
        <></>
      ) : providers > nodes && nodes > 0 ? (
        <OpenStackPartNotice
          testId="openstack-bare-metal-partial"
          tone="warning"
        >
          {translator.translatePlural(PARTIAL_NOTICE, providers, {
            nodes: translator.formatNumber(nodes),
          })}
        </OpenStackPartNotice>
      ) : nodes === 0 && !quiet && !isDown ? (
        <OpenStackPartNotice
          testId="openstack-bare-metal-nothing-shown"
          tone={providers > 0 ? "warning" : "neutral"}
          text={NOTHING_SHOWN_NOTICE}
        />
      ) : (
        <></>
      )}

      {props.onlyWhatChangesThisRow ? (
        <></>
      ) : (
        <OpenStackPartNotice
          testId="openstack-bare-metal-collection"
          text={
            isProbeCollected ? CONDUCTORS_ON_A_PROBE : CONDUCTORS_ON_THE_AGENT
          }
        />
      )}
    </Fragment>
  );
};

export default OpenStackBareMetalNotices;
