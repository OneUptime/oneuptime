import { FormSessionReader } from "../../Services/FormPrivateUserSessionService";
import FormService, { FormFileToStore } from "../../Services/FormService";
import FormSubmissionFollowerService from "../../Services/FormSubmissionFollowerService";
import FormSubmissionMessageService from "../../Services/FormSubmissionMessageService";
import FormSubmissionService from "../../Services/FormSubmissionService";
import MailService from "../../Services/MailService";
import UserService from "../../Services/UserService";
import Markdown, { MarkdownContentType } from "../../Types/Markdown";
import FormRateLimit from "../../Middleware/FormRateLimit";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import FormFollowUpToken from "./FormFollowUpToken";
import {
  FormFollowUpRecordFacts,
  FormFollowUpRecordKind,
  getFormFollowUpRecordKind,
} from "./FormFollowUpRecords";
import {
  getFormFollowUpNote,
  getFormFollowUpReplyNote,
} from "./FormSubmissionNote";
import { getFormTargetHandler } from "./FormTargets";
import Form from "../../../Models/DatabaseModels/Form";
import FormSubmission from "../../../Models/DatabaseModels/FormSubmission";
import FormSubmissionFollower from "../../../Models/DatabaseModels/FormSubmissionFollower";
import FormSubmissionMessage from "../../../Models/DatabaseModels/FormSubmissionMessage";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CustomFieldFile,
  readCustomFieldFiles,
} from "../../../Types/CustomField/CustomFieldFile";
import Dictionary from "../../../Types/Dictionary";
import { JSONArray } from "../../../Types/JSON";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { PublicFormBranding } from "../../../Types/Form/FormBranding";
import {
  cleanFormFollowUpName,
  FORM_FOLLOW_UP_ALREADY_FOLLOWING_MESSAGE,
  FORM_FOLLOW_UP_EMAIL_MESSAGE,
  FORM_FOLLOW_UP_FILES_FIELD_ID,
  FORM_FOLLOW_UP_MAX_PEOPLE,
  FORM_FOLLOW_UP_MESSAGE_FIELD_ID,
  FORM_FOLLOW_UP_MESSAGE_MAX_LENGTH,
  FORM_FOLLOW_UP_MESSAGE_REQUIRED_MESSAGE,
  FORM_FOLLOW_UP_MESSAGE_TOO_LONG_MESSAGE,
  FORM_FOLLOW_UP_NO_SUBMISSION_MESSAGE,
  FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE,
  FORM_FOLLOW_UP_OFF_MESSAGE,
  FORM_FOLLOW_UP_PARAMETER,
  FORM_FOLLOW_UP_RECORD_GONE_MESSAGE,
  FORM_FOLLOW_UP_TOO_MANY_PEOPLE_MESSAGE,
  FORM_REQUEST_PARAMETER,
  FormFollowUpAuthor,
  FormFollowUpRecordFile,
  FormFollowUpRecordMessage,
  FormFollowUpRecordPerson,
  FormFollowUpRecordView,
  formatFormFollowUpCredential,
  getFormFollowUpPersonLabel,
  getFormFollowUpReplyFields,
  PublicFormMyRequests,
  PublicFormRequest,
  PublicFormRequestAccess,
  PublicFormRequestAnswer,
  PublicFormRequestMessage,
  PublicFormRequestPerson,
  PublicFormRequestSummary,
  readFormFollowUpCredential,
  readFormFollowUpEmail,
} from "../../../Types/Form/FormFollowUp";
import { FORM_SIGN_IN_REQUIRED_MESSAGE } from "../../../Types/Form/FormPrivateUserSignIn";
import {
  formatFormSubmissionErrors,
  getFormFileAnswerFiles,
  PublicFormField,
  PublicFormSubmissionFollowUp,
  validateFormAnswer,
} from "../../../Types/Form/FormPublic";
import { FormFileAnswer } from "../../../Types/Form/FormFileAnswer";
import {
  FormSubmissionAnswer,
  readFormSubmissionAnswers,
} from "../../../Types/Form/FormSubmissionAnswer";
import FormTargetType, {
  readFormTargetType,
} from "../../../Types/Form/FormTargetType";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import QueryHelper from "../../Types/Database/QueryHelper";

/*
 * FOLLOWING UP ON A FORM SUBMISSION (Common/Types/Form/FormFollowUp).
 *
 * On a form with follow-ups on, the person who submits is added to the
 * people following the submission (FormSubmissionFollower) and emailed a
 * link to it. From the form's own page they - and anybody added since -
 * read its state and its conversation with the team, write to the team,
 * add others and stop following. A responder answers from the page of the
 * record the submission created, and everybody following is emailed.
 *
 * WHO MAY OPEN A REQUEST
 *
 *  - On a form anybody can open: whoever holds a link's credential - the
 *    person's id and their token, compared in constant time. The same
 *    answer for every link that opens nothing.
 *  - On a form that asks its visitors to sign in: only a signed-in visitor
 *    whose address is one of the people following it. A link's token is
 *    not enough there.
 *
 * Every public route reads the form first through FormService, held to
 * every check a visit to it is - on, on its plan, inside its IP allowlist -
 * and refuses every request of a form whose follow-ups are off.
 *
 * WHAT THE TEAM SEES
 *
 * Everything the people following write is also a private note on the
 * record, written as OneUptime with the person's name and address - which
 * alerts the record's owners and posts to its channels as every private
 * note does. A responder's reply is a private note written as the
 * responder, so replying takes what writing a private note on the record
 * takes; reading the conversation on the record's page takes reading its
 * private notes. The submission's answers are on the record already, on the
 * private note the submission left.
 *
 * Emails are best-effort: one that cannot be sent is logged and the request
 * stands, so nobody is invited to send the same message again.
 */

// The most messages a request shows: far past any real conversation.
const MESSAGE_LIMIT: number = 500;

// The most requests My requests lists.
const MY_REQUESTS_LIMIT: number = 100;

