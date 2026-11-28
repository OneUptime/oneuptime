/*
 * The import graph reaches the native isolated-vm addon through the
 * services; it is never run here.
 */
jest.mock("isolated-vm", () => {
  return {};
});

/*
 * FORM FOLLOW-UPS (Server/Utils/Form/FormFollowUp), against in-memory
 * stores of the people following, the messages and the submissions: who may
 * open a request, and what a message, a person added, a person leaving and
 * a responder's reply each change - and whom they email.
 */

jest.mock("../../../../Server/Services/FormSubmissionFollowerService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/FormSubmissionMessageService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/FormSubmissionService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/FormService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/MailService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Services/UserService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Middleware/FormRateLimit", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../Server/Utils/Form/FormTargets", () => {
  return { __esModule: true, getFormTargetHandler: jest.fn() };
});
jest.mock("../../../../Server/Utils/Form/FormFollowUpRecords", () => {
  return { __esModule: true, getFormFollowUpRecordKind: jest.fn() };
});

import FormFollowUp from "../../../../Server/Utils/Form/FormFollowUp";
import FormService from "../../../../Server/Services/FormService";
import FormSubmissionFollowerService from "../../../../Server/Services/FormSubmissionFollowerService";
import FormSubmissionMessageService from "../../../../Server/Services/FormSubmissionMessageService";
import FormSubmissionService from "../../../../Server/Services/FormSubmissionService";
import MailService from "../../../../Server/Services/MailService";
import UserService from "../../../../Server/Services/UserService";
import FormRateLimit from "../../../../Server/Middleware/FormRateLimit";
import { getFormTargetHandler } from "../../../../Server/Utils/Form/FormTargets";
import { getFormFollowUpRecordKind } from "../../../../Server/Utils/Form/FormFollowUpRecords";
import Form from "../../../../Models/DatabaseModels/Form";
import FormSubmission from "../../../../Models/DatabaseModels/FormSubmission";
import FormSubmissionFollower from "../../../../Models/DatabaseModels/FormSubmissionFollower";
import FormSubmissionMessage from "../../../../Models/DatabaseModels/FormSubmissionMessage";
import Email from "../../../../Types/Email";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import {
  FORM_FOLLOW_UP_ALREADY_FOLLOWING_MESSAGE,
  FORM_FOLLOW_UP_EMAIL_MESSAGE,
  FORM_FOLLOW_UP_MAX_PEOPLE,
  FORM_FOLLOW_UP_MESSAGE_REQUIRED_MESSAGE,
  FORM_FOLLOW_UP_NO_SUBMISSION_MESSAGE,
  FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE,
  FORM_FOLLOW_UP_OFF_MESSAGE,
  FORM_FOLLOW_UP_RECORD_GONE_MESSAGE,
  FORM_FOLLOW_UP_TOO_MANY_PEOPLE_MESSAGE,
  FormFollowUpAuthor,
  FormFollowUpRecordView,
  formatFormFollowUpCredential,
  PublicFormMyRequests,
  PublicFormRequest,
} from "../../../../Types/Form/FormFollowUp";
import { FORM_SIGN_IN_REQUIRED_MESSAGE } from "../../../../Types/Form/FormPrivateUserSignIn";
import { PublicFormSubmissionFollowUp } from "../../../../Types/Form/FormPublic";
import FormTargetType from "../../../../Types/Form/FormTargetType";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

type AnyFunction = (...args: Array<any>) => any;
type Row = Record<string, any>;

const PROJECT_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const FORM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_FORM_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const SHARE_KEY: string = "66666666-6666-4666-8666-666666666666";
const FORM_URL: string = `https://oneuptime.example/accounts/form/${SHARE_KEY}`;

// ---------------------------------------------------------------------------
// In-memory stores, read the way the services are asked.
// ---------------------------------------------------------------------------

const text: (value: unknown) => string = (value: unknown): string => {
  return value === undefined || value === null ? "" : String(value);
};

const matches: (row: Row, query: Row) => boolean = (
  row: Row,
  query: Row,
): boolean => {
  return Object.keys(query).every((key: string): boolean => {
    const wanted: any = query[key];
    const column: string = key === "_id" ? "id" : key;
    const actual: string = text(row[column]).toLowerCase();

    // QueryHelper.any: a Raw operator, its values in its parameters.
    const parameters: unknown =
      wanted && typeof wanted === "object"
        ? (wanted as { _objectLiteralParameters?: unknown })
            ._objectLiteralParameters
        : undefined;
    const values: unknown =
      parameters && typeof parameters === "object"
        ? Object.values(parameters as Record<string, unknown>)[0]
        : undefined;

    if (Array.isArray(values)) {
      return values
        .map((value: unknown): string => {
          return text(value).toLowerCase();
        })
        .includes(actual);
    }

    return actual === text(wanted).toLowerCase();
  });
};

interface Store {
  rows: Array<Row>;
}

let clock: number = Date.parse("2026-11-28T10:00:00.000Z");

const tick: () => Date = (): Date => {
  clock += 1000;
  return new Date(clock);
};

