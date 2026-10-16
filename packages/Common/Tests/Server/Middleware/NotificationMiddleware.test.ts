import NotificationMiddleware from "../../../Server/Middleware/NotificationMiddleware";
// Types
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
// Helpers
import Response from "../../../Server/Utils/Response";
import { OnCallInputRequest } from "../../../Types/Call/CallRequest";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";

jest.mock("twilio/lib/twiml/VoiceResponse");
jest.mock("../../../Server/Utils/Response");
jest.mock("../../../Server/Utils/JsonWebToken", () => {
  return {
    decodeJsonPayload: jest.fn(),
  };
});
jest.mock("../../../Types/JSONFunctions", () => {
  return {
    deserialize: jest.fn(),
    flattenObject: jest.fn().mockReturnValue({}),
  };
});

describe("NotificationMiddleware", () => {
  describe("sendResponse", () => {
    let mockRequest: ExpressRequest;
    let mockResponse: ExpressResponse;
    let onCallInputRequest: OnCallInputRequest;

    beforeEach(() => {
      mockRequest = { body: { Digits: "1234" } } as ExpressRequest;
      mockResponse = {} as ExpressResponse;
      onCallInputRequest = {
        default: { sayMessage: "default message" },
      };
    });

    afterEach(() => {
      jest.resetAllMocks();
    });

    test("Should return correct message for a valid Digits value", async () => {
      onCallInputRequest["1234"] = { sayMessage: "message 1" };
      const responseInstance: VoiceResponse = new VoiceResponse();

      (
        VoiceResponse as jest.MockedClass<typeof VoiceResponse>
      ).mockImplementation(() => {
        return responseInstance;
      });
      await NotificationMiddleware.sendResponse(
        mockRequest,
        mockResponse,
        onCallInputRequest,
      );

      expect(responseInstance.say).toHaveBeenCalledWith(
        (onCallInputRequest["1234"] as any).sayMessage,
      );
      expect(Response.sendXmlResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        responseInstance.toString(),
      );
    });

    test("Should return default message for an invalid Digits value", async () => {
      const responseInstance: VoiceResponse = new VoiceResponse();

      (
        VoiceResponse as jest.MockedClass<typeof VoiceResponse>
      ).mockImplementation(() => {
        return responseInstance;
      });
      await NotificationMiddleware.sendResponse(
        mockRequest,
        mockResponse,
        onCallInputRequest,
      );

      expect(responseInstance.say).toHaveBeenCalledWith(
        onCallInputRequest["default"]?.sayMessage,
      );
      expect(Response.sendXmlResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        responseInstance.toString(),
      );
    });

    /*
     * Passing a page on with the second key: what the call answers depends on
     * what came of it ("You passed this incident on. Escalation rule 2 is
     * paging Sam Lee now."), so the route hands the sentence in, and it is
     * said instead of anything the call's token carries.
     */
    test("Should say the message it is handed, whatever key was pressed", async () => {
      onCallInputRequest["1234"] = { sayMessage: "message 1" };
      const responseInstance: VoiceResponse = new VoiceResponse();

      (
        VoiceResponse as jest.MockedClass<typeof VoiceResponse>
      ).mockImplementation(() => {
        return responseInstance;
      });
      await NotificationMiddleware.sendResponse(
        mockRequest,
        mockResponse,
        onCallInputRequest,
        "You passed this incident on. Good bye.",
      );

      expect(responseInstance.say).toHaveBeenCalledTimes(1);
      expect(responseInstance.say).toHaveBeenCalledWith(
        "You passed this incident on. Good bye.",
      );
    });

    test("Should say what the call carries when the message handed in is empty", async () => {
      const responseInstance: VoiceResponse = new VoiceResponse();

      (
        VoiceResponse as jest.MockedClass<typeof VoiceResponse>
      ).mockImplementation(() => {
        return responseInstance;
      });
      await NotificationMiddleware.sendResponse(
        mockRequest,
        mockResponse,
        onCallInputRequest,
        "",
      );

      expect(responseInstance.say).toHaveBeenCalledWith("default message");
    });
  });

  describe("isValidCallNotificationRequest", () => {
    let mockRequest: ExpressRequest;
    let mockResponse: ExpressResponse;
    let mockNext: NextFunction;

    beforeEach(() => {
      mockRequest = {
        body: {},
        query: {},
      } as ExpressRequest;
      mockResponse = {} as ExpressResponse;
      mockNext = jest.fn() as NextFunction;
    });

    afterEach(() => {
      jest.resetAllMocks();
    });

    test("Should return error if Digits is not in req body", async () => {
      await NotificationMiddleware.isValidCallNotificationRequest(
        mockRequest,
        mockResponse,
        mockNext,
      );

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        new BadDataException("Invalid input"),
      );
    });

    test("Should return error if Token is not in req query", async () => {
      mockRequest.body["Digits"] = "1234";

      await NotificationMiddleware.isValidCallNotificationRequest(
        mockRequest,
        mockResponse,
        mockNext,
      );

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        new BadDataException("Invalid token"),
      );
    });

    test("Should return error if token decoding fails", async () => {
      mockRequest.body["Digits"] = "1234";
      mockRequest.query["token"] = "token";

      jest.spyOn(JSONWebToken, "decodeJsonPayload").mockImplementation(() => {
        throw new Error("Decoding error");
      });
      await NotificationMiddleware.isValidCallNotificationRequest(
        mockRequest,
        mockResponse,
        mockNext,
      );

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        new BadDataException("Invalid token"),
      );
    });

    test("Should call 'next' if data is valid", async () => {
      mockRequest.body["Digits"] = "1234";
      mockRequest.query["token"] = "token";
      const tokenData: JSONObject = { id: 1 };

      jest.spyOn(JSONFunctions, "deserialize").mockReturnValue(tokenData);
      await NotificationMiddleware.isValidCallNotificationRequest(
        mockRequest,
        mockResponse,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalled();
      expect((mockRequest as any).callTokenData).toEqual(tokenData);
    });
  });
});