// What a follower is read with, everywhere here.
const FOLLOWER_SELECT: {
  _id: true;
  projectId: true;
  formId: true;
  formSubmissionId: true;
  email: true;
  name: true;
  isSubmitter: true;
  createdAt: true;
} = {
  _id: true,
  projectId: true,
  formId: true,
  formSubmissionId: true,
  email: true,
  name: true,
  isSubmitter: true,
  createdAt: true,
};

// What a submission is read with for a follow-up.
const SUBMISSION_SELECT: {
  _id: true;
  projectId: true;
  formId: true;
  title: true;
  answers: true;
  submitterName: true;
  submitterEmail: true;
  targetType: true;
  incidentId: true;
  alertId: true;
  scheduledMaintenanceId: true;
  createdAt: true;
} = {
  _id: true,
  projectId: true,
  formId: true,
  title: true,
  answers: true,
  submitterName: true,
  submitterEmail: true,
  targetType: true,
  incidentId: true,
  alertId: true,
  scheduledMaintenanceId: true,
  createdAt: true,
};

// The person reading a request on the form's page, as they were found.
interface FormFollowUpReader {
  follower: FormSubmissionFollower;
  // On a form that asks its visitors to sign in: the address signed in.
  signedInAs?: string | undefined;
}

// What every public route hands over: the form, already read and checked.
export interface FormFollowUpPublicRequest {
  // Read with FormService.getFormForFollowUp.
  form: Form;
  // The form's link key, which its hourly ceilings are counted by.
  shareKey: string;
  formSession?: FormSessionReader | undefined;
}

// Who wrote a message the people following are emailed about.
interface FormFollowUpMessageAuthor {
  name: string;
  // The person following who wrote it, who is not emailed about it.
  followerId?: ObjectID | undefined;
}

export default class FormFollowUp {
  /**
   * After a submission, on a form with follow-ups on: the submitter
   * follows it - by the address they signed in with, on a form that asks
   * its visitors to sign in, else the address they gave - and is emailed a
   * link to it. What the thank-you screen is told, or nothing when there is
   * nobody to follow it (no address given). Never throws: the submission
   * stands whatever happens here.
   */
  @CaptureSpan()
  public static async startAfterSubmission(data: {
    form: Form;
    submissionId: ObjectID;
    title?: string | undefined;
    reference?: string | undefined;
    submitterName?: string | undefined;
    submitterEmail?: string | undefined;
    signedInEmail?: string | null | undefined;
  }): Promise<PublicFormSubmissionFollowUp | undefined> {
    try {
      const email: string | null = data.form.requireSignIn
        ? readFormFollowUpEmail(data.signedInEmail)
        : readFormFollowUpEmail(data.submitterEmail);

      if (!email) {
        return undefined;
      }

      const follower: FormSubmissionFollower = await this.addFollower({
        form: data.form,
        submissionId: data.submissionId,
        email: email,
        name: cleanFormFollowUpName(data.submitterName).name,
        isSubmitter: true,
      });

      const link: string = await this.getLink({
        form: data.form,
        follower: follower,
      });

      await this.sendEmail({
        form: data.form,
        to: email,
        subject: `Your request: ${this.getSubjectTitle({
          title: data.title,
          reference: data.reference,
        })}`,
        templateType: EmailTemplateType.FormFollowUpStarted,
        vars: {
          formName: this.getFormName(data.form),
          requestTitle: this.getTitleText({
            title: data.title,
            reference: data.reference,
          }),
          requestUrl: link,
          isSignInRequired: data.form.requireSignIn ? "true" : "",
        },
      });

      if (data.form.requireSignIn) {
        return {
          submissionId: data.submissionId.toString(),
          emailedTo: email,
        };
      }

      return {
        credential: formatFormFollowUpCredential({
          followerId: follower.id!.toString(),
          token: follower.accessToken!,
        }),
        emailedTo: email,
      };
    } catch (err) {
      logger.error(
        `FormFollowUp: could not start following submission ${data.submissionId.toString()} of form ${data.form.id?.toString()}. The submission stands.`,
        this.getLogAttributes(data.form),
      );
      logger.error(err, this.getLogAttributes(data.form));

      return undefined;
    }
  }

  /*
   * ---------------------------------------------------------------------
   * The form's page.
   * ---------------------------------------------------------------------
   */

  // One request, for the person the access names.
  @CaptureSpan()
  public static async getRequest(
    data: FormFollowUpPublicRequest & { access: PublicFormRequestAccess },
  ): Promise<PublicFormRequest> {
    const reader: FormFollowUpReader = await this.findReader(data);

    return await this.buildRequest({ form: data.form, reader: reader });
  }

