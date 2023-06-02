import Dictionary from 'Common/Types/Dictionary';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { ClusterKey as ONEUPTIME_SECRET } from '../../Config';
import ClusterKeyAuthorization from '../../Middleware/ClusterKeyAuthorization';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../../Utils/Express';
import Response from '../../Utils/Response';

describe('ClusterKeyAuthorization', () => {
    describe('getClusterKeyHeaders', () => {
        test('should return cluster key headers', () => {
            const mockedResult: Dictionary<string> = {
                clusterkey: ONEUPTIME_SECRET.toString(),
            };

            const result: Dictionary<string> =
                ClusterKeyAuthorization.getClusterKeyHeaders();

            expect(result).toStrictEqual(mockedResult);
        });
    });

    describe('isAuthorizedServiceMiddleware', () => {
        const clusterKey: string = ONEUPTIME_SECRET.toString();

        const mockedValidRequestFields: string[] = [
            'params',
            'query',
            'headers',
            'body',
        ];
        const res: ExpressResponse = {} as ExpressResponse;
        const next: NextFunction = jest.fn();

        describe("should call function 'next' when valid clusterKey is passed as request's", () => {
            test.each(mockedValidRequestFields)('%s', async (field: string) => {
                const data: Dictionary<string> = {
                    [field === 'headers' ? 'clusterkey' : 'clusterKey']:
                        clusterKey,
                };

                const req: Partial<ExpressRequest> = { [field]: data };

                await ClusterKeyAuthorization.isAuthorizedServiceMiddleware(
                    req as ExpressRequest,
                    res,
                    next
                );

                expect(next).toBeCalled();
            });
        });

        test('should call Response.sendErrorResponse when clusterKey is not passed', async () => {
            const req: ExpressRequest = {} as ExpressRequest;

            const spySendErrorResponse: jest.SpyInstance = jest
                .spyOn(Response, 'sendErrorResponse')
                .mockImplementation(jest.fn());

            await ClusterKeyAuthorization.isAuthorizedServiceMiddleware(
                req,
                res,
                next
            );

            expect(spySendErrorResponse).toHaveBeenCalledWith(
                req,
                res,
                new BadDataException('Cluster key not found.')
            );
        });

        describe("should call Response.sendErrorResponse when invalid clusterKey is passed as request's", () => {
            test.each(mockedValidRequestFields)('%s', async (field: string) => {
                const data: Dictionary<string> = {
                    [field === 'headers' ? 'clusterkey' : 'clusterKey']: 'sec',
                };

                const req: Partial<ExpressRequest> = { [field]: data };

                const spySendErrorResponse: jest.SpyInstance = jest
                    .spyOn(Response, 'sendErrorResponse')
                    .mockImplementation(jest.fn());

                await ClusterKeyAuthorization.isAuthorizedServiceMiddleware(
                    req as ExpressRequest,
                    res,
                    next
                );

                expect(spySendErrorResponse).toHaveBeenCalledWith(
                    req,
                    res,
                    new BadDataException('Invalid cluster key provided')
                );
            });
        });
    });
});
