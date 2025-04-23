import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
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
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

export interface ComponentProps {
  scheduledMaintenanceId: ObjectID;
  onActionComplete: () => void;
}

const ChangeScheduledMaintenanceState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);

  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [
    scheduledMaintenanceNoteTemplates,
    setScheduledMaintenanceNoteTemplates,
  ] = useState<ScheduledMaintenanceNoteTemplate[]>([]);

  const [scheduledMaintenanceStates, setScheduledMaintenanceStates] = useState<
    ScheduledMaintenanceState[]
  >([]);
  const [
    currentScheduledMaintenanceState,
    setCurrentScheduledMaintenanceState,
  ] = useState<ScheduledMaintenanceState | undefined>(undefined);

  const [
    selectedScheduledMaintenanceState,
    setSelectedScheduledMaintenanceState,
  ] = useState<ScheduledMaintenanceState | undefined>(undefined);

  const [
    scheduledMaintenanceStateTimelines,
    setScheduledMaintenanceStateTimelines,
  ] = useState<ScheduledMaintenanceStateTimeline[]>([]);

  const fetchScheduledMaintenanceNoteTemplates: PromiseVoidFunction =
    async (): Promise<void> => {
      const scheduledMaintenanceNoteTemplates: ListResult<ScheduledMaintenanceNoteTemplate> =
        await ModelAPI.getList<ScheduledMaintenanceNoteTemplate>({
          modelType: ScheduledMaintenanceNoteTemplate,
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

      setScheduledMaintenanceNoteTemplates(
        scheduledMaintenanceNoteTemplates.data,
      );
    };

  const fetchScheduledMaintenanceStates: PromiseVoidFunction =
    async (): Promise<void> => {
      const projectId: ObjectID | undefined | null =
        ProjectUtil.getCurrentProject()?.id;

      if (!projectId) {
        throw new BadDataException("ProjectId not found.");
      }

      const scheduledMaintenanceStates: ListResult<ScheduledMaintenanceState> =
        await ModelAPI.getList<ScheduledMaintenanceState>({
          modelType: ScheduledMaintenanceState,
          query: {
            projectId: projectId,
          },
          limit: 99,
          skip: 0,
          select: {
            _id: true,
            isResolvedState: true,
            isOngoingState: true,
            isScheduledState: true,
            isEndedState: true,
            name: true,
            color: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
          requestOptions: {},
        });

      setScheduledMaintenanceStates(scheduledMaintenanceStates.data);
    };

  const fetchScheduledMaintenanceStateTimelines: PromiseVoidFunction =
    async (): Promise<void> => {
      const scheduledMaintenanceStateTimelines: ListResult<ScheduledMaintenanceStateTimeline> =
        await ModelAPI.getList<ScheduledMaintenanceStateTimeline>({
          modelType: ScheduledMaintenanceStateTimeline,
          query: {
            scheduledMaintenanceId: props.scheduledMaintenanceId,
          },
          limit: 99,
          skip: 0,
          select: {
            _id: true,
            scheduledMaintenanceStateId: true,
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
          requestOptions: {},
        });

      setScheduledMaintenanceStateTimelines(
        scheduledMaintenanceStateTimelines.data,
      );
    };

  const loadPage: PromiseVoidFunction = async () => {
    try {
      setIsLoading(true);
      setError("");

      await fetchScheduledMaintenanceStates();
      await fetchScheduledMaintenanceStateTimelines();
      await fetchScheduledMaintenanceNoteTemplates();
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
    if (
      scheduledMaintenanceStates.length === 0 ||
      scheduledMaintenanceStateTimelines.length === 0
    ) {
      return;
    }

    const currentScheduledMaintenanceStateTimeline:
      | ScheduledMaintenanceStateTimeline
      | undefined =
      scheduledMaintenanceStateTimelines[
        scheduledMaintenanceStateTimelines.length - 1
      ];

    if (!currentScheduledMaintenanceStateTimeline) {
      return;
    }

    const currentScheduledMaintenanceState:
      | ScheduledMaintenanceState
      | undefined = scheduledMaintenanceStates.find(
      (state: ScheduledMaintenanceState) => {
        return (
          state.id?.toString() ===
          currentScheduledMaintenanceStateTimeline.scheduledMaintenanceStateId?.toString()
        );
      },
    );

    setCurrentScheduledMaintenanceState(currentScheduledMaintenanceState);
  }, [scheduledMaintenanceStates, scheduledMaintenanceStateTimelines]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <div className="-ml-3 mt-1">
      <ProgressButtons
        id="scheduledMaintenance-state-progress-buttons"
        completedStepId={currentScheduledMaintenanceState?.id?.toString() || ""}
        onStepClick={(stepId: string) => {
          const scheduledMaintenanceState:
            | ScheduledMaintenanceState
            | undefined = scheduledMaintenanceStates.find(
            (state: ScheduledMaintenanceState) => {
              return state.id?.toString() === stepId;
            },
          );

          setSelectedScheduledMaintenanceState(scheduledMaintenanceState);
          setShowModal(true);
        }}
        progressButtonItems={scheduledMaintenanceStates.map(
          (state: ScheduledMaintenanceState) => {
            return {
              id: state.id?.toString() || "",
              title: state.name || "",
              color: state.color || Black,
            };
          },
        )}
      />

      {showModal && (
        <ModelFormModal
          modelType={ScheduledMaintenanceStateTimeline}
          name={"create-scheduledMaintenance-state-timeline"}
          title={
            "Mark Scheduled Maintenance as " +
            selectedScheduledMaintenanceState?.name
          }
          description={
            "You are about to mark this scheduled maintenance as " +
            selectedScheduledMaintenanceState?.name +
            "."
          }
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText="Save"
          onBeforeCreate={async (model: ScheduledMaintenanceStateTimeline) => {
            const projectId: ObjectID | undefined | null =
              ProjectUtil.getCurrentProject()?.id;

            if (!projectId) {
              throw new BadDataException("ProjectId not found.");
            }

            model.projectId = projectId;
            model.scheduledMaintenanceId = props.scheduledMaintenanceId;
            model.scheduledMaintenanceStateId =
              selectedScheduledMaintenanceState!.id!;

            return model;
          }}
          onSuccess={(model: ScheduledMaintenanceStateTimeline) => {
            //get scheduledMaintenance state and update current scheduledMaintenance state
            const scheduledMaintenanceState:
              | ScheduledMaintenanceState
              | undefined = scheduledMaintenanceStates.find(
              (state: ScheduledMaintenanceState) => {
                return (
                  state.id?.toString() ===
                  model.scheduledMaintenanceStateId?.toString()
                );
              },
            );

            setCurrentScheduledMaintenanceState(scheduledMaintenanceState);

            setShowModal(false);
            props.onActionComplete();
          }}
          formProps={{
            name: "create-scheduled-maintenance-state-timeline",
            modelType: ScheduledMaintenanceStateTimeline,
            id: "create-scheduled-maintenance-state-timeline",
            fields: [
              {
                field: {
                  publicNoteTemplate: true,
                } as any,
                onChange: (
                  value: string,
                  currentValues: FormValues<ScheduledMaintenanceNoteTemplate>,
                  setNewFormValues: (
                    currentFormValues: FormValues<ScheduledMaintenanceStateTimeline>,
                  ) => void,
                ) => {
                  // get note template by id
                  const selectedTemplate:
                    | ScheduledMaintenanceNoteTemplate
                    | undefined = scheduledMaintenanceNoteTemplates.find(
                    (template: ScheduledMaintenanceNoteTemplate) => {
                      return template.id?.toString() === value;
                    },
                  );

                  const note: string = selectedTemplate?.note || "";

                  if (note) {
                    setNewFormValues({
                      ...currentValues,
                      publicNote: note,
                    } as any);
                  }
                },
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: scheduledMaintenanceNoteTemplates.map(
                  (template: ScheduledMaintenanceNoteTemplate) => {
                    return {
                      value: template.id!.toString(),
                      label: template.templateName || "",
                    };
                  },
                ),
                showIf: () => {
                  return scheduledMaintenanceNoteTemplates.length > 0;
                },
                description:
                  "If you have a template for this state change, select it here.",
                title: "Select Note Template",
                required: false,
                overrideFieldKey: "publicNoteTemplate",
                showEvenIfPermissionDoesNotExist: true,
              },
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

export default ChangeScheduledMaintenanceState;
