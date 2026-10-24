import PageComponentProps from "../PageComponentProps";
import EventNotes from "../../Components/EventNotes/EventNotes";
import EventStatBar from "../../Components/EventView/EventStatBar";
import EventStatTile from "../../Components/EventView/EventStatTile";
import MitreAttackChips from "../../Components/SecurityCase/MitreAttackChips";
import {
  CloseSecurityCaseModal,
  DeclareIncidentFromCaseModal,
  RunSecurityPlaybookModal,
} from "../../Components/SecurityCase/SecurityCaseActionModals";
import SecurityCaseAiCard from "../../Components/SecurityCase/SecurityCaseAiCard";
import SecurityCaseDetections from "../../Components/SecurityCase/SecurityCaseDetections";
import SecurityCaseEntitiesCard from "../../Components/SecurityCase/SecurityCaseEntitiesCard";
import SecurityCaseFeed from "../../Components/SecurityCase/SecurityCaseFeed";
import SecurityCaseHeader from "../../Components/SecurityCase/SecurityCaseHeader";
import { getSecurityCaseNoteKind } from "../../Components/SecurityCase/SecurityCaseNoteKind";
import { readSecurityEntities } from "../../Components/SecurityCase/SecurityEntityChips";
import {
  getSecurityCaseAssigneePickerConfig,
  getSecurityCaseTeamPickerConfig,
} from "../../Components/SecurityCase/SecurityCaseAssigneePicker";
import SecurityCasePlaybookRuns from "../../Components/SecurityPlaybook/SecurityCasePlaybookRuns";
import useSecurityCaseValues from "../../Components/SecurityCase/useSecurityCaseValues";
import { getSecurityEventsBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Label from "Common/Models/DatabaseModels/Label";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import { formatDurationInMinutes } from "Common/Utils/SecurityCase/SecurityOverviewMetrics";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import Page from "Common/UI/Components/Page/Page";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

type CaseDialog =
  | "close"
  | "runPlaybook"
  | "declareIncident"
  | "edit"
  | "delete"
  | null;

// Minutes from one moment to another, or null when either is missing.
export function minutesBetween(
  from: Date | undefined,
  to: Date | undefined,
): number | null {
  if (!from || !to) {
    return null;
  }

  const minutes: number =
    (new Date(to).getTime() - new Date(from).getTime()) / (60 * 1000);

  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

/*
 * One security case, worked on a page of its own: the header to move it
 * along, the detections and entities it is about, the playbooks that ran on
 * it, its notes and its timeline. Everything on it refreshes as the case
 * changes - a playbook step, a colleague's note, a detection joining it.
 */
const SecurityCaseViewPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const caseId: ObjectID = Navigation.getLastParamAsObjectID();
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [securityCase, setSecurityCase] = useState<SecurityCase | null>(null);
  // The project's case priorities and statuses, which the case is drawn with.
  const {
    values,
    error: valuesError,
    retry: retryValues,
  } = useSecurityCaseValues();
  // The status Close Case (or a closing step) closes the case into.
  const [closeToStatus, setCloseToStatus] = useState<SecurityCaseStatus | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [dialog, setDialog] = useState<CaseDialog>(null);
  // The playbook Run Playbook starts on: the one OneUptime AI suggested.
  const [playbookToRun, setPlaybookToRun] = useState<ObjectID | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>("");

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const item: SecurityCase | null = await ModelAPI.getItem<SecurityCase>({
        modelType: SecurityCase,
        id: caseId,
        select: {
          _id: true,
          caseNumberWithPrefix: true,
          title: true,
          description: true,
          securityCaseStatusId: true,
          securityCasePriorityId: true,
          verdict: true,
          closingNote: true,
          source: true,
          entities: true,
          mitreTactics: true,
          mitreTechniques: true,
          detectionCount: true,
          firstDetectedAt: true,
          lastDetectedAt: true,
          acknowledgedAt: true,
          containedAt: true,
          closedAt: true,
          createdAt: true,
          incidentId: true,
          incident: {
            _id: true,
            incidentNumberWithPrefix: true,
          },
          assignedToUserId: true,
          assignedToUser: {
            _id: true,
            name: true,
            email: true,
            profilePictureId: true,
          },
          assignedToTeamId: true,
          assignedToTeam: {
            _id: true,
            name: true,
          },
          labels: {
            _id: true,
            name: true,
            color: true,
          },
          // OneUptime AI's triage of the case, for its AI card.
          aiVerdict: true,
          aiSuggestedSecurityCasePriorityId: true,
          aiSuggestedPlaybookId: true,
          aiTriageReport: true,
          aiTriagedAt: true,
          aiTriagePromptInjectionSuspected: true,
        },
      });

      if (!item) {
        setError(translator.translateText("This case does not exist.") || "");
      } else {
        setSecurityCase(item);
        setError("");
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  }, [caseId.toString()]);

  useEffect(() => {
    setIsLoading(true);
    void load();
  }, [load]);

  // Live: a colleague's change, a playbook step or a new detection on this case.
  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const stopListening: () => void = Realtime.listenToModelEvent<SecurityCase>(
      {
        eventType: ModelEventType.Update,
        modelType: SecurityCase,
        tenantId: projectId,
        modelId: caseId,
      },
      (modelId: ObjectID) => {
        if (modelId.toString() === caseId.toString()) {
          void load();
          setRefreshToggle(Date.now().toString());
        }
      },
    );

    return () => {
      stopListening();
    };
  }, [caseId.toString(), load]);

  const refreshAll: () => void = (): void => {
    void load();
    setRefreshToggle(Date.now().toString());
  };

  const updateCase: (data: Record<string, string>) => Promise<void> = async (
    data: Record<string, string>,
  ): Promise<void> => {
    setIsWorking(true);
    setActionError("");

    try {
      await ModelAPI.updateById<SecurityCase>({
        modelType: SecurityCase,
        id: caseId,
        data: data,
      });
      refreshAll();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsWorking(false);
  };

  const breadcrumbs: ReturnType<typeof getSecurityEventsBreadcrumbs> =
    getSecurityEventsBreadcrumbs(path);

  if (valuesError && !values) {
    return (
      <Page title="Case" breadcrumbLinks={breadcrumbs}>
        <ErrorMessage message={valuesError} onRefreshClick={retryValues} />
      </Page>
    );
  }

  if ((isLoading && !securityCase) || (!values && !error)) {
    return (
      <Page title="Case" breadcrumbLinks={breadcrumbs} isLoading={true}>
        <></>
      </Page>
    );
  }

  if (error || !securityCase || !values) {
    return (
      <Page title="Case" breadcrumbLinks={breadcrumbs}>
        <ErrorMessage message={error || "This case could not be loaded."} />
      </Page>
    );
  }

  const isClosed: boolean = SecurityCaseStatuses.isClosed(
    values.statuses,
    securityCase.securityCaseStatusId,
  );
  const projectClosedStatus: SecurityCaseStatus | null =
    SecurityCaseStatuses.getStatusOfStage(
      values.statuses,
      SecurityCaseStage.Closed,
    );

  const entities: ReturnType<typeof readSecurityEntities> =
    readSecurityEntities(securityCase.entities);
  const openFor: number | null = minutesBetween(
    securityCase.createdAt,
    securityCase.closedAt || OneUptimeDate.getCurrentDate(),
  );
  const timeToAcknowledge: number | null = minutesBetween(
    securityCase.createdAt,
    securityCase.acknowledgedAt,
  );
  const timeToContain: number | null = minutesBetween(
    securityCase.createdAt,
    securityCase.containedAt,
  );

  return (
    <Page
      title={securityCase.caseNumberWithPrefix || "Case"}
      breadcrumbLinks={breadcrumbs}
    >
      <div className="space-y-6">
        {actionError ? <ErrorMessage message={actionError} /> : <></>}

        <SecurityCaseHeader
          securityCase={securityCase}
          values={values}
          isWorking={isWorking}
          onAssignToMe={() => {
            void updateCase({ assignedToUserId: User.getUserId().toString() });
          }}
          onChangeStatus={(status: SecurityCaseStatus) => {
            // A status that closes the case asks for its verdict first.
            if (
              !isClosed &&
              SecurityCaseStatuses.isClosed(values.statuses, status.id)
            ) {
              setCloseToStatus(status);
              setDialog("close");
              return;
            }

            void updateCase({
              securityCaseStatusId: status.id!.toString(),
            });
          }}
          onChangePriority={(priority: SecurityCasePriority) => {
            void updateCase({
              securityCasePriorityId: priority.id!.toString(),
            });
          }}
          onRunPlaybook={() => {
            setPlaybookToRun(null);
            setDialog("runPlaybook");
          }}
          onDeclareIncident={() => {
            setDialog("declareIncident");
          }}
          onEdit={() => {
            setDialog("edit");
          }}
          onDelete={() => {
            setDialog("delete");
          }}
        />

        <EventStatBar
          columns={4}
          ariaLabel={translator.translateText("Case figures")}
        >
          <EventStatTile
            variant="segment"
            icon={IconProp.Bolt}
            label="Detections"
            value={String(securityCase.detectionCount || 0)}
            description={
              securityCase.firstDetectedAt
                ? translator.translateTemplate("First {{when}}", {
                    when: OneUptimeDate.fromNow(securityCase.firstDetectedAt),
                  })
                : undefined
            }
          />
          <EventStatTile
            variant="segment"
            icon={IconProp.Clock}
            label={isClosed ? "Took" : "Open For"}
            value={formatDurationInMinutes(openFor)}
          />
          <EventStatTile
            variant="segment"
            icon={IconProp.User}
            label="Time to Acknowledge"
            value={formatDurationInMinutes(timeToAcknowledge)}
          />
          <EventStatTile
            variant="segment"
            icon={IconProp.ShieldCheck}
            label="Time to Contain"
            value={formatDurationInMinutes(timeToContain)}
          />
        </EventStatBar>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="min-w-0 space-y-6 xl:col-span-2">
            {/*
              What OneUptime AI made of the case, first: the read an analyst
              starts from. Not drawn at all with the project's AI off.
            */}
            <SecurityCaseAiCard
              securityCase={securityCase}
              priorities={values.priorities}
              refreshToggle={refreshToggle}
              isWorking={isWorking}
              onTriaged={refreshAll}
              onSetPriority={(priority: SecurityCasePriority) => {
                void updateCase({
                  securityCasePriorityId: priority.id!.toString(),
                });
              }}
              onRunPlaybook={(playbookId: ObjectID) => {
                setPlaybookToRun(playbookId);
                setDialog("runPlaybook");
              }}
            />
            <SecurityCaseDetections
              securityCaseId={caseId}
              refreshToggle={refreshToggle}
            />
            <SecurityCasePlaybookRuns
              securityCaseId={caseId}
              refreshToggle={refreshToggle}
              onRunPlaybook={() => {
                setPlaybookToRun(null);
                setDialog("runPlaybook");
              }}
              onRunsChanged={refreshAll}
            />
            <SecurityCaseFeed key={refreshToggle} securityCaseId={caseId} />
          </div>
          <div className="min-w-0 space-y-6">
            <SecurityCaseEntitiesCard entities={entities} />
            <Card
              title="MITRE ATT&CK"
              description="The tactics and techniques this case's detections map to."
            >
              <MitreAttackChips
                tactics={securityCase.mitreTactics || []}
                techniques={securityCase.mitreTechniques || []}
                emptyText="None of this case's detections is mapped to ATT&CK."
              />
            </Card>
            <EventNotes
              {...getSecurityCaseNoteKind({ securityCaseId: caseId })}
              currentProject={props.currentProject}
            />
          </div>
        </div>
      </div>

      {dialog === "close" && (closeToStatus || projectClosedStatus) ? (
        <CloseSecurityCaseModal
          securityCase={securityCase}
          closeToStatus={(closeToStatus || projectClosedStatus)!}
          isProjectClosedStatus={
            !closeToStatus ||
            closeToStatus.id?.toString() === projectClosedStatus?.id?.toString()
          }
          onClose={() => {
            setDialog(null);
          }}
          onDone={() => {
            setDialog(null);
            refreshAll();
          }}
        />
      ) : (
        <></>
      )}

      {dialog === "runPlaybook" ? (
        <RunSecurityPlaybookModal
          securityCase={securityCase}
          initialPlaybookId={playbookToRun || undefined}
          onClose={() => {
            setDialog(null);
          }}
          onDone={() => {
            setDialog(null);
            refreshAll();
          }}
        />
      ) : (
        <></>
      )}

      {dialog === "declareIncident" ? (
        <DeclareIncidentFromCaseModal
          securityCase={securityCase}
          onClose={() => {
            setDialog(null);
          }}
          onDeclared={() => {
            // The header links to the incident once the case is read again.
          }}
          onDone={() => {
            setDialog(null);
            refreshAll();
          }}
        />
      ) : (
        <></>
      )}

      {dialog === "edit" ? (
        <ModelFormModal<SecurityCase>
          title="Edit Case"
          modelType={SecurityCase}
          name="Edit Security Case"
          modalWidth={ModalWidth.Large}
          submitButtonText="Save"
          onClose={() => {
            setDialog(null);
          }}
          onSuccess={() => {
            setDialog(null);
            refreshAll();
          }}
          formProps={{
            name: "security-case-edit",
            modelType: SecurityCase,
            id: "security-case-edit",
            formType: FormType.Update,
            steps: [
              { title: "Case", id: "case" },
              { title: "Assignment", id: "assignment" },
            ],
            fields: [
              {
                field: { title: true },
                stepId: "case",
                title: "Title",
                fieldType: FormFieldSchemaType.Text,
                required: true,
              },
              {
                field: { description: true },
                stepId: "case",
                title: "Description",
                fieldType: FormFieldSchemaType.Markdown,
                required: false,
              },
              {
                field: { assignedToUserId: true },
                stepId: "assignment",
                title: "Assign To",
                fieldType: FormFieldSchemaType.PeoplePicker,
                required: false,
                peoplePicker: getSecurityCaseAssigneePickerConfig(),
              },
              {
                field: { assignedToTeamId: true },
                stepId: "assignment",
                title: "Team",
                fieldType: FormFieldSchemaType.PeoplePicker,
                required: false,
                peoplePicker: getSecurityCaseTeamPickerConfig(),
              },
              {
                field: { labels: true },
                stepId: "assignment",
                title: "Labels",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                required: false,
                dropdownModal: {
                  type: Label,
                  labelField: "name",
                  valueField: "_id",
                },
              },
            ],
          }}
          modelIdToEdit={caseId}
        />
      ) : (
        <></>
      )}

      {dialog === "delete" ? (
        <ConfirmModal
          title="Delete Case"
          description={translator.translateTemplate(
            "{{case}} and its detections, notes and timeline are deleted for good. To keep the record, close it with a verdict instead.",
            {
              case: `${securityCase.caseNumberWithPrefix || ""} ${
                securityCase.title || ""
              }`.trim(),
            },
          )}
          submitButtonText="Delete Case"
          submitButtonType={ButtonStyleType.DANGER}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={async () => {
            setDialog(null);
            setIsWorking(true);

            try {
              await ModelAPI.deleteItem<SecurityCase>({
                modelType: SecurityCase,
                id: caseId,
              });
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SECURITY_CASES] as Route,
                ),
              );
            } catch (err) {
              setActionError(API.getFriendlyMessage(err));
              setIsWorking(false);
            }
          }}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default SecurityCaseViewPage;