  /**
   * A message from the person the access names: text, files or both,
   * checked as a form's own Markdown and file questions are. Kept with the
   * submission, written on the record as a private note with its files -
   * which tells the record's owners - and emailed to everybody else
   * following. Counted against the form's hourly ceiling, as a submission
   * is: each one reaches the team.
   */
  @CaptureSpan()
  public static async reply(
    data: FormFollowUpPublicRequest & {
      access: PublicFormRequestAccess;
      answers: unknown;
    },
  ): Promise<PublicFormRequest> {
    const reader: FormFollowUpReader = await this.findReader(data);

    const reply: { message: string; files: Array<FormFileAnswer> } =
      this.readReply(data.answers);

    const submission: FormSubmission = await this.getSubmission(
      reader.follower.formSubmissionId!,
    );

    const target: { type: FormTargetType; id: ObjectID } | null =
      this.getTarget(submission);

    // A record deleted: nobody would read the message.
    if (!target || !(await this.readFacts(submission))) {
      throw new BadDataException(FORM_FOLLOW_UP_RECORD_GONE_MESSAGE);
    }

    await FormRateLimit.reserveFormSubmission({ shareKey: data.shareKey });

    const files: Array<CustomFieldFile> = await FormService.storeFormFiles({
      form: data.form,
      shareKey: data.shareKey,
      files: reply.files.map((file: FormFileAnswer): FormFileToStore => {
        return { label: "Files", file: file };
      }),
      context: "a form's follow-up message",
    });

    const authorName: string = getFormFollowUpPersonLabel({
      name: reader.follower.name,
      email: reader.follower.email?.toString(),
    });

    // Made inert where it is shown: on the page, in emails, on the note.
    const message: string = reply.message
      ? FeedMarkdown.writtenOutside(reply.message).toString()
      : "";

    try {
      const created: FormSubmissionMessage = new FormSubmissionMessage();
      created.projectId = data.form.projectId!;
      created.formId = data.form.id!;
      created.formSubmissionId = submission.id!;
      created.author = FormFollowUpAuthor.Requester;
      created.formSubmissionFollowerId = reader.follower.id!;
      created.authorName = authorName;
      created.authorEmail = reader.follower.email!;
      created.message = message;
      created.files = files as unknown as JSONArray;

      await FormSubmissionMessageService.create({
        data: created,
        props: { isRoot: true },
      });
    } catch (err) {
      await FormService.deleteStoredFormFiles({
        form: data.form,
        files: files,
      });

      throw err;
    }

    // The team reads it on the record, with its files.
    try {
      await getFormTargetHandler(target.type).addNote({
        form: data.form,
        createdId: target.id,
        note: getFormFollowUpNote({
          formName: data.form.name,
          authorName: reader.follower.name,
          authorEmail: reader.follower.email?.toString(),
          message: reply.message,
        }),
        attachments: files,
      });
    } catch (err) {
      logger.error(
        `FormFollowUp: could not write a follow-up message of submission ${submission.id?.toString()} on its record. The message is kept.`,
        this.getLogAttributes(data.form),
      );
      logger.error(err, this.getLogAttributes(data.form));
    }

    await this.emailPeopleFollowing({
      form: data.form,
      submission: submission,
      author: { name: authorName, followerId: reader.follower.id! },
      message: message,
      fileNames: files.map((file: CustomFieldFile): string => {
        return file.name;
      }),
    });

    return await this.buildRequest({ form: data.form, reader: reader });
  }

  /**
   * Somebody added by a person following the request: emailed a link of
   * their own. At most FORM_FOLLOW_UP_MAX_PEOPLE follow one request.
   */
  @CaptureSpan()
  public static async addPerson(
    data: FormFollowUpPublicRequest & {
      access: PublicFormRequestAccess;
      email: unknown;
      name: unknown;
    },
  ): Promise<PublicFormRequest> {
    const reader: FormFollowUpReader = await this.findReader(data);

    const person: { email: string; name?: string | undefined } =
      this.readPerson({ email: data.email, name: data.name });

    const submission: FormSubmission = await this.getSubmission(
      reader.follower.formSubmissionId!,
    );

    await FormRateLimit.reserveFormSubmission({ shareKey: data.shareKey });

    await this.addPersonTo({
      form: data.form,
      submission: submission,
      email: person.email,
      name: person.name,
      addedBy: getFormFollowUpPersonLabel({
        name: reader.follower.name,
        email: reader.follower.email?.toString(),
      }),
    });

    return await this.buildRequest({ form: data.form, reader: reader });
  }

  // The person the access names stops following: their link stops working.
  @CaptureSpan()
  public static async stopFollowing(
    data: FormFollowUpPublicRequest & { access: PublicFormRequestAccess },
  ): Promise<void> {
    const reader: FormFollowUpReader = await this.findReader(data);

    await FormSubmissionFollowerService.deleteOneById({
      id: reader.follower.id!,
      props: { isRoot: true },
    });
  }

