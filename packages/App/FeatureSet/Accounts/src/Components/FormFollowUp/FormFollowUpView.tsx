import {
  FormFailure,
  FormFailureKind,
  formatFormRetryAfter,
  getFormFailure,
} from "../../Utils/Form";
import {
  addPersonToFormRequest,
  FormFollowUpTarget,
  FormFollowUpView as FollowUpView,
  loadFormRequest,
  loadMyFormRequests,
  sendFormRequestReply,
  stopFollowingFormRequest,
} from "../../Utils/FormFollowUp";
import { isKnownFormFollowUpMessage } from "../../Utils/FormFollowUpMessage";
import { isKnownFormMessage } from "../../Utils/FormMessage";
import { formatDateText, getDateLocale } from "Common/Types/DateLanguage";
import {
  FORM_FOLLOW_UP_EMAIL_MAX_LENGTH,
  FORM_FOLLOW_UP_MESSAGE_FIELD_ID,
  FORM_FOLLOW_UP_NAME_MAX_LENGTH,
  FormFollowUpAuthor,
  getFormFollowUpReplyFields,
  PublicFormMyRequests,
  PublicFormRequest,
  PublicFormRequestMessage,
  PublicFormRequestPerson,
  PublicFormRequestState,
  PublicFormRequestSummary,
} from "Common/Types/Form/FormFollowUp";
import { PublicForm, PublicFormField } from "Common/Types/Form/FormPublic";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import AuthPageSkeleton from "Common/UI/Components/AuthPage/AuthPageSkeleton";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import {
  buildPublicFormFields,
  getPublicFormFilesProblem,
  packPublicFormAnswers,
} from "Common/UI/Components/PublicForm/PublicFormFields";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * A FORM'S FOLLOW-UPS, ON THE FORM'S OWN PAGE (Common/Types/Form/FormFollowUp).
 *
 * Drawn by Pages/Form inside the form's own card, under its name and logo,
 * in place of the form: one request - its state, its conversation with the
 * team, a box to write to them with files, the people following it and a
 * way to add one, the answers it was sent with, and Stop following - or, on
 * a form that asks its visitors to sign in, My requests. The form's page
 * has already signed the visitor in where the form asks for it.
 *
 * Everything the server says is in the request it answers with: a message
 * sent, a person added or a refusal is shown here, next to what the visitor
 * was doing, and nothing on the page navigates away. Always light, as the
 * form's page is.
 */

// What a failure says: the sentence, and when to try again if a limit said.
export interface FormFollowUpFailureText {
  message: string;
  retryAfter: string | null;
}

export interface ComponentProps {
  target: FormFollowUpTarget;
  view: FollowUpView;
  // The form asks its visitors to sign in: My requests is there to go back to.
  isSignInForm: boolean;
  // Show another view: a request from My requests, or My requests again.
  onOpenView: (view: FollowUpView) => void;
  // Back to the form itself - to send a new request.
  onBackToForm: () => void;
}

// A locale file's whole-sentence keys contain dots and colons of their own.
const FLAT_KEY_OPTIONS: { keySeparator: false; nsSeparator: false } = {
  keySeparator: false,
  nsSeparator: false,
};

const EMAIL_KEY: string = "personEmail";
const NAME_KEY: string = "personName";

