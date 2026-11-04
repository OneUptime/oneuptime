import ObjectID from "Common/Types/ObjectID";
import { OpenStackCountRow } from "Common/Types/OpenStack/OpenStackCounts";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  countOpenStackRows,
  fetchOpenStackCounts,
} from "../../../Pages/OpenStack/Utils/OpenStackPartData";
import { isOpenStackListPossiblyOneProject } from "../../../Pages/OpenStack/Utils/OpenStackPartFacts";
import OpenStackPartNotice from "./OpenStackPartNotice";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * Neutron and Cinder answer a limited credential with a 200 and only its own project's
 * rows, so a list can look whole and not be. This says so when every row is one project's
 * and more than one is known, and it only says "may": a page can't always tell, because a
 * cloud with one project that holds any of these looks the same.
 */
export interface ComponentProps {
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
}

const OpenStackLimitedViewNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const read: OpenStackRead<boolean> = useOpenStackRead<boolean>(async () => {
    const [counts, projects]: [Array<OpenStackCountRow>, number] =
      await Promise.all([
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
    return isOpenStackListPossiblyOneProject({
      projectIdsInList: counts.map((row: OpenStackCountRow) => {
        return row.value;
      }),
      knownProjectCount: projects,
    });
  }, [props.openStackCloudId.toString(), props.kind]);

  if (!read.data) {
    return <></>;
  }

  return (
    <OpenStackPartNotice
      testId="openstack-limited-view-notice"
      tone="neutral"
      text={translator.translateText(
        "Every row here is one project's. Neutron and Cinder answer a limited credential with its own project's rows and no error, so this list may not be the whole cloud. Run troubleshoot.sh on the agent's machine to see what this credential can read.",
      )}
    />
  );
};

export default OpenStackLimitedViewNotice;
