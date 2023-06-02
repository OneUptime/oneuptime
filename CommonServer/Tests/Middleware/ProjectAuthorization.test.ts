import ObjectID from 'Common/Types/ObjectID';
import ProjectMiddleware from '../../Middleware/ProjectAuthorization';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../../Utils/Express';
import ApiKeyService from '../../Services/ApiKeyService';
import Response from '../../Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import OneUptimeDate from 'Common/Types/Date';
import QueryHelper from '../../Types/Database/QueryHelper';
import ApiKey from 'Model/Models/ApiKey';
import AccessTokenService from '../../Services/AccessTokenService';
import { UserTenantAccessPermission } from 'Common/Types/Permission';

jest.mock('../../Services/ApiKeyService');
jest.mock('../../Services/AccessTokenService');

type ObjectIdOrNull = ObjectID | null;

describe('ProjectMiddleware', () => {
    const mockedObjectId: ObjectID = ObjectID.generate();

    describe('getProjectId', () => {
        describe("should return value when tenantid is passed in the request's", () => {
            const reqFields: string[] = ['params', 'query', 'headers'];
            test.each(reqFields)('%s', (field: string) => {
                const req: Partial<ExpressRequest> = {
                    [field]: { tenantid: mockedObjectId.toString() },
                };

                const result: ObjectIdOrNull = ProjectMiddleware.getProjectId(
                    req as ExpressRequest
                );

                expect(result).toEqual(mockedObjectId);
            });
        });

        test("should return value when projectid is passed in the request's header", () => {
            const req: Partial<ExpressRequest> = {
                headers: { projectid: mockedObjectId.toString() },
            };

            const result: ObjectIdOrNull = ProjectMiddleware.getProjectId(
                req as ExpressRequest
            );

            expect(result).toEqual(mockedObjectId);
        });

        test("should return value when projectId is passed in the request's body", () => {
            const req: Partial<ExpressRequest> = {
                body: { projectId: mockedObjectId.toString() },
            };

            const result: ObjectIdOrNull = ProjectMiddleware.getProjectId(
                req as ExpressRequest
            );

            expect(result).toEqual(mockedObjectId);
        });

        test('should return null when projectId is not passed in the request', () => {
            const result: ObjectIdOrNull = ProjectMiddleware.getProjectId(
                {} as ExpressRequest
            );

            expect(result).toBeNull();
        });
    });

    describe('getApiKey', () => {
        test("should return apiKey when apikey is passed in the request's header", () => {
            const req: Partial<ExpressRequest> = {
                headers: { apikey: mockedObjectId.toString() },
            };

            const result: ObjectIdOrNull = ProjectMiddleware.getApiKey(
                req as ExpressRequest
            );

            expect(result).toEqual(mockedObjectId);
        });

        test("should return null when apikey is not passed in the request's header", () => {
            const result: ObjectIdOrNull = ProjectMiddleware.getApiKey(
                {} as ExpressRequest
            );

            expect(result).toBeNull();
        });
    });

    describe('hasApiKey', () => {
        const req: ExpressRequest = { headers: {} } as ExpressRequest;

        test('should return true when getApiKey returns a non-null value', () => {
            const spyGetApiKey: jest.SpyInstance = jest
                .spyOn(ProjectMiddleware, 'getApiKey')
                .mockReturnValue(mockedObjectId);

            const result: boolean = ProjectMiddleware.hasApiKey(req);

            expect(result).toStrictEqual(true);
            expect(spyGetApiKey).toHaveBeenCalledWith(req);
        });

        test('should return false when getApiKey returns null', () => {
            const spyGetApiKey: jest.SpyInstance = jest
                .spyOn(ProjectMiddleware, 'getApiKey')
                .mockReturnValue(null);

            const result: boolean = ProjectMiddleware.hasApiKey(req);

            expect(result).toStrictEqual(false);
            expect(spyGetApiKey).toHaveBeenCalledWith(req);
        });
    });

    describe('hasProjectID', () => {
        const req: ExpressRequest = { headers: {} } as ExpressRequest;
        test('should return true when getProjectId returns a non-null value', () => {
            const spyGetProjectId: jest.SpyInstance = jest
                .spyOn(ProjectMiddleware, 'getProjectId')
                .mockReturnValue(mockedObjectId);

            const result: boolean = ProjectMiddleware.hasProjectID(req);

            expect(result).toStrictEqual(true);
            expect(spyGetProjectId).toHaveBeenCalledWith(req);
        });

        test('should return false when getProjectId returns null', () => {
            const spyGetProjectId: jest.SpyInstance = jest
                .spyOn(ProjectMiddleware, 'getProjectId')
                .mockReturnValue(null);

            const result: boolean = ProjectMiddleware.hasProjectID(req);

            expect(result).toStrictEqual(false);
            expect(spyGetProjectId).toHaveBeenCalledWith(req);
        });
    });

    describe('isValidProjectIdAndApiKeyMiddleware', () => {
        const req: ExpressRequest = {} as ExpressRequest;
        const res: ExpressResponse = {} as ExpressResponse;
        const next: NextFunction = jest.fn();

        const mockedApiModel: ApiKey = {
            id: mockedObjectId,
        } as ApiKey;

        beforeAll(() => {
            jest.spyOn(ProjectMiddleware, 'getProjectId').mockReturnValue(
                mockedObjectId
            );
            jest.spyOn(ProjectMiddleware, 'getApiKey').mockReturnValue(
                mockedObjectId
            );
        });

        test('should throw BadDataException when getProjectId returns null', async () => {
            const spyGetProjectId: jest.SpyInstance = jest
                .spyOn(ProjectMiddleware, 'getProjectId')
                .mockReturnValueOnce(null);

            await expect(
                ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware(
                    req,
                    res,
                    next
                )
            ).rejects.toThrowError('ProjectId not found in the request');

            expect(spyGetProjectId).toHaveBeenCalledWith(req);
        });

        test('should throw BadDataException when getApiKey returns null', async () => {
            const spyGetApiKey: jest.SpyInstance = jest
                .spyOn(ProjectMiddleware, 'getApiKey')
                .mockReturnValueOnce(null);

            await expect(
                ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware(
                    req,
                    res,
                    next
                )
            ).rejects.toThrowError('ApiKey not found in the request');

            expect(spyGetApiKey).toHaveBeenCalledWith(req);
        });

        test('should call Response.sendErrorResponse when apiKeyModel is null', async () => {
            const spyFindOneBy: jest.SpyInstance = jest
                .spyOn(ApiKeyService, 'findOneBy')
                .mockResolvedValue(null);
            const spySendErrorResponse: jest.SpyInstance = jest
                .spyOn(Response, 'sendErrorResponse')
                .mockImplementation(jest.fn);

            jest.spyOn(QueryHelper, 'greaterThan').mockImplementation(
                jest.fn()
            );

            await ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware(
                req,
                res,
                next
            );

            expect(spyFindOneBy).toHaveBeenCalledWith({
                query: {
                    projectId: mockedObjectId,
                    apiKey: mockedObjectId,
                    expiresAt: QueryHelper.greaterThan(
                        OneUptimeDate.getCurrentDate()
                    ),
                },
                select: {
                    _id: true,
                },
                props: { isRoot: true },
            });

            expect(spySendErrorResponse).toHaveBeenCalledWith(
                req,
                res,
                new BadDataException('Invalid Project ID or API Key')
            );
        });

        test('should call Response.sendErrorResponse when apiKeyModel is not null but getApiTenantAccessPermission returned null', async () => {
            const spySendErrorResponse: jest.SpyInstance = jest
                .spyOn(Response, 'sendErrorResponse')
                .mockImplementation(jest.fn);

            jest.spyOn(ApiKeyService, 'findOneBy').mockResolvedValue(
                mockedApiModel
            );
            const spyGetApiTenantAccessPermission: jest.SpyInstance = jest
                .spyOn(AccessTokenService, 'getApiTenantAccessPermission')
                .mockImplementationOnce(jest.fn().mockResolvedValue(null));

            await ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware(
                req,
                res,
                next
            );

            expect(spyGetApiTenantAccessPermission).toHaveBeenCalled();
            expect(spySendErrorResponse).toHaveBeenCalledWith(
                req,
                res,
                new BadDataException('Invalid Project ID or API Key')
            );
        });

        test("should call function 'next' when apiKeyModel is not null and getApiTenantAccessPermission returned userTenantAccessPermission", async () => {
            const mockedUserTenantAccessPermission: UserTenantAccessPermission =
                {} as UserTenantAccessPermission;
            jest.spyOn(ApiKeyService, 'findOneBy').mockResolvedValue(
                mockedApiModel
            );
            const spyGetApiTenantAccessPermission: jest.SpyInstance = jest
                .spyOn(AccessTokenService, 'getApiTenantAccessPermission')
                .mockResolvedValue(mockedUserTenantAccessPermission);

            await ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware(
                req,
                res,
                next
            );

            expect(spyGetApiTenantAccessPermission).toHaveBeenCalled();
            expect(next).toHaveBeenCalled();
        });
    });
});
