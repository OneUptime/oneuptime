import axiosMock from '../axios_mock';
import { API_URL } from '../../config';
import * as _actions from '../../actions/register';
import * as _types from '../../constants/register';

const actions = { ..._actions, ..._types };

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

describe('actions', () => {
    it('should create an action of type SIGNUP_FAILED', () => {
        const expectedAction = {
            type: actions.SIGNUP_FAILED,
            payload: 'error that occurred',
        };
        const action = actions.signupError('error that occurred');
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(expectedAction.payload);
    });
});

describe('actions', () => {
    it('should create an action of type SAVE_USER_STATE with values in payload', () => {
        const expectedAction = {
            type: actions.SAVE_USER_STATE,
            payload: 'values',
        };
        const action = actions.saveUserState('values');
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(expectedAction.payload);
    });
});

describe('actions', () => {
    it('should create an action of type SAVE_CARD_STATE with values in payload', () => {
        const expectedAction = {
            type: actions.SAVE_COMPANY_STATE,
            payload: 'values',
        };
        const action = actions.saveCompanyState('values');
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(expectedAction.payload);
    });
});

describe('actions', () => {
    it('should create an action of type SAVE_COMPANY_STATE with values in payload', () => {
        const expectedAction = {
            type: actions.SAVE_CARD_STATE,
            payload: 'values',
        };
        const action = actions.saveCardState('values');
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(expectedAction.payload);
    });
});
describe('actions', () => {
    it('should create an action of type SIGNUP_REQUEST, promise in payload', () => {
        const promise = Promise.resolve('incident request response');
        const action = actions.signUpRequest(promise);

        expect(action.type).toEqual(actions.SIGNUP_REQUEST);
        return action.payload.then(o => {
            expect(o).toEqual('incident request response');
        });
    });
});
describe('actions', () => {
    it('should create an action of type RESET_SIGNUP', () => {
        const action = actions.signUpReset();

        expect(action.type).toEqual(actions.RESET_SIGNUP);
    });
});
describe('actions', () => {
    it('should create an action of type RESET_SIGNUP', () => {
        const action = actions.resetSignup();

        expect(action.type).toEqual(actions.RESET_SIGNUP);
    });
});

describe('actions', () => {
    it('should despatch LOGIN_SUCCESS', () => {
        const dispatch = dispatched => {
            expect(dispatched.type).toEqual('auth/LOGIN_SUCCESS');
        };
        actions.signupSuccess(user)(dispatch);
    });
});

describe('actions', () => {
    it('should create an action of type RESET_SIGNUP', () => {
        const action = actions.resetSignup();

        expect(action.type).toEqual(actions.RESET_SIGNUP);
    });
});

describe('actions', () => {
    it('should despatch SIGNUP_FAILED with 404', () => {
        const dispatch = dispatched => {
            switch (dispatched.type) {
                case actions.SIGNUP_REQUEST:
                    expect(dispatched.type).toEqual(actions.SIGNUP_REQUEST);
                    break;
                case actions.SIGNUP_SUCCESS:
                    expect(dispatched.type).toEqual(actions.SIGNUP_SUCCESS);
                    expect(dispatched.payload).toEqual([]);
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.SIGNUP_FAILED);
                    expect(dispatched.payload).toEqual(
                        Error('Request failed with status code 404')
                    );
                    break;
            }
        };
        actions.signupUser({})(dispatch);
    });
});

describe('actions', () => {
    it('should despatch SIGNUP_FAILED with 404', () => {
        axiosMock.onPost(`${API_URL}/user/signup`).reply(200, user, {});

        const dispatch = dispatched => {
            if (!dispatched) {
                return;
            }
            switch (dispatched.type) {
                case actions.SIGNUP_REQUEST:
                    expect(dispatched.type).toEqual(actions.SIGNUP_REQUEST);
                    break;
                case actions.SIGNUP_SUCCESS:
                    expect(dispatched.type).toEqual(actions.SIGNUP_SUCCESS);
                    expect(dispatched.payload).toEqual(user);
                    break;
                case actions.RESET_SIGNUP:
                    expect(dispatched.type).toEqual(actions.RESET_SIGNUP);
                    break;
                case 'auth/LOGIN_SUCCESS':
                    expect(dispatched.type).toEqual('auth/LOGIN_SUCCESS');
                    expect(dispatched.payload).toEqual(user);
                    break;
                default:
                    expect(dispatched.type).toEqual(actions.SIGNUP_FAILED);
                    expect(dispatched.payload).toEqual('fail test');
                    break;
            }
        };
        actions.signupUser({})(dispatch);
    });
});

