import { describe, expect, jest, test } from "@jest/globals";
import * as React from "react";
import { getMonitorLinkedResourcesFormFields } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorLinkedResourcesFormFields";
import { MONITOR_LINKED_RESOURCE_TYPES } from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/MonitorLinkedResourcesPrefillRules";
import { AffectedResourcesPayload } from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Field from "../../../UI/Components/Forms/Types/Field";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import type { Mock } from "jest-mock";

/*
 * The Edit form of a monitor's Linked Resources card: one picker for
 * everything an incident's Other Affected Resources offers, anchored on
 * `hosts`, whose payload is split back into each relation - and a hidden
 * registration for every other relation, so the form loads and saves them
 * all. Nothing else: the card edits only the links.
 */

const OTHER_KEYS: Array<string> = [
  "kubernetesClusters",
  "dockerHosts",
  "podmanHosts",
  "proxmoxClusters",
  "vmwareVCenters",
  "cephClusters",
  "dockerSwarmClusters",
  "iotFleets",
  "databaseServers",
  "services",
];

type SetNewFormValues = (values: FormValues<Monitor>) => void;

function keyOf(field: Field<Monitor>): string {
  return Object.keys(field.field || {})[0]!;
}

describe("getMonitorLinkedResourcesFormFields", () => {
  const fields: Fields<Monitor> = getMonitorLinkedResourcesFormFields();

  test("draws one picker, anchored on hosts, for every linkable kind", () => {
    const anchor: Field<Monitor> = fields[0]!;

    expect(keyOf(anchor)).toBe("hosts");
    expect(anchor.title).toBe("Linked Resources");
    expect(anchor.fieldType).toBe(FormFieldSchemaType.CustomComponent);
    expect(anchor.required).toBe(false);

    const picker: React.ReactElement = anchor.getCustomElement!(
      {} as FormValues<Monitor>,
      {},
    ) as React.ReactElement;
    expect(
      (picker.props as { resourceTypes: Array<string> }).resourceTypes,
    ).toEqual(MONITOR_LINKED_RESOURCE_TYPES);
  });

  test("registers every other relation, hidden, so it is loaded and saved", () => {
    const hidden: Array<Field<Monitor>> = fields.slice(1);

    expect(hidden.map(keyOf)).toEqual(OTHER_KEYS);

    for (const field of hidden) {
      expect(field.showIf?.({} as FormValues<Monitor>)).toBe(false);
      expect(field.required).toBe(false);
    }
  });

  test("splits the picker's payload back into each relation", async () => {
    const setNewFormValues: Mock<SetNewFormValues> =
      jest.fn<SetNewFormValues>();
    const payload: AffectedResourcesPayload = {
      __affectedResourcesPayload: true,
      monitors: undefined,
      hosts: ["h-1"],
      kubernetesClusters: ["k-1"],
      dockerHosts: [],
      podmanHosts: [],
      proxmoxClusters: [],
      vmwareVCenters: [],
      cephClusters: [],
      dockerSwarmClusters: [],
      iotFleets: [],
      databaseServers: ["db-1"],
      networkSites: undefined,
      services: ["svc-1"],
    };

    fields[0]!.onChange!(
      payload,
      { name: "Checkout website" } as FormValues<Monitor>,
      setNewFormValues,
    );

    // The split runs after the field stores the payload itself.
    expect(setNewFormValues).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect(setNewFormValues.mock.calls[0]![0]).toEqual({
      name: "Checkout website",
      hosts: ["h-1"],
      kubernetesClusters: ["k-1"],
      dockerHosts: [],
      podmanHosts: [],
      proxmoxClusters: [],
      vmwareVCenters: [],
      cephClusters: [],
      dockerSwarmClusters: [],
      iotFleets: [],
      databaseServers: ["db-1"],
      services: ["svc-1"],
    });
  });

  test("ignores a value that is not the picker's payload", async () => {
    const setNewFormValues: Mock<SetNewFormValues> =
      jest.fn<SetNewFormValues>();

    fields[0]!.onChange!(["h-1"], {} as FormValues<Monitor>, setNewFormValues);
    await Promise.resolve();

    expect(setNewFormValues).not.toHaveBeenCalled();
  });
});
