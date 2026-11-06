import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackCountRow } from "Common/Types/OpenStack/OpenStackCounts";
import {
  OpenStackResourceKind,
  OpenStackServiceFamily,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  countOpenStackRows,
  fetchOpenStackApiStates,
  fetchOpenStackCounts,
} from "../../../Pages/OpenStack/Utils/OpenStackPartData";
import {
  OpenStackApiState,
  OpenStackListView,
  getOpenStackListView,
} from "../../../Pages/OpenStack/Utils/OpenStackPartFacts";
import OpenStackPartNotice from "./OpenStackPartNotice";
import useIsOpenStackProbeCollected from "./UseIsOpenStackProbeCollected";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * Neutron and Cinder answer a limited credential with a 200 and only its own project's
 * rows, so a list can look whole and not be, and an empty one can look like nothing there.
 * Where Cinder answers, whether it lists its workers says which this is
 * (getOpenStackListView), so this says so outright. A cloud with no Cinder to ask only gets a
 * "may", when every row is one project's and more than one is known.
 */
export interface ComponentProps {
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
}

// What each service does differently, recorded on real credentials (access-check).
const OPENSTACK_LIMITED_VIEW_WORDS: Partial<
  Record<OpenStackResourceKind, string>
> = {
  [OpenStackResourceKind.Stack]: translationKey(
    "This credential sees its own project's stacks here at most, and no error says so: Heat shows a plain reader those with no project on them, and the monitoring role none. So this list is not the whole cloud. Seeing every project takes the Full view credential. Run troubleshoot.sh on the agent's machine to see what this credential can read.",
  ),
  [OpenStackResourceKind.LoadBalancer]: translationKey(
    "This credential sees its own project's load balancers here at most, and the monitoring role none, and no error says so: Octavia answers anything but an admin that way. So this list is not the whole cloud. Seeing every project takes the Full view credential. Run troubleshoot.sh on the agent's machine to see what this credential can read.",
  ),
  [OpenStackResourceKind.Amphora]: translationKey(
    "This credential can't list amphorae: Octavia lets only an admin do that, and refuses anything less. Seeing them takes the Full view credential. Run troubleshoot.sh on the agent's machine to see what this credential can read.",
  ),
  [OpenStackResourceKind.Share]: translationKey(
    "This credential sees its own project's shares here at most, and no error says so: Manila answers anything but an admin that way, recorded, and the monitoring role none. So this list is not the whole cloud. Seeing every project takes the Full view credential. Run troubleshoot.sh on the agent's machine to see what this credential can read.",
  ),
  [OpenStackResourceKind.ContainerCluster]: translationKey(
    "This credential sees no project's Kubernetes clusters but its own, and no error says so: Magnum answers anything but an admin that way, so this list is not the whole cloud. Seeing every project takes the Full view credential. Run troubleshoot.sh on the agent's machine to see what this credential can read.",
  ),
};

const OpenStackLimitedViewNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isProbeCollected: boolean = useIsOpenStackProbeCollected(
    props.openStackCloudId,
  );

  const read: OpenStackRead<OpenStackListView> =
    useOpenStackRead<OpenStackListView>(async () => {
      const facts: JSONObject = { family: OpenStackServiceFamily.Volume };
      const [apis, volumeWorkers, counts, projects]: [
        Record<string, OpenStackApiState>,
        number,
        Array<OpenStackCountRow>,
        number,
      ] = await Promise.all([
        fetchOpenStackApiStates(props.openStackCloudId),
        countOpenStackRows({
          openStackCloudId: props.openStackCloudId,
          kind: OpenStackResourceKind.Service,
          query: { facts: facts },
        }),
        fetchOpenStackCounts({
          openStackCloudId: props.openStackCloudId,
          kind: props.kind,
          by: "project",
        }),
        countOpenStackRows({
          openStackCloudId: props.openStackCloudId,
          kind: OpenStackResourceKind.Project,
        }),
      ]);
      return getOpenStackListView({
        volumeApi: apis[OpenStackServiceType.Volume] || "not-reported",
        volumeWorkerCount: volumeWorkers,
        projectIdsInList: counts.map((row: OpenStackCountRow) => {
          return row.value;
        }),
        knownProjectCount: projects,
      });
    }, [props.openStackCloudId.toString(), props.kind]);

  if (read.data === "own-project") {
    return (
      <OpenStackPartNotice
        testId="openstack-limited-view-notice"
        tone="neutral"
        text={translator.translateText(
          OPENSTACK_LIMITED_VIEW_WORDS[props.kind] ||
            "This credential sees its own project's rows here, and no error says so: Neutron and Cinder answer anything but an admin that way, so this list is not the whole cloud. Seeing every project takes the Full view credential. Run troubleshoot.sh on the agent's machine to see what this credential can read.",
        )}
      />
    );
  }

  if (read.data !== "possibly-one-project") {
    return <></>;
  }

  return (
    <OpenStackPartNotice
      testId="openstack-limited-view-notice"
      tone="neutral"
      text={translator.translateText(
        isProbeCollected
          ? "Every row here is one project's. Neutron and Cinder answer a limited credential with its own project's rows and no error, so this list may not be the whole cloud. Test Connection, under Data Collection on this cloud's Settings page, says what this credential can read."
          : "Every row here is one project's. Neutron and Cinder answer a limited credential with its own project's rows and no error, so this list may not be the whole cloud. Run troubleshoot.sh on the agent's machine to see what this credential can read.",
      )}
    />
  );
};

export default OpenStackLimitedViewNotice;
