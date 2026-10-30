import { describe, expect, test } from "@jest/globals";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import {
  getKubernetesAlertTemplateById,
  getKubernetesDefaultAlertTemplateId,
} from "Common/Types/Monitor/KubernetesAlertTemplates";
import ReplacedCriteriaEdit from "../../FeatureSet/Dashboard/src/Utils/Form/Monitor/ReplacedCriteriaEdit";

/*
 * A new infrastructure monitor's step form applies its default alert in the
 * pass in which the criteria editor's incident and alert lists mount and
 * hand their rows up - through the default criteria they were drawn with.
 * That echo put the default criteria back over the alert's (the create form
 * showed Stopped Reporting picked and "is offline" criteria;
 * CreateMonitor.spec.ts caught it). MonitorStep drops an edit that shares no
 * criteria id with what the step holds.
 */

const IDS: {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
} = {
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
};

function defaultCriteria(): MonitorCriteria {
  return MonitorCriteria.getDefaultMonitorCriteria({
    monitorType: MonitorType.Kubernetes,
    monitorName: "Production",
    ...IDS,
  });
}

function templateCriteria(): MonitorCriteria {
  return getKubernetesAlertTemplateById(
    getKubernetesDefaultAlertTemplateId(),
  )!.getMonitorStep({
    clusterIdentifier: "prod",
    monitorName: "Production",
    ...IDS,
  }).data!.monitorCriteria;
}

function withInstances(
  criteria: MonitorCriteria,
  instances: Array<MonitorCriteriaInstance>,
): MonitorCriteria {
  const copy: MonitorCriteria = MonitorCriteria.fromJSON(criteria.toJSON());
  copy.data!.monitorCriteriaInstanceArray = instances;
  return copy;
}

describe("an edit of criteria the step has since replaced", () => {
  test("the default criteria's echo after the default alert replaced them is dropped", () => {
    expect(
      ReplacedCriteriaEdit.isEditOfReplacedCriteria({
        current: templateCriteria(),
        edited: defaultCriteria(),
      }),
    ).toBe(true);
  });

  test("an edit of the criteria on screen is kept", () => {
    const current: MonitorCriteria = templateCriteria();
    const edited: MonitorCriteria = MonitorCriteria.fromJSON(current.toJSON());
    edited.data!.monitorCriteriaInstanceArray[0]!.data!.name = "Renamed";

    expect(
      ReplacedCriteriaEdit.isEditOfReplacedCriteria({ current, edited }),
    ).toBe(false);
  });

  test("adding or removing a criteria is kept: the edit still shares an id", () => {
    const current: MonitorCriteria = templateCriteria();
    const instances: Array<MonitorCriteriaInstance> =
      current.data!.monitorCriteriaInstanceArray;
    const added: MonitorCriteriaInstance =
      defaultCriteria().data!.monitorCriteriaInstanceArray[0]!;

    expect(
      ReplacedCriteriaEdit.isEditOfReplacedCriteria({
        current,
        edited: withInstances(current, [...instances, added]),
      }),
    ).toBe(false);
    expect(
      ReplacedCriteriaEdit.isEditOfReplacedCriteria({
        current,
        edited: withInstances(current, [instances[0]!]),
      }),
    ).toBe(false);
  });

  test("criteria with no ids, or none on either side, are never judged", () => {
    const current: MonitorCriteria = templateCriteria();

    expect(
      ReplacedCriteriaEdit.isEditOfReplacedCriteria({
        current: undefined,
        edited: current,
      }),
    ).toBe(false);
    expect(
      ReplacedCriteriaEdit.isEditOfReplacedCriteria({
        current,
        edited: withInstances(current, []),
      }),
    ).toBe(false);

    const withoutIds: MonitorCriteria = MonitorCriteria.fromJSON(
      defaultCriteria().toJSON(),
    );
    for (const instance of withoutIds.data!.monitorCriteriaInstanceArray) {
      delete (instance.data as { id?: string }).id;
    }
    expect(
      ReplacedCriteriaEdit.isEditOfReplacedCriteria({
        current,
        edited: withoutIds,
      }),
    ).toBe(false);
  });
});
