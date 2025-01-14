import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";
import Exception from "Common/Types/Exception/Exception";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ProgressButtons from "Common/UI/Components/ProgressButtons/ProgressButtons";
import { Black } from "Common/Types/BrandColors";


export interface ComponentProps {
  incidentId: ObjectID;
  onActionComplete: () => void;
}

const ChangeIncidentState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {

  const [showModal, setShowModal] = useState<boolean>(false);

  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [incidentStates, setIncidentStates] = useState<IncidentState[]>([]);
  const [currentIncidentState, setCurrentIncidentState] = useState<
    IncidentState | undefined
  >(undefined);

  const [selectedIncidentState, setSelectedIncidentState] = useState<
    IncidentState | undefined
  >(undefined);

  const [incidentStateTimelines, setIncidentStateTimelines] = useState<
    IncidentStateTimeline[]
  >([]);

  const fetchIncidentStates = async () => {
    const projectId: ObjectID | undefined | null =
      ProjectUtil.getCurrentProject()?.id;

    if (!projectId) {
      throw new BadDataException("ProjectId not found.");
    }

    const incidentStates: ListResult<IncidentState> =
      await ModelAPI.getList<IncidentState>({
        modelType: IncidentState,
        query: {
          projectId: projectId,
        },
        limit: 99,
        skip: 0,
        select: {
          _id: true,
          isResolvedState: true,
          isAcknowledgedState: true,
          isCreatedState: true,
          name: true,
          color: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        requestOptions: {},
      });

    setIncidentStates(incidentStates.data);
  }


  const fetchIncidentStateTimelines = async () => {
    const incidentStateTimelines: ListResult<IncidentStateTimeline> =
      await ModelAPI.getList<IncidentStateTimeline>({
        modelType: IncidentStateTimeline,
        query: {
          incidentId: props.incidentId,
        },
        limit: 99,
        skip: 0,
        select: {
          _id: true,
          incidentStateId: true,
        },
        sort: {
          startsAt: SortOrder.Ascending
        },
        requestOptions: {},
      });

    setIncidentStateTimelines(incidentStateTimelines.data);
  }


  const loadPage: PromiseVoidFunction = async () => {
    try{
      setIsLoading(true);
      setError("");

      await fetchIncidentStates();
      await fetchIncidentStateTimelines();

    } catch (err: unknown) {
      setError(API.getFriendlyMessage(err as Exception));
    }
    setIsLoading(false);
  };


  useEffect(() => {
    
    loadPage().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });

  }, []);

  useEffect(() => {

    if (incidentStates.length === 0 || incidentStateTimelines.length === 0) {
      return;
    }

    const currentIncidentStateTimeline: IncidentStateTimeline | undefined =
      incidentStateTimelines[incidentStateTimelines.length - 1];

    if (!currentIncidentStateTimeline) {
      return;
    }

    const currentIncidentState: IncidentState | undefined = incidentStates.find(
      (state: IncidentState) =>
        state.id?.toString() === currentIncidentStateTimeline.incidentStateId?.toString(),
    );

    setCurrentIncidentState(currentIncidentState);

  }, [incidentStates, incidentStateTimelines]); 


  if(isLoading) {
    return <PageLoader isVisible={true} />;
  }


  if(error) {
    return <ErrorMessage message={error} />;
  }


  return (
    <div className="-ml-3 mt-1">
      
      <ProgressButtons

        id="incident-state-progress-buttons"
        currentStepId={currentIncidentState?.id?.toString() || ""}
        onStepClick={(stepId: string) => {
          const incidentState: IncidentState | undefined = incidentStates.find(
            (state: IncidentState) => state.id?.toString() === stepId,
          );

          setSelectedIncidentState(incidentState);
          setShowModal(true);
        }}

        progressButtonItems={incidentStates.map((state: IncidentState) => {
          return {
            id: state.id?.toString() || "",
            title: state.name || "",
            color: state.color || Black,
          };
        })}
      />

      {showModal && (
        <ModelFormModal
          modelType={IncidentStateTimeline}
          name={
            "create-incident-state-timeline"
          }
          title={
           "Mark Incident as " + selectedIncidentState?.name
          }
          description={
          "You are about to mark this incident as " + selectedIncidentState?.name + "."
          }
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText="Save"
          onBeforeCreate={async (model: IncidentStateTimeline) => {
            const projectId: ObjectID | undefined | null =
              ProjectUtil.getCurrentProject()?.id;

            if (!projectId) {
              throw new BadDataException("ProjectId not found.");
            }

            model.projectId = projectId;
            model.incidentId = props.incidentId;
            model.incidentStateId = selectedIncidentState!.id!;

            return model;
          }}
          onSuccess={() => {
            setShowModal(false);
            props.onActionComplete();
          }}
          formProps={{
            name: "create-scheduled-maintenance-state-timeline",
            modelType: IncidentStateTimeline,
            id: "create-scheduled-maintenance-state-timeline",
            fields: [
              {
                field: {
                  publicNote: true,
                } as any,
                fieldType: FormFieldSchemaType.Markdown,
                description:
                  "Post a public note about this state change to the status page.",
                title: "Public Note",
                required: false,
                overrideFieldKey: "publicNote",
                showEvenIfPermissionDoesNotExist: true,
              },
              {
                field: {
                  shouldStatusPageSubscribersBeNotified: true,
                },
                fieldType: FormFieldSchemaType.Checkbox,
                description: "Notify subscribers of this state change.",
                title: "Notify Status Page Subscribers",
                required: false,
                defaultValue: true,
              },
            ],
            formType: FormType.Create,
          }}
        />
      )}
    </div>
  );
};

export default ChangeIncidentState;
