import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
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
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

export interface ComponentProps {
  episodeId: ObjectID;
  onActionComplete: () => void;
}

const ChangeEpisodeState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);

  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [incidentNoteTemplates, setIncidentNoteTemplates] = useState<
    IncidentNoteTemplate[]
  >([]);

  const [incidentStates, setIncidentStates] = useState<IncidentState[]>([]);
  const [currentIncidentState, setCurrentIncidentState] = useState<
    IncidentState | undefined
  >(undefined);

  const [selectedIncidentState, setSelectedIncidentState] = useState<
    IncidentState | undefined
  >(undefined);

  const [episodeStateTimelines, setEpisodeStateTimelines] = useState<
    IncidentEpisodeStateTimeline[]
  >([]);

  const fetchIncidentNoteTemplates: PromiseVoidFunction =
    async (): Promise<void> => {
      const incidentNoteTemplates: ListResult<IncidentNoteTemplate> =
        await ModelAPI.getList<IncidentNoteTemplate>({
          modelType: IncidentNoteTemplate,
          query: {
            projectId: ProjectUtil.getCurrentProject()!.id!,
          },
          limit: 99,
          skip: 0,
          select: {
            _id: true,
            templateName: true,
            note: true,
          },
          sort: {
            templateName: SortOrder.Ascending,
          },
        });

      setIncidentNoteTemplates(incidentNoteTemplates.data);
    };

  const fetchIncidentStates: PromiseVoidFunction = async (): Promise<void> => {
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
  };

  const fetchEpisodeStateTimelines: PromiseVoidFunction =
    async (): Promise<void> => {
      const episodeStateTimelines: ListResult<IncidentEpisodeStateTimeline> =
        await ModelAPI.getList<IncidentEpisodeStateTimeline>({
          modelType: IncidentEpisodeStateTimeline,
          query: {
            incidentEpisodeId: props.episodeId,
          },
          limit: 99,
          skip: 0,
          select: {
            _id: true,
            incidentStateId: true,
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
          requestOptions: {},
        });

      setEpisodeStateTimelines(episodeStateTimelines.data);
    };

  const loadPage: PromiseVoidFunction = async () => {
    try {
      setIsLoading(true);
      setError("");
      await fetchIncidentNoteTemplates();
      await fetchIncidentStates();
      await fetchEpisodeStateTimelines();
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
    if (incidentStates.length === 0 || episodeStateTimelines.length === 0) {
      return;
    }

    const currentEpisodeStateTimeline:
      | IncidentEpisodeStateTimeline
      | undefined = episodeStateTimelines[episodeStateTimelines.length - 1];

    if (!currentEpisodeStateTimeline) {
      return;
    }

    const currentIncidentState: IncidentState | undefined = incidentStates.find(
      (state: IncidentState) => {
        return (
          state.id?.toString() ===
          currentEpisodeStateTimeline.incidentStateId?.toString()
        );
      },
    );

    setCurrentIncidentState(currentIncidentState);
  }, [incidentStates, episodeStateTimelines]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <div className="-ml-3 mt-1">
      <ProgressButtons
        id="episode-state-progress-buttons"
        completedStepId={currentIncidentState?.id?.toString() || ""}
        onStepClick={(stepId: string) => {
          const incidentState: IncidentState | undefined = incidentStates.find(
            (state: IncidentState) => {
              return state.id?.toString() === stepId;
            },
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
          modalWidth={ModalWidth.Large}
          modelType={IncidentEpisodeStateTimeline}
          name={"create-episode-state-timeline"}
          title={"Mark Episode as " + selectedIncidentState?.name}
          description={
            "You are about to mark this episode as " +
            selectedIncidentState?.name +
            ". This will also update all incidents in this episode."
          }
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText="Save"
          onBeforeCreate={async (model: IncidentEpisodeStateTimeline) => {
            const projectId: ObjectID | undefined | null =
              ProjectUtil.getCurrentProject()?.id;

            if (!projectId) {
              throw new BadDataException("ProjectId not found.");
            }

            model.projectId = projectId;
            model.incidentEpisodeId = props.episodeId;
            model.incidentStateId = selectedIncidentState!.id!;

            return model;
          }}
          onSuccess={(model: IncidentEpisodeStateTimeline) => {
            const incidentState: IncidentState | undefined =
              incidentStates.find((state: IncidentState) => {
                return (
                  state.id?.toString() === model.incidentStateId?.toString()
                );
              });

            setCurrentIncidentState(incidentState);

            setShowModal(false);
            props.onActionComplete();
          }}
          formProps={{
            name: "create-episode-state-timeline",
            modelType: IncidentEpisodeStateTimeline,
            id: "create-episode-state-timeline",
            fields: [
              {
                field: {
                  privateNoteTemplate: true,
                } as any,
                onChange: (
                  value: string,
                  currentValues: FormValues<IncidentNoteTemplate>,
                  setNewFormValues: (
                    currentFormValues: FormValues<IncidentEpisodeStateTimeline>,
                  ) => void,
                ) => {
                  const selectedTemplate: IncidentNoteTemplate | undefined =
                    incidentNoteTemplates.find(
                      (template: IncidentNoteTemplate) => {
                        return template.id?.toString() === value;
                      },
                    );

                  const note: string = selectedTemplate?.note || "";

                  if (note) {
                    setNewFormValues({
                      ...currentValues,
                      privateNote: note,
                    } as any);
                  }
                },
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: incidentNoteTemplates.map(
                  (template: IncidentNoteTemplate) => {
                    return {
                      value: template.id!.toString(),
                      label: template.templateName || "",
                    };
                  },
                ),
                showIf: () => {
                  return incidentNoteTemplates.length > 0;
                },
                description:
                  "If you have a template for this state change, select it here.",
                title: "Select Note Template",
                required: false,
                overrideFieldKey: "privateNoteTemplate",
                showEvenIfPermissionDoesNotExist: true,
              },
              {
                field: {
                  privateNote: true,
                } as any,
                fieldType: FormFieldSchemaType.Markdown,
                description: "Post a private note about this state change.",
                title: "Private Note",
                required: false,
                overrideFieldKey: "privateNote",
                showEvenIfPermissionDoesNotExist: true,
              },
            ],
            formType: FormType.Create,
          }}
        />
      )}
    </div>
  );
};

export default ChangeEpisodeState;
