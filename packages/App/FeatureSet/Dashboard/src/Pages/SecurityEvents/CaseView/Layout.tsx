import PageComponentProps from "../../PageComponentProps";
import {
  CloseSecurityCaseModal,
  DeclareIncidentFromCaseModal,
  RunSecurityPlaybookModal,
} from "../../../Components/SecurityCase/SecurityCaseActionModals";
import {
  getSecurityCaseAssigneePickerConfig,
  getSecurityCaseTeamPickerConfig,
} from "../../../Components/SecurityCase/SecurityCaseAssigneePicker";
import SecurityCaseHeader from "../../../Components/SecurityCase/SecurityCaseHeader";
import SecurityCaseNotFound, {
  SecurityCaseNotFoundReason,
} from "../../../Components/SecurityCase/SecurityCaseNotFound";
import {
  SECURITY_CASE_VIEW_SELECT,
  getSecurityCaseRecordName,
} from "../../../Components/SecurityCase/SecurityCaseViewSelect";
import useSecurityCaseValues from "../../../Components/SecurityCase/useSecurityCaseValues";
import { getSecurityEventsBreadcrumbs } from "../../../Utils/Breadcrumbs";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SecurityCaseSideMenu from "./SideMenu";
import SecurityCaseViewContext from "./SecurityCaseViewContext";
import Label from "Common/Models/DatabaseModels/Label";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import Page from "Common/UI/Components/Page/Page";
import { nameRecordInTrail } from "Common/UI/Components/Page/RecordNameInTrail";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Outlet, matchPath, useLocation, useParams } from "react-router-dom";

type CaseDialog =
  | "close"
  | "runPlaybook"
  | "declareIncident"
  | "edit"
  | "delete"
  | null;

/*
 * The case as it was last read, stamped with the id it was read for, so a
 * case read for the page the reader just left is never shown for the one
 * they are on.
 */
interface LoadedCase {
  caseId: string;
  securityCase: SecurityCase | null;
  // Why it could not be read; "" when it was, or when it is not there.
  error: string;
}

/*
 * One security case, worked on pages of its own under a side menu of its
 * own, as an incident is (SecurityCaseNavigation.ts): its Overview, its
 * Timeline, its Detections, Entities and Playbook Runs, its Private Notes,
 * and under Advanced its Audit Logs and Delete Case.
 *
 * The layout reads the case once for all of them, keeps it fresh - a
 * colleague's change, a playbook step or a detection joining it bumps
 * every page - and draws its header on top of each: in full on the
 * Overview, compact on the others, with the same actions on every one. The
 * actions' dialogs live here too, so Close Case, Run Playbook, Declare
 * Incident, Edit Case and Delete Case work the same from any page. The
 * crumb that stands for the case names it by its number.
 *
 * A case that is not there, or that the reader may not read, says so in
 * place of its pages, with the way back to the queue.
 */
const SecurityCaseViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { id } = useParams();
  const location: ReturnType<typeof useLocation> = useLocation();
  /*
   * Keyed on the id's string, not the ObjectID: a new ObjectID is built
   * from the route params on every render.
   */
  const caseIdString: string = id || "";
  const caseId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(caseIdString);
  }, [caseIdString]);
  const isIdValid: boolean = ObjectID.isValidUUID(caseIdString);
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const isOverview: boolean = Boolean(
    matchPath(
      {
        path: (RouteMap[PageMap.SECURITY_CASE_VIEW] as Route).toString(),
        end: true,
      },
      location.pathname,
    ),
  );

  // The project's case priorities and statuses, which the case is drawn with.
  const {
    values,
    error: valuesError,
    retry: retryValues,
  } = useSecurityCaseValues();

  const [loaded, setLoaded] = useState<LoadedCase | null>(null);
  const [actionError, setActionError] = useState<string>("");
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [dialog, setDialog] = useState<CaseDialog>(null);
  // The status Close Case (or a closing step) closes the case into.
  const [closeToStatus, setCloseToStatus] = useState<SecurityCaseStatus | null>(
    null,
  );
  // The playbook Run Playbook starts on: the one OneUptime AI suggested.
  const [playbookToRun, setPlaybookToRun] = useState<ObjectID | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>("");

  /*
   * Bumped by every read, when the case changes and on unmount: a read
   * only lands while no newer one has started.
   */
  const latestReadRef: MutableRefObject<number> = useRef<number>(0);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const readNumber: number = latestReadRef.current + 1;
    latestReadRef.current = readNumber;

    let result: LoadedCase;

    if (!isIdValid) {
      // Not a case's id at all: nothing to ask the server.
      result = { caseId: caseIdString, securityCase: null, error: "" };
    } else {
      try {
        const item: SecurityCase | null = await ModelAPI.getItem<SecurityCase>({
          modelType: SecurityCase,
          id: caseId,
          select: SECURITY_CASE_VIEW_SELECT,
        });

        result = { caseId: caseIdString, securityCase: item, error: "" };
      } catch (err) {
        result = {
          caseId: caseIdString,
          securityCase: null,
          error: API.getFriendlyMessage(err),
        };
      }
    }

    if (readNumber !== latestReadRef.current) {
      return;
    }

    setLoaded((previous: LoadedCase | null): LoadedCase => {
      /*
       * A refresh that fails keeps the case already on screen: a network
       * blip is not a reason to take a case the reader could see a moment
       * ago away from them.
       */
      if (
        result.error &&
        previous &&
        previous.caseId === result.caseId &&
        previous.securityCase
      ) {
        return previous;
      }

      return result;
    });
  }, [caseIdString]);

  useEffect(() => {
    setDialog(null);
    setActionError("");
    void load();

    return () => {
      latestReadRef.current++;
    };
  }, [load]);

  const refreshAll: () => void = useCallback((): void => {
    void load();
    setRefreshToggle(Date.now().toString());
    // The side menu's count of runs waiting for an approval.
    GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
  }, [load]);

  // Live: a colleague's change, a playbook step or a new detection on this case.
  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId || !isIdValid) {
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
        if (modelId.toString() === caseIdString) {
          refreshAll();
        }
      },
    );

    return () => {
      stopListening();
    };
  }, [caseIdString, refreshAll]);

  const updateCase: (data: JSONObject) => Promise<void> = useCallback(
    async (data: JSONObject): Promise<void> => {
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
    },
    [caseIdString, refreshAll],
  );

  const openRunPlaybook: (playbookId?: ObjectID | undefined) => void =
    useCallback((playbookId?: ObjectID | undefined): void => {
      setPlaybookToRun(playbookId || null);
      setDialog("runPlaybook");
    }, []);

  const requestDelete: () => void = useCallback((): void => {
    setDialog("delete");
  }, []);

  const isCurrentCaseLoaded: boolean =
    loaded !== null && loaded.caseId === caseIdString;
  const securityCase: SecurityCase | null = isCurrentCaseLoaded
    ? loaded!.securityCase
    : null;

  const context: SecurityCaseViewContext | null =
    useMemo((): SecurityCaseViewContext | null => {
      if (!securityCase || !values) {
        return null;
      }

      return {
        caseId: caseId,
        securityCase: securityCase,
        values: values,
        refreshToggle: refreshToggle,
        isWorking: isWorking,
        refresh: refreshAll,
        updateCase: updateCase,
        runPlaybook: openRunPlaybook,
        requestDelete: requestDelete,
      };
    }, [
      securityCase,
      values,
      refreshToggle,
      isWorking,
      refreshAll,
      updateCase,
      openRunPlaybook,
      requestDelete,
    ]);

  const breadcrumbs: Array<Link> | undefined = nameRecordInTrail({
    links: getSecurityEventsBreadcrumbs(path),
    recordId: caseIdString,
    recordName: securityCase ? getSecurityCaseRecordName(securityCase) : null,
  });

  const sideMenu: ReactElement = <SecurityCaseSideMenu modelId={caseId} />;

  // The project's statuses and priorities could not be read, nor the case drawn.
  if (valuesError && !values) {
    return (
      <Page breadcrumbLinks={breadcrumbs}>
        <SecurityCaseNotFound
          reason={SecurityCaseNotFoundReason.LoadFailed}
          error={valuesError}
          onTryAgain={retryValues}
        />
      </Page>
    );
  }

  if (!isCurrentCaseLoaded || !values) {
    return (
      <Page breadcrumbLinks={breadcrumbs} sideMenu={sideMenu} isLoading={true}>
        <></>
      </Page>
    );
  }

  if (!securityCase) {
    const readGate: PermissionGateResult = PermissionGate.check(
      new SecurityCase(),
      ModelAction.Read,
    );

    const reason: SecurityCaseNotFoundReason = loaded!.error
      ? SecurityCaseNotFoundReason.LoadFailed
      : !readGate.isAllowed && readGate.disabledReason
        ? SecurityCaseNotFoundReason.NoAccess
        : SecurityCaseNotFoundReason.NotFound;

    return (
      <Page breadcrumbLinks={breadcrumbs}>
        <SecurityCaseNotFound
          reason={reason}
          error={loaded!.error || readGate.disabledReason}
          onTryAgain={() => {
            setLoaded(null);
            void load();
          }}
        />
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

  return (
    <Page breadcrumbLinks={breadcrumbs} sideMenu={sideMenu}>
      <>
        {actionError ? (
          <Alert
            type={AlertType.DANGER}
            title={actionError}
            dataTestId="security-case-action-error"
            onClose={() => {
              setActionError("");
            }}
          />
        ) : (
          <></>
        )}

        <SecurityCaseHeader
          securityCase={securityCase}
          values={values}
          layout={isOverview ? "full" : "compact"}
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
            openRunPlaybook();
          }}
          onDeclareIncident={() => {
            setDialog("declareIncident");
          }}
          onEdit={() => {
            setDialog("edit");
          }}
          onDelete={requestDelete}
        />

        {/* Each page of the case starts afresh for another case. */}
        <React.Fragment key={caseIdString}>
          <Outlet context={context} />
        </React.Fragment>

        {dialog === "close" && (closeToStatus || projectClosedStatus) ? (
          <CloseSecurityCaseModal
            securityCase={securityCase}
            closeToStatus={(closeToStatus || projectClosedStatus)!}
            isProjectClosedStatus={
              !closeToStatus ||
              closeToStatus.id?.toString() ===
                projectClosedStatus?.id?.toString()
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
      </>
    </Page>
  );
};

export default SecurityCaseViewLayout;
