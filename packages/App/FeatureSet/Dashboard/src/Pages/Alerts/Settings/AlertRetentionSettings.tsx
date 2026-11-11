import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";
import ResolvedRecordRetentionCard from "../../../Components/Retention/ResolvedRecordRetentionCard";
import { ALERT_RETENTION_COPY } from "../../../Components/Retention/ResolvedRecordRetentionCopy";

export type ComponentProps = PageComponentProps;

/*
 * Alerts -> Settings -> Data Retention: how long a resolved alert is kept
 * before it is deleted with everything it carries (issue #6903). A page of
 * its own, named as Settings -> Data Retention is for telemetry, so someone
 * looking for how long alerts are kept finds it by name in the menu or the
 * search.
 */
const AlertRetentionSettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  return (
    <ResolvedRecordRetentionCard
      copy={ALERT_RETENTION_COPY}
      projectId={projectId}
    />
  );
};

export default AlertRetentionSettings;