const makeService: (store: Store) => Record<string, AnyFunction> = (
  store: Store,
): Record<string, AnyFunction> => {
  const sorted: (rows: Array<Row>, sort?: Row) => Array<Row> = (
    rows: Array<Row>,
    sort?: Row,
  ): Array<Row> => {
    if (!sort || !sort["createdAt"]) {
      return rows;
    }

    const direction: number = String(sort["createdAt"]).startsWith("D")
      ? -1
      : 1;

    return [...rows].sort((a: Row, b: Row): number => {
      return (a["createdAt"].getTime() - b["createdAt"].getTime()) * direction;
    });
  };

  return {
    create: jest.fn(async (data: { data: Row }): Promise<Row> => {
      const row: Row = {
        ...data.data,
        id: ObjectID.generate(),
        createdAt: tick(),
      };
      // A create does not hand back a computed secret.
      delete row["accessToken"];
      store.rows.push({ ...row, accessToken: data.data["accessToken"] });
      return Object.assign(Object.create(Object.getPrototypeOf(data.data)), row);
    }),
    findOneBy: jest.fn(
      async (data: { query: Row; sort?: Row }): Promise<Row | null> => {
        return (
          sorted(
            store.rows.filter((row: Row): boolean => {
              return matches(row, data.query);
            }),
            data.sort,
          )[0] || null
        );
      },
    ),
    findOneById: jest.fn(async (data: { id: ObjectID }): Promise<Row | null> => {
      return (
        store.rows.find((row: Row): boolean => {
          return text(row["id"]) === text(data.id);
        }) || null
      );
    }),
    findBy: jest.fn(
      async (data: { query: Row; sort?: Row; limit?: number }): Promise<
        Array<Row>
      > => {
        return sorted(
          store.rows.filter((row: Row): boolean => {
            return matches(row, data.query);
          }),
          data.sort,
        ).slice(0, data.limit || 1000);
      },
    ),
    deleteOneById: jest.fn(async (data: { id: ObjectID }): Promise<void> => {
      store.rows = store.rows.filter((row: Row): boolean => {
        return text(row["id"]) !== text(data.id);
      });
    }),
  };
};

const followers: Store = { rows: [] };
const messages: Store = { rows: [] };
const submissions: Store = { rows: [] };

const sentMail: Array<Row> = [];
const notes: Array<Row> = [];
const notesAs: Array<Row> = [];

const recordKind: Record<string, Mock<AnyFunction>> = {
  findReadable: jest.fn(),
  findUpdatable: jest.fn(),
  assertMayReadNotes: jest.fn(),
  addNoteAs: jest.fn(),
  readFacts: jest.fn(),
};

const makeForm: (overrides?: Partial<Form>) => Form = (
  overrides?: Partial<Form>,
): Form => {
  const form: Form = new Form();
  form.id = FORM_ID;
  form.projectId = PROJECT_ID;
  form.name = "Support";
  form.enableFollowUps = true;
  form.requireSignIn = false;
  form.requireSsoForLogin = false;
  Object.assign(form, overrides || {});
  return form;
};

const addSubmission: (overrides?: Row) => Row = (overrides?: Row): Row => {
  const row: Row = {
    id: ObjectID.generate(),
    projectId: PROJECT_ID,
    formId: FORM_ID,
    title: "Checkout fails",
    answers: [
      {
        fieldId: "f1",
        label: "What is wrong?",
        value: "Checkout fails",
        displayValue: "Checkout fails",
      },
    ],
    submitterName: "Jane",
    submitterEmail: new Email("jane@example.com"),
    targetType: FormTargetType.Incident,
    incidentId: INCIDENT_ID,
    createdAt: tick(),
    ...(overrides || {}),
  };
  submissions.rows.push(row);
  return row;
};

const addFollower: (data: {
  submission: Row;
  email: string;
  name?: string;
  isSubmitter?: boolean;
  formId?: ObjectID;
}) => Row = (data: {
  submission: Row;
  email: string;
  name?: string;
  isSubmitter?: boolean;
  formId?: ObjectID;
}): Row => {
  const row: Row = {
    id: ObjectID.generate(),
    projectId: PROJECT_ID,
    formId: data.formId || FORM_ID,
    formSubmissionId: data.submission["id"],
    email: new Email(data.email),
    name: data.name,
    isSubmitter: Boolean(data.isSubmitter),
    accessToken: "ab".repeat(32),
    createdAt: tick(),
  };
  followers.rows.push(row);
  return row;
};

const credentialOf: (follower: Row) => string = (follower: Row): string => {
  return formatFormFollowUpCredential({
    followerId: follower["id"].toString(),
    token: follower["accessToken"],
  });
};

const refusal: (promise: Promise<unknown>) => Promise<Error> = async (
  promise: Promise<unknown>,
): Promise<Error> => {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }

  throw new Error("Expected a refusal.");
};

const sessionOf: (email: string | null) => () => Promise<unknown> = (
  _email: string | null,
): (() => Promise<unknown>) => {
  return async (): Promise<unknown> => {
    return null;
  };
};

