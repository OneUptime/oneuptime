import reducer from '../../reducers/team';
import * as types from '../../constants/team';

const initialState = {
    teamLoading: {
        error: null,
        requesting: false,
        success: false,
    },
    subProjectTeamLoading: {
        error: null,
        requesting: false,
        success: false,
    },
    teamCreate: {
        error: null,
        requesting: false,
        success: false,
    },
    teamUpdateRole: {
        error: null,
        requesting: false,
        success: false,
        updating: [],
    },
    teamdelete: {
        error: null,
        requesting: false,
        success: false,
        deleting: [],
    },
    teamMembers: [],
    subProjectTeamMembers: [],
    pages: {
        counter: 1,
    },
};

describe('Modal Reducers', () => {
    it('should return initial state', () => {
        expect(reducer(initialState, {})).toEqual(initialState);
    });

    it('should handle TEAM_LOADING_REQUEST', () => {
        const expected = {
            ...initialState,
            teamLoading: {
                error: null,
                requesting: true,
                success: false,
            },
        };

        expect(
            reducer(initialState, { type: types.TEAM_LOADING_REQUEST })
        ).toEqual(expected);
    });

    it('should handle TEAM_LOADING_SUCCESS', () => {
        const payload = [{ _id: '_id' }];
        const expected = {
            ...initialState,
            teamLoading: {
                error: null,
                requesting: false,
                success: true,
            },
            teamMembers: payload,
        };

        expect(
            reducer(initialState, {
                type: types.TEAM_LOADING_SUCCESS,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle TEAM_LOADING_FAILURE', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            teamLoading: {
                error: payload,
                requesting: false,
                success: false,
            },
            teamMembers: [],
        };

        expect(
            reducer(initialState, {
                type: types.TEAM_LOADING_FAILURE,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle TEAM_CREATE_FAILURE', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            teamCreate: {
                error: payload,
                requesting: false,
                success: false,
            },
            teamMembers: [],
        };

        expect(
            reducer(initialState, {
                type: types.TEAM_CREATE_FAILURE,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle TEAM_CREATE_SUCCESS', () => {
        const payload = {
            data: [{ _id: '_id' }],
            subProjectId: 'subProjectId',
            count: 1,
        };
        const currentState = {
            ...initialState,
            subProjectTeamMembers: [
                {
                    teamMembers: [],
                    subProject: { _id: 'subProjectId' },
                    count: 0,
                },
            ],
        };
        const expected = {
            ...initialState,
            teamCreate: {
                error: null,
                requesting: false,
                success: true,
            },
            teamMembers: [],
            subProjectTeamMembers: [
                {
                    teamMembers: [{ _id: '_id' }],
                    subProject: { _id: 'subProjectId' },
                    count: 1,
                },
            ],
        };

        expect(
            reducer(currentState, {
                type: types.TEAM_CREATE_SUCCESS,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle TEAM_CREATE_REQUEST', () => {
        const expected = {
            ...initialState,
            teamCreate: {
                error: null,
                requesting: true,
                success: false,
            },
        };

        expect(
            reducer(initialState, { type: types.TEAM_CREATE_REQUEST })
        ).toEqual(expected);
    });

    it('should handle TEAM_DELETE_REQUEST', () => {
        const payload = { _id: '_id' };
        const expected = {
            ...initialState,
            teamdelete: {
                error: null,
                requesting: true,
                success: false,
                deleting: initialState.teamdelete.deleting.concat([payload]),
            },
        };
        expect(
            reducer(initialState, {
                type: types.TEAM_DELETE_REQUEST,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle TEAM_DELETE_SUCCESS', () => {
        const payload = {
            data: [{ _id: '_id' }],
            subProjectId: 'subProjectId',
            count: 1,
        };
        const currentState = {
            ...initialState,
            subProjectTeamMembers: [
                {
                    teamMembers: [],
                    subProject: { _id: 'subProjectId' },
                    count: 0,
                },
            ],
        };
        const expected = {
            ...initialState,
            teamdelete: {
                error: null,
                requesting: false,
                success: true,
                deleting: [],
            },
            teamMembers: [],
            subProjectTeamMembers: [
                {
                    teamMembers: [{ _id: '_id' }],
                    subProject: { _id: 'subProjectId' },
                    count: 1,
                },
            ],
        };

        expect(
            reducer(currentState, {
                type: types.TEAM_DELETE_SUCCESS,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle TEAM_DELETE_FAILURE', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            teamdelete: {
                error: payload,
                requesting: false,
                success: false,
                deleting: [],
            },
        };

        expect(
            reducer(initialState, {
                type: types.TEAM_DELETE_FAILURE,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle TEAM_UPDATE_ROLE_REQUEST', () => {
        const payload = { _id: '_id' };
        const expected = {
            ...initialState,
            teamUpdateRole: {
                error: null,
                requesting: true,
                success: false,
                updating: [{ _id: '_id' }],
            },
        };
        expect(
            reducer(initialState, {
                type: types.TEAM_UPDATE_ROLE_REQUEST,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle TEAM_UPDATE_ROLE_SUCCESS', () => {
        const currentState = {
            ...initialState,
            subProjectTeamMembers: [
                {
                    teamMembers: [
                        { _id: '_id', userId: '_id', role: 'Administrator' },
                    ],
                    subProject: { _id: 'subProjectId' },
                    count: 1,
                },
            ],
        };
        const payload = {
            data: [{ _id: '_id', userId: '_id', role: 'Member' }],
            subProjectId: 'subProjectId',
            count: 1,
        };
        const expected = {
            ...initialState,
            teamUpdateRole: {
                error: null,
                requesting: false,
                success: true,
                updating: [],
            },
            teamMembers: [],
            subProjectTeamMembers: [
                {
                    teamMembers: [
                        { _id: '_id', userId: '_id', role: 'Member' },
                    ],
                    subProject: { _id: 'subProjectId' },
                    count: 1,
                },
            ],
        };
        expect(
            reducer(currentState, {
                type: types.TEAM_UPDATE_ROLE_SUCCESS,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle TEAM_UPDATE_ROLE_FAILURE', () => {
        const payload = 'some error';
        const expected = {
            ...initialState,
            teamUpdateRole: {
                error: payload,
                requesting: false,
                success: false,
                updating: [],
            },
        };

        expect(
            reducer(initialState, {
                type: types.TEAM_UPDATE_ROLE_FAILURE,
                payload: payload,
            })
        ).toEqual(expected);
    });

    it('should handle PAGINATE_NEXT', () => {
        const expected = {
            ...initialState,
            pages: {
                counter: 2,
            },
        };
        expect(reducer(initialState, { type: types.PAGINATE_NEXT })).toEqual(
            expected
        );
    });

    it('should handle PAGINATE_PREV', () => {
        const expected = {
            ...initialState,
            pages: {
                counter: 0,
            },
        };
        expect(reducer(initialState, { type: types.PAGINATE_PREV })).toEqual(
            expected
        );
    });

    it('should handle PAGINATE_RESET', () => {
        const expected = {
            ...initialState,
            pages: {
                counter: 1,
            },
        };
        expect(reducer(initialState, { type: types.PAGINATE_RESET })).toEqual(
            expected
        );
    });
});
