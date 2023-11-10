/* eslint-disable no-loop-func */
import Express, {
    ExpressResponse,
    ExpressRouter,
    NextFunction,
    OneUptimeRequest,
} from '../../Utils/Express';
import DatabaseService from '../../Services/DatabaseService';
import UserMiddleware from '../../Middleware/UserAuthorization';
import BaseModel from 'Common/Models/BaseModel';
import BaseAPI from '../../API/BaseAPI';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import PositiveNumber from 'Common/Types/PositiveNumber';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import { PlanSelect } from 'Common/Types/Billing/SubscriptionPlan';
import ObjectID from 'Common/Types/ObjectID';
import Response from '../../Utils/Response';
import ProjectService from '../../Services/ProjectService';
import UserType from 'Common/Types/UserType';
import { mockRouter } from './Helpers';
import { UserPermission } from 'Common/Types/Permission';

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
    };
});

jest.mock('../../Services/DatabaseService', () => {
    return jest.fn().mockImplementation(() => {
        return {
            countBy: () => {
                return new PositiveNumber(42);
            },
            findBy: () => {
                return [{ id: 'mock' }];
            },
            findOneById: jest.fn().mockImplementation(() => {
                return { id: 'mock' };
            }),
            deleteOneBy: jest.fn(),
            updateOneBy: jest.fn(),
            create: jest.fn().mockImplementation((...args: []) => {
                return args;
            }),
            hardDeleteItemsOlderThanInDays: jest.fn(),
        };
    });
});

jest.mock('Common/Models/BaseModel', () => {
    return jest.fn().mockImplementation((initObject: {}) => {
        return {
            ...initObject,
            getCrudApiPath: jest.fn().mockImplementation(() => {
                return '/mock';
            }),
            getTableColumnMetadata: jest.fn().mockImplementation(() => {
                return null;
            }),
        };
    });
});

jest.mock('../../Services/ProjectService', () => {
    return {
        getCurrentPlan: () => {
            return {
                currentPlan: 'Free',
                isSubscriptionUnpaid: false,
            };
        },
    };
});

jest.mock('../../EnvironmentConfig', () => {
    return {
        IsBillingEnabled: true,
    };
});

// eslint-disable-next-line @typescript-eslint/typedef
const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
} as any as ExpressResponse;

const deleteRequest: OneUptimeRequest = {
    params: { id: 'delete-me' },
    headers: {},
} as unknown as OneUptimeRequest;

const countRequest: OneUptimeRequest = {
    body: { query: { id: 'count-me' } },
    headers: {},
} as unknown as OneUptimeRequest;

const getRequest: OneUptimeRequest = {
    params: { id: 'get-me' },
    headers: {},
} as unknown as OneUptimeRequest;

const next: NextFunction = jest.fn();

const TestService: DatabaseService<BaseModel> = new DatabaseService(BaseModel);
let emptyDatabaseCommonInteractionProps: DatabaseCommonInteractionProps = {};

