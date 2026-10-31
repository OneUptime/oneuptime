import PageComponentProps from "../../PageComponentProps";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { usePrivateRecordGate } from "Common/UI/Utils/PrivateRecordScope";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import AttachmentList from "../../../Components/Attachment/AttachmentList";
import { getModelIdString } from "../../../Utils/ModelId";
import SubscriberNotificationStatus from "../../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import IncidentPostmortemPublication from "Common/Types/StatusPage/IncidentPostmortemPublication";
import GenerateFromAIModal, {
  GenerateAIRequestData,
} from "Common/UI/Components/AI/GenerateFromAIModal";
import { POSTMORTEM_TEMPLATES } from "Common/UI/Components/AI/AITemplates";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  INCIDENT_POSTMORTEM_FORM_FIELDS,
  INCIDENT_POSTMORTEM_FORM_STEPS,
} from "../../../Components/Postmortem/IncidentPostmortemForm";
import usePostmortemTemplates, {
  PostmortemTemplatesState,
} from "../../../Components/Postmortem/usePostmortemTemplates";
import {
  PostmortemTemplateOption,
  toAITemplates,
} from "../../../Components/Postmortem/PostmortemTemplates";
import PostmortemMoreMenu, {
  hasPostmortemMoreMenuItems,
} from "../../../Components/Postmortem/PostmortemMoreMenu";
import PostmortemEmptyState from "../../../Components/Postmortem/PostmortemEmptyState";
import PostmortemSummary from "../../../Components/Postmortem/PostmortemSummary";
import {
  PostmortemAddOwners,
  useIncidentOwners,
} from "../../../Components/Postmortem/PostmortemOwners";
import {
  canAddOwners,
  OwnersTarget,
} from "../../../Components/Owners/AddOwners";
import usePostmortemStatuses, {
  PostmortemStatusesState,
} from "../../../Components/Postmortem/usePostmortemStatuses";
import useAiOffered from "../../../Utils/UseAiOffered";
import ApplyPostmortemTemplateModal from "../../../Components/Postmortem/ApplyPostmortemTemplateModal";

// Whether the postmortem is on the status page, and so what it says there.
const isPublished: (item: Incident) => boolean = (item: Incident): boolean => {
  return Boolean(item.showPostmortemOnStatusPage);
};

/*
 * An incident's postmortem, in one card: where it stands and who owns it,
 * then what it says, its files, and whether it is on the status page.
 *
 * - Its status - Not Started, Draft, Completed or one of the project's own -
 *   is a pill that opens the project's statuses, and moves by itself as the
 *   postmortem is written and published (Common/Utils/Incident/
 *   PostmortemStatus). Its owners are the incident's owners.
 * - Nothing written yet, the card's one obvious next step is Write
 *   Postmortem, with the two ways to start from something beside it: a
 *   template, once the project has one, and a draft by OneUptime AI, while
 *   AI is on.
 * - Written, Edit Postmortem Note is the card's button, and the template and
 *   the AI draft fold into its ⋯ - they replace the note, which is rarely
 *   what a written postmortem needs. Publishing on the status page stays the
 *   editor's second step.
 */
