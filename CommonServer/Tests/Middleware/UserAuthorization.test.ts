import Dictionary from 'Common/Types/Dictionary';
import UserMiddleware from '../../Middleware/UserAuthorization';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../../Utils/Express';
import JSONWebToken from '../../Utils/JsonWebToken';
import logger from '../../Utils/Logger';
import JSONWebTokenData from 'Common/Types/JsonWebTokenData';
import ObjectID from 'Common/Types/ObjectID';
import ProjectMiddleware from '../../Middleware/ProjectAuthorization';
import UserService from '../../Services/UserService';
import Email from 'Common/Types/Email';
import ProjectService from '../../Services/ProjectService';
import Response from '../../Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Project from 'Model/Models/Project';
import SsoAuthorizationException from 'Common/Types/Exception/SsoAuthorizationException';
import AccessTokenService from '../../Services/AccessTokenService';
import {
    UserGlobalAccessPermission,
    UserTenantAccessPermission,
} from 'Common/Types/Permission';
import JSONFunctions from 'Common/Types/JSONFunctions';
import HashedString from 'Common/Types/HashedString';

jest.mock('../../Utils/Logger');
jest.mock('../../Middleware/ProjectAuthorization');
jest.mock('../../Utils/JsonWebToken');
jest.mock('../../Services/UserService');
jest.mock('../../Services/AccessTokenService');
jest.mock('../../Utils/Response');
jest.mock('../../Services/ProjectService');
jest.mock('Common/Types/HashedString');

type StringOrNull = string | null;