describe('BaseAPI', () => {
    let baseApiInstance: BaseAPI<BaseModel, DatabaseService<BaseModel>>;
    let emptyRequest: OneUptimeRequest = {
        query: {},
        headers: {},
    } as OneUptimeRequest;

    beforeAll(async () => {
        mockRouter.post.mockClear();
        mockRouter.get.mockClear();
        mockRouter.put.mockClear();
        mockRouter.delete.mockClear();

        baseApiInstance = new BaseAPI(BaseModel, TestService);
        emptyDatabaseCommonInteractionProps =
            await baseApiInstance.getDatabaseCommonInteractionProps(
                emptyRequest
            );
    });

    afterEach(() => {
        jest.clearAllMocks();

        emptyRequest = {
            query: {},
            headers: {},
        } as OneUptimeRequest;
    });

    describe('constructor', () => {
        it('should construct and set up routes', () => {
            expect(Express.getRouter().post).toHaveBeenCalledWith(
                '/mock',
                UserMiddleware.getUserMiddleware,
                expect.any(Function)
            );

            expect(Express.getRouter().post).toHaveBeenCalledWith(
                '/mock/get-list',
                UserMiddleware.getUserMiddleware,
                expect.any(Function)
            );

            expect(Express.getRouter().get).toHaveBeenCalledWith(
                '/mock/get-list',
                UserMiddleware.getUserMiddleware,
                expect.any(Function)
            );

            expect(Express.getRouter().post).toHaveBeenCalledWith(
                '/mock/count',
                UserMiddleware.getUserMiddleware,
                expect.any(Function)
            );

            expect(Express.getRouter().post).toHaveBeenCalledWith(
                '/mock/:id/get-item',
                UserMiddleware.getUserMiddleware,
                expect.any(Function)
            );

            expect(Express.getRouter().put).toHaveBeenCalledWith(
                '/mock/:id',
                UserMiddleware.getUserMiddleware,
                expect.any(Function)
            );

            expect(Express.getRouter().delete).toHaveBeenCalledWith(
                '/mock/:id',
                UserMiddleware.getUserMiddleware,
                expect.any(Function)
            );
        });
    });

    describe('routes', () => {
        // eslint-disable-next-line @typescript-eslint/typedef
        const checkRoutes = [
            ['POST', '/mock', 'createItem'],
            ['POST', '/mock/get-list', 'getList'],
            ['GET', '/mock/get-list', 'getList'],
            ['POST', '/mock/count', 'count'],
            ['POST', '/mock/:id/get-item', 'getItem'],
            ['GET', '/mock/:id/get-item', 'getItem'],
            ['PUT', '/mock/:id', 'updateItem'],
            ['DELETE', '/mock/:id', 'deleteItem'],
        ] as [String, String, String][];

        for (const [method, uri, shouldBeCalled] of checkRoutes) {
            describe(`${method} ${uri}`, () => {
                it(`should call ${shouldBeCalled}`, async () => {
                    const spy: jest.SpyInstance = jest.spyOn(
                        baseApiInstance as any,
                        shouldBeCalled as any
                    );
                    await mockRouter
                        .match(method, uri)
                        .handlerFunction(emptyRequest, res, next);
                    expect(spy).toHaveBeenCalledWith(emptyRequest, res);
                });

                it('should call next(err) on exception', async () => {
                    const error: Error = new Error('Mocked Error');
                    jest.spyOn(
                        baseApiInstance as any,
                        shouldBeCalled as any
                    ).mockImplementationOnce(() => {
                        throw error;
                    });
                    const next: jest.Mock = jest.fn();
                    await mockRouter
                        .match(method, uri)
                        .handlerFunction(emptyRequest, res, next);
                    expect(next).toHaveBeenCalledWith(error);
                });
            });
        }
    });

    describe('BaseAPI.getPermissionsForTenant', () => {
        it('should return empty permissions if userTenantAccessPermission is not set', async () => {
            jest.spyOn(
                baseApiInstance,
                'getDatabaseCommonInteractionProps'
            ).mockResolvedValueOnce({});
            const permissions: UserPermission[] =
                await baseApiInstance.getPermissionsForTenant(emptyRequest);
            expect(permissions).toEqual([]);
        });

        it('should return permissions if userTenantAccessPermission is set and tenantId is available', async () => {
            // eslint-disable-next-line @typescript-eslint/typedef
            const mockPermissions = [{ permission: 'granted' }];
            jest.spyOn(
                baseApiInstance,
                'getDatabaseCommonInteractionProps'
            ).mockResolvedValueOnce({
                userTenantAccessPermission: {
                    tenantId: { permissions: mockPermissions },
                },
                tenantId: 'tenantId',
            } as any);

            const permissions: UserPermission[] =
                await baseApiInstance.getPermissionsForTenant(emptyRequest);
            expect(permissions).toEqual(mockPermissions);
        });

        it('should return empty permissions if tenantId is not available', async () => {
            jest.spyOn(
                baseApiInstance,
                'getDatabaseCommonInteractionProps'
            ).mockResolvedValueOnce({
                userTenantAccessPermission: {
                    tenantId: { permissions: [{ doesnt: 'matter' }] },
                },
                tenantId: null,
            } as any);

            const permissions: UserPermission[] =
                await baseApiInstance.getPermissionsForTenant(emptyRequest);
            expect(permissions).toEqual([]);
        });
    });

    describe('getTenantId', () => {
        it('should return null if there is no tennatId', () => {
            expect(baseApiInstance.getTenantId(emptyRequest)).toEqual(null);
        });

        it('should return ObjectID if tennantId is passed', () => {
            const tenantId: ObjectID = new ObjectID('123');
            const tenantRequest: OneUptimeRequest = {
                tenantId,
            } as OneUptimeRequest;
            expect(baseApiInstance.getTenantId(tenantRequest)).toEqual(
                tenantId
            );
        });
    });

    describe('getDatabaseCommonInteractionProps', () => {
        let request: OneUptimeRequest;

        beforeEach(() => {
            request = {
                userType: undefined,
                userAuthorization: undefined,
                userGlobalAccessPermission: undefined,
                userTenantAccessPermission: undefined,
                tenantId: undefined,
                headers: {},
            } as unknown as OneUptimeRequest;
        });

        it('should initialize props with undefined values', async () => {
            const props: DatabaseCommonInteractionProps =
                await baseApiInstance.getDatabaseCommonInteractionProps(
                    request
                );
            expect(props).toEqual(
                expect.objectContaining({
                    tenantId: undefined,
                    userGlobalAccessPermission: undefined,
                    userTenantAccessPermission: undefined,
                    userId: undefined,
                    userType: undefined,
                    isMultiTenantRequest: undefined,
                })
            );
        });

        it('should set userId if userAuthorization is present', async () => {
            request.userAuthorization = { userId: new ObjectID('123') } as any;
            const props: DatabaseCommonInteractionProps =
                await baseApiInstance.getDatabaseCommonInteractionProps(
                    request
                );
            expect(props.userId).toEqual(new ObjectID('123'));
        });

        it('should set userGlobalAccessPermission if present in the request', async () => {
            request.userGlobalAccessPermission = { canEdit: true } as any;
            const props: DatabaseCommonInteractionProps =
                await baseApiInstance.getDatabaseCommonInteractionProps(
                    request
                );
            expect(props.userGlobalAccessPermission).toEqual({ canEdit: true });
        });

        it('should set userTenantAccessPermission if present in the request', async () => {
            request.userTenantAccessPermission = { canView: true } as any;
            const props: DatabaseCommonInteractionProps =
                await baseApiInstance.getDatabaseCommonInteractionProps(
                    request
                );
            expect(props.userTenantAccessPermission).toEqual({ canView: true });
        });

        it('should set tenantId if present in the request', async () => {
            request.tenantId = new ObjectID('456');
            const props: DatabaseCommonInteractionProps =
                await baseApiInstance.getDatabaseCommonInteractionProps(
                    request
                );
            expect(props.tenantId).toEqual(new ObjectID('456'));
        });

        it('should set isMultiTenantRequest based on headers', async () => {
            request.headers['is-multi-tenant-query'] = 'true';
            const props: DatabaseCommonInteractionProps =
                await baseApiInstance.getDatabaseCommonInteractionProps(
                    request
                );
            expect(props.isMultiTenantRequest).toBe(true);
        });

        describe('when billing is enabled', () => {
            it('should set currentPlan and isSubscriptionUnpaid if tenantId is present', async () => {
                request.tenantId = new ObjectID('789');
                // eslint-disable-next-line @typescript-eslint/typedef
                const plan = {
                    plan: 'Free' as PlanSelect,
                    isSubscriptionUnpaid: false,
                };
                jest.spyOn(ProjectService, 'getCurrentPlan').mockResolvedValue(
                    plan
                );

                const props: DatabaseCommonInteractionProps =
                    await baseApiInstance.getDatabaseCommonInteractionProps(
                        request
                    );
                expect(props.currentPlan).toBe('Free');
                expect(props.isSubscriptionUnpaid).toBe(false);
            });

            it('should set currentPlan and isSubscriptionUnpaid to undefined if tenantId is not present', async () => {
                const props: DatabaseCommonInteractionProps =
                    await baseApiInstance.getDatabaseCommonInteractionProps(
                        request
                    );
                expect(props.currentPlan).toBeUndefined();
                expect(props.isSubscriptionUnpaid).toBeUndefined();
            });
        });

        it('should set isMasterAdmin if userType is MasterAdmin', async () => {
            request.userType = UserType.MasterAdmin;
            const props: DatabaseCommonInteractionProps =
                await baseApiInstance.getDatabaseCommonInteractionProps(
                    request
                );
            expect(props.isMasterAdmin).toBe(true);
        });
    });

    describe('getList', () => {
        it('should call onBeforeList', async () => {
            const onBeforeListSpy: jest.SpyInstance = jest.spyOn(
                baseApiInstance as any,
                'onBeforeList'
            );
            await baseApiInstance.getList(emptyRequest, res);
            expect(onBeforeListSpy).toHaveBeenCalledWith(emptyRequest, res);
        });

        it('should call service.findBy with the correct parameters', async () => {
            const findBySpy: jest.SpyInstance = jest.spyOn(
                TestService,
                'findBy'
            );
            await baseApiInstance.getList(emptyRequest, res);
            expect(findBySpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    skip: expect.any(PositiveNumber),
                    limit: expect.any(PositiveNumber),
                    query: {},
                    select: {},
                    sort: {},
                    props: emptyDatabaseCommonInteractionProps,
                })
            );
        });

        it('should call service.count with the correct parameters', async () => {
            const findBySpy: jest.SpyInstance = jest.spyOn(
                TestService,
                'countBy'
            );
            await baseApiInstance.getList(emptyRequest, res);
            expect(findBySpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    query: {},
                    props: emptyDatabaseCommonInteractionProps,
                })
            );
        });

        it('should return values retrieved from service', async () => {
            const result: [Request, Response, Object, PositiveNumber, Object] =
                (await baseApiInstance.getList(emptyRequest, res)) as any;
            expect(result[2]).toEqual([{ id: 'mock' }]);
            expect(result[3]).toEqual(new PositiveNumber(42));
        });

        it('should parse query, select, sort from body', async () => {
            emptyRequest.body = {
                query: { skip: 10, limit: 10, query: 'query' },
                select: { id: ['selected'] },
                sort: { _id: 'Descending' },
            };
            const findBySpy: jest.SpyInstance = jest.spyOn(
                TestService,
                'findBy'
            );
            await baseApiInstance.getList(emptyRequest, res);
            expect(findBySpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    skip: expect.any(PositiveNumber),
                    limit: expect.any(PositiveNumber),
                    query: { limit: 10, query: 'query', skip: 10 },
                    select: { id: ['selected'] },
                    sort: { _id: 'Descending' },
                    props: emptyDatabaseCommonInteractionProps,
                })
            );
        });

        it('should throw BadRequestException if limit is greater than LIMIT_PER_PROJECT', async () => {
            emptyRequest.query['limit'] = (LIMIT_PER_PROJECT + 1).toString();
            await expect(
                baseApiInstance.getList(emptyRequest, res)
            ).rejects.toThrow(BadRequestException);
        });

        it.skip('should throw BadRequestException if limit is less than 0', async () => {
            emptyRequest.query['limit'] = '-1';
            await expect(
                baseApiInstance.getList(emptyRequest, res)
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('getCount', () => {
        it('should call onBeforeCount lifecycle method', async () => {
            const onBeforeCountSpy: jest.SpyInstance = jest.spyOn(
                baseApiInstance as any,
                'onBeforeCount'
            );

            await baseApiInstance.count(emptyRequest, res);
            expect(onBeforeCountSpy).toHaveBeenCalledWith(emptyRequest, res);
        });

        it('should process empty query if no body is provided', async () => {
            const countBySpy: jest.SpyInstance = jest.spyOn(
                TestService,
                'countBy'
            );
            await baseApiInstance.count(emptyRequest, res);
            expect(countBySpy).toHaveBeenCalledWith({
                query: {},
                props: emptyDatabaseCommonInteractionProps,
            });
        });

        it('should process provided query', async () => {
            const countBySpy: jest.SpyInstance = jest.spyOn(
                TestService,
                'countBy'
            );
            await baseApiInstance.count(countRequest, res);
            expect(countBySpy).toHaveBeenCalledWith({
                query: { id: 'count-me' },
                props: emptyDatabaseCommonInteractionProps,
            });
        });

        it('should call the countBy method of the service with the correct parameters', async () => {
            const findBySpy: jest.SpyInstance = jest.spyOn(
                TestService,
                'countBy'
            );
            await baseApiInstance.count(countRequest, res);
            expect(findBySpy).toHaveBeenCalledWith({
                query: { id: 'count-me' },
                props: emptyDatabaseCommonInteractionProps,
            });
        });

        it('should send a json response with the count', async () => {
            await baseApiInstance.count(emptyRequest, res);
            expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
                emptyRequest,
                res,
                {
                    count: 42,
                }
            );
        });
    });

    describe('getItem', () => {
        it('should call onBeforeDelete lifecycle method', async () => {
            const onBeforeGetSpy: jest.SpyInstance = jest.spyOn(
                baseApiInstance as any,
                'onBeforeGet'
            );
            await baseApiInstance.getItem(getRequest, res);
            expect(onBeforeGetSpy).toHaveBeenCalledWith(getRequest, res);
        });

        it('should call service.findOneById', async () => {
            const findOneByIdSpy: jest.SpyInstance = jest.spyOn(
                baseApiInstance.service,
                'findOneById'
            );
            await baseApiInstance.getItem(getRequest, res);
            expect(findOneByIdSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: new ObjectID('get-me'),
                    props: emptyDatabaseCommonInteractionProps,
                    select: {},
                })
            );
        });

        it('should interpret body.select', async () => {
            const findOneByIdSpy: jest.SpyInstance = jest.spyOn(
                baseApiInstance.service,
                'findOneById'
            );
            const getRequestWithSelect: OneUptimeRequest = {
                ...getRequest,
                ...{ body: { select: { id: true } } },
            } as unknown as OneUptimeRequest;

            await baseApiInstance.getItem(getRequestWithSelect, res);
            expect(findOneByIdSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: new ObjectID('get-me'),
                    props: emptyDatabaseCommonInteractionProps,
                    select: { id: true },
                })
            );
        });

        it('should return EntityResponse', async () => {
            const sendEntityResponseSpy: jest.SpyInstance = jest.spyOn(
                Response as any,
                'sendEntityResponse'
            );
            await baseApiInstance.getItem(getRequest, res);
            expect(sendEntityResponseSpy).toHaveBeenCalledWith(
                getRequest,
                res,
                { id: 'mock' },
                BaseModel
            );
        });
    });

    describe('deleteItem', () => {
        it('should call onBeforeDelete lifecycle method', async () => {
            const onBeforeDeleteSpy: jest.SpyInstance = jest.spyOn(
                baseApiInstance as any,
                'onBeforeDelete'
            );
            await baseApiInstance.deleteItem(deleteRequest, res);
            expect(onBeforeDeleteSpy).toHaveBeenCalledWith(deleteRequest, res);
        });

        it('should convert request param id to query', async () => {
            await baseApiInstance.deleteItem(deleteRequest, res);
            const deleteOneBySpy: jest.SpyInstance = jest.spyOn(
                baseApiInstance.service,
                'deleteOneBy'
            );
            expect(deleteOneBySpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    query: { _id: 'delete-me' },
                    props: emptyDatabaseCommonInteractionProps,
                })
            );
        });

        it('should send empty response on success', async () => {
            await baseApiInstance.deleteItem(deleteRequest, res);
            const sendEmptyResponseSpy: jest.SpyInstance = jest.spyOn(
                Response as any,
                'sendEmptyResponse'
            );
            expect(sendEmptyResponseSpy).toHaveBeenCalledWith(
                deleteRequest,
                res
            );
        });
    });

    describe('updateItem', () => {
        let updateRequest: OneUptimeRequest;
        let updateResponse: ExpressResponse;
        let emptyProps: DatabaseCommonInteractionProps;

        beforeEach(() => {
            updateRequest = {
                params: { id: 'update-me' },
                body: { data: { name: 'updatedName' } },
                headers: {},
            } as unknown as OneUptimeRequest;

            updateResponse = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis(),
                send: jest.fn().mockReturnThis(),
            } as unknown as ExpressResponse;

            emptyProps = {};
        });

        it('should call onBeforeUpdate lifecycle method', async () => {
            const onBeforeUpdateSpy: jest.SpyInstance = jest.spyOn(
                baseApiInstance as any,
                'onBeforeUpdate'
            );
            await baseApiInstance.updateItem(updateRequest, updateResponse);
            expect(onBeforeUpdateSpy).toHaveBeenCalledWith(
                updateRequest,
                updateResponse
            );
        });

        it('should remove forbidden fields from the item', async () => {
            // eslint-disable-next-line @typescript-eslint/typedef
            const itemWithForbiddenFields = {
                _id: 'should-be-removed',
                createdAt: 'should-be-removed',
                updatedAt: 'should-be-removed',
                name: 'updatedName',
            };

            updateRequest.body.data = itemWithForbiddenFields;
            await baseApiInstance.updateItem(updateRequest, updateResponse);

            const updateOneBySpy: jest.SpyInstance = jest.spyOn(
                baseApiInstance.service,
                'updateOneBy'
            );
            expect(updateOneBySpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: { name: 'updatedName' },
                })
            );
        });

        it('should convert request param id to ObjectID for query', async () => {
            await baseApiInstance.updateItem(updateRequest, updateResponse);
            const updateOneBySpy: jest.SpyInstance = jest.spyOn(
                baseApiInstance.service,
                'updateOneBy'
            );
            expect(updateOneBySpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    query: { _id: 'update-me' },
                })
            );
        });

        it('should call the updateOneBy method of the service with correct parameters', async () => {
            await baseApiInstance.updateItem(updateRequest, updateResponse);
            const updateOneBySpy: jest.SpyInstance = jest.spyOn(
                baseApiInstance.service,
                'updateOneBy'
            );
            expect(updateOneBySpy).toHaveBeenCalledWith({
                query: { _id: 'update-me' },
                data: { name: 'updatedName' },
                props: emptyProps,
            });
        });

        it('should send empty response on success', async () => {
            await baseApiInstance.updateItem(updateRequest, updateResponse);
            const sendEmptyResponseSpy: jest.SpyInstance = jest.spyOn(
                Response as any,
                'sendEmptyResponse'
            );
            expect(sendEmptyResponseSpy).toHaveBeenCalledWith(
                updateRequest,
                updateResponse
            );
        });
    });

    describe('createItem', () => {
        let createRequest: OneUptimeRequest;
        let createResponse: ExpressResponse;
        let savedItem: BaseModel;

        beforeEach(() => {
            createRequest = {
                body: {
                    data: { version: '1' },
                    miscDataProps: { additional: 'info' },
                },
                headers: {},
            } as unknown as OneUptimeRequest;

            createResponse = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis(),
                send: jest.fn().mockReturnThis(),
            } as unknown as ExpressResponse;

            savedItem = new BaseModel();
        });

        it('should call onBeforeCreate lifecycle method', async () => {
            const onBeforeCreateSpy: jest.SpyInstance = jest.spyOn(
                baseApiInstance as any,
                'onBeforeCreate'
            );
            await baseApiInstance.createItem(createRequest, createResponse);
            expect(onBeforeCreateSpy).toHaveBeenCalledWith(
                createRequest,
                createResponse
            );
        });

        it('should return EntityResponse with the saved item', async () => {
            jest.spyOn(baseApiInstance.service, 'create').mockResolvedValue(
                savedItem
            );
            await baseApiInstance.createItem(createRequest, createResponse);
            const sendEntityResponseSpy: jest.SpyInstance = jest.spyOn(
                Response as any,
                'sendEntityResponse'
            );
            expect(sendEntityResponseSpy).toHaveBeenCalledWith(
                createRequest,
                createResponse,
                savedItem,
                BaseModel
            );
        });
    });

    describe('getRouter', () => {
        it('should return an ExpressRouter instance', () => {
            const router: ExpressRouter = baseApiInstance.getRouter();
            expect(router).toBeDefined();
        });
    });

    describe('getEntityName', () => {
        it('should return the name of the entity', () => {
            const entityName: String = baseApiInstance.getEntityName();
            expect(entityName).toBe('mockConstructor');
        });
    });
});