beforeEach(() => {
  followers.rows = [];
  messages.rows = [];
  submissions.rows = [];
  sentMail.length = 0;
  notes.length = 0;
  notesAs.length = 0;

  Object.assign(FormSubmissionFollowerService, makeService(followers));
  Object.assign(FormSubmissionMessageService, makeService(messages));
  Object.assign(FormSubmissionService, makeService(submissions));

  Object.assign(FormService, {
    getPublicFormUrl: jest.fn(async (): Promise<string> => {
      return FORM_URL;
    }),
    storeFormFiles: jest.fn(
      async (data: { files: Array<Row> }): Promise<Array<Row>> => {
        return data.files.map((entry: Row, index: number): Row => {
          return {
            fileId: `0000000${index}-0000-4000-8000-000000000000`,
            name: entry["file"]["name"],
            fileType: entry["file"]["fileType"],
            size: 5,
          };
        });
      },
    ),
    deleteStoredFormFiles: jest.fn(async (): Promise<void> => {}),
    findSignedInEmail: jest.fn(async (): Promise<string | null> => {
      return null;
    }),
    getFollowUpBranding: jest.fn((): Row => {
      return {};
    }),
    findOneById: jest.fn(async (): Promise<Row> => {
      return {
        id: FORM_ID,
        projectId: PROJECT_ID,
        name: "Support",
        shareKey: new ObjectID(SHARE_KEY),
        requireSignIn: false,
        enableFollowUps: true,
      };
    }),
  });

  Object.assign(MailService, {
    sendMail: jest.fn(async (mail: Row, options: Row): Promise<void> => {
      sentMail.push({ ...mail, options: options });
    }),
  });

  Object.assign(UserService, {
    findOneById: jest.fn(async (): Promise<Row> => {
      return { name: { toString: (): string => { return "Sam Responder"; } } };
    }),
  });

  Object.assign(FormRateLimit, {
    reserveFormSubmission: jest.fn(async (): Promise<void> => {}),
  });

  (getFormTargetHandler as unknown as Mock<AnyFunction>).mockReturnValue({
    addNote: jest.fn(async (data: Row): Promise<void> => {
      notes.push(data);
    }),
  });

  recordKind["findReadable"]!.mockImplementation(async (): Promise<Row> => {
    return { id: INCIDENT_ID };
  });
  recordKind["findUpdatable"]!.mockImplementation(async (): Promise<Row> => {
    return { id: INCIDENT_ID };
  });
  recordKind["assertMayReadNotes"]!.mockImplementation(
    async (): Promise<void> => {},
  );
  recordKind["addNoteAs"]!.mockImplementation(
    async (data: Row): Promise<void> => {
      notesAs.push(data);
    },
  );
  recordKind["readFacts"]!.mockImplementation(async (): Promise<Row> => {
    return {
      state: { name: "Investigating", color: "#ff0000", isClosed: false },
      reference: "INC-42",
    };
  });

  (getFormFollowUpRecordKind as unknown as Mock<AnyFunction>).mockReturnValue(
    recordKind,
  );
});

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe("after a submission", () => {
  test("the submitter follows it, by the address they gave, and is emailed their own link", async () => {
    const submission: Row = addSubmission();

    const followUp: PublicFormSubmissionFollowUp | undefined =
      await FormFollowUp.startAfterSubmission({
        form: makeForm(),
        submissionId: submission["id"],
        title: "Checkout fails",
        reference: "INC-42",
        submitterName: "Jane",
        submitterEmail: "Jane@Example.com",
      });

    expect(followers.rows).toHaveLength(1);

    const follower: Row = followers.rows[0]!;

    expect(follower["email"].toString()).toBe("jane@example.com");
    expect(follower["name"]).toBe("Jane");
    expect(follower["isSubmitter"]).toBe(true);
    expect(follower["accessToken"]).toMatch(/^[0-9a-f]{64}$/);
    expect(text(follower["formSubmissionId"])).toBe(text(submission["id"]));

    expect(followUp).toEqual({
      credential: credentialOf(follower),
      emailedTo: "jane@example.com",
    });

    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]!["templateType"]).toBe(
      EmailTemplateType.FormFollowUpStarted,
    );
    expect(sentMail[0]!["toEmail"].toString()).toBe("jane@example.com");
    expect(sentMail[0]!["isSubjectLiteral"]).toBe(true);
    expect(sentMail[0]!["subject"]).toBe("Your request: INC-42: Checkout fails");
    expect(sentMail[0]!["vars"]["requestUrl"]).toBe(
      `${FORM_URL}?followUp=${encodeURIComponent(credentialOf(follower))}`,
    );
    expect(sentMail[0]!["vars"]["isSignInRequired"]).toBe("");
    expect(text(sentMail[0]!["options"]["projectId"])).toBe(text(PROJECT_ID));
  });

  test("on a form that asks its visitors to sign in, it is the address signed in with, and the link names the submission alone", async () => {
    const submission: Row = addSubmission();

    const followUp: PublicFormSubmissionFollowUp | undefined =
      await FormFollowUp.startAfterSubmission({
        form: makeForm({ requireSignIn: true }),
        submissionId: submission["id"],
        title: "Checkout fails",
        submitterEmail: "typed@example.com",
        signedInEmail: "signed.in@example.com",
      });

    expect(followers.rows[0]!["email"].toString()).toBe(
      "signed.in@example.com",
    );
    expect(followUp).toEqual({
      submissionId: submission["id"].toString(),
      emailedTo: "signed.in@example.com",
    });
    expect(sentMail[0]!["vars"]["requestUrl"]).toBe(
      `${FORM_URL}?request=${submission["id"].toString()}`,
    );
    expect(sentMail[0]!["vars"]["requestUrl"]).not.toContain("followUp");
    expect(sentMail[0]!["vars"]["isSignInRequired"]).toBe("true");
  });

  test("nobody follows a submission sent with no address", async () => {
    const submission: Row = addSubmission({ submitterEmail: undefined });

    await expect(
      FormFollowUp.startAfterSubmission({
        form: makeForm(),
        submissionId: submission["id"],
      }),
    ).resolves.toBeUndefined();

    expect(followers.rows).toHaveLength(0);
    expect(sentMail).toHaveLength(0);
  });

  test("an address that is not one is no address", async () => {
    const submission: Row = addSubmission();

    await expect(
      FormFollowUp.startAfterSubmission({
        form: makeForm(),
        submissionId: submission["id"],
        submitterEmail: "Jane <jane@example.com>",
      }),
    ).resolves.toBeUndefined();

    expect(followers.rows).toHaveLength(0);
  });

  test("never throws: the submission stands whatever happens", async () => {
    const submission: Row = addSubmission();

    (FormSubmissionFollowerService as unknown as Row)["create"] = jest.fn(
      async (): Promise<never> => {
        throw new Error("database down");
      },
    );

    await expect(
      FormFollowUp.startAfterSubmission({
        form: makeForm(),
        submissionId: submission["id"],
        submitterEmail: "jane@example.com",
      }),
    ).resolves.toBeUndefined();

    expect(sentMail).toHaveLength(0);
  });
});

