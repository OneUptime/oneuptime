import FormService, {
  FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  FORM_NOT_AVAILABLE_MESSAGE,
} from "../../../Server/Services/FormService";
import FormDomainService from "../../../Server/Services/FormDomainService";
import Form from "../../../Models/DatabaseModels/Form";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { PublicFormSubmissionRequest } from "../../../Types/Form/FormPublic";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A form on its own domain, in FormService: the form a domain answers with
 * is the one its form domain names (FormDomainService
 * .getShareKeyOfFormOnDomain), read and submitted exactly as a visit to its
 * link reads and submits it - so every rule of the link holds on the domain.
 * And the name the page on the domain is titled with
 * (getFormNameOnCustomDomain): only when the visitor would be shown the
 * form, never otherwise, and never an error.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9d01",
);
const SHARE_KEY: string = "9c9e6679-7425-40de-944b-e07fc1f90ae7";

let shareKeyOfDomain: string | null = SHARE_KEY;
let storedForm: Form | null = null;
let isOnPlan: boolean = true;

function buildForm(data: {
  isEnabled?: boolean;
  ipWhitelist?: string;
  name?: string;
}): Form {
  const form: Form = new Form();
  form._id = "a1b2c3d4-0000-4000-8000-0000000000d1";
  form.projectId = PROJECT_ID;
  form.name = data.name === undefined ? "Report a Problem" : data.name;
  form.isEnabled = data.isEnabled !== false;
  form.shareKey = new ObjectID(SHARE_KEY);
  form.targetType = FormTargetType.Incident;
  form.fields = [] as unknown as JSONObject[];
  form.ipWhitelist = data.ipWhitelist || "";
  return form;
}

beforeEach(() => {
  shareKeyOfDomain = SHARE_KEY;
  storedForm = buildForm({});
  isOnPlan = true;

  jest
    .spyOn(FormDomainService, "getShareKeyOfFormOnDomain")
    .mockImplementation((async () => {
      return shareKeyOfDomain;
    }) as never);

  jest.spyOn(FormService, "findOneBy").mockImplementation((async (findBy: {
    query: { shareKey?: ObjectID };
  }) => {
    return storedForm &&
      storedForm.shareKey?.toString() === findBy.query.shareKey?.toString()
      ? storedForm
      : null;
  }) as never);

  jest.spyOn(FormService, "isProjectOnPlan").mockImplementation((async () => {
    return isOnPlan;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("FormService.getFormNameOnCustomDomain", () => {
  test("the form's name, when the visitor would be shown the form", async () => {
    await expect(
      FormService.getFormNameOnCustomDomain({
        hostname: "report.acme.com",
        clientIp: "198.51.100.23",
      }),
    ).resolves.toBe("Report a Problem");

    expect(FormDomainService.getShareKeyOfFormOnDomain).toHaveBeenCalledWith(
      "report.acme.com",
    );
  });

  test.each([
    [
      "no form has the domain",
      (): void => {
        shareKeyOfDomain = null;
      },
    ],
    [
      "the form is off",
      (): void => {
        storedForm = buildForm({ isEnabled: false });
      },
    ],
    [
      "the form was deleted",
      (): void => {
        storedForm = null;
      },
    ],
    [
      "the project's plan does not include forms",
      (): void => {
        isOnPlan = false;
      },
    ],
    [
      "the visitor's network is outside the form's IP allowlist",
      (): void => {
        storedForm = buildForm({ ipWhitelist: "10.0.0.0/8" });
      },
    ],
    [
      "the form has no name to give",
      (): void => {
        storedForm = buildForm({ name: "   " });
      },
    ],
  ])("nothing when %s", async (_label: string, arrange: () => void) => {
    arrange();

    await expect(
      FormService.getFormNameOnCustomDomain({
        hostname: "report.acme.com",
        clientIp: "198.51.100.23",
      }),
    ).resolves.toBeNull();
  });

  test("never throws: a lookup that fails gives no name", async () => {
    jest
      .spyOn(FormDomainService, "getShareKeyOfFormOnDomain")
      .mockImplementation((async () => {
        throw new Error("the database is down");
      }) as never);

    await expect(
      FormService.getFormNameOnCustomDomain({
        hostname: "report.acme.com",
        clientIp: undefined,
      }),
    ).resolves.toBeNull();
  });
});

describe("FormService.getPublicFormOnCustomDomain", () => {
  test("reads the form the domain names, as its link reads it", async () => {
    const getPublicForm: ReturnType<typeof jest.spyOn> = jest
      .spyOn(FormService, "getPublicForm")
      .mockResolvedValue({ name: "Report a Problem", fields: [] } as never);

    await FormService.getPublicFormOnCustomDomain({
      hostname: "report.acme.com",
      clientIp: "198.51.100.23",
    });

    expect(getPublicForm).toHaveBeenCalledWith({
      shareKey: SHARE_KEY,
      clientIp: "198.51.100.23",
    });
  });

  test("a domain no form has is not available, without a form being read", async () => {
    shareKeyOfDomain = null;

    const getPublicForm: ReturnType<typeof jest.spyOn> = jest.spyOn(
      FormService,
      "getPublicForm",
    );

    await expect(
      FormService.getPublicFormOnCustomDomain({
        hostname: "status.acme.com",
        clientIp: undefined,
      }),
    ).rejects.toThrow(new NotFoundException(FORM_NOT_AVAILABLE_MESSAGE));
    expect(getPublicForm).not.toHaveBeenCalled();
  });

  test("a form outside its IP allowlist is refused on its domain as on its link", async () => {
    storedForm = buildForm({ ipWhitelist: "10.0.0.0/8" });

    await expect(
      FormService.getPublicFormOnCustomDomain({
        hostname: "report.acme.com",
        clientIp: "198.51.100.23",
      }),
    ).rejects.toThrow(new ForbiddenException(FORM_NETWORK_NOT_ALLOWED_MESSAGE));
  });
});

describe("FormService.submitPublicFormOnCustomDomain", () => {
  test("submits to the form the domain names, as its link submits", async () => {
    const submitPublicForm: ReturnType<typeof jest.spyOn> = jest
      .spyOn(FormService, "submitPublicForm")
      .mockResolvedValue({ reference: "INC-1" } as never);

    const request: PublicFormSubmissionRequest = {
      data: { answers: { title: "Down" } },
      captchaToken: "a-token",
    };

    await expect(
      FormService.submitPublicFormOnCustomDomain({
        hostname: "report.acme.com",
        request: request,
        clientIp: "198.51.100.23",
        captchaRemoteIp: "198.51.100.23",
      }),
    ).resolves.toEqual({ reference: "INC-1" });

    expect(submitPublicForm).toHaveBeenCalledWith({
      shareKey: SHARE_KEY,
      request: request,
      clientIp: "198.51.100.23",
      captchaRemoteIp: "198.51.100.23",
    });
  });

  test("a domain no form has takes no submission", async () => {
    shareKeyOfDomain = null;

    const submitPublicForm: ReturnType<typeof jest.spyOn> = jest.spyOn(
      FormService,
      "submitPublicForm",
    );

    await expect(
      FormService.submitPublicFormOnCustomDomain({
        hostname: "status.acme.com",
        request: { data: { answers: {} } },
        clientIp: undefined,
      }),
    ).rejects.toThrow(new NotFoundException(FORM_NOT_AVAILABLE_MESSAGE));
    expect(submitPublicForm).not.toHaveBeenCalled();
  });
});
