import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * HOW THE LISTS HAND A NUMBER TO THE VERIFY DIALOG.
 *
 * The person's SMS, call, WhatsApp and incoming call number lists each:
 *
 *   - open the verify dialog straight after a number is added - adding it
 *     sent the code, so typing it in is the next step, not something to be
 *     found behind the row's Verify button;
 *   - open the same dialog from Verify, and offer no Resend Code of their
 *     own - a new code is the dialog's, next to the field it is for;
 *   - and, for calls: a number already verified for SMS comes back
 *     verified, with a notice instead of a dialog asking for a code that was
 *     never sent; and when an SMS verification verifies call numbers too, the
 *     call list shows them as verified without a reload.
 *
 * The table itself is ModelTable's business (and its own suites'); it is
 * replaced here by a stand-in that hands over the props each list gives it,
 * so these exercise exactly what the lists do with them.
 */

const postMock: MockFunction = getJestMockFunction();

type ModelTableProps = Record<string, any>;

const tableProps: Map<string, ModelTableProps> = new Map();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, any>): ReactElement => {
      tableProps.set(props["id"] as string, props);
      return <div data-testid={`table-${props["id"] as string}`} />;
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return (
          (error as { message?: string } | undefined)?.message ||
          "Something went wrong"
        );
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import SMSMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/SMS";
import CallMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Call";
import WhatsAppMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/WhatsApp";
import IncomingCallNumberMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/IncomingCallNumber";
import ProjectNotificationChannelsStore from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannels";
import { CALL_NUMBERS_VERIFIED_BY_SMS_EVENT } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/VerificationCodeChannels";
import { ProjectNotificationChannel } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCopy";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserIncomingCallNumber from "../../../Models/DatabaseModels/UserIncomingCallNumber";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";

const USER_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";
const ITEM_ID: string = "11111111-7777-4777-8777-777777777777";
const PHONE: string = "+15551230100";

interface MethodList {
  name: string;
  Component: () => ReactElement;
  tableId: string;
  modelType: DatabaseBaseModelType;
  route: string;
  dialogTitle: string;
}

const METHOD_LISTS: Array<MethodList> = [
  {
    name: "SMS",
    Component: SMSMethods,
    tableId: "user-sms",
    modelType: UserSMS,
    route: "/user-sms",
    dialogTitle: "Verify Phone Number",
  },
  {
    name: "Call",
    Component: CallMethods,
    tableId: "user-call",
    modelType: UserCall,
    route: "/user-call",
    dialogTitle: "Verify Phone Number",
  },
  {
    name: "WhatsApp",
    Component: WhatsAppMethods,
    tableId: "user-whatsapp",
    modelType: UserWhatsApp,
    route: "/user-whatsapp",
    dialogTitle: "Verify WhatsApp Number",
  },
  {
    name: "Incoming call numbers",
    Component: IncomingCallNumberMethods,
    tableId: "user-incoming-call-number",
    modelType: UserIncomingCallNumber,
    route: "/user-incoming-call-number",
    dialogTitle: "Verify Phone Number",
  },
];

const ACTIVE_STATUS: JSONObject = {
  isVerified: false,
  codeState: "active",
  codeSentAt: new Date().toISOString(),
  codeExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  resendAvailableInSeconds: 60,
  cannotSendReason: null,
};

let verifyAnswer: JSONObject;

const row: (
  list: MethodList,
  values: { isVerified: boolean; phone?: string },
) => BaseModel = (
  list: MethodList,
  values: { isVerified: boolean; phone?: string },
): BaseModel => {
  const model: BaseModel = new list.modelType();
  model.id = new ObjectID(ITEM_ID);
  (model as unknown as Record<string, unknown>)["phone"] = new Phone(
    values.phone || PHONE,
  );
  (model as unknown as Record<string, unknown>)["isVerified"] =
    values.isVerified;
  return model;
};

const propsOf: (list: MethodList) => ModelTableProps = (
  list: MethodList,
): ModelTableProps => {
  const props: ModelTableProps | undefined = tableProps.get(list.tableId);

  if (!props) {
    throw new Error(`${list.name} drew no table`);
  }

  return props;
};

const postsTo: (route: string) => Array<{ url: string; data: JSONObject }> = (
  route: string,
): Array<{ url: string; data: JSONObject }> => {
  return postMock.mock.calls
    .map((call: Array<any>) => {
      return {
        url: call[0].url.toString() as string,
        data: call[0].data as JSONObject,
      };
    })
    .filter((call: { url: string }) => {
      return call.url.endsWith(route);
    });
};

const addNumber: (list: MethodList, added: BaseModel) => Promise<void> = async (
  list: MethodList,
  added: BaseModel,
): Promise<void> => {
  await act(async (): Promise<void> => {
    await propsOf(list)["onCreateSuccess"](added);
  });
};

beforeEach(() => {
  localStorage.setItem("user_id", USER_ID);
  sessionStorage.setItem("current_project_id", PROJECT_ID);

  tableProps.clear();

  ProjectNotificationChannelsStore.reset();
  ProjectNotificationChannelsStore.setFetcher(async () => {
    return {
      [ProjectNotificationChannel.SMS]: true,
      [ProjectNotificationChannel.Call]: true,
      [ProjectNotificationChannel.WhatsApp]: true,
      [ProjectNotificationChannel.Telegram]: true,
    };
  });

  verifyAnswer = {};

  /*
   * The lists' refresh key is the time as a string, to the second. Each read
   * moves it on a second, so a refresh is never lost to two in one second.
   */
  let tick: number = 0;
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    tick++;
    return new Date(Date.UTC(2026, 9, 8, 10, 0, tick));
  });

  postMock.mockReset();
  postMock.mockImplementation((request: any): Promise<unknown> => {
    const url: string = request.url.toString();

    if (url.endsWith("/verify")) {
      return Promise.resolve(
        new HTTPResponse<JSONObject>(200, verifyAnswer, {}),
      );
    }

    return Promise.resolve(
      new HTTPResponse<JSONObject>(200, ACTIVE_STATUS, {}),
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ProjectNotificationChannelsStore.setFetcher(null);
  ProjectNotificationChannelsStore.reset();
  localStorage.clear();
  sessionStorage.clear();
});

describe.each(METHOD_LISTS)("$name", (list: MethodList) => {
  test("adding a number opens its verify dialog straight away", async () => {
    render(<list.Component />);

    expect(screen.queryByTestId("modal-title")).toBeNull();

    await addNumber(list, row(list, { isVerified: false }));

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        list.dialogTitle,
      );
    });

    // For the number just added, on its own channel's route.
    expect(postsTo(`${list.route}/verification-status`)[0]!.data).toEqual({
      projectId: expect.anything(),
      itemId: ITEM_ID,
    });
    expect(document.body.textContent).toContain(PHONE);
  });

  test("Verify opens the same dialog, and the list offers no Resend Code of its own", async () => {
    render(<list.Component />);

    const actions: Array<Record<string, any>> = propsOf(list)["actionButtons"];

    expect(
      actions.map((action: Record<string, any>) => {
        return action["title"];
      }),
    ).not.toContain("Resend Code");

    const verify: Record<string, any> = actions.find(
      (action: Record<string, any>) => {
        return action["title"] === "Verify";
      },
    )!;

    expect(verify["isVisible"](row(list, { isVerified: false }))).toBe(true);
    expect(verify["isVisible"](row(list, { isVerified: true }))).toBe(false);

    const onComplete: MockFunction = getJestMockFunction();

    await act(async (): Promise<void> => {
      await verify["onClick"](
        row(list, { isVerified: false }),
        onComplete,
        getJestMockFunction(),
      );
    });

    expect(onComplete).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        list.dialogTitle,
      );
    });
  });

  test("a verified number refreshes the list, and closing the dialog leaves it closed", async () => {
    render(<list.Component />);

    const before: string = propsOf(list)["refreshToggle"];

    await addNumber(list, row(list, { isVerified: false }));

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("verification-code-input"), {
      target: { value: "424242" },
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("modal-title")).toBeNull();
    });

    expect(postsTo(`${list.route}/verify`)).toHaveLength(1);
    expect(propsOf(list)["refreshToggle"]).not.toBe(before);
  });
});

