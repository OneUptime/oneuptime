import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A FORM THAT ASKS ITS VISITORS TO SIGN IN (#10249) IS NEITHER SHOWN NOR
 * TAKEN FROM ANYBODY ELSE.
 *
 * FormService decides every public route of a form: its read, its
 * submission (on its link and on its custom domain), its sign-in state and
 * the form a sign-in is for. On a form set to Only people who sign in
 * (Form.requireSignIn):
 *
 *   - a visitor without a live session of one of its private users is
 *     answered FORM_SIGN_IN_REQUIRED_MESSAGE (401) - after every check a
 *     visit makes before it (the form is on, on its plan, the network is
 *     allowed), and before anything the form asks or does is built or a
 *     captcha is checked;
 *   - the session is read from the form's own cookie, for this form and its
 *     Require SSO to Sign In (FormPrivateUserSessionService);
 *   - its sign-in state names the form's id, its name and who is signed in -
 *     and nothing else, from the form's access columns alone; a form that
 *     does not ask names nothing at all.
 */

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import Form from "../../../Models/DatabaseModels/Form";
import FormDomain from "../../../Models/DatabaseModels/FormDomain";
import FormPrivateUser from "../../../Models/DatabaseModels/FormPrivateUser";
import FormPrivateUserSession from "../../../Models/DatabaseModels/FormPrivateUserSession";
import FormDomainService from "../../../Server/Services/FormDomainService";
import FormPrivateUserSessionService, {
  FormSessionReader,
} from "../../../Server/Services/FormPrivateUserSessionService";
import FormService, {
  FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  FORM_NOT_AVAILABLE_MESSAGE,
} from "../../../Server/Services/FormService";
import CaptchaUtil from "../../../Server/Utils/Captcha";
import UsableCustomDomain from "../../../Server/Utils/CustomDomain/UsableCustomDomain";
import { ExpressRequest } from "../../../Server/Utils/Express";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import {
  FORM_SIGN_IN_NOT_ASKED_MESSAGE,
  FORM_SIGN_IN_REQUIRED_MESSAGE,
  FormSignInState,
} from "../../../Types/Form/FormPrivateUserSignIn";
import ObjectID from "../../../Types/ObjectID";

const FORM_ID: string = "0f000000-0000-4000-8000-000000000001";
const PROJECT_ID: string = "0f000000-0000-4000-8000-0000000000aa";
const SHARE_KEY: string = "0f000000-0000-4000-8000-0000000000bb";
const SIGNED_IN_EMAIL: string = "ada@acme.example";
const ALLOWED_IP: string = "203.0.113.7";

// What the form's row holds.
interface StoredForm {
  isEnabled: boolean;
  requireSignIn: boolean;
  requireSsoForLogin: boolean;
  ipWhitelist?: string | undefined;
}

let stored: StoredForm;
let hasSession: boolean;

// Every select the form was read with, in order.
let selects: Array<Record<string, unknown>>;

const REQUEST: ExpressRequest = {
  headers: {},
  cookies: {},
} as unknown as ExpressRequest;

// The reader a public form route hands the service: the form's own cookie of REQUEST.
const READER: FormSessionReader =
  FormPrivateUserSessionService.getSessionReader(REQUEST);

const buildForm: () => Form = (): Form => {
  const form: Form = new Form();
  form._id = FORM_ID;
  form.projectId = new ObjectID(PROJECT_ID);
  form.shareKey = new ObjectID(SHARE_KEY);
  form.name = "Access request";
  form.isEnabled = stored.isEnabled;
  form.requireSignIn = stored.requireSignIn;
  form.requireSsoForLogin = stored.requireSsoForLogin;
  form.ipWhitelist = stored.ipWhitelist;
  return form;
};

const session: () => FormPrivateUserSession = (): FormPrivateUserSession => {
  const privateUser: FormPrivateUser = new FormPrivateUser();
  privateUser.email = new Email(SIGNED_IN_EMAIL);

  const formSession: FormPrivateUserSession = new FormPrivateUserSession();
  formSession._id = "0f000000-0000-4000-8000-0000000000cc";
  formSession.formPrivateUser = privateUser;
  return formSession;
};

let findSession: SpyInstance<
  typeof FormPrivateUserSessionService.findSignedInSessionOnRequest
>;
let buildPublicForm: SpyInstance<(form: Form) => Promise<unknown>>;

beforeEach(() => {
  stored = {
    isEnabled: true,
    requireSignIn: true,
    requireSsoForLogin: false,
  };
  hasSession = false;
  selects = [];

  const lookUp: (findBy: {
    query: { shareKey?: ObjectID; _id?: unknown };
    select: Record<string, unknown>;
  }) => Promise<Form | null> = async (findBy: {
    query: { shareKey?: ObjectID; _id?: unknown };
    select: Record<string, unknown>;
  }): Promise<Form | null> => {
    selects.push(findBy.select);
    return findBy.query.shareKey?.toString() === SHARE_KEY ? buildForm() : null;
  };

  jest.spyOn(FormService, "findOneBy").mockImplementation(lookUp as never);
  jest
    .spyOn(FormService, "findOneById")
    .mockImplementation((async (findBy: {
      id: ObjectID;
      select: Record<string, unknown>;
    }): Promise<Form | null> => {
      selects.push(findBy.select);
      return findBy.id.toString() === FORM_ID ? buildForm() : null;
    }) as never);

  // Every project is on a plan with forms.
  jest
    .spyOn(FormService as never, "isProjectOnPlan" as never)
    .mockResolvedValue(true as never);

  findSession = jest
    .spyOn(FormPrivateUserSessionService, "findSignedInSessionOnRequest")
    .mockImplementation((async (): Promise<FormPrivateUserSession | null> => {
      return hasSession ? session() : null;
    }) as never);

  // What a visit is shown, once it may be: none of this suite's business.
  buildPublicForm = jest
    .spyOn(FormService as never, "buildPublicFormFor" as never)
    .mockResolvedValue({ form: { name: "Access request", fields: [] } } as never);

  jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(true);
  jest
    .spyOn(CaptchaUtil, "verifyCaptcha")
    .mockRejectedValue(new BadDataException("captcha checked") as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const answerOf: (work: Promise<unknown>) => Promise<Exception | null> = async (
  work: Promise<unknown>,
): Promise<Exception | null> => {
  try {
    await work;
    return null;
  } catch (err) {
    return err as Exception;
  }
};

describe("a form that asks its visitors to sign in", () => {
  test("refuses its read to a visitor holding no session of its private users, before anything it asks is built", async () => {
    const answer: Exception | null = await answerOf(
      FormService.getPublicForm({
        shareKey: SHARE_KEY,
        clientIp: ALLOWED_IP,
        formSession: READER,
      }),
    );

    expect(answer).toBeInstanceOf(NotAuthenticatedException);
    expect(answer?.message).toBe(FORM_SIGN_IN_REQUIRED_MESSAGE);
    expect(buildPublicForm).not.toHaveBeenCalled();
  });

  test("reads the session from the form's own cookie, for this form and its Require SSO to Sign In", async () => {
    stored.requireSsoForLogin = true;

    await answerOf(
      FormService.getPublicForm({
        shareKey: SHARE_KEY,
        clientIp: ALLOWED_IP,
        formSession: READER,
      }),
    );

    expect(findSession).toHaveBeenCalledTimes(1);

    const lookup: {
      req: ExpressRequest;
      formId: ObjectID;
      requireSsoForLogin: boolean | undefined;
    } = findSession.mock.calls[0]![0] as never;

    expect(lookup.req).toBe(REQUEST);
    expect(lookup.formId.toString()).toBe(FORM_ID);
    expect(lookup.requireSsoForLogin).toBe(true);
  });

  test("refuses a read that hands over no session reader at all, as one without a session", async () => {
    const answer: Exception | null = await answerOf(
      FormService.getPublicForm({ shareKey: SHARE_KEY, clientIp: ALLOWED_IP }),
    );

    expect(answer).toBeInstanceOf(NotAuthenticatedException);
    expect(findSession).not.toHaveBeenCalled();
  });

  test("shows the form to one of its private users, signed in", async () => {
    hasSession = true;

    const answer: Exception | null = await answerOf(
      FormService.getPublicForm({
        shareKey: SHARE_KEY,
        clientIp: ALLOWED_IP,
        formSession: READER,
      }),
    );

    expect(answer).toBeNull();
    expect(buildPublicForm).toHaveBeenCalledTimes(1);
  });

  test("takes no submission from a visitor without a session - and checks no captcha first", async () => {
    const answer: Exception | null = await answerOf(
      FormService.submitPublicForm({
        shareKey: SHARE_KEY,
        request: { answers: {} } as never,
        clientIp: ALLOWED_IP,
        formSession: READER,
      }),
    );

    expect(answer).toBeInstanceOf(NotAuthenticatedException);
    expect(answer?.message).toBe(FORM_SIGN_IN_REQUIRED_MESSAGE);
    expect(CaptchaUtil.verifyCaptcha).not.toHaveBeenCalled();
  });

  test("goes on to the submission's own checks for one of its private users", async () => {
    hasSession = true;

    const answer: Exception | null = await answerOf(
      FormService.submitPublicForm({
        shareKey: SHARE_KEY,
        request: { answers: {} } as never,
        clientIp: ALLOWED_IP,
        formSession: READER,
      }),
    );

    // The next check, the captcha, ran: the sign-in let the visitor past.
    expect(answer?.message).toBe("captcha checked");
  });

  test("answers its custom domain as its link: no session, no form", async () => {
    jest
      .spyOn(FormDomainService, "getShareKeyOfFormOnDomain")
      .mockResolvedValue(SHARE_KEY as never);

    const read: Exception | null = await answerOf(
      FormService.getPublicFormOnCustomDomain({
        hostname: "forms.acme.example",
        clientIp: ALLOWED_IP,
        formSession: READER,
      }),
    );
    const submission: Exception | null = await answerOf(
      FormService.submitPublicFormOnCustomDomain({
        hostname: "forms.acme.example",
        request: { answers: {} } as never,
        clientIp: ALLOWED_IP,
        formSession: READER,
      }),
    );

    expect(read).toBeInstanceOf(NotAuthenticatedException);
    expect(submission).toBeInstanceOf(NotAuthenticatedException);
  });

  test("checks the form is on and the network is allowed before it asks anybody to sign in", async () => {
    stored.isEnabled = false;

    const off: Exception | null = await answerOf(
      FormService.getPublicForm({
        shareKey: SHARE_KEY,
        clientIp: ALLOWED_IP,
        formSession: READER,
      }),
    );

    expect(off).toBeInstanceOf(NotFoundException);
    expect(off?.message).toBe(FORM_NOT_AVAILABLE_MESSAGE);

    stored.isEnabled = true;
    stored.ipWhitelist = "198.51.100.0/24";

    const outside: Exception | null = await answerOf(
      FormService.getPublicForm({
        shareKey: SHARE_KEY,
        clientIp: ALLOWED_IP,
        formSession: READER,
      }),
    );

    expect(outside).toBeInstanceOf(ForbiddenException);
    expect(outside?.message).toBe(FORM_NETWORK_NOT_ALLOWED_MESSAGE);
    expect(findSession).not.toHaveBeenCalled();
  });
});

describe("a form that does not ask anybody to sign in", () => {
  test("is shown as before, and no session is looked for", async () => {
    stored.requireSignIn = false;

    const answer: Exception | null = await answerOf(
      FormService.getPublicForm({
        shareKey: SHARE_KEY,
        clientIp: ALLOWED_IP,
        formSession: READER,
      }),
    );

    expect(answer).toBeNull();
    expect(findSession).not.toHaveBeenCalled();
  });
});

describe("a form's sign-in state", () => {
  test("names nothing of a form that does not ask its visitors to sign in", async () => {
    stored.requireSignIn = false;

    const state: FormSignInState = await FormService.getSignInState({
      shareKey: SHARE_KEY,
      clientIp: ALLOWED_IP,
      formSession: READER,
    });

    expect(state).toEqual({ requireSignIn: false });
  });

  test("names the form's id and name, and nobody signed in, to a visitor without a session", async () => {
    const state: FormSignInState = await FormService.getSignInState({
      shareKey: SHARE_KEY,
      clientIp: ALLOWED_IP,
      formSession: READER,
    });

    expect(state).toEqual({
      requireSignIn: true,
      formId: FORM_ID,
      name: "Access request",
      signedInAs: null,
    });
  });

  test("names the private user signed in on this host", async () => {
    hasSession = true;

    const state: FormSignInState = await FormService.getSignInState({
      shareKey: SHARE_KEY,
      clientIp: ALLOWED_IP,
      formSession: READER,
    });

    expect(state.signedInAs).toBe(SIGNED_IN_EMAIL);
  });

  test("is read from the form's access columns alone - nothing it asks or does", async () => {
    await FormService.getSignInState({
      shareKey: SHARE_KEY,
      clientIp: ALLOWED_IP,
      formSession: READER,
    });

    expect(selects).toHaveLength(1);
    expect(Object.keys(selects[0]!).sort()).toEqual(
      [
        "_id",
        "projectId",
        "name",
        "isEnabled",
        "ipWhitelist",
        "requireSignIn",
        "requireSsoForLogin",
      ].sort(),
    );
  });

  test("is held to the form's network as a visit is", async () => {
    stored.ipWhitelist = "198.51.100.0/24";

    const answer: Exception | null = await answerOf(
      FormService.getSignInState({
        shareKey: SHARE_KEY,
        clientIp: ALLOWED_IP,
        formSession: READER,
      }),
    );

    expect(answer).toBeInstanceOf(ForbiddenException);
  });
});

describe("the form a sign-in is for", () => {
  test("is a form that asks its visitors to sign in, read by its id", async () => {
    const form: Form = await FormService.getFormForSignIn({
      formId: new ObjectID(FORM_ID),
      clientIp: ALLOWED_IP,
      notAskedMessage: FORM_SIGN_IN_NOT_ASKED_MESSAGE,
    });

    expect(form.id?.toString()).toBe(FORM_ID);
  });

  test("signs nobody in to a form that does not ask, nor to one that is off", async () => {
    stored.requireSignIn = false;

    const notAsked: Exception | null = await answerOf(
      FormService.getFormForSignIn({
        formId: new ObjectID(FORM_ID),
        clientIp: ALLOWED_IP,
        notAskedMessage: FORM_SIGN_IN_NOT_ASKED_MESSAGE,
      }),
    );

    expect(notAsked).toBeInstanceOf(BadDataException);
    expect(notAsked?.message).toBe(FORM_SIGN_IN_NOT_ASKED_MESSAGE);

    stored.requireSignIn = true;
    stored.isEnabled = false;

    const off: Exception | null = await answerOf(
      FormService.getFormForSignIn({
        formId: new ObjectID(FORM_ID),
        clientIp: ALLOWED_IP,
        notAskedMessage: FORM_SIGN_IN_NOT_ASKED_MESSAGE,
      }),
    );

    expect(off).toBeInstanceOf(NotFoundException);
  });
});

describe("a form's public link", () => {
  test("is its usable custom domain, else /accounts/form/<share key>", async () => {
    const getAddress: SpyInstance<typeof UsableCustomDomain.getAddress> =
      jest
        .spyOn(UsableCustomDomain, "getAddress")
        .mockResolvedValue("https://forms.acme.example" as never);
    jest
      .spyOn(FormDomainService, "findBy")
      .mockResolvedValue([new FormDomain()] as never);

    const url: string = await FormService.getPublicFormUrl(
      new ObjectID(FORM_ID),
    );

    expect(url).toBe("https://forms.acme.example");

    const asked: { fallbackPath: string } = getAddress.mock
      .calls[0]![0] as never;

    expect(asked.fallbackPath).toBe(`/accounts/form/${SHARE_KEY}`);
  });
});
