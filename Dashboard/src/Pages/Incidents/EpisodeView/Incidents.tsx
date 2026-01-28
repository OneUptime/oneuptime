import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import IncidentEpisodeMember, {
  IncidentEpisodeMemberAddedBy,
} from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import Incident from "Common/Models/DatabaseModels/Incident";
import FieldType from "Common/UI/Components/Types/FieldType";
import IncidentElement from "../../../Components/Incident/Incident";
import Pill from "Common/UI/Components/Pill/Pill";
import { Black } from "Common/Types/BrandColors";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

const EpisodeIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ModelTable<IncidentEpisodeMember>
      modelType={IncidentEpisodeMember}
      name="Episode Incidents"
      id="episode-incidents-table"
      userPreferencesKey="episode-incidents-table"
      isDeleteable={true}
      isEditable={false}
      isCreateable={true}
      isViewable={false}
      createVerb="Add"
      query={{
        incidentEpisodeId: modelId,
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      bulkActions={{
        buttons: [ModalTableBulkDefaultActions.Delete],
      }}
      onBeforeCreate={(
        item: IncidentEpisodeMember,
      ): Promise<IncidentEpisodeMember> => {
        item.incidentEpisodeId = modelId;
        item.projectId = ProjectUtil.getCurrentProjectId()!;
        item.addedBy = IncidentEpisodeMemberAddedBy.Manual;
        return Promise.resolve(item);
      }}
      filters={[]}
      cardProps={{
        title: "Member Incidents",
        description: "Incidents that are part of this episode.",
      }}
      noItemsMessage="No incidents in this episode."
      showRefreshButton={true}
      formFields={[
        {
          field: {
            incidentId: true,
          },
          title: "Incident",
          description: "Select an incident to add to this episode.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          dropdownModal: {
            type: Incident,
            labelField: "title",
            valueField: "_id",
          },
        },
      ]}
      columns={[
        {
          field: {
            incident: {
              incidentNumber: true,
            },
          },
          title: "Incident #",
          type: FieldType.Text,
          getElement: (item: IncidentEpisodeMember): ReactElement => {
            if (!item.incident?.incidentNumber) {
              return <>-</>;
            }
            return <>#{item.incident.incidentNumber}</>;
          },
        },
        {
          field: {
            incident: {
              title: true,
              _id: true,
            },
          },
          title: "Title",
          type: FieldType.Element,
          getElement: (item: IncidentEpisodeMember): ReactElement => {
            if (!item.incident) {
              return <>-</>;
            }
            return <IncidentElement incident={item.incident} />;
          },
        },
        {
          field: {
            addedBy: true,
          },
          title: "Added By",
          type: FieldType.Text,
          getElement: (item: IncidentEpisodeMember): ReactElement => {
            if (item.addedBy === IncidentEpisodeMemberAddedBy.Rule) {
              return (
                <Pill isMinimal={true} color={Black} text="Grouping Rule" />
              );
            }
            if (item.addedBy === IncidentEpisodeMemberAddedBy.Manual) {
              return <Pill isMinimal={true} color={Black} text="Manual" />;
            }
            if (item.addedBy === IncidentEpisodeMemberAddedBy.API) {
              return <Pill isMinimal={true} color={Black} text="API" />;
            }
            return <>-</>;
          },
        },
        {
          field: {
            addedAt: true,
          },
          title: "Added At",
          type: FieldType.DateTime,
        },
      ]}
    />
  );
};

export default EpisodeIncidents;
