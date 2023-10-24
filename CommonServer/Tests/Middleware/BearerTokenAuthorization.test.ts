import BearerTokenAuthorization from '../../Middleware/BearerTokenAuthorization';
import { OneUptimeRequest, ExpressResponse } from '../../Utils/Express';
import ObjectID from 'Common/Types/ObjectID';
import JSONWebToken from '../../Utils/JsonWebToken';
import { JSONObject } from 'Common/Types/JSON';

describe('BearerTokenAuthorization', () => {
    describe('isAuthorizedBearerToken', () => {
        it('adds decoded token data to request', () => {
            const jsonObj: JSONObject = { test: 'test' };
            const req: OneUptimeRequest = {
                id: ObjectID.generate(),
                headers: {
                    authorization: `Bearer ${JSONWebToken.signJsonPayload(
                        jsonObj,
                        5
                    )}`,
                },
            } as OneUptimeRequest;
            const res: ExpressResponse = {} as ExpressResponse;
            const next: jest.Mock = jest.fn();
            void BearerTokenAuthorization.isAuthorizedBearerToken(
                req,
                res,
                next
            );
            const jsonObjResult: JSONObject = req.bearerTokenData as JSONObject;
            expect(jsonObjResult['test']).toMatchInlineSnapshot(`"test"`);
        });
        it('calls next without arguments if token is valid', () => {
            const jsonObj: JSONObject = { test: 'test' };
            const req: OneUptimeRequest = {
                id: ObjectID.generate(),
                headers: {
                    authorization: `Bearer ${JSONWebToken.signJsonPayload(
                        jsonObj,
                        5
                    )}`,
                },
            } as OneUptimeRequest;
            const res: ExpressResponse = {} as ExpressResponse;
            const next: jest.Mock = jest.fn();
            void BearerTokenAuthorization.isAuthorizedBearerToken(
                req,
                res,
                next
            );
            expect(next.mock.calls[0][0]).toMatchInlineSnapshot(`undefined`);
        });
        it('calls next with exception if token is empty', () => {
            const req: OneUptimeRequest = {
                id: ObjectID.generate(),
                headers: {
                    authorization: '',
                },
            } as OneUptimeRequest;
            const res: ExpressResponse = {} as ExpressResponse;
            const next: jest.Mock = jest.fn();
            void BearerTokenAuthorization.isAuthorizedBearerToken(
                req,
                res,
                next
            );
            expect(next.mock.calls[0][0]).toMatchInlineSnapshot(
                `[Error: Invalid bearer token, or bearer token not provided.]`
            );
        });
        it('calls next with exception if token is invalid', () => {
            const req: OneUptimeRequest = {
                id: ObjectID.generate(),
                headers: {
                    authorization: 'Bearer ',
                },
            } as OneUptimeRequest;
            const res: ExpressResponse = {} as ExpressResponse;
            const next: jest.Mock = jest.fn();
            void BearerTokenAuthorization.isAuthorizedBearerToken(
                req,
                res,
                next
            );
            expect(next.mock.calls[0][0]).toMatchInlineSnapshot(
                `[Error: Invalid bearer token, or bearer token not provided.]`
            );
        });
        it('calls next with exception if token header is not present', () => {
            const req: OneUptimeRequest = {
                id: ObjectID.generate(),
            } as OneUptimeRequest;
            const res: ExpressResponse = {} as ExpressResponse;
            const next: jest.Mock = jest.fn();
            void BearerTokenAuthorization.isAuthorizedBearerToken(
                req,
                res,
                next
            );
            expect(next.mock.calls[0][0]).toMatchInlineSnapshot(
                `[Error: Invalid bearer token, or bearer token not provided.]`
            );
        });
    });
});
