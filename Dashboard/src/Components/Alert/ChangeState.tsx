import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
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
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

export interface ComponentProps {
  alertId: ObjectID;
  onActionComplete: () => void;
}

const ChangeAlertState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);

  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [alertNoteTemplates, setAlertNoteTemplates] = useState<
    AlertNoteTemplate[]
  >([]);

  const [alertStates, setAlertStates] = useState<AlertState[]>([]);
  const [currentAlertState, setCurrentAlertState] = useState<
    AlertState | undefined
  >(undefined);

  const [selectedAlertState, setSelectedAlertState] = useState<
    AlertState | undefined
  >(undefined);

  const [alertStateTimelines, setAlertStateTimelines] = useState<
    AlertStateTimeline[]
  >([]);

  const fetchAlertNoteTemplates: PromiseVoidFunction =
    async (): Promise<void> => {
      const alertNoteTemplates: ListResult<AlertNoteTemplate> =
        await ModelAPI.getList<AlertNoteTemplate>({
          modelType: AlertNoteTemplate,
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

      setAlertNoteTemplates(alertNoteTemplates.data);
    };

  const fetchAlertStates: PromiseVoidFunction = async (): Promise<void> => {
    const projectId: ObjectID | undefined | null =
      ProjectUtil.getCurrentProject()?.id;

    if (!projectId) {
      throw new BadDataException("ProjectId not found.");
    }

    const alertStates: ListResult<AlertState> =
      await ModelAPI.getList<AlertState>({
        modelType: AlertState,
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

    setAlertStates(alertStates.data);
  };

  const fetchAlertStateTimelines: PromiseVoidFunction =
    async (): Promise<void> => {
      const alertStateTimelines: ListResult<AlertStateTimeline> =
        await ModelAPI.getList<AlertStateTimeline>({
          modelType: AlertStateTimeline,
          query: {
            alertId: props.alertId,
          },
          limit: 99,
          skip: 0,
          select: {
            _id: true,
            alertStateId: true,
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
          requestOptions: {},
        });

      setAlertStateTimelines(alertStateTimelines.data);
    };

  const loadPage: PromiseVoidFunction = async () => {
    try {
      setIsLoading(true);
      setError("");
      await fetchAlertNoteTemplates();
      await fetchAlertStates();
      await fetchAlertStateTimelines();
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
    if (alertStates.length === 0 || alertStateTimelines.length === 0) {
      return;
    }

    const currentAlertStateTimeline: AlertStateTimeline | undefined =
      alertStateTimelines[alertStateTimelines.length - 1];

    if (!currentAlertStateTimeline) {
      return;
    }

    const currentAlertState: AlertState | undefined = alertStates.find(
      (state: AlertState) => {
        return (
          state.id?.toString() ===
          currentAlertStateTimeline.alertStateId?.toString()
        );
      },
    );

    setCurrentAlertState(currentAlertState);
  }, [alertStates, alertStateTimelines]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <div className="-ml-3 mt-1">
      <ProgressButtons
        id="alert-state-progress-buttons"
        completedStepId={currentAlertState?.id?.toString() || ""}
        onStepClick={(stepId: string) => {
          const alertState: AlertState | undefined = alertStates.find(
            (state: AlertState) => {
              return state.id?.toString() === stepId;
            },
          );

          setSelectedAlertState(alertState);
          setShowModal(true);
        }}
        progressButtonItems={alertStates.map((state: AlertState) => {
          return {
            id: state.id?.toString() || "",
            title: state.name || "",
            color: state.color || Black,
          };
        })}
      />

      {showModal && (
        <ModelFormModal
          modelType={AlertStateTimeline}
          name={"create-alert-state-timeline"}
          title={"Mark Alert as " + selectedAlertState?.name}
          description={
            "You are about to mark this alert as " +
            selectedAlertState?.name +
            "."
          }
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText="Save"
          onBeforeCreate={async (model: AlertStateTimeline) => {
            const projectId: ObjectID | undefined | null =
              ProjectUtil.getCurrentProject()?.id;

            if (!projectId) {
              throw new BadDataException("ProjectId not found.");
            }

            model.projectId = projectId;
            model.alertId = props.alertId;
            model.alertStateId = selectedAlertState!.id!;

            return model;
          }}
          onSuccess={(model: AlertStateTimeline) => {
            //get alert state and update current alert state
            const alertState: AlertState | undefined = alertStates.find(
              (state: AlertState) => {
                return state.id?.toString() === model.alertStateId?.toString();
              },
            );

            setCurrentAlertState(alertState);

            setShowModal(false);
            props.onActionComplete();
          }}
          formProps={{
            name: "create-scheduled-maintenance-state-timeline",
            modelType: AlertStateTimeline,
            id: "create-scheduled-maintenance-state-timeline",
            fields: [
              {
                field: {
                  privateNoteTemplate: true,
                } as any,
                onChange: (
                  value: string,
                  currentValues: FormValues<AlertNoteTemplate>,
                  setNewFormValues: (
                    currentFormValues: FormValues<AlertStateTimeline>,
                  ) => void,
                ) => {
                  // get note template by id
                  const selectedTemplate: AlertNoteTemplate | undefined =
                    alertNoteTemplates.find((template: AlertNoteTemplate) => {
                      return template.id?.toString() === value;
                    });

                  const note: string = selectedTemplate?.note || "";

                  if (note) {
                    setNewFormValues({
                      ...currentValues,
                      privateNote: note,
                    } as any);
                  }
                },
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: alertNoteTemplates.map(
                  (template: AlertNoteTemplate) => {
                    return {
                      value: template.id!.toString(),
                      label: template.templateName || "",
                    };
                  },
                ),
                showIf: () => {
                  return alertNoteTemplates.length > 0;
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
                description:
                  "Post a private note about this state change to the status page.",
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

export default ChangeAlertState;