describe("opening a request with a link", () => {
  test("shows the request to the person whose link it is", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({
      submission,
      email: "jane@example.com",
      name: "Jane",
      isSubmitter: true,
    });
    const bob: Row = addFollower({ submission, email: "bob@example.com" });

    messages.rows.push({
      id: ObjectID.generate(),
      formSubmissionId: submission["id"],
      author: FormFollowUpAuthor.Requester,
      formSubmissionFollowerId: jane["id"],
      authorName: "Jane",
      message: "Still broken",
      files: [
        {
          fileId: "77777777-7777-4777-8777-777777777777",
          name: "shot.png",
          fileType: "image/png",
          size: 3,
        },
      ],
      createdAt: tick(),
    });
    messages.rows.push({
      id: ObjectID.generate(),
      formSubmissionId: submission["id"],
      author: FormFollowUpAuthor.Team,
      authorName: "",
      message: "Looking into it",
      createdAt: tick(),
    });

    const request: PublicFormRequest = await FormFollowUp.getRequest({
      form: makeForm(),
      shareKey: SHARE_KEY,
      access: { credential: credentialOf(bob) },
    });

    expect(request.submissionId).toBe(submission["id"].toString());
    expect(request.formName).toBe("Support");
    expect(request.title).toBe("Checkout fails");
    expect(request.reference).toBe("INC-42");
    expect(request.state).toEqual({
      name: "Investigating",
      color: "#ff0000",
      isClosed: false,
    });
    expect(request.answers).toEqual([
      { label: "What is wrong?", value: "Checkout fails" },
    ]);

    expect(
      request.messages.map((message: Row): Row => {
        return {
          author: message["author"],
          text: message["text"],
          isYou: message["isYou"],
          files: message["files"],
        };
      }),
    ).toEqual([
      {
        author: FormFollowUpAuthor.Requester,
        text: "Still broken",
        isYou: false,
        files: [{ name: "shot.png", size: 3 }],
      },
      {
        author: FormFollowUpAuthor.Team,
        text: "Looking into it",
        isYou: false,
        files: [],
      },
    ]);

    expect(
      request.people.map((person: Row): Row => {
        return {
          email: person["email"],
          isSubmitter: person["isSubmitter"],
          isYou: person["isYou"],
        };
      }),
    ).toEqual([
      { email: "jane@example.com", isSubmitter: true, isYou: false },
      { email: "bob@example.com", isSubmitter: false, isYou: true },
    ]);

    expect(request.you.email).toBe("bob@example.com");
    expect(request.canAddPeople).toBe(true);
    expect(request.signedInAs).toBeUndefined();
    // Never a token in what the page is told.
    expect(JSON.stringify(request)).not.toContain(jane["accessToken"]);
  });

  test.each([
    ["no credential", (): Row => {
      return {};
    }],
    ["a malformed credential", (): Row => {
      return { credential: "nonsense" };
    }],
    ["a wrong token", (follower: Row): Row => {
      return {
        credential: formatFormFollowUpCredential({
          followerId: follower["id"].toString(),
          token: "cd".repeat(32),
        }),
      };
    }],
    ["a person who is not following any more", (): Row => {
      return {
        credential: formatFormFollowUpCredential({
          followerId: ObjectID.generate().toString(),
          token: "ab".repeat(32),
        }),
      };
    }],
  ])(
    "gives the one not-available answer for %s",
    async (_name: string, accessOf: (follower: Row) => Row) => {
      const submission: Row = addSubmission();
      const jane: Row = addFollower({ submission, email: "jane@example.com" });

      const error: Error = await refusal(
        FormFollowUp.getRequest({
          form: makeForm(),
          shareKey: SHARE_KEY,
          access: accessOf(jane),
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE);
    },
  );

  test("a link of another form opens nothing on this one", async () => {
    const submission: Row = addSubmission({ formId: OTHER_FORM_ID });
    const jane: Row = addFollower({
      submission,
      email: "jane@example.com",
      formId: OTHER_FORM_ID,
    });

    const error: Error = await refusal(
      FormFollowUp.getRequest({
        form: makeForm(),
        shareKey: SHARE_KEY,
        access: { credential: credentialOf(jane) },
      }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
  });

  test("a form whose follow-ups are off opens no request, whatever the link", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    const error: Error = await refusal(
      FormFollowUp.getRequest({
        form: makeForm({ enableFollowUps: false }),
        shareKey: SHARE_KEY,
        access: { credential: credentialOf(jane) },
      }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE);
  });

  test("a deleted record reads as closed, with no state", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    recordKind["readFacts"]!.mockImplementation(async (): Promise<null> => {
      return null;
    });

    const request: PublicFormRequest = await FormFollowUp.getRequest({
      form: makeForm(),
      shareKey: SHARE_KEY,
      access: { credential: credentialOf(jane) },
    });

    expect(request.state).toBeNull();
    expect(request.reference).toBeUndefined();
  });
});

describe("opening a request on a form that asks its visitors to sign in", () => {
  const signInForm: Form = makeForm({ requireSignIn: true });

  test("asks a visitor who is not signed in to sign in, even with a link", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    const error: Error = await refusal(
      FormFollowUp.getRequest({
        form: signInForm,
        shareKey: SHARE_KEY,
        formSession: sessionOf(null) as never,
        access: { credential: credentialOf(jane) },
      }),
    );

    expect(error).toBeInstanceOf(NotAuthenticatedException);
    expect(error.message).toBe(FORM_SIGN_IN_REQUIRED_MESSAGE);
  });

  test("shows the request to a signed-in visitor whose address follows it", async () => {
    const submission: Row = addSubmission();
    addFollower({ submission, email: "jane@example.com" });

    (FormService as unknown as Row)["findSignedInEmail"] = jest.fn(
      async (): Promise<string> => {
        return "jane@example.com";
      },
    );

    const request: PublicFormRequest = await FormFollowUp.getRequest({
      form: signInForm,
      shareKey: SHARE_KEY,
      access: { submissionId: submission["id"].toString() },
    });

    expect(request.you.email).toBe("jane@example.com");
    expect(request.signedInAs).toBe("jane@example.com");
  });

  test("refuses a signed-in visitor whose address does not follow it", async () => {
    const submission: Row = addSubmission();
    addFollower({ submission, email: "jane@example.com" });

    (FormService as unknown as Row)["findSignedInEmail"] = jest.fn(
      async (): Promise<string> => {
        return "mallory@example.com";
      },
    );

    const error: Error = await refusal(
      FormFollowUp.getRequest({
        form: signInForm,
        shareKey: SHARE_KEY,
        access: { submissionId: submission["id"].toString() },
      }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
  });

  test("a link emailed before the form asked visitors to sign in still finds its request, for its own address", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    (FormService as unknown as Row)["findSignedInEmail"] = jest.fn(
      async (): Promise<string> => {
        return "jane@example.com";
      },
    );

    const request: PublicFormRequest = await FormFollowUp.getRequest({
      form: signInForm,
      shareKey: SHARE_KEY,
      access: { credential: credentialOf(jane) },
    });

    expect(request.submissionId).toBe(submission["id"].toString());
  });
});

describe("a message from somebody following", () => {
  test("is kept, written on the record as a private note with its files, and emailed to everybody else", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({
      submission,
      email: "jane@example.com",
      name: "Jane",
      isSubmitter: true,
    });
    addFollower({ submission, email: "bob@example.com" });

    const request: PublicFormRequest = await FormFollowUp.reply({
      form: makeForm(),
      shareKey: SHARE_KEY,
      access: { credential: credentialOf(jane) },
      answers: {
        message: "It fails for **every** order",
        files: [
          {
            name: "steps.txt",
            fileType: "text/plain",
            data: Buffer.from("1. open checkout").toString("base64"),
          },
        ],
      },
    });

    // The form's hourly ceiling bounds messages as it bounds submissions.
    expect(FormRateLimit.reserveFormSubmission).toHaveBeenCalledWith({
      shareKey: SHARE_KEY,
    });

    expect(messages.rows).toHaveLength(1);
    expect(messages.rows[0]).toMatchObject({
      author: FormFollowUpAuthor.Requester,
      authorName: "Jane",
      message: "It fails for **every** order",
    });
    expect(text(messages.rows[0]!["formSubmissionFollowerId"])).toBe(
      text(jane["id"]),
    );
    expect(messages.rows[0]!["files"]).toHaveLength(1);

    expect(notes).toHaveLength(1);
    expect(text(notes[0]!["createdId"])).toBe(text(INCIDENT_ID));
    expect(notes[0]!["note"]).toContain(
      "Jane (<jane@example.com>) wrote on this request through the form **Support**:",
    );
    expect(notes[0]!["attachments"]).toHaveLength(1);

    // Everybody else is told; the author is not.
    expect(
      sentMail.map((mail: Row): string => {
        return mail["toEmail"].toString();
      }),
    ).toEqual(["bob@example.com"]);
    expect(sentMail[0]!["templateType"]).toBe(
      EmailTemplateType.FormFollowUpMessage,
    );
    expect(sentMail[0]!["vars"]["authorName"]).toBe("Jane");
    expect(sentMail[0]!["vars"]["fileNames"]).toBe("steps.txt");
    expect(sentMail[0]!["vars"]["message"]).toContain("every");

    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]!.isYou).toBe(true);
  });

  test("makes what a stranger wrote inert before it is kept", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    await FormFollowUp.reply({
      form: makeForm(),
      shareKey: SHARE_KEY,
      access: { credential: credentialOf(jane) },
      answers: { message: "<!channel> ![x](https://tracker.example/p.png)" },
    });

    expect(messages.rows[0]!["message"]).not.toContain("<!channel>");
    // The image's "!" is escaped: it is a link, and nothing loads by itself.
    expect(messages.rows[0]!["message"]).not.toMatch(
      /(^|[^\\])!\[x\]\(https:\/\/tracker\.example/,
    );
  });

  test("needs words or a file", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    const error: Error = await refusal(
      FormFollowUp.reply({
        form: makeForm(),
        shareKey: SHARE_KEY,
        access: { credential: credentialOf(jane) },
        answers: { message: "   " },
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(FORM_FOLLOW_UP_MESSAGE_REQUIRED_MESSAGE);
    expect(FormRateLimit.reserveFormSubmission).not.toHaveBeenCalled();
    expect(messages.rows).toHaveLength(0);
  });

  test("is refused past the form's own text limit", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    const error: Error = await refusal(
      FormFollowUp.reply({
        form: makeForm(),
        shareKey: SHARE_KEY,
        access: { credential: credentialOf(jane) },
        answers: { message: "x".repeat(10001) },
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
  });

  test("is refused once the record is deleted: nobody would read it", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    recordKind["readFacts"]!.mockImplementation(async (): Promise<null> => {
      return null;
    });

    const error: Error = await refusal(
      FormFollowUp.reply({
        form: makeForm(),
        shareKey: SHARE_KEY,
        access: { credential: credentialOf(jane) },
        answers: { message: "Hello?" },
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(FORM_FOLLOW_UP_RECORD_GONE_MESSAGE);
    expect(messages.rows).toHaveLength(0);
  });

  test("takes its stored files away again when the message cannot be kept", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    (FormSubmissionMessageService as unknown as Row)["create"] = jest.fn(
      async (): Promise<never> => {
        throw new Error("database down");
      },
    );

    await refusal(
      FormFollowUp.reply({
        form: makeForm(),
        shareKey: SHARE_KEY,
        access: { credential: credentialOf(jane) },
        answers: {
          files: [
            {
              name: "a.txt",
              fileType: "text/plain",
              data: Buffer.from("a").toString("base64"),
            },
          ],
        },
      }),
    );

    expect(FormService.deleteStoredFormFiles).toHaveBeenCalledTimes(1);
    expect(notes).toHaveLength(0);
  });

  test("is kept even when the note cannot be written", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    (getFormTargetHandler as unknown as Mock<AnyFunction>).mockReturnValue(
      {
        addNote: jest.fn(async (): Promise<never> => {
          throw new Error("note refused");
        }),
      },
    );

    const request: PublicFormRequest = await FormFollowUp.reply({
      form: makeForm(),
      shareKey: SHARE_KEY,
      access: { credential: credentialOf(jane) },
      answers: { message: "Hi" },
    });

    expect(request.messages).toHaveLength(1);
  });
});

describe("adding somebody, from the form's page", () => {
  test("adds them, and emails them a link of their own naming who added them", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({
      submission,
      email: "jane@example.com",
      name: "Jane",
    });

    const request: PublicFormRequest = await FormFollowUp.addPerson({
      form: makeForm(),
      shareKey: SHARE_KEY,
      access: { credential: credentialOf(jane) },
      email: "Bob@Example.com",
      name: "  Bob  ",
    });

    expect(followers.rows).toHaveLength(2);

    const bob: Row = followers.rows[1]!;

    expect(bob["email"].toString()).toBe("bob@example.com");
    expect(bob["name"]).toBe("Bob");
    expect(bob["isSubmitter"]).toBe(false);
    expect(bob["accessToken"]).toMatch(/^[0-9a-f]{64}$/);
    expect(bob["accessToken"]).not.toBe(jane["accessToken"]);

    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]!["templateType"]).toBe(
      EmailTemplateType.FormFollowUpPersonAdded,
    );
    expect(sentMail[0]!["toEmail"].toString()).toBe("bob@example.com");
    expect(sentMail[0]!["vars"]["addedBy"]).toBe("Jane");
    expect(sentMail[0]!["vars"]["requestUrl"]).toContain(
      encodeURIComponent(credentialOf(bob)),
    );

    expect(request.people).toHaveLength(2);
  });

  test.each([
    ["no address", undefined],
    ["two addresses", "a@example.com b@example.com"],
    ["a name and an address", "Bob <bob@example.com>"],
  ])("refuses %s", async (_name: string, email: unknown) => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    const error: Error = await refusal(
      FormFollowUp.addPerson({
        form: makeForm(),
        shareKey: SHARE_KEY,
        access: { credential: credentialOf(jane) },
        email: email,
        name: undefined,
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(FORM_FOLLOW_UP_EMAIL_MESSAGE);
    expect(sentMail).toHaveLength(0);
  });

  test("refuses somebody already following, in any case", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    const error: Error = await refusal(
      FormFollowUp.addPerson({
        form: makeForm(),
        shareKey: SHARE_KEY,
        access: { credential: credentialOf(jane) },
        email: "JANE@example.com",
        name: undefined,
      }),
    );

    expect(error.message).toBe(FORM_FOLLOW_UP_ALREADY_FOLLOWING_MESSAGE);
  });

  test("stops at the most people one request can have", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    for (let i: number = 1; i < FORM_FOLLOW_UP_MAX_PEOPLE; i++) {
      addFollower({ submission, email: `person${i}@example.com` });
    }

    const error: Error = await refusal(
      FormFollowUp.addPerson({
        form: makeForm(),
        shareKey: SHARE_KEY,
        access: { credential: credentialOf(jane) },
        email: "one.too.many@example.com",
        name: undefined,
      }),
    );

    expect(error.message).toBe(FORM_FOLLOW_UP_TOO_MANY_PEOPLE_MESSAGE);
    expect(followers.rows).toHaveLength(FORM_FOLLOW_UP_MAX_PEOPLE);
  });

  test("a full request says nobody more can be added", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    for (let i: number = 1; i < FORM_FOLLOW_UP_MAX_PEOPLE; i++) {
      addFollower({ submission, email: `person${i}@example.com` });
    }

    const request: PublicFormRequest = await FormFollowUp.getRequest({
      form: makeForm(),
      shareKey: SHARE_KEY,
      access: { credential: credentialOf(jane) },
    });

    expect(request.canAddPeople).toBe(false);
  });
});

