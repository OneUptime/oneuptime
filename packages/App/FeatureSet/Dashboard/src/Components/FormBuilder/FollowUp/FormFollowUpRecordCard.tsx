import FormsCopy from "../FormsCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { CustomFieldFile } from "Common/Types/CustomField/CustomFieldFile";
import OneUptimeDate from "Common/Types/Date";
import {
  FORM_FOLLOW_UP_EMAIL_MAX_LENGTH,
  FORM_FOLLOW_UP_MESSAGE_MAX_LENGTH,
  FORM_FOLLOW_UP_NAME_MAX_LENGTH,
  FORM_FOLLOW_UP_RECORD_PEOPLE_PATH,
  FORM_FOLLOW_UP_RECORD_REMOVE_PATH,
  FORM_FOLLOW_UP_RECORD_REPLY_PATH,
  FormFollowUpAuthor,
  FormFollowUpRecordMessage,
  FormFollowUpRecordPerson,
  FormFollowUpRecordView,
  getFormFollowUpPersonLabel,
  getFormFollowUpRecordRoute,
} from "Common/Types/Form/FormFollowUp";
import FormTargetType from "Common/Types/Form/FormTargetType";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CustomFieldFileList from "Common/UI/Components/CustomFields/CustomFieldFileList";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Link from "Common/UI/Components/Link/Link";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * A FORM SUBMISSION'S FOLLOW-UP, ON THE PAGE OF THE RECORD IT CREATED
 * (Common/Types/Form/FormFollowUp, Server/API/FormFollowUpRecordAPI).
 *
 * Drawn on an incident's, an alert's and a scheduled maintenance event's
 * page, and only when a form submission created the record and the reader
 * may read the record's private notes: for every other record the route
 * answers 404 or 403, and the card draws nothing. It shows which form the
 * record came through and who sent it, the people following the request,
 * the conversation, and - for somebody who may edit the record - a reply
 * box, Add Person and Remove. A reply is the reader's own private note on
 * the record, emailed to everybody following.
 */

export interface ComponentProps {
  recordType: FormTargetType;
  recordId: ObjectID;
  // Told after a reply: the record's feed has a new private note.
  onChanged?: (() => void) | undefined;
}

const REPLY_KEY: string = "reply";
const EMAIL_KEY: string = "email";
const NAME_KEY: string = "name";

type ReadViewFunction = (data: unknown) => FormFollowUpRecordView | null;

// The route's answer, as far as it is the view the card draws.
const readView: ReadViewFunction = (
  data: unknown,
): FormFollowUpRecordView | null => {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof (data as JSONObject)["submissionId"] !== "string" ||
    !Array.isArray((data as JSONObject)["people"]) ||
    !Array.isArray((data as JSONObject)["messages"])
  ) {
    return null;
  }

  return data as unknown as FormFollowUpRecordView;
};

const FormFollowUpRecordCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const [view, setView] = useState<FormFollowUpRecordView | null>(null);
  // Nothing to draw: no submission created the record, or it may not be read.
  const [isHidden, setIsHidden] = useState<boolean>(false);

  const [replyError, setReplyError] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const [replyInstance, setReplyInstance] = useState<number>(0);
  const [replySent, setReplySent] = useState<boolean>(false);

  const [isAddingPerson, setIsAddingPerson] = useState<boolean>(false);
  const [personError, setPersonError] = useState<string>("");
  const [isSavingPerson, setIsSavingPerson] = useState<boolean>(false);

  const [removing, setRemoving] = useState<FormFollowUpRecordPerson | null>(
    null,
  );
  const [removeError, setRemoveError] = useState<string>("");
  const [isRemoving, setIsRemoving] = useState<boolean>(false);

  const baseRoute: string = getFormFollowUpRecordRoute({
    recordType: props.recordType,
    recordId: props.recordId.toString(),
  });

  const getUrl: (path?: string) => URL = (path?: string): URL => {
    return URL.fromString(APP_API_URL.toString()).addRoute(
      path ? `${baseRoute}/${path}` : baseRoute,
    );
  };

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: getUrl(),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const read: FormFollowUpRecordView | null = readView(response.data);

      setView(read);
      setIsHidden(!read);
    } catch {
      // A record no submission created, or one the reader may not read.
      setView(null);
      setIsHidden(true);
    }
  }, [props.recordType, props.recordId.toString()]);

  useEffect(() => {
    void load();
  }, [load]);

  const post: (path: string, body: JSONObject) => Promise<void> = async (
    path: string,
    body: JSONObject,
  ): Promise<void> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: getUrl(path),
        data: body,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const read: FormFollowUpRecordView | null = readView(response.data);

    if (read) {
      setView(read);
    }
  };

  const sendReply: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    if (isSending) {
      return;
    }

    setIsSending(true);
    setReplyError("");
    setReplySent(false);

    try {
      await post(FORM_FOLLOW_UP_RECORD_REPLY_PATH, {
        message:
          typeof values[REPLY_KEY] === "string"
            ? (values[REPLY_KEY] as string)
            : "",
      });

      setReplyInstance((instance: number): number => {
        return instance + 1;
      });
      setReplySent(true);
      props.onChanged?.();
    } catch (err) {
      setReplyError(API.getFriendlyMessage(err));
    }

    setIsSending(false);
  };

  const addPerson: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    if (isSavingPerson) {
      return;
    }

    setIsSavingPerson(true);
    setPersonError("");

    try {
      const body: JSONObject = {
        email:
          typeof values[EMAIL_KEY] === "string"
            ? (values[EMAIL_KEY] as string).trim()
            : "",
      };

      if (
        typeof values[NAME_KEY] === "string" &&
        (values[NAME_KEY] as string).trim()
      ) {
        body["name"] = (values[NAME_KEY] as string).trim();
      }

      await post(FORM_FOLLOW_UP_RECORD_PEOPLE_PATH, body);
      setIsAddingPerson(false);
    } catch (err) {
      setPersonError(API.getFriendlyMessage(err));
    }

    setIsSavingPerson(false);
  };

  const removePerson: () => Promise<void> = async (): Promise<void> => {
    if (!removing || isRemoving) {
      return;
    }

    setIsRemoving(true);
    setRemoveError("");

    try {
      await post(
        `${FORM_FOLLOW_UP_RECORD_PEOPLE_PATH}/${encodeURIComponent(
          removing.id,
        )}/${FORM_FOLLOW_UP_RECORD_REMOVE_PATH}`,
        {},
      );
      setRemoving(null);
    } catch (err) {
      setRemoveError(API.getFriendlyMessage(err));
    }

    setIsRemoving(false);
  };

  if (isHidden || !view) {
    return <></>;
  }

  const canAddPeople: boolean =
    view.canReply && view.people.length < view.maxPeople;

  return (
    <Card
      title={FormsCopy.followUpRecordTitle}
      description={FormsCopy.followUpRecordDescription}
      buttons={
        canAddPeople
          ? [
              {
                title: FormsCopy.followUpAddPerson,
                buttonStyle: ButtonStyleType.NORMAL,
                icon: IconProp.Add,
                onClick: () => {
                  setPersonError("");
                  setIsAddingPerson(true);
                },
              },
            ]
          : []
      }
    >
      <div className="space-y-6" data-testid="form-follow-up-record">
        {!view.isFollowUpOn ? (
          <Alert
            type={AlertType.INFO}
            title={FormsCopy.followUpRecordOff}
            dataTestId="form-follow-up-record-off"
          />
        ) : (
          <></>
        )}

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {tx(FormsCopy.followUpSubmittedThrough)}
          </p>
          <p className="mt-1 text-sm text-gray-900 [overflow-wrap:anywhere]">
            <Link
              className="font-medium text-indigo-600 hover:text-indigo-500"
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.FORM_VIEW] as Route,
                { modelId: new ObjectID(view.formId) },
              )}
            >
              {view.formName || view.formId}
            </Link>
          </p>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {tx(FormsCopy.followUpPeopleTitle)}
          </p>
          <ul
            className="mt-2 divide-y divide-gray-100"
            data-testid="form-follow-up-record-people"
          >
            {view.people.map(
              (person: FormFollowUpRecordPerson): ReactElement => {
                return (
                  <li
                    key={person.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
                      {person.name ? (
                        <>
                          <span className="font-medium text-gray-900">
                            {person.name}
                          </span>{" "}
                          <span className="text-gray-500">{person.email}</span>
                        </>
                      ) : (
                        <span className="text-gray-900">{person.email}</span>
                      )}
                      {person.isSubmitter ? (
                        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                          {tx(FormsCopy.followUpSubmitterBadge)}
                        </span>
                      ) : (
                        <></>
                      )}
                    </span>
                    {view.canReply ? (
                      <button
                        type="button"
                        className="text-sm font-medium text-gray-600 hover:text-gray-900"
                        data-testid={`form-follow-up-remove-${person.id}`}
                        onClick={() => {
                          setRemoveError("");
                          setRemoving(person);
                        }}
                      >
                        {tx(FormsCopy.followUpRemovePerson)}
                      </button>
                    ) : (
                      <></>
                    )}
                  </li>
                );
              },
            )}
          </ul>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {tx(FormsCopy.followUpConversationTitle)}
          </p>
          {view.messages.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">
              {tx(FormsCopy.followUpNoMessages)}
            </p>
          ) : (
            <ol
              className="mt-2 space-y-3"
              data-testid="form-follow-up-record-messages"
            >
              {view.messages.map(
                (message: FormFollowUpRecordMessage): ReactElement => {
                  const isTeam: boolean =
                    message.author === FormFollowUpAuthor.Team;

                  return (
                    <li
                      key={message.id}
                      className={
                        isTeam
                          ? "rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2"
                          : "rounded-lg border border-gray-200 bg-white px-3 py-2"
                      }
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                          {getFormFollowUpPersonLabel({
                            name: message.authorName,
                            email: message.authorEmail,
                          })}
                          {isTeam ? (
                            <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-normal text-indigo-700">
                              {tx(FormsCopy.followUpTeamBadge)}
                            </span>
                          ) : (
                            <></>
                          )}
                        </span>
                        <span className="text-xs text-gray-500">
                          {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                            message.createdAt,
                          )}
                        </span>
                      </div>
                      {message.text ? (
                        <div className="mt-1 text-sm text-gray-700">
                          <MarkdownViewer text={message.text} />
                        </div>
                      ) : (
                        <></>
                      )}
                      {message.files.length > 0 ? (
                        <div className="mt-2">
                          <CustomFieldFileList
                            files={message.files as Array<CustomFieldFile>}
                          />
                        </div>
                      ) : (
                        <></>
                      )}
                    </li>
                  );
                },
              )}
            </ol>
          )}
        </div>

        {view.canReply ? (
          <div data-testid="form-follow-up-record-reply">
            <BasicForm
              key={replyInstance}
              id="form-follow-up-record-reply"
              name="Form follow-up reply"
              fields={[
                {
                  field: { [REPLY_KEY]: true },
                  title: FormsCopy.followUpReplyLabel,
                  description: FormsCopy.followUpReplyHelp,
                  fieldType: FormFieldSchemaType.Markdown,
                  required: true,
                  validation: { maxLength: FORM_FOLLOW_UP_MESSAGE_MAX_LENGTH },
                  spanFullRow: true,
                },
              ]}
              initialValues={{}}
              showAsColumns={1}
              disableAutofocus={true}
              isLoading={isSending}
              submitButtonText={FormsCopy.followUpSendReply}
              onSubmit={(values: FormValues<JSONObject>) => {
                void sendReply(values as JSONObject);
              }}
              footer={
                replyError ? (
                  <div className="mt-3">
                    <Alert
                      type={AlertType.DANGER}
                      dataTestId="form-follow-up-record-reply-error"
                      title={
                        <span>
                          <ErrorInSentence
                            message={replyError}
                            showWhereToLook={true}
                          />
                        </span>
                      }
                    />
                  </div>
                ) : replySent ? (
                  <p
                    className="mt-3 text-sm text-gray-600"
                    role="status"
                    data-testid="form-follow-up-record-reply-sent"
                  >
                    {tx(FormsCopy.followUpReplySent)}
                  </p>
                ) : (
                  <></>
                )
              }
            />
          </div>
        ) : (
          <></>
        )}
      </div>

      {isAddingPerson ? (
        <BasicFormModal<JSONObject>
          title={FormsCopy.followUpAddPerson}
          description={FormsCopy.followUpAddPersonDescription}
          name="Add person to form follow-up"
          submitButtonText={FormsCopy.followUpAddPerson}
          isSubmitting={isSavingPerson}
          error={personError || undefined}
          onClose={() => {
            setIsAddingPerson(false);
            setPersonError("");
          }}
          onSubmit={(values: JSONObject) => {
            void addPerson(values);
          }}
          formProps={{
            id: "form-follow-up-add-person",
            initialValues: {},
            fields: [
              {
                field: { [EMAIL_KEY]: true },
                title: "Email",
                fieldType: FormFieldSchemaType.Email,
                required: true,
                disableSpellCheck: true,
                validation: { maxLength: FORM_FOLLOW_UP_EMAIL_MAX_LENGTH },
              },
              {
                field: { [NAME_KEY]: true },
                title: "Name",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                validation: { maxLength: FORM_FOLLOW_UP_NAME_MAX_LENGTH },
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {removing ? (
        <ConfirmModal
          title={FormsCopy.followUpRemovePersonTitle}
          description={FormsCopy.followUpRemovePersonDescription}
          submitButtonText={FormsCopy.followUpRemovePerson}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isRemoving}
          error={removeError || undefined}
          onClose={() => {
            setRemoving(null);
            setRemoveError("");
          }}
          onSubmit={() => {
            void removePerson();
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default FormFollowUpRecordCard;
