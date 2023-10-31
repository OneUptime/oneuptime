import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';

import NotificationMiddleware from '../../Middleware/NotificationMiddleware';

// Helpers
import Response from '../../Utils/Response';
import JSONWebToken from '../../Utils/JsonWebToken';
import BadDataException from 'Common/Types/Exception/BadDataException';
import JSONFunctions from 'Common/Types/JSONFunctions';

// Types
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../../Utils/Express';
import { OnCallInputRequest } from 'Common/Types/Call/CallRequest';
import { JSONObject } from 'Common/Types/JSON';

jest.mock('twilio/lib/twiml/VoiceResponse');
jest.mock('../../Utils/Response');
jest.mock('../../Utils/JsonWebToken', () => {
    return {
        decodeJsonPayload: jest.fn(),
    };
});
jest.mock('Common/Types/JSONFunctions', () => {
    return {
        deserialize: jest.fn(),
    };
});

describe('NotificationMiddleware', () => {
    describe('sendResponse', () => {
        let mockRequest: ExpressRequest;
        let mockResponse: ExpressResponse;
        let onCallInputRequest: OnCallInputRequest;

        beforeEach(() => {
            mockRequest = { body: { Digits: '1234' } } as ExpressRequest;
            mockResponse = {} as ExpressResponse;
            onCallInputRequest = {
                default: { sayMessage: 'default message' },
            };
        });

        afterEach(() => {
            jest.resetAllMocks();
        });

        test('Should return correct message for a valid Digits value', async () => {
            onCallInputRequest['1234'] = { sayMessage: 'message 1' };
            const responseInstance: VoiceResponse = new VoiceResponse();

            (
                VoiceResponse as jest.MockedClass<typeof VoiceResponse>
            ).mockImplementation(() => {
                return responseInstance;
            });
            await NotificationMiddleware.sendResponse(
                mockRequest,
                mockResponse,
                onCallInputRequest
            );

            expect(responseInstance.say).toHaveBeenCalledWith(
                (onCallInputRequest['1234'] as any).sayMessage
            );
            expect(Response.sendXmlResponse).toHaveBeenCalledWith(
                mockRequest,
                mockResponse,
                responseInstance.toString()
            );
        });

        test('Should return default message for an invalid Digits value', async () => {
            const responseInstance: VoiceResponse = new VoiceResponse();

            (
                VoiceResponse as jest.MockedClass<typeof VoiceResponse>
            ).mockImplementation(() => {
                return responseInstance;
            });
            await NotificationMiddleware.sendResponse(
                mockRequest,
                mockResponse,
                onCallInputRequest
            );

            expect(responseInstance.say).toHaveBeenCalledWith(
                onCallInputRequest['default']?.sayMessage
            );
            expect(Response.sendXmlResponse).toHaveBeenCalledWith(
                mockRequest,
                mockResponse,
                responseInstance.toString()
            );
        });
    });

    describe('isValidCallNotificationRequest', () => {
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

        test('Should return error if Digits is not in req body', async () => {
            await NotificationMiddleware.isValidCallNotificationRequest(
                mockRequest,
                mockResponse,
                mockNext
            );

            expect(Response.sendErrorResponse).toHaveBeenCalledWith(
                mockRequest,
                mockResponse,
                new BadDataException('Invalid input')
            );
        });

        test('Should return error if Token is not in req query', async () => {
            mockRequest.body['Digits'] = '1234';

            await NotificationMiddleware.isValidCallNotificationRequest(
                mockRequest,
                mockResponse,
                mockNext
            );

            expect(Response.sendErrorResponse).toHaveBeenCalledWith(
                mockRequest,
                mockResponse,
                new BadDataException('Invalid token')
            );
        });

        test('Should return error if token decoding fails', async () => {
            mockRequest.body['Digits'] = '1234';
            mockRequest.query['token'] = 'token';

            jest.spyOn(JSONWebToken, 'decodeJsonPayload').mockImplementation(
                () => {
                    throw new Error('Decoding error');
                }
            );
            await NotificationMiddleware.isValidCallNotificationRequest(
                mockRequest,
                mockResponse,
                mockNext
            );

            expect(Response.sendErrorResponse).toHaveBeenCalledWith(
                mockRequest,
                mockResponse,
                new BadDataException('Invalid token')
            );
        });

        test("Should call 'next' if data is valid", async () => {
            mockRequest.body['Digits'] = '1234';
            mockRequest.query['token'] = 'token';
            const tokenData: JSONObject = { id: 1 };

            jest.spyOn(JSONFunctions, 'deserialize').mockReturnValue(tokenData);
            await NotificationMiddleware.isValidCallNotificationRequest(
                mockRequest,
                mockResponse,
                mockNext
            );

            expect(mockNext).toHaveBeenCalled();
            expect((mockRequest as any).callTokenData).toEqual(tokenData);
        });
    });
});