describe("stopping following", () => {
  test("takes the person off, and their link opens nothing after", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });
    addFollower({ submission, email: "bob@example.com" });

    await FormFollowUp.stopFollowing({
      form: makeForm(),
      shareKey: SHARE_KEY,
      access: { credential: credentialOf(jane) },
    });

    expect(
      followers.rows.map((row: Row): string => {
        return row["email"].toString();
      }),
    ).toEqual(["bob@example.com"]);

    const error: Error = await refusal(
      FormFollowUp.getRequest({
        form: makeForm(),
        shareKey: SHARE_KEY,
        access: { credential: credentialOf(jane) },
      }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
  });
});

describe("My requests", () => {
  test("lists every request of the form the signed-in address follows, newest activity first", async () => {
    const older: Row = addSubmission({ title: "Older" });
    const newer: Row = addSubmission({ title: "Newer" });
    const notMine: Row = addSubmission({ title: "Not mine" });

    addFollower({ submission: older, email: "jane@example.com" });
    addFollower({ submission: newer, email: "jane@example.com" });
    addFollower({ submission: notMine, email: "bob@example.com" });

    // A message on the older one makes it the most recent.
    messages.rows.push({
      id: ObjectID.generate(),
      formSubmissionId: older["id"],
      author: FormFollowUpAuthor.Team,
      message: "Update",
      createdAt: tick(),
    });

    (FormService as unknown as Row)["findSignedInEmail"] = jest.fn(
      async (): Promise<string> => {
        return "jane@example.com";
      },
    );

    const mine: PublicFormMyRequests = await FormFollowUp.getMyRequests({
      form: makeForm({ requireSignIn: true }),
      shareKey: SHARE_KEY,
    });

    expect(mine.signedInAs).toBe("jane@example.com");
    expect(
      mine.requests.map((request: Row): string => {
        return request["title"];
      }),
    ).toEqual(["Older", "Newer"]);
    expect(mine.requests[0]!.reference).toBe("INC-42");
  });

  test("is not there on a form anybody can open", async () => {
    const error: Error = await refusal(
      FormFollowUp.getMyRequests({ form: makeForm(), shareKey: SHARE_KEY }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
  });

  test("asks a visitor who is not signed in to sign in", async () => {
    const error: Error = await refusal(
      FormFollowUp.getMyRequests({
        form: makeForm({ requireSignIn: true }),
        shareKey: SHARE_KEY,
      }),
    );

    expect(error).toBeInstanceOf(NotAuthenticatedException);
  });
});

describe("the record's page", () => {
  const props: Row = { userId: USER_ID, tenantId: PROJECT_ID };

  test("shows the follow-up to somebody who may read the record and its private notes", async () => {
    const submission: Row = addSubmission();
    addFollower({
      submission,
      email: "jane@example.com",
      name: "Jane",
      isSubmitter: true,
    });

    const view: FormFollowUpRecordView = (await FormFollowUp.getForRecord({
      recordType: FormTargetType.Incident,
      recordId: INCIDENT_ID,
      props: props as never,
    })) as FormFollowUpRecordView;

    expect(recordKind["assertMayReadNotes"]).toHaveBeenCalled();
    expect(view.submissionId).toBe(submission["id"].toString());
    expect(view.formName).toBe("Support");
    expect(view.isFollowUpOn).toBe(true);
    expect(view.submitterName).toBe("Jane");
    expect(view.submitterEmail).toBe("jane@example.com");
    expect(view.people).toHaveLength(1);
    expect(view.canReply).toBe(true);
    expect(view.maxPeople).toBe(FORM_FOLLOW_UP_MAX_PEOPLE);
  });

  test("lets nobody reply who may not edit the record", async () => {
    addSubmission();

    recordKind["findUpdatable"]!.mockImplementation(async (): Promise<never> => {
      throw new NotAuthorizedException("no");
    });

    const view: FormFollowUpRecordView = (await FormFollowUp.getForRecord({
      recordType: FormTargetType.Incident,
      recordId: INCIDENT_ID,
      props: props as never,
    })) as FormFollowUpRecordView;

    expect(view.canReply).toBe(false);
  });

  test("is nothing - and no error - for a record no submission created, as most records are", async () => {
    await expect(
      FormFollowUp.getForRecord({
        recordType: FormTargetType.Incident,
        recordId: INCIDENT_ID,
        props: props as never,
      }),
    ).resolves.toBeNull();

    // Still only once the reader may read the record and its private notes.
    expect(recordKind["findReadable"]).toHaveBeenCalled();
    expect(recordKind["assertMayReadNotes"]).toHaveBeenCalled();
  });

  test("a change to a record no submission created is refused, as not there", async () => {
    const error: Error = await refusal(
      FormFollowUp.replyFromRecord({
        recordType: FormTargetType.Incident,
        recordId: INCIDENT_ID,
        message: "Hello",
        props: props as never,
      } as never),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(FORM_FOLLOW_UP_NO_SUBMISSION_MESSAGE);
  });

  test("is not there for somebody who may not read the record", async () => {
    addSubmission();

    recordKind["findReadable"]!.mockImplementation(async (): Promise<null> => {
      return null;
    });

    await expect(
      FormFollowUp.getForRecord({
        recordType: FormTargetType.Incident,
        recordId: INCIDENT_ID,
        props: props as never,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test("is refused to somebody who may not read the record's private notes", async () => {
    addSubmission();

    recordKind["assertMayReadNotes"]!.mockImplementation(
      async (): Promise<never> => {
        throw new NotAuthorizedException("no notes");
      },
    );

    await expect(
      FormFollowUp.getForRecord({
        recordType: FormTargetType.Incident,
        recordId: INCIDENT_ID,
        props: props as never,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("a reply is the responder's own private note, kept and emailed to everybody following", async () => {
    const submission: Row = addSubmission();
    addFollower({ submission, email: "jane@example.com" });
    addFollower({ submission, email: "bob@example.com" });

    const view: FormFollowUpRecordView = await FormFollowUp.replyFromRecord({
      recordType: FormTargetType.Incident,
      recordId: INCIDENT_ID,
      message: "  We found it.  ",
      props: props as never,
    });

    expect(notesAs).toHaveLength(1);
    expect(notesAs[0]!["props"]).toBe(props);
    expect(notesAs[0]!["note"]).toBe(
      "**Sent to the people following this request:**\n\nWe found it.",
    );

    expect(messages.rows).toHaveLength(1);
    expect(messages.rows[0]).toMatchObject({
      author: FormFollowUpAuthor.Team,
      authorName: "Sam Responder",
      message: "We found it.",
    });
    expect(text(messages.rows[0]!["createdByUserId"])).toBe(text(USER_ID));

    expect(
      sentMail
        .map((mail: Row): string => {
          return mail["toEmail"].toString();
        })
        .sort(),
    ).toEqual(["bob@example.com", "jane@example.com"]);
    expect(sentMail[0]!["vars"]["authorName"]).toBe("Sam Responder");

    expect(view.messages).toHaveLength(1);
  });

  test("a reply is refused to somebody who may not edit the record, before anything is written", async () => {
    addSubmission();

    recordKind["findUpdatable"]!.mockImplementation(async (): Promise<null> => {
      return null;
    });

    await expect(
      FormFollowUp.replyFromRecord({
        recordType: FormTargetType.Incident,
        recordId: INCIDENT_ID,
        message: "Hi",
        props: props as never,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(notesAs).toHaveLength(0);
    expect(messages.rows).toHaveLength(0);
    expect(sentMail).toHaveLength(0);
  });

  test("a reply is refused while the form's follow-ups are off", async () => {
    addSubmission();

    (FormService as unknown as Row)["findOneById"] = jest.fn(
      async (): Promise<Row> => {
        return { id: FORM_ID, name: "Support", enableFollowUps: false };
      },
    );

    const error: Error = await refusal(
      FormFollowUp.replyFromRecord({
        recordType: FormTargetType.Incident,
        recordId: INCIDENT_ID,
        message: "Hi",
        props: props as never,
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(FORM_FOLLOW_UP_OFF_MESSAGE);
  });

  test("an empty reply is refused", async () => {
    addSubmission();

    await expect(
      FormFollowUp.replyFromRecord({
        recordType: FormTargetType.Incident,
        recordId: INCIDENT_ID,
        message: "   ",
        props: props as never,
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("somebody added from the record's page is emailed, naming the responder", async () => {
    const submission: Row = addSubmission();
    addFollower({ submission, email: "jane@example.com" });

    const view: FormFollowUpRecordView =
      await FormFollowUp.addPersonFromRecord({
        recordType: FormTargetType.Incident,
        recordId: INCIDENT_ID,
        email: "ops@example.com",
        name: "Ops",
        props: props as never,
      });

    expect(view.people).toHaveLength(2);
    expect(sentMail[0]!["vars"]["addedBy"]).toBe("Sam Responder");
    expect(sentMail[0]!["toEmail"].toString()).toBe("ops@example.com");
  });

  test("somebody removed from the record's page loses their link", async () => {
    const submission: Row = addSubmission();
    const jane: Row = addFollower({ submission, email: "jane@example.com" });

    const view: FormFollowUpRecordView =
      await FormFollowUp.removePersonFromRecord({
        recordType: FormTargetType.Incident,
        recordId: INCIDENT_ID,
        followerId: jane["id"],
        props: props as never,
      });

    expect(view.people).toHaveLength(0);
    expect(followers.rows).toHaveLength(0);
  });

  test("removing somebody of another request is refused", async () => {
    addSubmission();
    const other: Row = addSubmission({ incidentId: ObjectID.generate() });
    const stranger: Row = addFollower({
      submission: other,
      email: "x@example.com",
    });

    await expect(
      FormFollowUp.removePersonFromRecord({
        recordType: FormTargetType.Incident,
        recordId: INCIDENT_ID,
        followerId: stranger["id"],
        props: props as never,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(followers.rows).toHaveLength(1);
  });

  test("an alert's and a maintenance event's submissions are found by their own column", async () => {
    const alertId: ObjectID = ObjectID.generate();
    addSubmission({
      targetType: FormTargetType.Alert,
      incidentId: undefined,
      alertId: alertId,
    });

    const view: FormFollowUpRecordView = (await FormFollowUp.getForRecord({
      recordType: FormTargetType.Alert,
      recordId: alertId,
      props: props as never,
    })) as FormFollowUpRecordView;

    expect(view.formName).toBe("Support");
    expect(getFormFollowUpRecordKind).toHaveBeenCalledWith(FormTargetType.Alert);
  });
});
