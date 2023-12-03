import Project from 'Model/Models/Project';
import TeamMember from 'Model/Models/TeamMember';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import NotAuthenticatedException from 'Common/Types/Exception/NotAuthenticatedException';
import PositiveNumber from 'Common/Types/PositiveNumber';
import JSONWebTokenData from 'Common/Types/JsonWebTokenData';
import ObjectID from 'Common/Types/ObjectID';
import TeamMemberService from '../../Services/TeamMemberService';
import { mockRouter } from './Helpers';
import {
    OneUptimeResponse,
    OneUptimeRequest,
    NextFunction,
} from '../../Utils/Express';
import Response from '../../Utils/Response';
import ProjectAPI from '../../API/ProjectAPI';

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

jest.mock('../../Services/TeamMemberService');
jest.mock('../../Services/ProjectService');

describe('ProjectAPI', () => {
    let mockRequest: OneUptimeRequest;
    let mockResponse: OneUptimeResponse;
    let nextFunction: NextFunction;

    beforeEach(() => {
        new ProjectAPI();
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

    describe('POST /project/list-user-projects', () => {
        it('should respond with a empty list', async () => {
            const mockUserId: ObjectID = new ObjectID('123');
            mockRequest.userAuthorization = {
                userId: mockUserId,
            } as JSONWebTokenData;

            const mockTeamMembers: Array<TeamMember> = [
                {
                    userId: mockUserId,
                    hasAcceptedInvitation: true,
                } as TeamMember,
            ];

            const projects: Array<Project> = [];

            TeamMemberService.findBy = jest
                .fn()
                .mockResolvedValue(mockTeamMembers);

            await mockRouter
                .match('post', '/project/list-user-projects')
                .handlerFunction(mockRequest, mockResponse, nextFunction);

            expect(TeamMemberService.findBy).toHaveBeenCalledWith({
                query: {
                    userId: mockUserId,
                    hasAcceptedInvitation: true,
                },
                select: {
                    project: {
                        _id: true,
                        name: true,
                        trialEndsAt: true,
                        paymentProviderPlanId: true,
                        resellerId: true,
                        isFeatureFlagMonitorGroupsEnabled: true,
                        paymentProviderMeteredSubscriptionStatus: true,
                        paymentProviderSubscriptionStatus: true,
                    },
                },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                props: {
                    isRoot: true,
                },
            });

            const response: jest.SpyInstance = jest.spyOn(
                Response,
                'sendEntityArrayResponse'
            );
            expect(response).toHaveBeenCalledWith(
                mockRequest,
                mockResponse,
                projects,
                new PositiveNumber(projects.length),
                Project
            );
        });

        it('should respond with a list of projects by project', async () => {
            const mockUserId: ObjectID = new ObjectID('123');
            mockRequest.userAuthorization = {
                userId: mockUserId,
            } as JSONWebTokenData;

            const mockTeamMembers: Array<TeamMember> = [
                {
                    userId: mockUserId,
                    hasAcceptedInvitation: true,
                    project: {
                        _id: 'project1',
                        name: 'Project 1',
                        slug: 'Project 1',
                    },
                } as TeamMember,
                {
                    userId: mockUserId,
                    hasAcceptedInvitation: true,
                    project: {
                        _id: 'project2',
                        name: 'Project 2',
                        slug: 'Project 2',
                    },
                } as TeamMember,
            ];

            const projects: Array<Project> = [
                {
                    _id: 'project1',
                    name: 'Project 1',
                    slug: 'Project 1',
                } as Project,
                {
                    _id: 'project2',
                    name: 'Project 2',
                    slug: 'Project 2',
                } as Project,
            ];

            TeamMemberService.findBy = jest
                .fn()
                .mockResolvedValue(mockTeamMembers);

            await mockRouter
                .match('post', '/project/list-user-projects')
                .handlerFunction(mockRequest, mockResponse, nextFunction);

            expect(TeamMemberService.findBy).toHaveBeenCalledWith({
                query: {
                    userId: mockUserId,
                    hasAcceptedInvitation: true,
                },
                select: {
                    project: {
                        _id: true,
                        name: true,
                        trialEndsAt: true,
                        paymentProviderPlanId: true,
                        resellerId: true,
                        isFeatureFlagMonitorGroupsEnabled: true,
                        paymentProviderMeteredSubscriptionStatus: true,
                        paymentProviderSubscriptionStatus: true,
                    },
                },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                props: {
                    isRoot: true,
                },
            });

            const response: jest.SpyInstance = jest.spyOn(
                Response,
                'sendEntityArrayResponse'
            );
            expect(response).toHaveBeenCalledWith(
                mockRequest,
                mockResponse,
                projects,
                new PositiveNumber(projects.length),
                Project
            );
        });

        it('should handle authentication error', async () => {
            const authError: NotAuthenticatedException =
                new NotAuthenticatedException(
                    'User should be logged in to access this API'
                );
            await mockRouter
                .match('post', '/project/list-user-projects')
                .handlerFunction(mockRequest, mockResponse, nextFunction);

            expect(nextFunction).toHaveBeenCalledWith(authError);
        });
    });
});
