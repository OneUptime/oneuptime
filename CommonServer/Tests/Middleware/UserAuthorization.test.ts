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
jest.mock('Common/Types/JSONFunctions');

type StringOrNull = string | null;

describe('UserMiddleware', () => {
    const mockedAccessToken: string = ObjectID.generate().toString();
    const projectId: ObjectID = ObjectID.generate();
    const userId: ObjectID = ObjectID.generate();
    const mockedProject: Project = { _id: projectId.toString() } as Project;

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

        const hashValue: string = 'hash-value';
        const mockedTenantAccessPermission: UserTenantAccessPermission = {
            projectId,
        } as UserTenantAccessPermission;
        const mockedGlobalAccessPermission: UserGlobalAccessPermission = {
            projectIds: [projectId],
        } as UserGlobalAccessPermission;

        const jwtTokenData: JSONWebTokenData = {
            userId,
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

        afterEach(() => {
            jest.clearAllMocks();
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

        test("should call function 'next' and return, when getAccessToken returns a null value", async () => {
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
            jest.spyOn(ProjectMiddleware, 'getProjectId').mockReturnValueOnce(
                null
            );
            jest.spyOn(JSONFunctions, 'serialize').mockReturnValueOnce({});
            const spyGetUserGlobalAccessPermission: jest.SpyInstance = jest
                .spyOn(AccessTokenService, 'getUserGlobalAccessPermission')
                .mockResolvedValueOnce(mockedGlobalAccessPermission);

            await UserMiddleware.getUserMiddleware(req, res, next);

            expect(res.set).toHaveBeenCalledWith(
                'global-permissions',
                JSON.stringify({})
            );
            expect(res.set).toHaveBeenCalledWith(
                'global-permissions-hash',
                hashValue
            );
            expect(next).toHaveBeenCalled();
            expect(spyGetUserGlobalAccessPermission).toHaveBeenCalledWith(
                userId
            );
        });

        test('should not set global-permissions and global-permissions-hash in the response header, when user does not have global access permission', async () => {
            jest.spyOn(ProjectMiddleware, 'getProjectId').mockReturnValueOnce(
                null
            );
            const spyGetUserGlobalAccessPermission: jest.SpyInstance = jest
                .spyOn(AccessTokenService, 'getUserGlobalAccessPermission')
                .mockResolvedValueOnce(null);

            await UserMiddleware.getUserMiddleware(req, res, next);

            expect(res.set).not.toHaveBeenCalledWith(
                'global-permissions',
                expect.anything()
            );
            expect(res.set).not.toHaveBeenCalledWith(
                'global-permissions-hash',
                expect.anything()
            );
            expect(next).toHaveBeenCalled();
            expect(spyGetUserGlobalAccessPermission).toHaveBeenCalledWith(
                userId
            );
        });

        test('should call Response.sendErrorResponse, when tenantId is passed in the header and getUserTenantAccessPermissionWithTenantId throws an exception', async () => {
            const spyGetUserTenantAccessPermissionWithTenantId: jest.SpyInstance =
                jest
                    .spyOn(
                        UserMiddleware,
                        'getUserTenantAccessPermissionWithTenantId'
                    )
                    .mockRejectedValueOnce(new SsoAuthorizationException());

            await UserMiddleware.getUserMiddleware(req, res, next);

            expect(Response.sendErrorResponse).toHaveBeenCalledWith(
                req,
                res,
                new SsoAuthorizationException()
            );
            expect(
                spyGetUserTenantAccessPermissionWithTenantId
            ).toHaveBeenCalledWith(req, projectId, userId);
            expect(next).not.toBeCalled();
        });

        test('should set project-permissions and project-permissions-hash in the response header, when tenantId is passed in the header and user has tenant access permission', async () => {
            jest.spyOn(JSONFunctions, 'serialize').mockReturnValueOnce({});
            const spyGetUserTenantAccessPermissionWithTenantId: jest.SpyInstance =
                jest
                    .spyOn(
                        UserMiddleware,
                        'getUserTenantAccessPermissionWithTenantId'
                    )
                    .mockResolvedValueOnce(mockedTenantAccessPermission);

            await UserMiddleware.getUserMiddleware(req, res, next);

            expect(res.set).toHaveBeenCalledWith(
                'project-permissions',
                JSON.stringify({})
            );
            expect(res.set).toHaveBeenCalledWith(
                'project-permissions-hash',
                hashValue
            );
            expect(next).toHaveBeenCalled();

            expect(
                spyGetUserTenantAccessPermissionWithTenantId
            ).toHaveBeenCalledWith(req, projectId, userId);
        });

        test("should not call getUserTenantAccessPermissionForMultiTenant, when is-multi-tenant-query is set in the request header and but userGlobalAccessPermission's projectIds length is zero", async () => {
            const mockedRequest: Partial<ExpressRequest> = {
                headers: { 'is-multi-tenant-query': 'yes' },
            };

            jest.spyOn(
                AccessTokenService,
                'getUserGlobalAccessPermission'
            ).mockResolvedValueOnce({
                ...mockedGlobalAccessPermission,
                projectIds: [],
            });
            jest.spyOn(
                UserMiddleware,
                'getUserTenantAccessPermissionWithTenantId'
            ).mockResolvedValueOnce(null);
            const spyGetUserTenantAccessPermissionForMultiTenant: jest.SpyInstance =
                jest.spyOn(
                    UserMiddleware,
                    'getUserTenantAccessPermissionForMultiTenant'
                );

            await UserMiddleware.getUserMiddleware(
                mockedRequest as ExpressRequest,
                res,
                next
            );

            expect(res.set).not.toHaveBeenCalledWith(
                'project-permissions',
                expect.anything()
            );
            expect(res.set).not.toHaveBeenCalledWith(
                'project-permissions-hash',
                expect.anything()
            );
            expect(next).toHaveBeenCalled();
            expect(
                spyGetUserTenantAccessPermissionForMultiTenant
            ).not.toHaveBeenCalled();
        });

        test('should set project-permissions and project-permissions-hash in the response header, when is-multi-tenant-query is set in the request header and getUserTenantAccessPermissionForMultiTenant returned access permission', async () => {
            const mockedRequest: Partial<ExpressRequest> = {
                headers: { 'is-multi-tenant-query': 'yes' },
            };

            jest.spyOn(JSONFunctions, 'serialize').mockReturnValue({});
            jest.spyOn(
                AccessTokenService,
                'getUserGlobalAccessPermission'
            ).mockResolvedValueOnce(mockedGlobalAccessPermission);
            jest.spyOn(
                UserMiddleware,
                'getUserTenantAccessPermissionWithTenantId'
            ).mockResolvedValueOnce(null);
            const spyGetUserTenantAccessPermissionForMultiTenant: jest.SpyInstance =
                jest
                    .spyOn(
                        UserMiddleware,
                        'getUserTenantAccessPermissionForMultiTenant'
                    )
                    .mockResolvedValueOnce({
                        [projectId.toString()]: mockedTenantAccessPermission,
                    });

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
            expect(
                spyGetUserTenantAccessPermissionForMultiTenant
            ).toHaveBeenCalledWith(
                mockedRequest,
                userId,
                mockedGlobalAccessPermission.projectIds
            );
        });

        test('should not set project-permissions and project-permissions-hash in the response header, when the project-permissions-hash set in the request header equals the projectPermissionsHash computed from userTenantAccessPermission', async () => {
            const mockedRequest: Partial<ExpressRequest> = {
                headers: { 'project-permissions-hash': hashValue },
            };

            const spyGetUserTenantAccessPermissionWithTenantId: jest.SpyInstance =
                jest
                    .spyOn(
                        UserMiddleware,
                        'getUserTenantAccessPermissionWithTenantId'
                    )
                    .mockResolvedValueOnce(mockedTenantAccessPermission);

            await UserMiddleware.getUserMiddleware(
                mockedRequest as ExpressRequest,
                res,
                next
            );

            expect(res.set).not.toHaveBeenCalledWith(
                'project-permissions',
                expect.anything()
            );
            expect(res.set).not.toHaveBeenCalledWith(
                'project-permissions-hash',
                expect.anything()
            );
            expect(next).toHaveBeenCalled();

            expect(
                spyGetUserTenantAccessPermissionWithTenantId
            ).toHaveBeenCalledWith(mockedRequest, projectId, userId);
        });
    });

    describe('getUserTenantAccessPermissionWithTenantId', () => {
        const req: ExpressRequest = {} as ExpressRequest;

        const spyFindOneById: jest.SpyInstance = jest.spyOn(
            ProjectService,
            'findOneById'
        );
        const spyDoesSsoTokenForProjectExist: jest.SpyInstance = jest.spyOn(
            UserMiddleware,
            'doesSsoTokenForProjectExist'
        );

        afterEach(() => {
            jest.clearAllMocks();
        });

        test("should throw 'Invalid tenantId' error, when project is not found for the tenantId", async () => {
            spyFindOneById.mockResolvedValueOnce(null);

            await expect(
                UserMiddleware.getUserTenantAccessPermissionWithTenantId(
                    req,
                    projectId,
                    userId
                )
            ).rejects.toThrowError(new BadDataException('Invalid tenantId'));
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

        test('should throw SsoAuthorizationException error, when sso login is required but sso token for the projectId does not exist', async () => {
            spyFindOneById.mockResolvedValueOnce({
                ...mockedProject,
                requireSsoForLogin: true,
            });

            spyDoesSsoTokenForProjectExist.mockReturnValueOnce(false);

            await expect(
                UserMiddleware.getUserTenantAccessPermissionWithTenantId(
                    req,
                    projectId,
                    userId
                )
            ).rejects.toThrowError(new SsoAuthorizationException());
            expect(spyDoesSsoTokenForProjectExist).toHaveBeenCalledWith(
                req,
                projectId,
                userId
            );
        });

        test('should return null when getUserTenantAccessPermission returns null', async () => {
            spyFindOneById.mockResolvedValueOnce(mockedProject);

            const spyGetUserTenantAccessPermission: jest.SpyInstance = jest
                .spyOn(AccessTokenService, 'getUserTenantAccessPermission')
                .mockResolvedValueOnce(null);

            const result: UserTenantAccessPermission | null =
                await UserMiddleware.getUserTenantAccessPermissionWithTenantId(
                    req,
                    projectId,
                    userId
                );

            expect(result).toBeNull();
            expect(spyGetUserTenantAccessPermission).toHaveBeenLastCalledWith(
                userId,
                projectId
            );
        });

        test('should return UserTenantAccessPermission', async () => {
            const mockedUserTenantAccessPermission: UserTenantAccessPermission =
                { projectId } as UserTenantAccessPermission;

            spyFindOneById.mockResolvedValueOnce(mockedProject);

            const spyGetUserTenantAccessPermission: jest.SpyInstance = jest
                .spyOn(AccessTokenService, 'getUserTenantAccessPermission')
                .mockResolvedValueOnce(mockedUserTenantAccessPermission);

            const result: UserTenantAccessPermission | null =
                await UserMiddleware.getUserTenantAccessPermissionWithTenantId(
                    req,
                    projectId,
                    userId
                );

            expect(result).toEqual(mockedUserTenantAccessPermission);
            expect(spyGetUserTenantAccessPermission).toHaveBeenLastCalledWith(
                userId,
                projectId
            );
        });
    });

    describe('getUserTenantAccessPermissionForMultiTenant', () => {
        const req: ExpressRequest = {} as ExpressRequest;
        const mockedUserTenantAccessPermission: UserTenantAccessPermission = {
            projectId,
        } as UserTenantAccessPermission;

        const spyFindBy: jest.SpyInstance = jest.spyOn(
            ProjectService,
            'findBy'
        );
        const spyDoesSsoTokenForProjectExist: jest.SpyInstance = jest.spyOn(
            UserMiddleware,
            'doesSsoTokenForProjectExist'
        );

        afterEach(() => {
            jest.clearAllMocks();
        });

        test('should return null, when projectIds length is zero', async () => {
            const result: Dictionary<UserTenantAccessPermission> | null =
                await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
                    req,
                    userId,
                    []
                );

            expect(result).toBeNull();
            expect(spyFindBy).not.toBeCalled();
        });

        test('should return default tenant access permission, when project for a projectId is found, sso is required for login, but sso token does not exist for that projectId', async () => {
            spyDoesSsoTokenForProjectExist.mockReturnValueOnce(false);
            spyFindBy.mockResolvedValueOnce([
                { ...mockedProject, requireSsoForLogin: true },
            ]);

            const spyGetDefaultUserTenantAccessPermission: jest.SpyInstance =
                jest
                    .spyOn(
                        AccessTokenService,
                        'getDefaultUserTenantAccessPermission'
                    )
                    .mockReturnValueOnce(mockedUserTenantAccessPermission);

            const result: Dictionary<UserTenantAccessPermission> | null =
                await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
                    req,
                    userId,
                    [projectId]
                );

            expect(result).toEqual({
                [projectId.toString()]: mockedUserTenantAccessPermission,
            });
            expect(spyDoesSsoTokenForProjectExist).toHaveBeenCalledWith(
                req,
                projectId,
                userId
            );
            expect(
                spyGetDefaultUserTenantAccessPermission
            ).toHaveBeenCalledWith(projectId);
        });

        test('should return user tenant access permission, when project for a projectId is found, sso is not required for login and project level permission exist for the projectId', async () => {
            spyFindBy.mockResolvedValueOnce([mockedProject]);

            const spyGetUserTenantAccessPermission: jest.SpyInstance = jest
                .spyOn(AccessTokenService, 'getUserTenantAccessPermission')
                .mockResolvedValueOnce(mockedUserTenantAccessPermission);

            const result: Dictionary<UserTenantAccessPermission> | null =
                await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
                    req,
                    userId,
                    [projectId]
                );

            expect(result).toEqual({
                [projectId.toString()]: mockedUserTenantAccessPermission,
            });
            expect(spyDoesSsoTokenForProjectExist).not.toBeCalled();
            expect(spyGetUserTenantAccessPermission).toHaveBeenCalledWith(
                userId,
                projectId
            );
        });

        test('should return null, when project for a projectId is found, sso is not required for login but project level permission does not exist for the projectId', async () => {
            spyFindBy.mockResolvedValueOnce([mockedProject]);

            const spyGetUserTenantAccessPermission: jest.SpyInstance = jest
                .spyOn(AccessTokenService, 'getUserTenantAccessPermission')
                .mockResolvedValueOnce(null);

            const result: Dictionary<UserTenantAccessPermission> | null =
                await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
                    req,
                    userId,
                    [projectId]
                );

            expect(result).toBeNull();
            expect(spyGetUserTenantAccessPermission).toHaveBeenCalledWith(
                userId,
                projectId
            );
        });

        test('should return user tenant access permission, when project for a projectId is not found, but project level permission exist for the projectId', async () => {
            spyFindBy.mockResolvedValueOnce([]);

            jest.spyOn(
                AccessTokenService,
                'getUserTenantAccessPermission'
            ).mockResolvedValueOnce(mockedUserTenantAccessPermission);

            const result: Dictionary<UserTenantAccessPermission> | null =
                await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
                    req,
                    userId,
                    [projectId]
                );

            expect(result).toEqual({
                [projectId.toString()]: mockedUserTenantAccessPermission,
            });
        });

        test('should return null, when project for a projectId is not found, and project level permission does not exist for the projectId', async () => {
            spyFindBy.mockResolvedValueOnce([]);

            const spyGetUserTenantAccessPermission: jest.SpyInstance = jest
                .spyOn(AccessTokenService, 'getUserTenantAccessPermission')
                .mockResolvedValueOnce(null);

            const result: Dictionary<UserTenantAccessPermission> | null =
                await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
                    req,
                    userId,
                    [projectId]
                );

            expect(result).toBeNull();
            expect(spyGetUserTenantAccessPermission).toHaveBeenCalledWith(
                userId,
                projectId
            );
        });
    });
});