const FormFollowUpView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t, i18n } = useTranslation();

  // A sentence the server sent, in the reader's language when a locale has it.
  const translateServerMessage: (message: string) => string = (
    message: string,
  ): string => {
    if (!isKnownFormMessage(message) && !isKnownFormFollowUpMessage(message)) {
      return message;
    }

    return t(message, { ...FLAT_KEY_OPTIONS, defaultValue: message });
  };

  // What to say for a failure: the server's own words, else the page's.
  const describeFailure: (
    failure: FormFailure,
    fallback: string,
  ) => FormFollowUpFailureText = (
    failure: FormFailure,
    fallback: string,
  ): FormFollowUpFailureText => {
    const when: string | null =
      failure.kind === FormFailureKind.RateLimited
        ? formatFormRetryAfter(
            failure.retryAfterSeconds,
            i18n.resolvedLanguage || i18n.language,
          )
        : null;

    return {
      message: failure.serverMessage
        ? translateServerMessage(failure.serverMessage)
        : fallback,
      retryAfter: when ? t("form.retryAfter", { when: when }) : null,
    };
  };

  // A date and time in the reader's language, on their clock.
  const formatWhen: (iso: string) => string = (iso: string): string => {
    let zone: string = "UTC";

    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      zone = "UTC";
    }

    return (
      formatDateText({
        date: new Date(iso),
        locale: getDateLocale(i18n.resolvedLanguage || i18n.language),
        timezones: [zone],
        shape: {},
      }) || iso
    );
  };

  if (props.view.kind === "mine") {
    return (
      <MyRequests
        target={props.target}
        formatWhen={formatWhen}
        describeFailure={describeFailure}
        onOpenView={props.onOpenView}
        onBackToForm={props.onBackToForm}
      />
    );
  }

  return (
    <RequestView
      // A fresh view, and fresh boxes, for each request opened.
      key={props.view.access.credential || props.view.access.submissionId || ""}
      target={props.target}
      view={props.view}
      isSignInForm={props.isSignInForm}
      formatWhen={formatWhen}
      describeFailure={describeFailure}
      onOpenView={props.onOpenView}
      onBackToForm={props.onBackToForm}
    />
  );
};

interface ViewProps {
  target: FormFollowUpTarget;
  formatWhen: (iso: string) => string;
  describeFailure: (
    failure: FormFailure,
    fallback: string,
  ) => FormFollowUpFailureText;
  onOpenView: (view: FollowUpView) => void;
  onBackToForm: () => void;
}

// A failure's sentence, and on a line of its own when to try again.
const FailureLines: FunctionComponent<{
  failure: FormFollowUpFailureText;
}> = (data: { failure: FormFollowUpFailureText }): ReactElement => {
  return (
    <span>
      {data.failure.message}
      {data.failure.retryAfter ? (
        <span className="mt-1 block">{data.failure.retryAfter}</span>
      ) : (
        <></>
      )}
    </span>
  );
};

// A state's badge: its name, beside a dot of its color.
const StateBadge: FunctionComponent<{
  state: PublicFormRequestState | null;
}> = (data: { state: PublicFormRequestState | null }): ReactElement => {
  const { t } = useTranslation();

  const name: string = data.state ? data.state.name : t("formFollowUp.closed");

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs font-medium text-gray-700"
      data-testid="form-request-state"
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full bg-gray-400"
        style={data.state?.color ? { backgroundColor: data.state.color } : {}}
      ></span>
      <span className="[overflow-wrap:anywhere]">{name}</span>
    </span>
  );
};