  /**
   * My requests: on a form that asks its visitors to sign in, every request
   * of the form the signed-in visitor's address follows, newest activity
   * first.
   */
  @CaptureSpan()
  public static async getMyRequests(
    data: FormFollowUpPublicRequest,
  ): Promise<PublicFormMyRequests> {
    this.assertFollowUpsOn(data.form);

    if (!data.form.requireSignIn) {
      throw new NotFoundException(FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE);
    }

    const signedInAs: string = await this.getSignedInEmail(data);

    const following: Array<FormSubmissionFollower> =
      await FormSubmissionFollowerService.findBy({
        query: {
          formId: data.form.id!,
          email: new Email(signedInAs),
        },
        select: { formSubmissionId: true },
        sort: { createdAt: SortOrder.Descending },
        limit: MY_REQUESTS_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

    const submissionIds: Array<string> = following
      .map((follower: FormSubmissionFollower): string => {
        return follower.formSubmissionId?.toString() || "";
      })
      .filter(Boolean);

    const submissions: Array<FormSubmission> =
      submissionIds.length === 0
        ? []
        : await FormSubmissionService.findBy({
            query: {
              _id: QueryHelper.any(submissionIds),
              formId: data.form.id!,
            },
            select: SUBMISSION_SELECT,
            limit: MY_REQUESTS_LIMIT,
            skip: 0,
            props: { isRoot: true },
          });

    const requests: Array<PublicFormRequestSummary> = [];

    for (const submission of submissions) {
      const lastMessage: FormSubmissionMessage | null =
        await FormSubmissionMessageService.findOneBy({
          query: { formSubmissionId: submission.id! },
          select: { createdAt: true },
          sort: { createdAt: SortOrder.Descending },
          props: { isRoot: true },
        });

      const submittedAt: Date = submission.createdAt || new Date();
      const facts: FormFollowUpRecordFacts | null =
        await this.readFacts(submission);

      const summary: PublicFormRequestSummary = {
        submissionId: submission.id!.toString(),
        title: this.getRequestTitle({ form: data.form, submission }),
        submittedAt: submittedAt.toISOString(),
        lastActivityAt: (lastMessage?.createdAt || submittedAt).toISOString(),
        state: facts?.state || null,
      };

      if (facts?.reference) {
        summary.reference = facts.reference;
      }

      requests.push(summary);
    }

    requests.sort(
      (a: PublicFormRequestSummary, b: PublicFormRequestSummary): number => {
        return b.lastActivityAt.localeCompare(a.lastActivityAt);
      },
    );

    const branding: PublicFormBranding = FormService.getFollowUpBranding(
      data.form,
    );

    return {
      formName: this.getFormName(data.form),
      ...branding,
      signedInAs: signedInAs,
      requests: requests,
    };
  }

  /*
   * ---------------------------------------------------------------------
   * The record's page in the dashboard.
   * ---------------------------------------------------------------------
   */

  /**
   * The follow-up of the record a submission created, for somebody who may
   * read the record and its private notes: who sent it, who follows it,
   * the conversation, and whether the reader may reply - who may edit the
   * record may. Null for a record no submission created - most records,
   * whose page asks all the same - and NotFound for one the reader may not
   * read.
   */
  @CaptureSpan()
  public static async getForRecord(data: {
    recordType: FormTargetType;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<FormFollowUpRecordView | null> {
    const kind: FormFollowUpRecordKind = getFormFollowUpRecordKind(
      data.recordType,
    );

    const record: { id?: ObjectID | null | undefined } | null =
      await kind.findReadable({ id: data.recordId, props: data.props });

    if (!record) {
      throw new NotFoundException(FORM_FOLLOW_UP_NO_SUBMISSION_MESSAGE);
    }

    await kind.assertMayReadNotes({ id: data.recordId, props: data.props });

    const submission: FormSubmission | null = await this.findSubmissionOf({
      recordType: data.recordType,
      recordId: data.recordId,
    });

    if (!submission) {
      return null;
    }

    const form: Form | null = await FormService.findOneById({
      id: submission.formId!,
      select: { _id: true, name: true, enableFollowUps: true },
      props: { isRoot: true },
    });

    const canReply: boolean = await this.mayEditRecord({
      kind: kind,
      recordId: data.recordId,
      props: data.props,
    });

    const people: Array<FormSubmissionFollower> = await this.getPeople(
      submission.id!,
    );

    const messages: Array<FormSubmissionMessage> = await this.getMessages(
      submission.id!,
    );

    const view: FormFollowUpRecordView = {
      submissionId: submission.id!.toString(),
      formId: submission.formId!.toString(),
      formName: (form?.name || "").trim(),
      isFollowUpOn: Boolean(form?.enableFollowUps),
      submittedAt: (submission.createdAt || new Date()).toISOString(),
      people: people.map(
        (person: FormSubmissionFollower): FormFollowUpRecordPerson => {
          return {
            id: person.id!.toString(),
            ...(person.name ? { name: person.name } : {}),
            email: person.email?.toString() || "",
            isSubmitter: Boolean(person.isSubmitter),
            addedAt: (person.createdAt || new Date()).toISOString(),
          };
        },
      ),
      messages: messages.map(
        (message: FormSubmissionMessage): FormFollowUpRecordMessage => {
          return {
            id: message.id!.toString(),
            createdAt: (message.createdAt || new Date()).toISOString(),
            author: this.readAuthor(message.author),
            authorName: (message.authorName || "").trim(),
            ...(message.authorEmail
              ? { authorEmail: message.authorEmail.toString() }
              : {}),
            text: message.message || "",
            files: readCustomFieldFiles(message.files).map(
              (file: CustomFieldFile): FormFollowUpRecordFile => {
                return {
                  fileId: file.fileId,
                  name: file.name,
                  fileType: file.fileType,
                  size: file.size,
                };
              },
            ),
          };
        },
      ),
      canReply: canReply && Boolean(form?.enableFollowUps),
      maxPeople: FORM_FOLLOW_UP_MAX_PEOPLE,
    };

    if (submission.submitterName) {
      view.submitterName = submission.submitterName;
    }

    if (submission.submitterEmail) {
      view.submitterEmail = submission.submitterEmail.toString();
    }

    return view;
  }

  // The record's follow-up after a change made to it, which it has.
  private static async getChangedRecordView(data: {
    recordType: FormTargetType;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<FormFollowUpRecordView> {
    const view: FormFollowUpRecordView | null = await this.getForRecord(data);

    if (!view) {
      throw new NotFoundException(FORM_FOLLOW_UP_NO_SUBMISSION_MESSAGE);
    }

    return view;
  }

  /**
   * A responder's reply, from the record's page: a private note on the
   * record, written as the responder - held to every rule a note written
   * there is - then kept with the submission and emailed to everybody
   * following it.
   */
  @CaptureSpan()
  public static async replyFromRecord(data: {
    recordType: FormTargetType;
    recordId: ObjectID;
    message: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<FormFollowUpRecordView> {
    const message: string = this.readTeamMessage(data.message);

    const context: {
      kind: FormFollowUpRecordKind;
      submission: FormSubmission;
      form: Form;
    } = await this.getRecordForChange(data);

    await context.kind.addNoteAs({
      id: data.recordId,
      projectId: context.submission.projectId!,
      note: getFormFollowUpReplyNote({ message: message }),
      props: data.props,
    });

    const authorName: string = await this.getUserName(data.props.userId);

    const created: FormSubmissionMessage = new FormSubmissionMessage();
    created.projectId = context.submission.projectId!;
    created.formId = context.submission.formId!;
    created.formSubmissionId = context.submission.id!;
    created.author = FormFollowUpAuthor.Team;
    created.authorName = authorName;
    created.message = message;

    if (data.props.userId) {
      created.createdByUserId = data.props.userId;
    }

    await FormSubmissionMessageService.create({
      data: created,
      props: { isRoot: true },
    });

    await this.emailPeopleFollowing({
      form: context.form,
      submission: context.submission,
      author: { name: authorName },
      message: message,
      fileNames: [],
    });

    return await this.getChangedRecordView(data);
  }

  // Somebody added from the record's page, by somebody who may edit it.
  @CaptureSpan()
  public static async addPersonFromRecord(data: {
    recordType: FormTargetType;
    recordId: ObjectID;
    email: unknown;
    name: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<FormFollowUpRecordView> {
    const person: { email: string; name?: string | undefined } =
      this.readPerson({ email: data.email, name: data.name });

    const context: {
      kind: FormFollowUpRecordKind;
      submission: FormSubmission;
      form: Form;
    } = await this.getRecordForChange(data);

    await this.addPersonTo({
      form: context.form,
      submission: context.submission,
      email: person.email,
      name: person.name,
      addedBy: (await this.getUserName(data.props.userId)) || "The team",
    });

    return await this.getChangedRecordView(data);
  }

  // Somebody taken off the request from the record's page.
  @CaptureSpan()
  public static async removePersonFromRecord(data: {
    recordType: FormTargetType;
    recordId: ObjectID;
    followerId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<FormFollowUpRecordView> {
    const context: {
      kind: FormFollowUpRecordKind;
      submission: FormSubmission;
      form: Form;
    } = await this.getRecordForChange(data);

    const follower: FormSubmissionFollower | null =
      await FormSubmissionFollowerService.findOneBy({
        query: {
          _id: data.followerId.toString(),
          formSubmissionId: context.submission.id!,
        },
        select: { _id: true },
        props: { isRoot: true },
      });

    if (!follower) {
      throw new NotFoundException("That person is not following this request.");
    }

    await FormSubmissionFollowerService.deleteOneById({
      id: follower.id!,
      props: { isRoot: true },
    });

    return await this.getChangedRecordView(data);
  }

  /*
   * ---------------------------------------------------------------------
   * Reading who is asking.
   * ---------------------------------------------------------------------
   */

  /*
   * The person following a request the access names, on the form the route
   * read - or the one answer every request they may not open gets.
   */
  private static async findReader(
    data: FormFollowUpPublicRequest & { access: PublicFormRequestAccess },
  ): Promise<FormFollowUpReader> {
    this.assertFollowUpsOn(data.form);

    const access: PublicFormRequestAccess = data.access || {};

    if (data.form.requireSignIn) {
      const signedInAs: string = await this.getSignedInEmail(data);

      const submissionId: ObjectID | null = await this.getSubmissionIdOfAccess({
        form: data.form,
        access: access,
      });

      if (!submissionId) {
        throw new NotFoundException(FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE);
      }

      const follower: FormSubmissionFollower | null =
        await FormSubmissionFollowerService.findOneBy({
          query: {
            formId: data.form.id!,
            formSubmissionId: submissionId,
            email: new Email(signedInAs),
          },
          select: FOLLOWER_SELECT,
          props: { isRoot: true },
        });

      if (!follower) {
        throw new NotFoundException(FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE);
      }

      return { follower: follower, signedInAs: signedInAs };
    }

    const credential: { followerId: string; token: string } | null =
      readFormFollowUpCredential(access.credential);

    const follower: FormSubmissionFollower | null = credential
      ? await FormSubmissionFollowerService.findOneBy({
          query: {
            _id: credential.followerId,
            formId: data.form.id!,
          },
          select: { ...FOLLOWER_SELECT, accessToken: true },
          props: { isRoot: true },
        })
      : null;

    // Compared whatever was found, so every refusal takes the same path.
    const isOwnLink: boolean = FormFollowUpToken.matches({
      stored: follower?.accessToken,
      presented: credential?.token,
    });

    if (!follower || !isOwnLink) {
      throw new NotFoundException(FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE);
    }

    return { follower: follower };
  }

  /*
   * The submission a signed-in visitor asks for: by its id, or by the
   * person a link of theirs names (a link emailed before the form asked its
   * visitors to sign in still opens the right request, for its person).
   */
  private static async getSubmissionIdOfAccess(data: {
    form: Form;
    access: PublicFormRequestAccess;
  }): Promise<ObjectID | null> {
    const submissionId: string = String(data.access.submissionId || "")
      .trim()
      .toLowerCase();

    if (submissionId && ObjectID.isValidUUID(submissionId)) {
      return new ObjectID(submissionId);
    }

    const credential: { followerId: string; token: string } | null =
      readFormFollowUpCredential(data.access.credential);

    if (!credential) {
      return null;
    }

    const follower: FormSubmissionFollower | null =
      await FormSubmissionFollowerService.findOneBy({
        query: { _id: credential.followerId, formId: data.form.id! },
        select: { formSubmissionId: true },
        props: { isRoot: true },
      });

    return follower?.formSubmissionId || null;
  }

  private static async getSignedInEmail(
    data: FormFollowUpPublicRequest,
  ): Promise<string> {
    const signedInAs: string | null = await FormService.findSignedInEmail({
      form: data.form,
      formSession: data.formSession,
    });

    if (!signedInAs) {
      throw new NotAuthenticatedException(FORM_SIGN_IN_REQUIRED_MESSAGE);
    }

    return signedInAs;
  }

  private static assertFollowUpsOn(form: Form): void {
    if (!form.enableFollowUps) {
      throw new NotFoundException(FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE);
    }
  }

  /*
   * The submission a record's page asks about, and the record itself, for
   * somebody who may change its follow-up: who may edit the record, on a
   * form whose follow-ups are on.
   */
  private static async getRecordForChange(data: {
    recordType: FormTargetType;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<{
    kind: FormFollowUpRecordKind;
    submission: FormSubmission;
    form: Form;
  }> {
    const kind: FormFollowUpRecordKind = getFormFollowUpRecordKind(
      data.recordType,
    );

    const record: { id?: ObjectID | null | undefined } | null =
      await kind.findReadable({ id: data.recordId, props: data.props });

    if (!record) {
      throw new NotFoundException(FORM_FOLLOW_UP_NO_SUBMISSION_MESSAGE);
    }

    if (
      !(await this.mayEditRecord({
        kind: kind,
        recordId: data.recordId,
        props: data.props,
      }))
    ) {
      throw new NotAuthorizedException(
        "Only people who may edit this record can reply to the people following its request, or change who follows it.",
      );
    }

    const submission: FormSubmission | null = await this.findSubmissionOf({
      recordType: data.recordType,
      recordId: data.recordId,
    });

    if (!submission) {
      throw new NotFoundException(FORM_FOLLOW_UP_NO_SUBMISSION_MESSAGE);
    }

    const form: Form | null = await FormService.findOneById({
      id: submission.formId!,
      select: {
        _id: true,
        projectId: true,
        name: true,
        shareKey: true,
        requireSignIn: true,
        enableFollowUps: true,
      },
      props: { isRoot: true },
    });

    if (!form) {
      throw new NotFoundException(FORM_FOLLOW_UP_NO_SUBMISSION_MESSAGE);
    }

    if (!form.enableFollowUps) {
      throw new BadDataException(FORM_FOLLOW_UP_OFF_MESSAGE);
    }

    return { kind: kind, submission: submission, form: form };
  }

  // Whether the caller may edit the record: asked as an update would be.
  private static async mayEditRecord(data: {
    kind: FormFollowUpRecordKind;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    if (!data.props.userId && !data.props.isRoot) {
      return false;
    }

    try {
      return Boolean(
        await data.kind.findUpdatable({
          id: data.recordId,
          props: data.props,
        }),
      );
    } catch (err) {
      if (!(err instanceof NotAuthorizedException)) {
        logger.error(err);
      }

      return false;
    }
  }

  private static async findSubmissionOf(data: {
    recordType: FormTargetType;
    recordId: ObjectID;
  }): Promise<FormSubmission | null> {
    const column: "incidentId" | "alertId" | "scheduledMaintenanceId" =
      data.recordType === FormTargetType.Alert
        ? "alertId"
        : data.recordType === FormTargetType.ScheduledMaintenance
          ? "scheduledMaintenanceId"
          : "incidentId";

    return await FormSubmissionService.findOneBy({
      query: { [column]: data.recordId },
      select: SUBMISSION_SELECT,
      props: { isRoot: true },
    });
  }

  /*
   * ---------------------------------------------------------------------
   * Reading what is asked for.
   * ---------------------------------------------------------------------
   */

  /*
   * A reply's text and files, checked as a form's own Markdown and file
   * questions are (validateFormAnswer): at least one of them, the text at
   * most FORM_FOLLOW_UP_MESSAGE_MAX_LENGTH characters.
   */
  private static readReply(answers: unknown): {
    message: string;
    files: Array<FormFileAnswer>;
  } {
    const values: Record<string, unknown> =
      answers && typeof answers === "object" && !Array.isArray(answers)
        ? (answers as Record<string, unknown>)
        : {};

    const fields: Array<PublicFormField> = getFormFollowUpReplyFields();
    const messageField: PublicFormField = fields.find(
      (field: PublicFormField): boolean => {
        return field.id === FORM_FOLLOW_UP_MESSAGE_FIELD_ID;
      },
    )!;
    const filesField: PublicFormField = fields.find(
      (field: PublicFormField): boolean => {
        return field.id === FORM_FOLLOW_UP_FILES_FIELD_ID;
      },
    )!;

    const errors: Array<string> = [];

    const messageAnswer: ReturnType<typeof validateFormAnswer> =
      validateFormAnswer({
        field: messageField,
        answer: values[FORM_FOLLOW_UP_MESSAGE_FIELD_ID],
      });

    const filesAnswer: ReturnType<typeof validateFormAnswer> =
      validateFormAnswer({
        field: filesField,
        answer: values[FORM_FOLLOW_UP_FILES_FIELD_ID],
      });

    if (!messageAnswer.isValid) {
      errors.push(...messageAnswer.errors);
    }

    if (!filesAnswer.isValid) {
      errors.push(...filesAnswer.errors);
    }

    if (errors.length > 0) {
      throw new BadDataException(formatFormSubmissionErrors(errors));
    }

    const message: string =
      messageAnswer.isValid && typeof messageAnswer.value === "string"
        ? messageAnswer.value
        : "";

    const files: Array<FormFileAnswer> =
      filesAnswer.isValid && filesAnswer.value !== undefined
        ? getFormFileAnswerFiles(filesAnswer.value)
        : [];

    if (!message.trim() && files.length === 0) {
      throw new BadDataException(FORM_FOLLOW_UP_MESSAGE_REQUIRED_MESSAGE);
    }

    return { message: message, files: files };
  }

  // A responder's reply: Markdown, at most FORM_FOLLOW_UP_MESSAGE_MAX_LENGTH.
  private static readTeamMessage(value: unknown): string {
    const message: string = typeof value === "string" ? value.trim() : "";

    if (!message) {
      throw new BadDataException("Write a reply before sending it.");
    }

    if (message.length > FORM_FOLLOW_UP_MESSAGE_MAX_LENGTH) {
      throw new BadDataException(FORM_FOLLOW_UP_MESSAGE_TOO_LONG_MESSAGE);
    }

    return message;
  }

  private static readPerson(data: { email: unknown; name: unknown }): {
    email: string;
    name?: string | undefined;
  } {
    const email: string | null = readFormFollowUpEmail(data.email);

    if (!email) {
      throw new BadDataException(FORM_FOLLOW_UP_EMAIL_MESSAGE);
    }

    const name: { name?: string | undefined; error?: string | undefined } =
      cleanFormFollowUpName(data.name);

    if (name.error) {
      throw new BadDataException(name.error);
    }

    return name.name ? { email: email, name: name.name } : { email: email };
  }

  /*
   * ---------------------------------------------------------------------
   * Changing who follows.
   * ---------------------------------------------------------------------
   */

  private static async addPersonTo(data: {
    form: Form;
    submission: FormSubmission;
    email: string;
    name?: string | undefined;
    addedBy: string;
  }): Promise<void> {
    const people: Array<FormSubmissionFollower> = await this.getPeople(
      data.submission.id!,
    );

    if (
      people.some((person: FormSubmissionFollower): boolean => {
        return person.email?.toString().toLowerCase() === data.email;
      })
    ) {
      throw new BadDataException(FORM_FOLLOW_UP_ALREADY_FOLLOWING_MESSAGE);
    }

    if (people.length >= FORM_FOLLOW_UP_MAX_PEOPLE) {
      throw new BadDataException(FORM_FOLLOW_UP_TOO_MANY_PEOPLE_MESSAGE);
    }

    const follower: FormSubmissionFollower = await this.addFollower({
      form: data.form,
      submissionId: data.submission.id!,
      email: data.email,
      name: data.name,
      isSubmitter: false,
    });

    const link: string = await this.getLink({
      form: data.form,
      follower: follower,
    });

    const title: string = this.getRequestTitle({
      form: data.form,
      submission: data.submission,
    });

    await this.sendEmail({
      form: data.form,
      to: data.email,
      subject: `You were added to a request: ${title}`,
      templateType: EmailTemplateType.FormFollowUpPersonAdded,
      vars: {
        formName: this.getFormName(data.form),
        requestTitle: title,
        addedBy: data.addedBy,
        requestUrl: link,
        isSignInRequired: data.form.requireSignIn ? "true" : "",
      },
    });
  }

  private static async addFollower(data: {
    form: Form;
    submissionId: ObjectID;
    email: string;
    name?: string | undefined;
    isSubmitter: boolean;
  }): Promise<FormSubmissionFollower> {
    const follower: FormSubmissionFollower = new FormSubmissionFollower();
    follower.projectId = data.form.projectId!;
    follower.formId = data.form.id!;
    follower.formSubmissionId = data.submissionId;
    follower.email = new Email(data.email);
    follower.isSubmitter = data.isSubmitter;
    follower.accessToken = FormFollowUpToken.generate();

    if (data.name) {
      follower.name = data.name;
    }

    const created: FormSubmissionFollower =
      await FormSubmissionFollowerService.create({
        data: follower,
        props: { isRoot: true },
      });

    // The token minted here, which a create does not hand back.
    created.accessToken = follower.accessToken;

    return created;
  }

  /*
   * ---------------------------------------------------------------------
   * Building what is shown.
   * ---------------------------------------------------------------------
   */

  private static async buildRequest(data: {
    form: Form;
    reader: FormFollowUpReader;
  }): Promise<PublicFormRequest> {
    const submission: FormSubmission = await this.getSubmission(
      data.reader.follower.formSubmissionId!,
    );

    const people: Array<FormSubmissionFollower> = await this.getPeople(
      submission.id!,
    );

    const messages: Array<FormSubmissionMessage> = await this.getMessages(
      submission.id!,
    );

    const readerId: string = data.reader.follower.id!.toString();

    const toPerson: (
      person: FormSubmissionFollower,
    ) => PublicFormRequestPerson = (
      person: FormSubmissionFollower,
    ): PublicFormRequestPerson => {
      const shown: PublicFormRequestPerson = {
        id: person.id!.toString(),
        email: person.email?.toString() || "",
        isSubmitter: Boolean(person.isSubmitter),
        isYou: person.id!.toString() === readerId,
      };

      if (person.name) {
        shown.name = person.name;
      }

      return shown;
    };

    const branding: PublicFormBranding = FormService.getFollowUpBranding(
      data.form,
    );

    const facts: FormFollowUpRecordFacts | null =
      await this.readFacts(submission);

    const request: PublicFormRequest = {
      submissionId: submission.id!.toString(),
      formName: this.getFormName(data.form),
      ...branding,
      title: this.getRequestTitle({ form: data.form, submission }),
      submittedAt: (submission.createdAt || new Date()).toISOString(),
      state: facts?.state || null,
      answers: readFormSubmissionAnswers(submission.answers).map(
        (answer: FormSubmissionAnswer): PublicFormRequestAnswer => {
          return { label: answer.label, value: this.getAnswerText(answer) };
        },
      ),
      messages: messages.map(
        (message: FormSubmissionMessage): PublicFormRequestMessage => {
          return {
            id: message.id!.toString(),
            createdAt: (message.createdAt || new Date()).toISOString(),
            author: this.readAuthor(message.author),
            authorName: (message.authorName || "").trim(),
            isYou:
              Boolean(message.formSubmissionFollowerId) &&
              message.formSubmissionFollowerId!.toString() === readerId,
            text: message.message || "",
            files: readCustomFieldFiles(message.files).map(
              (file: CustomFieldFile): { name: string; size: number } => {
                return { name: file.name, size: file.size };
              },
            ),
          };
        },
      ),
      people: people.map(toPerson),
      you: toPerson(data.reader.follower),
      canAddPeople: people.length < FORM_FOLLOW_UP_MAX_PEOPLE,
    };

    if (facts?.reference) {
      request.reference = facts.reference;
    }

    if (data.reader.signedInAs) {
      request.signedInAs = data.reader.signedInAs;
    }

    return request;
  }

  private static async getSubmission(
    submissionId: ObjectID,
  ): Promise<FormSubmission> {
    const submission: FormSubmission | null =
      await FormSubmissionService.findOneById({
        id: submissionId,
        select: SUBMISSION_SELECT,
        props: { isRoot: true },
      });

    if (!submission) {
      throw new NotFoundException(FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE);
    }

    return submission;
  }

  private static async getPeople(
    submissionId: ObjectID,
  ): Promise<Array<FormSubmissionFollower>> {
    return await FormSubmissionFollowerService.findBy({
      query: { formSubmissionId: submissionId },
      select: FOLLOWER_SELECT,
      sort: { createdAt: SortOrder.Ascending },
      limit: FORM_FOLLOW_UP_MAX_PEOPLE + 1,
      skip: 0,
      props: { isRoot: true },
    });
  }

  private static async getMessages(
    submissionId: ObjectID,
  ): Promise<Array<FormSubmissionMessage>> {
    return await FormSubmissionMessageService.findBy({
      query: { formSubmissionId: submissionId },
      select: {
        _id: true,
        author: true,
        authorName: true,
        authorEmail: true,
        formSubmissionFollowerId: true,
        message: true,
        files: true,
        createdAt: true,
      },
      sort: { createdAt: SortOrder.Ascending },
      limit: MESSAGE_LIMIT,
      skip: 0,
      props: { isRoot: true },
    });
  }

  private static getTarget(
    submission: FormSubmission,
  ): { type: FormTargetType; id: ObjectID } | null {
    const type: FormTargetType = readFormTargetType(submission.targetType);

    const id: ObjectID | undefined =
      type === FormTargetType.Alert
        ? submission.alertId
        : type === FormTargetType.ScheduledMaintenance
          ? submission.scheduledMaintenanceId
          : submission.incidentId;

    return id ? { type: type, id: id } : null;
  }

  /*
   * The record's state and number; null once it is gone, or while it
   * cannot be read.
   */
  private static async readFacts(
    submission: FormSubmission,
  ): Promise<FormFollowUpRecordFacts | null> {
    const target: { type: FormTargetType; id: ObjectID } | null =
      this.getTarget(submission);

    if (!target) {
      return null;
    }

    try {
      return await getFormFollowUpRecordKind(target.type).readFacts(target.id);
    } catch (err) {
      logger.error(
        `FormFollowUp: could not read the state of the record of submission ${submission.id?.toString()}.`,
      );
      logger.error(err);

      return null;
    }
  }

  private static readAuthor(value: unknown): FormFollowUpAuthor {
    return value === FormFollowUpAuthor.Team
      ? FormFollowUpAuthor.Team
      : FormFollowUpAuthor.Requester;
  }

  /*
   * What a request is called: the title it was created with, else its
   * first answer, else the form's name.
   */
  private static getRequestTitle(data: {
    form: Form;
    submission: FormSubmission;
  }): string {
    const title: string = (data.submission.title || "").trim();

    if (title) {
      return title;
    }

    const first: FormSubmissionAnswer | undefined = readFormSubmissionAnswers(
      data.submission.answers,
    )[0];

    const answer: string = first ? this.getAnswerText(first).trim() : "";

    if (answer) {
      return answer.length > 200 ? `${answer.slice(0, 199)}…` : answer;
    }

    return this.getFormName(data.form) || "Your request";
  }

  // An answer as its sender reads it: files by their names.
  private static getAnswerText(answer: FormSubmissionAnswer): string {
    const files: Array<CustomFieldFile> = readCustomFieldFiles(answer.value);

    if (files.length > 0) {
      return files
        .map((file: CustomFieldFile): string => {
          return file.name;
        })
        .join(", ");
    }

    return answer.displayValue || "";
  }

  private static getFormName(form: Form): string {
    return (form.name || "").trim();
  }

  // The subject's words for a request: its number and title, or its title.
  private static getSubjectTitle(data: {
    title?: string | undefined;
    reference?: string | undefined;
  }): string {
    return this.getTitleText(data);
  }

  private static getTitleText(data: {
    title?: string | undefined;
    reference?: string | undefined;
  }): string {
    const title: string = (data.title || "").trim();
    const reference: string = (data.reference || "").trim();

    if (title && reference) {
      return `${reference}: ${title}`;
    }

    return title || reference || "Your request";
  }

  private static async getUserName(
    userId: ObjectID | undefined,
  ): Promise<string> {
    if (!userId) {
      return "";
    }

    const user: User | null = await UserService.findOneById({
      id: userId,
      select: { name: true },
      props: { isRoot: true },
    });

    return (user?.name?.toString() || "").trim();
  }

  /*
   * ---------------------------------------------------------------------
   * Emails.
   * ---------------------------------------------------------------------
   */

  /*
   * A person's link to the request: on a form anybody can open, the form's
   * own address with their credential; on a form that asks its visitors to
   * sign in, with the submission alone - they sign in to open it.
   */
  private static async getLink(data: {
    form: Form;
    follower: FormSubmissionFollower;
  }): Promise<string> {
    const link: globalThis.URL = new globalThis.URL(
      await FormService.getPublicFormUrl(data.form.id!),
    );

    if (data.form.requireSignIn) {
      link.searchParams.set(
        FORM_REQUEST_PARAMETER,
        data.follower.formSubmissionId!.toString(),
      );
    } else {
      link.searchParams.set(
        FORM_FOLLOW_UP_PARAMETER,
        formatFormFollowUpCredential({
          followerId: data.follower.id!.toString(),
          token: data.follower.accessToken!,
        }),
      );
    }

    return link.toString();
  }

  // Everybody following a request but the author, told about a message.
  private static async emailPeopleFollowing(data: {
    form: Form;
    submission: FormSubmission;
    author: FormFollowUpMessageAuthor;
    message: string;
    fileNames: Array<string>;
  }): Promise<void> {
    const people: Array<FormSubmissionFollower> =
      await FormSubmissionFollowerService.findBy({
        query: { formSubmissionId: data.submission.id! },
        select: { ...FOLLOWER_SELECT, accessToken: true },
        sort: { createdAt: SortOrder.Ascending },
        limit: FORM_FOLLOW_UP_MAX_PEOPLE + 1,
        skip: 0,
        props: { isRoot: true },
      });

    const title: string = this.getRequestTitle({
      form: data.form,
      submission: data.submission,
    });

    const messageHtml: string = data.message
      ? await Markdown.convertToHTML(data.message, MarkdownContentType.Email)
      : "";

    for (const person of people) {
      if (
        data.author.followerId &&
        person.id?.toString() === data.author.followerId.toString()
      ) {
        continue;
      }

      const email: string = person.email?.toString() || "";

      if (!email) {
        continue;
      }

      try {
        await this.sendEmail({
          form: data.form,
          to: email,
          subject: `New message on your request: ${title}`,
          templateType: EmailTemplateType.FormFollowUpMessage,
          vars: {
            formName: this.getFormName(data.form),
            requestTitle: title,
            authorName: data.author.name || "The team",
            message: messageHtml,
            fileNames: data.fileNames.join(", "),
            requestUrl: await this.getLink({
              form: data.form,
              follower: person,
            }),
            isSignInRequired: data.form.requireSignIn ? "true" : "",
          },
        });
      } catch (err) {
        logger.error(
          `FormFollowUp: could not email a person following submission ${data.submission.id?.toString()}.`,
          this.getLogAttributes(data.form),
        );
        logger.error(err, this.getLogAttributes(data.form));
      }
    }
  }

  private static async sendEmail(data: {
    form: Form;
    to: string;
    subject: string;
    templateType: EmailTemplateType;
    vars: Dictionary<string>;
  }): Promise<void> {
    const mail: EmailMessage = {
      toEmail: new Email(data.to),
      subject: data.subject,
      isSubjectLiteral: true,
      templateType: data.templateType,
      vars: data.vars,
    };

    MailService.sendMail(mail, {
      projectId: data.form.projectId,
    }).catch((err: Error) => {
      logger.error(err, this.getLogAttributes(data.form));
    });
  }

  private static getLogAttributes(form: Form): LogAttributes {
    return {
      projectId: form.projectId?.toString(),
      formId: form.id?.toString(),
    };
  }
}