describe("the call list and numbers verified for SMS", () => {
  const callList: MethodList = METHOD_LISTS.find((list: MethodList) => {
    return list.name === "Call";
  })!;
  const smsList: MethodList = METHOD_LISTS.find((list: MethodList) => {
    return list.name === "SMS";
  })!;

  test("a number added that SMS already verified gets a notice, not a dialog asking for a code", async () => {
    render(<CallMethods />);

    await addNumber(callList, row(callList, { isVerified: true }));

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Phone Number Verified",
      );
    });

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      `${PHONE} is already verified for SMS, so it is verified for calls too. No code needed.`,
    );
    expect(screen.queryByTestId("verification-code-input")).toBeNull();
    expect(postsTo("/verification-status")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(screen.queryByTestId("modal-title")).toBeNull();
  });

  test("its description says a number verified for SMS needs no code there", () => {
    render(<CallMethods />);

    expect(propsOf(callList)["cardProps"]["description"]).toBe(
      "Manage Phone Numbers that will receive call notifications for this project. A number you have verified for SMS needs no code here.",
    );
  });

  test("shows the call numbers an SMS verification verified, without a reload", async () => {
    render(<CallMethods />);

    const before: string = propsOf(callList)["refreshToggle"];

    act(() => {
      GlobalEvents.dispatchEvent(CALL_NUMBERS_VERIFIED_BY_SMS_EVENT);
    });

    expect(propsOf(callList)["refreshToggle"]).not.toBe(before);
  });

  test("an SMS verification that verified call numbers tells the call list", async () => {
    verifyAnswer = { alsoVerifiedForCalls: 1 };

    const heard: MockFunction = getJestMockFunction();
    const listener: () => void = (): void => {
      heard();
    };

    GlobalEvents.addEventListener(CALL_NUMBERS_VERIFIED_BY_SMS_EVENT, listener);

    try {
      render(<SMSMethods />);

      await addNumber(smsList, row(smsList, { isVerified: false }));

      await waitFor(() => {
        expect(
          screen.getByTestId("verification-code-input"),
        ).toBeInTheDocument();
      });

      fireEvent.change(screen.getByTestId("verification-code-input"), {
        target: { value: "424242" },
      });

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      });

      await waitFor(() => {
        expect(heard).toHaveBeenCalledTimes(1);
      });

      // And the person is told, before the dialog closes.
      expect(document.body.textContent).toContain(
        "It is verified for calls too, so you will not need another code there.",
      );
    } finally {
      GlobalEvents.removeEventListener(
        CALL_NUMBERS_VERIFIED_BY_SMS_EVENT,
        listener,
      );
    }
  });

  test("an SMS verification that verified nothing else tells nobody", async () => {
    const heard: MockFunction = getJestMockFunction();
    const listener: () => void = (): void => {
      heard();
    };

    GlobalEvents.addEventListener(CALL_NUMBERS_VERIFIED_BY_SMS_EVENT, listener);

    try {
      render(<SMSMethods />);

      await addNumber(smsList, row(smsList, { isVerified: false }));

      await waitFor(() => {
        expect(
          screen.getByTestId("verification-code-input"),
        ).toBeInTheDocument();
      });

      fireEvent.change(screen.getByTestId("verification-code-input"), {
        target: { value: "424242" },
      });

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      });

      await waitFor(() => {
        expect(screen.queryByTestId("modal-title")).toBeNull();
      });

      expect(heard).not.toHaveBeenCalled();
    } finally {
      GlobalEvents.removeEventListener(
        CALL_NUMBERS_VERIFIED_BY_SMS_EVENT,
        listener,
      );
    }
  });
});
