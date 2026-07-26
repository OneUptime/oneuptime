import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useAsyncEffect } from "use-async-effect";

export interface ComponentProps {
  monitorId: ObjectID;
}

/**
 * Warns that deleting this monitor will change (or break) the SLOs that
 * measure it.
 *
 * The SLO ↔ Monitor join cascades on delete, so removing a monitor
 * silently shrinks every SLO that referenced it — and an SLO left with no
 * monitors at all stops being evaluated entirely and turns Misconfigured
 * on the worker's next tick. Nothing surfaced that consequence at the
 * point of no return, so the first sign was a grey pill on a page nobody
 * was looking at.
 *
 * A failed lookup renders nothing: this is an advisory, and blocking a
 * delete page on it would be worse than showing it late.
 */
const SloImpactWarning: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [slos, setSlos] = useState<Array<ServiceLevelObjective>>([]);

  useAsyncEffect(async () => {
    try {
      const result: ListResult<ServiceLevelObjective> =
        await ModelAPI.getList<ServiceLevelObjective>({
          modelType: ServiceLevelObjective,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            monitors: new Includes([props.monitorId]),
          },
          select: {
            _id: true,
            name: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {},
        });

      setSlos(result.data);
    } catch {
      setSlos([]);
    }
  }, [props.monitorId.toString()]);

  if (slos.length === 0) {
    return <></>;
  }

  const sloNames: string = slos
    .map((slo: ServiceLevelObjective) => {
      return slo.name || "Untitled SLO";
    })
    .join(", ");

  return (
    <Alert
      type={AlertType.WARNING}
      strongTitle={`This monitor is measured by ${slos.length} SLO${
        slos.length === 1 ? "" : "s"
      }`}
      title={`Deleting it removes it from: ${sloNames}. Any SLO left with no monitors stops being evaluated and shows as Misconfigured.`}
    />
  );
};

export default SloImpactWarning;