const MyRequests: FunctionComponent<ViewProps> = (
  props: ViewProps,
): ReactElement => {
  const { t } = useTranslation();

  const [mine, setMine] = useState<PublicFormMyRequests | null>(null);
  const [error, setError] = useState<FormFollowUpFailureText | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    loadMyFormRequests(props.target)
      .then((loaded: PublicFormMyRequests) => {
        if (isCurrent) {
          setMine(loaded);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(
            props.describeFailure(
              getFormFailure(err),
              t("formFollowUp.loadFailed"),
            ),
          );
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.target.shareKey]);

  if (error) {
    return (
      <div data-testid="form-my-requests-error">
        <Alert
          type={AlertType.DANGER}
          title={<FailureLines failure={error} />}
        />
        <div className="mt-6 flex justify-center">
          <Button
            title={t("formFollowUp.backToForm")}
            isTitleTranslated={true}
            buttonStyle={ButtonStyleType.NORMAL}
            onClick={props.onBackToForm}
          />
        </div>
      </div>
    );
  }

  if (!mine) {
    return <AuthPageSkeleton fields={3} />;
  }

  return (
    <div data-testid="form-my-requests">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">
          {t("formFollowUp.myRequests")}
        </h2>
        <Button
          title={t("formFollowUp.newRequest")}
          isTitleTranslated={true}
          buttonStyle={ButtonStyleType.PRIMARY}
          icon={IconProp.Add}
          dataTestId="form-new-request"
          onClick={props.onBackToForm}
        />
      </div>
      <p className="mt-1 text-sm text-gray-600 [overflow-wrap:anywhere]">
        {t("formSignIn.signedInAs", { email: mine.signedInAs })}
      </p>

      {mine.requests.length === 0 ? (
        <p
          className="mt-6 rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-600"
          data-testid="form-my-requests-empty"
        >
          {t("formFollowUp.noRequests")}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-100 rounded-lg border border-gray-200">
          {mine.requests.map(
            (request: PublicFormRequestSummary): ReactElement => {
              return (
                <li key={request.submissionId}>
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    data-testid={`form-my-request-${request.submissionId}`}
                    onClick={() => {
                      props.onOpenView({
                        kind: "request",
                        access: { submissionId: request.submissionId },
                      });
                    }}
                  >
                    <span className="min-w-0">
                      {request.reference ? (
                        <span className="block text-xs font-medium text-gray-500">
                          {request.reference}
                        </span>
                      ) : (
                        <></>
                      )}
                      <span className="block text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                        {request.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500">
                        {t("formFollowUp.lastActivity", {
                          when: props.formatWhen(request.lastActivityAt),
                        })}
                      </span>
                    </span>
                    <StateBadge state={request.state} />
                  </button>
                </li>
              );
            },
          )}
        </ul>
      )}
    </div>
  );
};

interface RequestViewProps extends ViewProps {
  view: Extract<FollowUpView, { kind: "request" }>;
  isSignInForm: boolean;
}

const RequestView: FunctionComponent<RequestViewProps> = (
  props: RequestViewProps,
): ReactElement => {
  const { t } = useTranslation();

  const [request, setRequest] = useState<PublicFormRequest | null>(null);
  const [loadError, setLoadError] = useState<FormFollowUpFailureText | null>(
    null,
  );

  const [replyError, setReplyError] = useState<FormFollowUpFailureText | null>(
    null,
  );
  const [isSending, setIsSending] = useState<boolean>(false);
  // Bumped after a message is sent: a fresh, empty reply box.
  const [replyInstance, setReplyInstance] = useState<number>(0);

  const [isAddingPerson, setIsAddingPerson] = useState<boolean>(false);
  const [personError, setPersonError] =
    useState<FormFollowUpFailureText | null>(null);
  const [isSavingPerson, setIsSavingPerson] = useState<boolean>(false);

  const [isConfirmingStop, setIsConfirmingStop] = useState<boolean>(false);
  const [stopError, setStopError] = useState<FormFollowUpFailureText | null>(
    null,
  );
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const [hasStopped, setHasStopped] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    loadFormRequest(props.target, props.view.access)
      .then((loaded: PublicFormRequest) => {
        if (isCurrent) {
          setRequest(loaded);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setLoadError(
            props.describeFailure(
              getFormFailure(err),
              t("formFollowUp.loadFailed"),
            ),
          );
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  /*
   * The reply box: the questions the server checks a reply with, drawn by
   * the form's own builder - so a file is held here to what a form's file
   * question takes - in the reader's words.
   */
  const replyForm: PublicForm = useMemo((): PublicForm => {
    return {
      name: "",
      isCaptchaRequired: false,
      fields: getFormFollowUpReplyFields().map(
        (field: PublicFormField): PublicFormField => {
          return {
            ...field,
            label:
              field.id === FORM_FOLLOW_UP_MESSAGE_FIELD_ID
                ? t("formFollowUp.messageLabel")
                : t("formFollowUp.filesLabel"),
          };
        },
      ),
    };
  }, [t]);

  const replyFields: Fields<JSONObject> = useMemo((): Fields<JSONObject> => {
    return buildPublicFormFields(replyForm, {
      dataTestIdPrefix: "form-request-reply",
    });
  }, [replyForm]);

  const personFields: Fields<JSONObject> = useMemo((): Fields<JSONObject> => {
    return [
      {
        field: { [EMAIL_KEY]: true },
        title: t("formFollowUp.personEmail"),
        fieldType: FormFieldSchemaType.Email,
        required: true,
        disableSpellCheck: true,
        validation: { maxLength: FORM_FOLLOW_UP_EMAIL_MAX_LENGTH },
        dataTestId: "form-request-person-email",
      },
      {
        field: { [NAME_KEY]: true },
        title: t("formFollowUp.personName"),
        fieldType: FormFieldSchemaType.Text,
        required: false,
        validation: { maxLength: FORM_FOLLOW_UP_NAME_MAX_LENGTH },
        dataTestId: "form-request-person-name",
      },
    ];
  }, [t]);

  const sendReply: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    if (isSending) {
      return;
    }

    const filesProblem: string | null = getPublicFormFilesProblem({
      form: replyForm,
      values: values,
    });

    if (filesProblem) {
      setReplyError({
        message: isKnownFormMessage(filesProblem)
          ? t(filesProblem, { ...FLAT_KEY_OPTIONS, defaultValue: filesProblem })
          : filesProblem,
        retryAfter: null,
      });
      return;
    }

    setIsSending(true);
    setReplyError(null);

    try {
      const answers: JSONObject = packPublicFormAnswers({
        form: replyForm,
        values: values,
      });

      setRequest(
        await sendFormRequestReply({
          target: props.target,
          access: props.view.access,
          answers: answers,
        }),
      );

      setReplyInstance((instance: number): number => {
        return instance + 1;
      });
    } catch (err) {
      setReplyError(
        props.describeFailure(
          getFormFailure(err),
          t("formFollowUp.replyFailed"),
        ),
      );
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
    setPersonError(null);

    try {
      const name: string =
        typeof values[NAME_KEY] === "string"
          ? (values[NAME_KEY] as string).trim()
          : "";

      setRequest(
        await addPersonToFormRequest({
          target: props.target,
          access: props.view.access,
          email:
            typeof values[EMAIL_KEY] === "string"
              ? (values[EMAIL_KEY] as string).trim()
              : "",
          name: name || undefined,
        }),
      );

      setIsAddingPerson(false);
    } catch (err) {
      setPersonError(
        props.describeFailure(
          getFormFailure(err),
          t("formFollowUp.addPersonFailed"),
        ),
      );
    }

    setIsSavingPerson(false);
  };

  const stopFollowing: () => Promise<void> = async (): Promise<void> => {
    if (isStopping) {
      return;
    }

    setIsStopping(true);
    setStopError(null);

    try {
      await stopFollowingFormRequest({
        target: props.target,
        access: props.view.access,
      });

      setHasStopped(true);
    } catch (err) {
      setStopError(
        props.describeFailure(
          getFormFailure(err),
          t("formFollowUp.stopFailed"),
        ),
      );
    }

    setIsStopping(false);
  };

  const backButton: ReactElement = props.isSignInForm ? (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500"
      data-testid="form-request-back"
      onClick={() => {
        props.onOpenView({ kind: "mine" });
      }}
    >
      <Icon icon={IconProp.ChevronLeft} className="h-4 w-4" />
      {t("formFollowUp.allMyRequests")}
    </button>
  ) : (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500"
      data-testid="form-request-back"
      onClick={props.onBackToForm}
    >
      <Icon icon={IconProp.ChevronLeft} className="h-4 w-4" />
      {t("formFollowUp.backToForm")}
    </button>
  );

  if (hasStopped) {
    return (
      <div className="text-center" data-testid="form-request-stopped">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
          <Icon icon={IconProp.CheckCircle} className="h-6 w-6 text-gray-500" />
        </div>
        <h2 className="mt-4 text-base font-medium leading-7 text-gray-900">
          {t("formFollowUp.stopped")}
        </h2>
        <div className="mt-6 flex justify-center">
          <Button
            title={t("formFollowUp.backToForm")}
            isTitleTranslated={true}
            buttonStyle={ButtonStyleType.NORMAL}
            onClick={props.onBackToForm}
          />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="text-center" data-testid="form-request-load-failure">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
          <Icon icon={IconProp.Alert} className="h-6 w-6 text-gray-500" />
        </div>
        <h2 className="mt-4 text-base font-medium leading-7 text-gray-900">
          <FailureLines failure={loadError} />
        </h2>
        <div className="mt-6 flex justify-center">{backButton}</div>
      </div>
    );
  }

  if (!request) {
    return <AuthPageSkeleton fields={3} />;
  }

  const getAuthorName: (message: PublicFormRequestMessage) => string = (
    message: PublicFormRequestMessage,
  ): string => {
    if (message.isYou) {
      return t("formFollowUp.you");
    }

    if (message.author === FormFollowUpAuthor.Team) {
      return message.authorName || t("formFollowUp.theTeam");
    }

    return message.authorName;
  };

  return (
    <div data-testid="form-request">
      <div>{backButton}</div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {request.reference ? (
            <p
              className="text-xs font-medium text-gray-500"
              data-testid="form-request-reference"
            >
              {request.reference}
            </p>
          ) : (
            <></>
          )}
          <h2
            className="text-lg font-semibold text-gray-900 [overflow-wrap:anywhere]"
            data-testid="form-request-title"
          >
            {request.title}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {t("formFollowUp.submittedAt", {
              when: props.formatWhen(request.submittedAt),
            })}
          </p>
        </div>
        <StateBadge state={request.state} />
      </div>

      <section className="mt-8" aria-labelledby="form-request-conversation">
        <h3
          id="form-request-conversation"
          className="text-sm font-semibold text-gray-900"
        >
          {t("formFollowUp.conversation")}
        </h3>
        {request.messages.length === 0 ? (
          <p
            className="mt-3 rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-600"
            data-testid="form-request-no-messages"
          >
            {t("formFollowUp.noMessages")}
          </p>
        ) : (
          <ol className="mt-3 space-y-3" data-testid="form-request-messages">
            {request.messages.map(
              (message: PublicFormRequestMessage): ReactElement => {
                const isTeam: boolean =
                  message.author === FormFollowUpAuthor.Team;

                return (
                  <li
                    key={message.id}
                    className={`rounded-lg border px-4 py-3 ${
                      isTeam
                        ? "border-indigo-100 bg-indigo-50"
                        : "border-gray-200 bg-white"
                    }`}
                    data-testid={`form-request-message-${message.id}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                        {getAuthorName(message)}
                      </span>
                      <span className="text-xs text-gray-500">
                        {props.formatWhen(message.createdAt)}
                      </span>
                    </div>
                    {message.text ? (
                      <div className="mt-2 text-sm text-gray-700">
                        <MarkdownViewer text={message.text} />
                      </div>
                    ) : (
                      <></>
                    )}
                    {message.files.length > 0 ? (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {message.files.map(
                          (
                            file: { name: string; size: number },
                            index: number,
                          ): ReactElement => {
                            return (
                              <li
                                key={`${file.name}-${index}`}
                                className="inline-flex max-w-full items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
                              >
                                <Icon
                                  icon={IconProp.File}
                                  className="h-3.5 w-3.5 flex-none text-gray-500"
                                />
                                <span className="[overflow-wrap:anywhere]">
                                  {file.name}
                                </span>
                              </li>
                            );
                          },
                        )}
                      </ul>
                    ) : (
                      <></>
                    )}
                  </li>
                );
              },
            )}
          </ol>
        )}

        <div className="mt-4" data-testid="form-request-reply">
          <BasicForm
            key={replyInstance}
            id="form-request-reply"
            fields={replyFields}
            initialValues={{}}
            showAsColumns={1}
            maxPrimaryButtonWidth={true}
            disableAutofocus={true}
            isLoading={isSending}
            submitButtonText={t("formFollowUp.send")}
            onSubmit={(values: FormValues<JSONObject>) => {
              void sendReply(values as JSONObject);
            }}
            footer={
              replyError ? (
                <div className="mt-4">
                  <Alert
                    type={AlertType.DANGER}
                    dataTestId="form-request-reply-error"
                    title={<FailureLines failure={replyError} />}
                  />
                </div>
              ) : (
                <></>
              )
            }
          />
        </div>
      </section>

      <section
        className="mt-8 border-t border-gray-100 pt-6"
        aria-labelledby="form-request-people"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3
            id="form-request-people"
            className="text-sm font-semibold text-gray-900"
          >
            {t("formFollowUp.people")}
          </h3>
          {request.canAddPeople && !isAddingPerson ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500"
              data-testid="form-request-add-person"
              onClick={() => {
                setPersonError(null);
                setIsAddingPerson(true);
              }}
            >
              <Icon icon={IconProp.Add} className="h-4 w-4" />
              {t("formFollowUp.addPerson")}
            </button>
          ) : (
            <></>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-600">
          {t("formFollowUp.peopleDescription")}
        </p>
        <ul
          className="mt-3 divide-y divide-gray-100"
          data-testid="form-request-people-list"
        >
          {request.people.map(
            (person: PublicFormRequestPerson): ReactElement => {
              return (
                <li
                  key={person.id}
                  className="flex flex-wrap items-center gap-2 py-2 text-sm"
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">
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
                  </span>
                  {person.isYou ? (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      {t("formFollowUp.you")}
                    </span>
                  ) : (
                    <></>
                  )}
                  {person.isSubmitter ? (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      {t("formFollowUp.submitter")}
                    </span>
                  ) : (
                    <></>
                  )}
                </li>
              );
            },
          )}
        </ul>
        {!request.canAddPeople ? (
          <p className="mt-2 text-xs text-gray-500">
            {t("formFollowUp.peopleFull")}
          </p>
        ) : (
          <></>
        )}
        {isAddingPerson ? (
          <div
            className="mt-4 rounded-lg border border-gray-200 px-4 py-4"
            data-testid="form-request-person-form"
          >
            <BasicForm
              id="form-request-person"
              fields={personFields}
              initialValues={{}}
              showAsColumns={1}
              disableAutofocus={false}
              isLoading={isSavingPerson}
              submitButtonText={t("formFollowUp.add")}
              onCancel={() => {
                setIsAddingPerson(false);
                setPersonError(null);
              }}
              cancelButtonText={t("formFollowUp.cancel")}
              onSubmit={(values: FormValues<JSONObject>) => {
                void addPerson(values as JSONObject);
              }}
              footer={
                personError ? (
                  <div className="mt-4">
                    <Alert
                      type={AlertType.DANGER}
                      dataTestId="form-request-person-error"
                      title={<FailureLines failure={personError} />}
                    />
                  </div>
                ) : (
                  <></>
                )
              }
            />
          </div>
        ) : (
          <></>
        )}
      </section>

      {request.answers.length > 0 ? (
        <details
          className="mt-8 border-t border-gray-100 pt-6"
          data-testid="form-request-answers"
        >
          <summary className="cursor-pointer text-sm font-semibold text-gray-900">
            {t("formFollowUp.whatYouSent")}
          </summary>
          <dl className="mt-3 divide-y divide-gray-100">
            {request.answers.map(
              (
                answer: { label: string; value: string },
                index: number,
              ): ReactElement => {
                return (
                  <div key={`${answer.label}-${index}`} className="py-2">
                    <dt className="text-xs font-medium text-gray-500 [overflow-wrap:anywhere]">
                      {answer.label}
                    </dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm text-gray-900 [overflow-wrap:anywhere]">
                      {answer.value}
                    </dd>
                  </div>
                );
              },
            )}
          </dl>
        </details>
      ) : (
        <></>
      )}

      <div className="mt-8 border-t border-gray-100 pt-6">
        {isConfirmingStop ? (
          <div
            className="rounded-lg border border-gray-200 px-4 py-4"
            data-testid="form-request-stop-confirm"
          >
            <p className="text-sm font-medium text-gray-900">
              {t("formFollowUp.stopTitle")}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {t("formFollowUp.stopDescription")}
            </p>
            {stopError ? (
              <div className="mt-3">
                <Alert
                  type={AlertType.DANGER}
                  dataTestId="form-request-stop-error"
                  title={<FailureLines failure={stopError} />}
                />
              </div>
            ) : (
              <></>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                title={t("formFollowUp.stopFollowing")}
                isTitleTranslated={true}
                buttonStyle={ButtonStyleType.DANGER}
                isLoading={isStopping}
                dataTestId="form-request-stop-yes"
                onClick={() => {
                  void stopFollowing();
                }}
              />
              <Button
                title={t("formFollowUp.cancel")}
                isTitleTranslated={true}
                buttonStyle={ButtonStyleType.NORMAL}
                dataTestId="form-request-stop-no"
                onClick={() => {
                  setIsConfirmingStop(false);
                  setStopError(null);
                }}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
            data-testid="form-request-stop"
            onClick={() => {
              setIsConfirmingStop(true);
            }}
          >
            {t("formFollowUp.stopFollowing")}
          </button>
        )}
      </div>
    </div>
  );
};

export default FormFollowUpView;