const IncidentPostmortem: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const isAiOffered: boolean = useAiOffered();

  /*
   * What the reader holds on the incident when it is private: writing its
   * postmortem, moving its status and adding owners are offered only when a
   * team of theirs that owns it may (PrivateRecordScope).
   */
  const privateRecordGate: (
    model: BaseModel,
  ) => PermissionGateOptions | undefined = usePrivateRecordGate();

  const postmortemTemplates: PostmortemTemplatesState =
    usePostmortemTemplates();
  const postmortemStatuses: PostmortemStatusesState = usePostmortemStatuses();
  const [showTemplateModal, setShowTemplateModal] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);
  /*
   * Whether the incident has a postmortem note, once it is read: what the
   * card offers depends on it. Null until the incident is read.
   */
  const [hasNote, setHasNote] = useState<boolean | null>(null);
  /*
   * The note a template or AI wrote, while the postmortem's editor is open
   * on it. Everything else in that editor is what the incident holds.
   */
  const [draftNote, setDraftNote] = useState<string | null>(null);
  // The editor, opened from Write Postmortem.
  const [isWriting, setIsWriting] = useState<boolean>(false);
  const [showAIGenerateModal, setShowAIGenerateModal] =
    useState<boolean>(false);

  // Bumped once an owner was added from the postmortem's own Add owners.
  const [ownersChangeCount, setOwnersChangeCount] = useState<number>(0);

  /*
   * The incident's owners own its postmortem; re-read after every save, and
   * once one was added here.
   */
  const incidentOwners: ReturnType<typeof useIncidentOwners> =
    useIncidentOwners({
      incidentId: modelId,
      refreshToken: `${refreshToggle}-${ownersChangeCount}`,
    });

  const ownersTarget: OwnersTarget = useMemo((): OwnersTarget => {
    return {
      ownerUserModelType: IncidentOwnerUser,
      ownerTeamModelType: IncidentOwnerTeam,
      resourceIdField: "incidentId",
      resourceId: modelId,
    };
  }, [modelId.toString()]);

  const incidentModel: Incident = useMemo((): Incident => {
    return new Incident();
  }, []);

  /*
   * Writing it takes what Edit Postmortem Note takes: the update of the
   * incident and its postmortem's fields (PermissionGate.checkFormUpdate).
   * Moving its status takes the update of the incident.
   */
  const writeGate: PermissionGateResult = PermissionGate.checkFormUpdate(
    incidentModel,
    INCIDENT_POSTMORTEM_FORM_FIELDS,
    privateRecordGate(incidentModel),
  );
  const statusGate: PermissionGateResult = PermissionGate.check(
    incidentModel,
    ModelAction.Update,
    privateRecordGate(incidentModel),
  );
  // Adding a person or a team as an owner, as the Owners page does.
  const addOwners: PostmortemAddOwners | undefined = canAddOwners(
    ownersTarget,
    privateRecordGate(new IncidentOwnerUser()),
  )
    ? {
        target: ownersTarget,
        onOwnersChanged: (): void => {
          setOwnersChangeCount((count: number): number => {
            return count + 1;
          });
        },
      }
    : undefined;

  const refresh: () => void = (): void => {
    setRefreshToggle((previous: boolean) => {
      return !previous;
    });
  };

  const handleResendPostmortemNotification: () => Promise<void> =
    async (): Promise<void> => {
      try {
        // Reset the notification status to Pending so the worker can pick it up again
        await ModelAPI.updateById({
          id: modelId,
          modelType: Incident,
          data: {
            subscriberNotificationStatusOnPostmortemPublished:
              StatusPageSubscriberNotificationStatus.Pending,
            subscriberNotificationStatusMessageOnPostmortemPublished:
              "Notification queued for resending",
          },
        });

        // Refresh the data to show updated status
        refresh();
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
    };

  const handleGeneratePostmortemFromAI: (
    data: GenerateAIRequestData,
  ) => Promise<string> = async (
    data: GenerateAIRequestData,
  ): Promise<string> => {
    const apiUrl: URL = URL.fromString(
      APP_API_URL.toString() +
        `/incident/generate-postmortem-from-ai/${modelId.toString()}`,
    );

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: apiUrl,
        data: {
          template: data.template,
        },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw new Error(API.getFriendlyMessage(response));
    }

    const postmortemNote: string = (response.data as JSONObject)[
      "postmortemNote"
    ] as string;

    if (!postmortemNote) {
      throw new Error("Failed to generate postmortem note with AI.");
    }

    return postmortemNote;
  };

  const handleAIGenerationSuccess: (generatedContent: string) => void = (
    generatedContent: string,
  ): void => {
    setShowAIGenerateModal(false);
    setDraftNote(generatedContent);
  };

  const handleTemplatePicked: (template: PostmortemTemplateOption) => void = (
    template: PostmortemTemplateOption,
  ): void => {
    setShowTemplateModal(false);

    if (!template.note.trim()) {
      setError("The selected template does not contain a postmortem note.");
      return;
    }

    setDraftNote(template.note);
  };

  const hasTemplates: boolean = postmortemTemplates.templates.length > 0;

  return (
    <>
      <CardModelDetail<Incident>
        name="Postmortem"
        cardProps={{
          title: "Postmortem",
          description:
            "Document the summary, learnings, and follow-ups for this incident.",
          /*
           * Written, the template and the AI draft fold into the ⋯ beside
           * Edit Postmortem Note. Not written, the card's body offers them
           * beside Write Postmortem instead.
           */
          buttons:
            hasNote &&
            hasPostmortemMoreMenuItems({
              writeGate: writeGate,
              hasTemplates: hasTemplates,
              isAiOffered: isAiOffered,
            })
              ? [
                  <PostmortemMoreMenu
                    key="postmortem-more-menu"
                    writeGate={writeGate}
                    hasTemplates={hasTemplates}
                    isAiOffered={isAiOffered}
                    onApplyTemplate={() => {
                      setShowTemplateModal(true);
                    }}
                    onGenerateWithAI={() => {
                      setShowAIGenerateModal(true);
                    }}
                  />,
                ]
              : [],
        }}
        refresher={refreshToggle}
        createEditModalWidth={ModalWidth.Large}
        isEditable={hasNote === true}
        editButtonText="Edit Postmortem Note"
        // The dialog names what it edits, as the button does - not "Edit Incident".
        editModalTitle="Edit Postmortem Note"
        onSaveSuccess={() => {
          refresh();
        }}
        formSteps={INCIDENT_POSTMORTEM_FORM_STEPS}
        formFields={INCIDENT_POSTMORTEM_FORM_FIELDS}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: Incident,
          id: "model-detail-incident-postmortem-note",
          selectMoreFields: {
            postmortemStatusId: true,
            subscriberNotificationStatusMessageOnPostmortemPublished: true,
            // Whether a skipped notification still waits for the incident to show.
            isVisibleOnStatusPage: true,
            isPrivate: true,
          },
          onItemLoaded: (item: Incident) => {
            setHasNote(
              IncidentPostmortemPublication.hasNote(item.postmortemNote),
            );
          },
          /*
           * Where it stands and who owns it, then the write-up and its
           * files, then the status page: whether the postmortem is on it
           * and, only while it is, whether and when subscribers heard about
           * it and the time it shows.
           */
          fields: [
            {
              field: {
                postmortemStatus: {
                  _id: true,
                  name: true,
                  color: true,
                },
              },
              // Status and Owners, side by side, each with its own name.
              title: "",
              colSpan: 2,
              fieldType: FieldType.Element,
              getElement: (item: Incident): ReactElement => {
                return (
                  <PostmortemSummary
                    incidentId={modelId}
                    statusId={
                      item.postmortemStatusId?.toString() ||
                      item.postmortemStatus?._id?.toString() ||
                      null
                    }
                    choices={postmortemStatuses.choices}
                    canChangeStatus={statusGate.isAllowed}
                    onStatusChanged={() => {
                      refresh();
                    }}
                    owners={incidentOwners.owners}
                    hasLoadedOwners={incidentOwners.hasLoaded}
                    addOwners={addOwners}
                  />
                );
              },
            },
            {
              field: {
                postmortemNote: true,
              },
              title: "",
              colSpan: 2,
              fieldType: FieldType.Element,
              getElement: (item: Incident): ReactElement => {
                if (
                  IncidentPostmortemPublication.hasNote(item.postmortemNote)
                ) {
                  /*
                   * The viewer spaces its paragraphs and lists apart; the
                   * first's space above and the last's below would put the
                   * text further from the rows around it than they are.
                   */
                  return (
                    <div
                      className="[&>div>*:first-child]:mt-0 [&>div>*:last-child]:mb-0"
                      data-testid="postmortem-note"
                    >
                      <LazyMarkdownViewer text={item.postmortemNote || ""} />
                    </div>
                  );
                }

                return (
                  <PostmortemEmptyState
                    writeGate={writeGate}
                    hasTemplates={hasTemplates}
                    isAiOffered={isAiOffered}
                    onWrite={() => {
                      setIsWriting(true);
                    }}
                    onApplyTemplate={() => {
                      setShowTemplateModal(true);
                    }}
                    onGenerateWithAI={() => {
                      setShowAIGenerateModal(true);
                    }}
                  />
                );
              },
            },
            {
              field: {
                postmortemAttachments: {
                  _id: true,
                  name: true,
                  fileType: true,
                  createdAt: true,
                },
              },
              title: "Postmortem Attachments",
              colSpan: 2,
              fieldType: FieldType.Element,
              // Nothing written and nothing attached: the empty state says it all.
              showIf: (item: Incident): boolean => {
                return (
                  IncidentPostmortemPublication.hasNote(item.postmortemNote) ||
                  Boolean(item.postmortemAttachments?.length)
                );
              },
              getElement: (item: Incident): ReactElement => {
                const modelIdString: string | null = getModelIdString(item);

                if (!item.postmortemAttachments?.length) {
                  return (
                    <div className="text-sm text-gray-500">
                      {translator.translateText(
                        "No postmortem attachments uploaded for this incident.",
                      )}
                    </div>
                  );
                }

                if (!modelIdString) {
                  return (
                    <div className="text-sm text-gray-400 italic">
                      {translator.translateText(
                        "Attachments are available but the incident identifier is missing, so they cannot be displayed.",
                      )}
                    </div>
                  );
                }

                return (
                  <AttachmentList
                    modelId={modelIdString}
                    attachments={item.postmortemAttachments}
                    attachmentApiPath="/incident/postmortem/attachment"
                  />
                );
              },
            },
            {
              field: {
                showPostmortemOnStatusPage: true,
              },
              title: "Postmortem visible on Status Page?",
              fieldType: FieldType.Boolean,
              // Nothing written and nothing switched on: there is nothing to publish yet.
              showIf: (item: Incident): boolean => {
                return (
                  IncidentPostmortemPublication.hasNote(item.postmortemNote) ||
                  isPublished(item)
                );
              },
            },
            {
              field: {
                notifySubscribersOnPostmortemPublished: true,
              },
              title: "Notify Subscribers",
              fieldType: FieldType.Boolean,
              showIf: isPublished,
            },
            {
              field: {
                subscriberNotificationStatusOnPostmortemPublished: true,
              },
              title: "Subscriber Notification Status",
              fieldType: FieldType.Element,
              showIf: (item: Incident): boolean => {
                return (
                  isPublished(item) &&
                  Boolean(item.notifySubscribersOnPostmortemPublished)
                );
              },
              getElement: (item: Incident): ReactElement => {
                /*
                 * Published while the incident is hidden: not sent yet,
                 * rather than not to be sent - it goes out when the incident
                 * is made visible on status pages.
                 */
                const isWaitingForIncident: boolean =
                  IncidentPostmortemPublication.isWaitingForIncidentToShow(
                    item,
                  );

                return (
                  <SubscriberNotificationStatus
                    status={
                      item.subscriberNotificationStatusOnPostmortemPublished
                    }
                    subscriberNotificationStatusMessage={
                      item.subscriberNotificationStatusMessageOnPostmortemPublished
                    }
                    statusText={
                      isWaitingForIncident
                        ? IncidentPostmortemPublication.hiddenIncidentLabel
                        : undefined
                    }
                    isWaiting={isWaitingForIncident}
                    onResendNotification={handleResendPostmortemNotification}
                  />
                );
              },
            },
            {
              field: {
                postmortemPostedAt: true,
              },
              title: "Postmortem Published At",
              fieldType: FieldType.DateTime,
              placeholder: "-",
              showIf: isPublished,
            },
          ],
          modelId: modelId,
        }}
      />

      {error ? (
        <ConfirmModal
          title={`Error`}
          description={`${error}`}
          submitButtonText={"Close"}
          onSubmit={() => {
            setError("");
          }}
        />
      ) : (
        <></>
      )}

      {showTemplateModal && hasTemplates ? (
        <ApplyPostmortemTemplateModal
          name="Incident > Apply Postmortem Template"
          templates={postmortemTemplates.templates}
          onPick={handleTemplatePicked}
          onClose={() => {
            setShowTemplateModal(false);
          }}
        />
      ) : (
        <></>
      )}

      {isWriting ? (
        <ModelFormModal<Incident>
          title="Write Postmortem"
          submitButtonText="Save Changes"
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setIsWriting(false);
          }}
          onSuccess={() => {
            setIsWriting(false);
            refresh();
          }}
          name="incident-postmortem-write"
          modelType={Incident}
          modelIdToEdit={modelId}
          formProps={{
            id: "incident-postmortem-write-form",
            steps: INCIDENT_POSTMORTEM_FORM_STEPS,
            fields: INCIDENT_POSTMORTEM_FORM_FIELDS,
            formType: FormType.Update,
            modelType: Incident,
            name: "Postmortem Note",
          }}
        />
      ) : (
        <></>
      )}

      {draftNote !== null ? (
        <ModelFormModal<Incident>
          title="Edit Postmortem Note"
          submitButtonText="Save Changes"
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setDraftNote(null);
          }}
          onSuccess={() => {
            setDraftNote(null);
            refresh();
          }}
          name="incident-postmortem-note-from-template"
          modelType={Incident}
          modelIdToEdit={modelId}
          formProps={{
            id: "incident-postmortem-note-template-form",
            steps: INCIDENT_POSTMORTEM_FORM_STEPS,
            fields: INCIDENT_POSTMORTEM_FORM_FIELDS,
            formType: FormType.Update,
            modelType: Incident,
            name: "Postmortem Note",
            /*
             * The incident's postmortem as it is stored, with the drafted
             * note in place of its note: a draft must not quietly change
             * whether the postmortem is on the status page, when it was
             * published or its attachments.
             */
            draftValues: {
              postmortemNote: draftNote,
            },
          }}
        />
      ) : (
        <></>
      )}

      {showAIGenerateModal ? (
        <GenerateFromAIModal
          title="Generate Postmortem with AI"
          description="AI will analyze the incident data, timeline, notes, and channel discussions to generate a comprehensive postmortem."
          onClose={() => {
            setShowAIGenerateModal(false);
          }}
          onGenerate={handleGeneratePostmortemFromAI}
          onSuccess={handleAIGenerationSuccess}
          templates={[
            ...POSTMORTEM_TEMPLATES,
            ...toAITemplates(postmortemTemplates.templates),
          ]}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default IncidentPostmortem;
