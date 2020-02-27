import * as _actions from '../../actions/login';
import * as _types from '../../constants/login';
import axiosMock from '../axios_mock';
import { API_URL } from '../../config';

/*
  Test for logins actions.
*/
const actions = { ..._actions, ..._types };
describe('actions', () => {
    it('should create an action of type LOGIN_REQUEST, promise in payload', () => {
        const promise = Promise.resolve('login request response');
        const action = actions.loginRequest(promise);

        expect(action.type).toEqual(actions.LOGIN_REQUEST);
        return action.payload.then(o => {
            expect(o).toEqual('login request response');
        });
    });
});

describe('actions', () => {
    it('should create an action of type LOGIN_FAILED, error in payload', () => {
        const expectedAction = {
            type: actions.LOGIN_FAILED,
            payload: 'error that occurred',
        };
        const action = actions.loginError('error that occurred');
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(expectedAction.payload);
    });
});

describe('actions', () => {
    it('should create an action of type LOGIN_SUCCESS, user in payload', () => {
        const user = {
            _id: '5b1c0c29cb06cc23b132db07',
            onCallAlert: ['sms', 'call', 'email'],
            tokens: {
                jwtAccessToken: '1234567890abcdefghijklmnopqrstuvwxyz',
            },
            createdAt: '2018-06-09T17:19:37.071Z',
            lastActive: '2018-07-05T19:15:35.321Z',
            name: 'Danstan Onyango',
            email: 'danstan.otieno@gmail.com',
            companyName: 'Zemuldo',
            companyRole: 'Geek',
            referral: 'Am with u',
            companyPhoneNumber: '+254728554638',
            coupon: null,
            jwtRefreshToken: '1234567890abcdefghijklmnopqrstuvwxyz',
            stripeCustomerId: 'cus_D1D9mLILlq66ev',
            __v: 0,
            profilePic: '1ddaf17a9c1a532865ff41f293117226.png',
            timezone: 'Alaska (GMT -09:00)',
            resetPasswordExpires: '1529658748197',
            resetPasswordToken: '3809e41fea639b365f81542cabb88495c9586087',
        };
        const expectedAction = {
            type: actions.LOGIN_SUCCESS,
            payload: user,
        };
        const action = actions.loginSuccess(user);
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(expectedAction.payload);
    });
});

describe('actions', () => {
    it('should create an action of type RESET_LOGIN', () => {
        const expectedAction = {
            type: actions.RESET_LOGIN,
        };
        expect(actions.resetLogin().type).toEqual(expectedAction.type);
    });
});

describe('actions', () => {
    it('should despatch LOGIN_REQUEST and INTERNAL_NOTE_SUCCESS  actions', () => {
        const user = {
            _id: 'test',
            username: 'test',
            email: 'test',
            tokens: {
                jwtAccessToken: 'test token',
            },
        };
        axiosMock.onPost(`${API_URL}/user/login`).reply(200, user, {});

        const dispatch = dispatched => {
            switch (dispatched.type) {
                case actions.LOGIN_REQUEST:
                    expect(dispatched.type).toEqual(actions.LOGIN_REQUEST);
                    break;
                case actions.LOGIN_SUCCESS:
                    expect(dispatched.type).toEqual(actions.LOGIN_SUCCESS);
                    expect(dispatched.payload).toEqual(user);
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.LOGIN_FAILED);
                    expect(dispatched.payload).toEqual('fail test');
            }
        };
        actions.loginUser({ username: 'test', password: '' })(dispatch);
    });
});