describe('UserMiddleware', () => {
    const mockedAccessToken: string = ObjectID.generate().toString();
    const projectId: ObjectID = ObjectID.generate();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getAccessToken', () => {
        test('should return access token when authorization token is passed in the request header', () => {
            const req: ExpressRequest = {
                headers: { authorization: mockedAccessToken },
                query: {},
            } as ExpressRequest;

            const result: StringOrNull = UserMiddleware.getAccessToken(req);

            expect(result).toEqual(mockedAccessToken);
        });

        test('should return access token when accessToken token is passed in the request query', () => {
            const req: Partial<ExpressRequest> = {
                query: { accessToken: mockedAccessToken },
                headers: {},
            };

            const result: StringOrNull = UserMiddleware.getAccessToken(
                req as ExpressRequest
            );

            expect(result).toEqual(mockedAccessToken);
        });

        test('should split and return the access token part of a bearer authorization token', () => {
            const req: ExpressRequest = {
                headers: { authorization: `Bearer ${mockedAccessToken}` },
                query: {},
            } as ExpressRequest;

            const result: StringOrNull = UserMiddleware.getAccessToken(req);

            expect(result).toEqual(mockedAccessToken);
        });

        test('should return null when authorization nor accessToken is passed', () => {
            const req: ExpressRequest = {
                headers: {},
                query: {},
            } as ExpressRequest;

            const result: StringOrNull = UserMiddleware.getAccessToken(req);

            expect(result).toBeNull();
        });
    });

    describe('getSsoTokens', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        const req: Partial<ExpressRequest> = {
            headers: { 'sso-token': mockedAccessToken },
        };

        test('should return an empty object when ssoToken is not passed', () => {
            const result: Dictionary<string> = UserMiddleware.getSsoTokens({
                headers: {},
            } as ExpressRequest);

            expect(result).toEqual({});
        });

        test('should return an empty object when ssoToken cannot be decoded', () => {
            const error: Error = new Error('Invalid token');
            const spyDecode: jest.SpyInstance = jest
                .spyOn(JSONWebToken, 'decode')
                .mockImplementationOnce((_: string) => {
                    throw error;
                });
            const spyErrorLogger: jest.SpyInstance = jest.spyOn(
                logger,
                'error'
            );

            const result: Dictionary<string> = UserMiddleware.getSsoTokens(
                req as ExpressRequest
            );

            expect(result).toEqual({});
            expect(spyDecode).toHaveBeenCalledWith(mockedAccessToken);
            expect(spyErrorLogger).toHaveBeenCalledWith(error);
        });

        test("should return an empty object when the decoded sso-token object doesn't have projectId property", () => {
            const spyDecode: jest.SpyInstance = jest
                .spyOn(JSONWebToken, 'decode')
                .mockReturnValueOnce({} as JSONWebTokenData);
            const spyErrorLogger: jest.SpyInstance = jest.spyOn(
                logger,
                'error'
            );

            const result: Dictionary<string> = UserMiddleware.getSsoTokens(
                req as ExpressRequest
            );

            expect(result).toEqual({});
            expect(spyDecode).toHaveBeenCalledWith(mockedAccessToken);
            expect(spyErrorLogger).not.toBeCalled();
        });

        test('should return a dictionary of string with projectId key', () => {
            jest.spyOn(JSONWebToken, 'decode').mockReturnValueOnce({
                projectId,
            } as JSONWebTokenData);

            const result: Dictionary<string> = UserMiddleware.getSsoTokens(
                req as ExpressRequest
            );

            expect(result).toEqual({
                [projectId.toString()]: mockedAccessToken,
            });
        });
    });

    describe('doesSsoTokenForProjectExist', () => {
        const req: ExpressRequest = {} as ExpressRequest;
        const userId: ObjectID = ObjectID.generate();

        beforeAll(() => {
            jest.spyOn(UserMiddleware, 'getSsoTokens').mockReturnValue({
                [projectId.toString()]: mockedAccessToken,
            });
        });

        test('should return false, when getSsoTokens does not return a value', () => {
            const spyGetSsoTokens: jest.SpyInstance = jest
                .spyOn(UserMiddleware, 'getSsoTokens')
                .mockImplementationOnce(jest.fn().mockReturnValue(null));

            const result: boolean = UserMiddleware.doesSsoTokenForProjectExist(
                req,
                projectId,
                userId
            );

            expect(result).toStrictEqual(false);
            expect(spyGetSsoTokens).toHaveBeenCalled();
        });

        test("should return false, when getSsoTokens returns a dictionary that does not contain the projectId's value as key", () => {
            const spyGetSsoTokens: jest.SpyInstance = jest
                .spyOn(UserMiddleware, 'getSsoTokens')
                .mockReturnValueOnce({});

            const result: boolean = UserMiddleware.doesSsoTokenForProjectExist(
                req,
                projectId,
                userId
            );

            expect(result).toStrictEqual(false);
            expect(spyGetSsoTokens).toHaveBeenCalledWith(req);
        });

        test("should return false, when decoded JWT object's projectId value does not match with projectId passed as parameter", () => {
            const objectId: ObjectID = ObjectID.generate();

            const spyDecode: jest.SpyInstance = jest
                .spyOn(JSONWebToken, 'decode')
                .mockReturnValueOnce({
                    projectId: objectId,
                    userId,
                } as JSONWebTokenData);

            const result: boolean = UserMiddleware.doesSsoTokenForProjectExist(
                req,
                projectId,
                userId
            );

            expect(result).toStrictEqual(false);
            expect(spyDecode).toHaveBeenCalledWith(mockedAccessToken);
        });

        test("should return false, when decoded JWT object's userId does not match with userId passed as parameter", () => {
            const objectId: ObjectID = ObjectID.generate();

            const spyDecode: jest.SpyInstance = jest
                .spyOn(JSONWebToken, 'decode')
                .mockReturnValueOnce({
                    userId: objectId,
                    projectId,
                } as JSONWebTokenData);

            const result: boolean = UserMiddleware.doesSsoTokenForProjectExist(
                req,
                projectId,
                userId
            );

            expect(result).toStrictEqual(false);
            expect(spyDecode).toHaveBeenCalledWith(mockedAccessToken);
        });

        test('should return true', () => {
            jest.spyOn(JSONWebToken, 'decode').mockReturnValueOnce({
                userId,
                projectId,
            } as JSONWebTokenData);

            const result: boolean = UserMiddleware.doesSsoTokenForProjectExist(
                req,
                projectId,
                userId
            );

            expect(result).toStrictEqual(true);
        });
    });

    describe('getUserMiddleware', () => {
        let req: ExpressRequest;
        let res: ExpressResponse;

        const next: NextFunction = jest.fn();

        const mockedUserId: ObjectID = ObjectID.generate();
        const hashValue: string = 'hash-value';

        const jwtTokenData: JSONWebTokenData = {
            userId: mockedUserId,
            isMasterAdmin: true,
            email: new Email('test@gmail.com'),
        };

        beforeAll(() => {
            jest.spyOn(ProjectMiddleware, 'getProjectId').mockReturnValue(
                projectId
            );
            jest.spyOn(ProjectMiddleware, 'hasApiKey').mockReturnValue(false);
            jest.spyOn(UserMiddleware, 'getAccessToken').mockReturnValue(
                mockedAccessToken
            );
            jest.spyOn(JSONWebToken, 'decode').mockReturnValue(jwtTokenData);
            jest.spyOn(HashedString, 'hashValue').mockResolvedValue(hashValue);
        });

        beforeEach(() => {
            req = { headers: {} } as ExpressRequest;

            res = {} as ExpressResponse;
            res.set = jest.fn();
        });

        test('should call isValidProjectIdAndApiKeyMiddleware and return when hasApiKey returns true', async () => {
            jest.spyOn(ProjectMiddleware, 'hasApiKey').mockReturnValueOnce(
                true
            );

            const spyGetAccessToken: jest.SpyInstance = jest.spyOn(
                UserMiddleware,
                'getAccessToken'
            );

            await UserMiddleware.getUserMiddleware(req, res, next);

            expect(
                ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware
            ).toHaveBeenCalledWith(req, res, next);
            expect(spyGetAccessToken).not.toHaveBeenCalled();
        });

        test("should call function 'next' and return, when getAccessToken returns a string value", async () => {
            const spyGetAccessToken: jest.SpyInstance = jest
                .spyOn(UserMiddleware, 'getAccessToken')
                .mockReturnValueOnce(null);

            await UserMiddleware.getUserMiddleware(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(spyGetAccessToken).toHaveBeenCalledWith(req);
            expect(JSONWebToken.decode).not.toHaveBeenCalled();
        });

        test("should call function 'next' and return, when accessToken can not be decoded", async () => {
            const error: Error = new Error('Invalid access token');

            const spyJWTDecode: jest.SpyInstance = jest
                .spyOn(JSONWebToken, 'decode')
                .mockImplementationOnce((_: string) => {
                    throw error;
                });

            await UserMiddleware.getUserMiddleware(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(spyJWTDecode).toHaveBeenCalledWith(mockedAccessToken);
            expect(UserService.updateOneBy).not.toHaveBeenCalled();
        });

        test('should set global-permissions and global-permissions-hash in the response header, when user has global access permission', async () => {
            const mockedGlobalAccessPermission: UserGlobalAccessPermission =
                {} as UserGlobalAccessPermission;

            jest.spyOn(ProjectMiddleware, 'getProjectId').mockReturnValueOnce(
                null
            );
            const spySerialize: jest.SpyInstance = jest
                .spyOn(JSONFunctions, 'serialize')
                .mockReturnValueOnce({});
            const spyGetUserGlobalAccessPermission: jest.SpyInstance = jest
                .spyOn(AccessTokenService, 'getUserGlobalAccessPermission')
                .mockResolvedValueOnce(mockedGlobalAccessPermission);

            await UserMiddleware.getUserMiddleware(req, res, next);

            expect(spyGetUserGlobalAccessPermission).toHaveBeenCalledWith(
                jwtTokenData.userId
            );
            expect(spySerialize).toHaveBeenCalledWith(
                mockedGlobalAccessPermission
            );
            expect(res.set).toHaveBeenCalledWith(
                'global-permissions',
                JSON.stringify({})
            );
            expect(res.set).toHaveBeenCalledWith(
                'global-permissions-hash',
                hashValue
            );
            expect(next).toHaveBeenCalled();
        });

        test('should not set global-permissions and global-permissions-hash in the response header, when user does not have global access permission', async () => {
            jest.spyOn(ProjectMiddleware, 'getProjectId').mockReturnValueOnce(
                null
            );
            const spyGetUserGlobalAccessPermission: jest.SpyInstance = jest
                .spyOn(AccessTokenService, 'getUserGlobalAccessPermission')
                .mockResolvedValueOnce(null);

            await UserMiddleware.getUserMiddleware(req, res, next);

            expect(spyGetUserGlobalAccessPermission).toHaveBeenCalledWith(
                jwtTokenData.userId
            );
            expect(res.set).not.toHaveBeenCalledWith(
                'global-permissions',
                expect.anything()
            );
            expect(res.set).not.toHaveBeenCalledWith(
                'global-permissions-hash',
                expect.anything()
            );
            expect(next).toHaveBeenCalled();
        });

        test('should return Invalid tenantId error, when tenantId is not null and project is not found', async () => {
            const spyFindOneById: jest.SpyInstance = jest
                .spyOn(ProjectService, 'findOneById')
                .mockResolvedValueOnce(null);

            await UserMiddleware.getUserMiddleware(req, res, next);

            expect(Response.sendErrorResponse).toHaveBeenCalledWith(
                req,
                res,
                new BadDataException('Invalid tenantId')
            );
            expect(spyFindOneById).toHaveBeenCalledWith({
                id: projectId,
                select: {
                    requireSsoForLogin: true,
                },
                props: {
                    isRoot: true,
                },
            });
        });

        test('should return SSO Authorization Required error, when sso is required for login but sso token for project does not exist', async () => {
            jest.spyOn(ProjectService, 'findOneById').mockResolvedValueOnce({
                requireSsoForLogin: true,
            } as Project);

            const spyDoesSsoTokenForProjectExist: jest.SpyInstance = jest
                .spyOn(UserMiddleware, 'doesSsoTokenForProjectExist')
                .mockReturnValueOnce(false);

            await UserMiddleware.getUserMiddleware(req, res, next);

            expect(Response.sendErrorResponse).toHaveBeenCalledWith(
                req,
                res,
                new SsoAuthorizationException()
            );
            expect(spyDoesSsoTokenForProjectExist).toHaveBeenCalledWith(
                req,
                projectId,
                jwtTokenData.userId
            );
        });

        test('should set project-permissions and project-permissions-hash in the response header when tenantId is not null and user has tenant access permission', async () => {
            const mockedTenantAccessPermission: UserTenantAccessPermission =
                {} as UserTenantAccessPermission;

            jest.spyOn(ProjectService, 'findOneById').mockResolvedValueOnce({
                requireSsoForLogin: false,
            } as Project);
            const spySerialize: jest.SpyInstance = jest
                .spyOn(JSONFunctions, 'serialize')
                .mockReturnValueOnce({});
            const spyGetUserTenantAccessPermission: jest.SpyInstance = jest
                .spyOn(AccessTokenService, 'getUserTenantAccessPermission')
                .mockResolvedValueOnce(mockedTenantAccessPermission);

            await UserMiddleware.getUserMiddleware(req, res, next);

            expect(spyGetUserTenantAccessPermission).toHaveBeenCalledWith(
                jwtTokenData.userId,
                projectId
            );
            expect(spySerialize).toHaveBeenCalledWith(
                mockedTenantAccessPermission
            );
            expect(res.set).toHaveBeenCalledWith(
                'project-permissions',
                JSON.stringify({})
            );
            expect(res.set).toHaveBeenCalledWith(
                'project-permissions-hash',
                hashValue
            );
            expect(next).toHaveBeenCalled();
        });

        test('should set project-permissions and project-permissions-hash in the response header with default tenant access permission, when is-multi-tenant-query request header is set and sso-token does not exist', async () => {
            const mockedTenantAccessPermission: UserTenantAccessPermission =
                {} as UserTenantAccessPermission;
            const mockedGlobalAccessPermission: UserGlobalAccessPermission = {
                projectIds: [projectId],
            } as UserGlobalAccessPermission;
            const project: Project = {
                _id: projectId.toString(),
                requireSsoForLogin: true,
            } as Project;

            const mockedRequest: Partial<ExpressRequest> = {
                headers: { 'is-multi-tenant-query': 'yes' },
            };

            jest.spyOn(ProjectService, 'findBy').mockResolvedValueOnce([
                project,
            ]);
            jest.spyOn(ProjectService, 'findOneById').mockResolvedValueOnce({
                ...project,
                requireSsoForLogin: false,
            } as Project);
            jest.spyOn(
                UserMiddleware,
                'doesSsoTokenForProjectExist'
            ).mockReturnValueOnce(false);
            jest.spyOn(JSONFunctions, 'serialize').mockReturnValueOnce({});
            jest.spyOn(
                AccessTokenService,
                'getUserGlobalAccessPermission'
            ).mockResolvedValueOnce(mockedGlobalAccessPermission);
            jest.spyOn(
                AccessTokenService,
                'getUserTenantAccessPermission'
            ).mockResolvedValueOnce(null);

            const spyGetDefaultUserTenantAccessPermission: jest.SpyInstance =
                jest
                    .spyOn(
                        AccessTokenService,
                        'getDefaultUserTenantAccessPermission'
                    )
                    .mockReturnValueOnce(mockedTenantAccessPermission);

            await UserMiddleware.getUserMiddleware(
                mockedRequest as ExpressRequest,
                res,
                next
            );

            expect(
                spyGetDefaultUserTenantAccessPermission
            ).toHaveBeenCalledWith(projectId);
            expect(res.set).toHaveBeenCalledWith(
                'project-permissions',
                JSON.stringify({})
            );
            expect(res.set).toHaveBeenCalledWith(
                'project-permissions-hash',
                hashValue
            );
            expect(next).toHaveBeenCalled();
        });

        test('should set project-permissions and project-permissions-hash in the response header with user tenant access permission, when is-multi-tenant-query request header is set and user has tenant access permission', async () => {
            const mockedTenantAccessPermission: UserTenantAccessPermission =
                {} as UserTenantAccessPermission;
            const mockedGlobalAccessPermission: UserGlobalAccessPermission = {
                projectIds: [projectId],
            } as UserGlobalAccessPermission;
            const project: Project = {
                _id: projectId.toString(),
                requireSsoForLogin: true,
            } as Project;

            const mockedRequest: Partial<ExpressRequest> = {
                headers: { 'is-multi-tenant-query': 'yes' },
            };

            jest.spyOn(ProjectService, 'findBy').mockResolvedValueOnce([
                project,
            ]);
            jest.spyOn(ProjectService, 'findOneById').mockResolvedValueOnce({
                ...project,
                requireSsoForLogin: false,
            } as Project);
            jest.spyOn(
                UserMiddleware,
                'doesSsoTokenForProjectExist'
            ).mockReturnValueOnce(true);
            jest.spyOn(JSONFunctions, 'serialize').mockReturnValueOnce({});
            jest.spyOn(
                AccessTokenService,
                'getUserGlobalAccessPermission'
            ).mockResolvedValueOnce(mockedGlobalAccessPermission);
            jest.spyOn(AccessTokenService, 'getUserTenantAccessPermission')
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(mockedTenantAccessPermission);

            await UserMiddleware.getUserMiddleware(
                mockedRequest as ExpressRequest,
                res,
                next
            );

            expect(res.set).toHaveBeenCalledWith(
                'project-permissions',
                JSON.stringify({})
            );
            expect(res.set).toHaveBeenCalledWith(
                'project-permissions-hash',
                hashValue
            );
            expect(next).toHaveBeenCalled();
        });
    });
});