describe('actions', () => {
    it('should create an action of type SIGNUP_STEP_INC', () => {
        const action = actions.incrementStep();

        expect(action.type).toEqual(actions.SIGNUP_STEP_INC);
    });
});

describe('actions', () => {
    it('should return an action of type SKIP_CARD_STEP', () => {
        expect(actions.SKIP_CARD_STEP).toEqual('register/SKIP_CARD_STEP');
    });
});

describe('actions', () => {
    it('should create an action of type SKIP_CARD_STEP', () => {
        const action = actions.skipCardStep();

        expect(action.type).toEqual(actions.SKIP_CARD_STEP);
    });
});

describe('actions', () => {
    it('should create an action of type SIGNUP_STEP_DEC', () => {
        const action = actions.decrementStep();

        expect(action.type).toEqual(actions.SIGNUP_STEP_DEC);
    });
});

// Is User Invited Actions

describe('actions', () => {
    it('should create an action of type IS_USER_INVITED_REQUEST, promise in payload', () => {
        const promise = Promise.resolve('request response');
        const action = actions.isUserInvitedRequest(promise);

        expect(action.type).toEqual(actions.IS_USER_INVITED_REQUEST);
        return action.payload.then(o => {
            expect(o).toEqual('request response');
        });
    });
});

describe('actions', () => {
    it('should create an action of type IS_USER_INVITED_SUCCESS', () => {
        const expectedAction = {
            type: actions.IS_USER_INVITED_SUCCESS,
        };
        expect(actions.isUserInvitedSuccess().type).toEqual(
            expectedAction.type
        );
    });
});
describe('actions', () => {
    it('should create an action of type IS_USER_INVITED_RESET', () => {
        const expectedAction = {
            type: actions.IS_USER_INVITED_RESET,
        };
        expect(actions.isUserInvitedReset().type).toEqual(expectedAction.type);
    });
});
describe('actions', () => {
    it('should create an action of type IS_USER_INVITED_RESET', () => {
        const expectedAction = {
            type: actions.IS_USER_INVITED_RESET,
        };
        expect(actions.resetIsUserInvited().type).toEqual(expectedAction.type);
    });
});

// Todo Test for isUserInvitedSuccess

describe('actions', () => {
    it('should despatch SIGNUP_FAILED with 404', () => {
        const dispatch = dispatched => {
            switch (dispatched.type) {
                case actions.IS_USER_INVITED_REQUEST:
                    expect(dispatched.type).toEqual(
                        actions.IS_USER_INVITED_REQUEST
                    );
                    break;
                case actions.IS_USER_INVITED_RESET:
                    expect(dispatched.type).toEqual(
                        actions.IS_USER_INVITED_RESET
                    );
                    expect(dispatched.payload).toEqual(
                        Error('Request failed with status code 404')
                    );
                    break;
                default:
                    expect(dispatched.type).toEqual(
                        actions.IS_USER_INVITED_REQUEST
                    );
                    break;
            }
        };
        actions.isUserInvited({})(dispatch);
    });
});

describe('actions', () => {
    it('should despatch SIGNUP_FAILED with 404', () => {
        axiosMock.onPost(`${API_URL}/user/isInvited`).reply(200, user, {});

        const dispatch = dispatched => {
            switch (dispatched.type) {
                case actions.IS_USER_INVITED_REQUEST:
                    expect(dispatched.type).toEqual(
                        actions.IS_USER_INVITED_REQUEST
                    );
                    break;
                case actions.IS_USER_INVITED_RESET:
                    expect(dispatched.type).toEqual(
                        actions.IS_USER_INVITED_RESET
                    );
                    expect(dispatched.payload).toEqual(
                        Error('Request failed with status code 404')
                    );
                    break;
                case actions.IS_USER_INVITED_SUCCESS:
                    expect(dispatched.type).toEqual(
                        actions.IS_USER_INVITED_SUCCESS
                    );
                    expect(dispatched.payload).toEqual(user);
                    break;
                default:
                    expect(dispatched.type).toEqual(
                        actions.IS_USER_INVITED_REQUEST
                    );
                    break;
            }
        };
        actions.isUserInvited({})(dispatch);
    });
});

// Todo Test for isUserInvitedSuccess with api mock
