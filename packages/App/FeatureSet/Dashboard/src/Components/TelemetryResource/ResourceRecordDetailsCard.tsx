import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "Common/Models/DatabaseModels/Label";
import Route from "Common/Types/API/Route";
import Select from "Common/Types/BaseDatabase/Select";
import ObjectID from "Common/Types/ObjectID";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelDetailField from "Common/UI/Components/ModelDetail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { ReactElement, useState } from "react";
import EditInSettingsLink from "./EditInSettingsLink";
import ResourceLabelsCard from "./ResourceLabelsCard";
import {
  isReportedDetailValue,
  RESOURCE_RECORD_DETAILS_COLUMNS,
  RESOURCE_RECORD_DETAILS_EMPTY_MESSAGE,
  RESOURCE_RECORD_DETAILS_HEADER_LAYOUT,
} from "./ResourceRecordDetails";

/*
 * THE DETAILS CARD OF A RESOURCE OVERVIEW WHOSE FACTS ARE ITS RECORD'S
 * COLUMNS: a Docker or Podman host's, a Kubernetes cluster's, a vCenter's, a
 * Proxmox or Ceph cluster's, a storage array's and a host's. The rules it
 * keeps are in ResourceRecordDetails:
 *
 *   - the page hands over only its facts - never the name, description,
 *     last seen, labels or status the hero and the header already say;
 *   - a fact the resource has not reported is not a row (no "Not
 *     reported", no dash), and with none reported the card says so in one
 *     line;
 *   - two columns from 640px on every page (they were one on some, two on
 *     others), and the record's ID line at the card's foot;
 *   - "Edit in Settings" in its header: the card on the Settings page is
 *     where the name, description, identifier and labels are edited
 *     (ResourceDetailsCard), under the same title;
 *   - the labels, read with the record, as a phone's Labels card under it
 *     (ResourceLabelsCard), where the page's header has no room for them.
 */
export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  // The detail's id, for the browser suites: "docker-host-details".
  id: string;
  /*
   * "Docker Host Details": the title its Settings page's card has too. A
   * title that says what the card holds needs no description under it.
   */
  title: string;
  // Its Settings page, where its name, description and labels are edited.
  settingsRoute: Route;
  // Flipped by the page's refresh, so the card reads the record again.
  refresher?: boolean | undefined;
  /*
   * What the resource reported about itself, one column each, in the order
   * the card lists them: its identifier first, its agent's version last. A
   * fact is drawn only when its column holds something, unless it says
   * when itself (showIf).
   */
  facts: Array<ModelDetailField<TBaseModel>>;
  // More of the record a fact's own element reads: a vCenter's probe.
  selectMoreFields?: Select<TBaseModel> | undefined;
}

// The column a fact reads.
export function getFactColumn<TBaseModel extends BaseModel>(
  fact: ModelDetailField<TBaseModel>,
): string {
  return Object.keys(fact.field || {})[0] || "";
}

/*
 * The fields the card hands ModelDetail: each fact, drawn only once its
 * column holds something (or when its own showIf says), and the record's
 * own ID, which the detail draws as the ID line at the card's foot
 * (Detail/DetailRecordId).
 */
export function getResourceRecordDetailFields<TBaseModel extends BaseModel>(
  facts: Array<ModelDetailField<TBaseModel>>,
): Array<ModelDetailField<TBaseModel>> {
  return [
    ...facts.map(
      (fact: ModelDetailField<TBaseModel>): ModelDetailField<TBaseModel> => {
        if (fact.showIf) {
          return fact;
        }

        const column: string = getFactColumn(fact);

        return {
          ...fact,
          showIf: (item: TBaseModel): boolean => {
            return isReportedDetailValue(
              (item as unknown as Record<string, unknown>)[column],
            );
          },
        };
      },
    ),
    {
      field: {
        _id: true,
      } as Select<TBaseModel>,
      title: "ID",
      fieldType: FieldType.ObjectID,
    },
  ];
}

const ResourceRecordDetailsCard: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  // Read with the record: the phone's Labels card under this one.
  const [labels, setLabels] = useState<Array<Label>>([]);

  return (
    <>
      <CardModelDetail<TBaseModel>
        name={props.title}
        refresher={Boolean(props.refresher)}
        cardProps={{
          title: props.title,
          /*
           * The title and "Edit in Settings" centred on each other. Nothing
           * is under the title, and in the default header the 38px button
           * hung 7px below a title it is level with only at the top; the
           * stacked header centres a title with nothing under it on its
           * actions, as an event's detail cards do.
           */
          headerLayout: RESOURCE_RECORD_DETAILS_HEADER_LAYOUT,
          buttons: [
            <EditInSettingsLink
              key="edit-in-settings"
              to={props.settingsRoute}
            />,
          ],
        }}
        modelDetailProps={{
          showDetailsInNumberOfColumns: RESOURCE_RECORD_DETAILS_COLUMNS,
          modelType: props.modelType,
          id: props.id,
          modelId: props.modelId,
          emptyMessage: RESOURCE_RECORD_DETAILS_EMPTY_MESSAGE,
          selectMoreFields: {
            ...(props.selectMoreFields || {}),
            labels: {
              name: true,
              color: true,
            },
          } as Select<TBaseModel>,
          onItemLoaded: (item: TBaseModel): void => {
            const loaded: unknown = (
              item as unknown as Record<string, unknown>
            )["labels"];
            setLabels(Array.isArray(loaded) ? (loaded as Array<Label>) : []);
          },
          fields: getResourceRecordDetailFields<TBaseModel>(props.facts),
        }}
      />
      <ResourceLabelsCard labels={labels} />
    </>
  );
};

export default ResourceRecordDetailsCard;
