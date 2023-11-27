import BadDataException from 'Common/Types/Exception/BadDataException';
import JSONWebTokenData from 'Common/Types/JsonWebTokenData';
import ObjectID from 'Common/Types/ObjectID';
import UserSMS from 'Model/Models/UserSMS';
import UserSmsService from '../../Services/UserSmsService';
import { mockRouter } from './Helpers';
import {
    OneUptimeResponse,
    OneUptimeRequest,
    NextFunction,
} from '../../Utils/Express';
import Response from '../../Utils/Response';
import UserSmsAPI from '../../API/UserSmsAPI';

jest.mock('../../Utils/Express', () => {
    return {
        getRouter: () => {
            return mockRouter;
        },
    };
});

jest.mock('../../Utils/Response', () => {
    return {
        sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
            return args;
        }),
        sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
            return args;
        }),
        sendEmptyResponse: jest.fn(),
        sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
            return args;
        }),
        sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
            return args;
        }),
    };
});

jest.mock('../../Services/UserSmsService');

describe('UserSmsAPI', () => {
    let mockRequest: OneUptimeRequest;
    let mockResponse: OneUptimeResponse;
    let nextFunction: NextFunction;

    beforeEach(() => {
        new UserSmsAPI();
        mockRequest = {} as OneUptimeRequest;
        mockResponse = {
            send: jest.fn(),
            json: jest.fn(),
            status: jest.fn().mockReturnThis(),
        } as unknown as OneUptimeResponse;
        nextFunction = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('POST /user-sms/verify', () => {
        it('should handle required item ID', async () => {
            const error: BadDataException = new BadDataException(
                'Invalid item ID'
            );
            mockRequest.body = {};
            await mockRouter
                .match('post', '/user-sms/verify')
                .handlerFunction(mockRequest, mockResponse, nextFunction);

            const response: jest.SpyInstance = jest.spyOn(
                Response,
                'sendErrorResponse'
            );
            expect(response).toHaveBeenCalledWith(
                mockRequest,
                mockResponse,
                error
            );
        });

        it('should handle required code', async () => {
            const error: BadDataException = new BadDataException(
                'Invalid code'
            );
            mockRequest.body = {
                itemId: 'item1',
            };
            await mockRouter
                .match('post', '/user-sms/verify')
                .handlerFunction(mockRequest, mockResponse, nextFunction);

            const response: jest.SpyInstance = jest.spyOn(
                Response,
                'sendErrorResponse'
            );
            expect(response).toHaveBeenCalledWith(
                mockRequest,
                mockResponse,
                error
            );
        });

        it('should handle Item not found', async () => {
            const error: BadDataException = new BadDataException(
                'Item not found'
            );
            mockRequest.body = {
                itemId: 'item1',
                code: 123456,
            };
            UserSmsService.findOneById = jest.fn().mockResolvedValue(null);

            await mockRouter
                .match('post', '/user-sms/verify')
                .handlerFunction(mockRequest, mockResponse, nextFunction);

            const response: jest.SpyInstance = jest.spyOn(
                Response,
                'sendErrorResponse'
            );
            expect(response).toHaveBeenCalledWith(
                mockRequest,
                mockResponse,
                error
            );
        });

        it('should handle Invalid user ID', async () => {
            const error: BadDataException = new BadDataException(
                'Invalid user ID'
            );
            mockRequest.body = {
                itemId: 'item1',
                code: '123456',
            };
            mockRequest.userAuthorization = {
                userId: new ObjectID('user123'),
            } as JSONWebTokenData;

            const item: UserSMS = {
                _id: '123',
                userId: new ObjectID('user321'),
            } as UserSMS;

            UserSmsService.findOneById = jest.fn().mockResolvedValue(item);

            await mockRouter
                .match('post', '/user-sms/verify')
                .handlerFunction(mockRequest, mockResponse, nextFunction);

            const response: jest.SpyInstance = jest.spyOn(
                Response,
                'sendErrorResponse'
            );
            expect(response).toHaveBeenCalledWith(
                mockRequest,
                mockResponse,
                error
            );
        });

        it('should handle Invalid code', async () => {
            const error: BadDataException = new BadDataException(
                'Invalid code'
            );
            mockRequest.body = {
                itemId: 'item1',
                code: '123456',
            };
            mockRequest.userAuthorization = {
                userId: new ObjectID('user123'),
            } as JSONWebTokenData;

            const item: UserSMS = {
                _id: '123',
                userId: new ObjectID('user123'),
                verificationCode: '123457',
            } as UserSMS;

            UserSmsService.findOneById = jest.fn().mockResolvedValue(item);

            await mockRouter
                .match('post', '/user-sms/verify')
                .handlerFunction(mockRequest, mockResponse, nextFunction);

            const response: jest.SpyInstance = jest.spyOn(
                Response,
                'sendErrorResponse'
            );
            expect(response).toHaveBeenCalledWith(
                mockRequest,
                mockResponse,
                error
            );
        });

        it('should handle valid response on verify', async () => {
            mockRequest.body = {
                itemId: 'item1',
                code: '123456',
            };
            mockRequest.userAuthorization = {
                userId: new ObjectID('user123'),
            } as JSONWebTokenData;

            const item: UserSMS = {
                _id: '123',
                userId: new ObjectID('user123'),
                verificationCode: '123456',
            } as UserSMS;

            UserSmsService.findOneById = jest.fn().mockResolvedValue(item);

            await mockRouter
                .match('post', '/user-sms/verify')
                .handlerFunction(mockRequest, mockResponse, nextFunction);

            const response: jest.SpyInstance = jest.spyOn(
                Response,
                'sendEmptyResponse'
            );
            expect(response).toHaveBeenCalledWith(mockRequest, mockResponse);
        });
    });

    describe('POST /user-sms/resend-verification-code', () => {
        it('should handle required item ID', async () => {
            const error: BadDataException = new BadDataException(
                'Invalid item ID'
            );
            mockRequest.body = {};
            await mockRouter
                .match('post', '/user-sms/resend-verification-code')
                .handlerFunction(mockRequest, mockResponse, nextFunction);

            const response: jest.SpyInstance = jest.spyOn(
                Response,
                'sendErrorResponse'
            );
            expect(response).toHaveBeenCalledWith(
                mockRequest,
                mockResponse,
                error
            );
        });

        it('should handle valid response resend', async () => {
            mockRequest.body = {
                itemId: 'item1',
                code: '123456',
            };

            mockRequest.userAuthorization = {
                userId: new ObjectID('user123'),
            } as JSONWebTokenData;

            UserSmsService.resendVerificationCode = jest
                .fn()
                .mockImplementation(() => {
                    return Promise.resolve();
                });

            await mockRouter
                .match('post', '/user-sms/verify')
                .handlerFunction(mockRequest, mockResponse, nextFunction);

            const response: jest.SpyInstance = jest.spyOn(
                Response,
                'sendEmptyResponse'
            );
            expect(response).toHaveBeenCalledWith(mockRequest, mockResponse);
        });
    });
});
