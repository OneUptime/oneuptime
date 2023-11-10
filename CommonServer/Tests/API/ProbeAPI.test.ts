import ProbeService from '../../Services/ProbeService';
import Probe from 'Model/Models/Probe';
import Response from '../../Utils/Response';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../../Utils/Express';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import { mockRouter } from './Helpers';
import Ingestor from '../../API/ProbeAPI';
import PositiveNumber from 'Common/Types/PositiveNumber';

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

jest.mock('../../Services/ProbeService');

describe('Ingestor', () => {
    let mockRequest: ExpressRequest;
    let mockResponse: ExpressResponse;
    let nextFunction: NextFunction;

    beforeEach(() => {
        new Ingestor();
        mockRequest = {} as ExpressRequest;
        mockResponse = {
            send: jest.fn(),
            json: jest.fn(),
            status: jest.fn().mockReturnThis(),
        } as unknown as ExpressResponse;
        nextFunction = jest.fn();
    });

    it('should correctly handle global probes request', async () => {
        // eslint-disable-next-line @typescript-eslint/typedef
        const mockProbes = [{ id: 'probe' }];
        ProbeService.findBy = jest.fn().mockResolvedValue(mockProbes);
        await mockRouter
            .match('post', '/probe/global-probes')
            .handlerFunction(mockRequest, mockResponse, nextFunction);

        expect(ProbeService.findBy).toHaveBeenCalledWith({
            query: {
                isGlobalProbe: true,
            },
            select: {
                name: true,
                description: true,
                lastAlive: true,
                iconFileId: true,
            },
            props: {
                isRoot: true,
            },
            skip: 0,
            limit: LIMIT_MAX,
        });

        const response: jest.SpyInstance = jest.spyOn(
            Response,
            'sendEntityArrayResponse'
        );
        expect(response).toHaveBeenCalledWith(
            mockRequest,
            mockResponse,
            mockProbes,
            expect.any(PositiveNumber),
            Probe
        );
    });

    it('should call next with an error if findBy throws', async () => {
        const testError: Error = new Error('Test error');
        ProbeService.findBy = jest.fn().mockRejectedValue(testError);
        await mockRouter
            .match('post', '/probe/global-probes')
            .handlerFunction(mockRequest, mockResponse, nextFunction);
        expect(nextFunction).toHaveBeenCalledWith(testError);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });
});
