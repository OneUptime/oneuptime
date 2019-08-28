import {
    ADD_PROJECT_NOTE_FAILURE,
    ADD_PROJECT_NOTE_REQUEST,
    ADD_PROJECT_NOTE_RESET,
    ADD_PROJECT_NOTE_SUCCESS,
} from '../constants/adminNote';

const INITIAL_STATE = {
    projectNotes: {
        error: null,
        requesting: false,
        success: false,
        projectNotes: [],
    },
    newProjectNote: {
        error: null,
        requesting: false,
        success: false
    }
};

export default function adminNote(state = INITIAL_STATE, action) {

    switch (action.type) {
        // add project admin notes
        case ADD_PROJECT_NOTE_REQUEST:

            return Object.assign({}, state, {
                newProjectNote: {
                    requesting: true,
                    error: null,
                    success: false,
                },

            });

        case ADD_PROJECT_NOTE_SUCCESS:
            return Object.assign({}, state, {
                projectNotes: {
                    requesting: false,
                    error: null,
                    success: true,
                    projectNotes: action.payload.data
                },
                newProjectNote:{
                    requesting: false,
                    error: null,
                    success: true
                }
            });

        case ADD_PROJECT_NOTE_FAILURE:

            return Object.assign({}, state, {
                newProjectNote: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case ADD_PROJECT_NOTE_RESET:

            return Object.assign({}, state, {
                ...INITIAL_STATE
            });

        default: return state;
    }
}