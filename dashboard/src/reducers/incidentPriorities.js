import {
  FETCH_INCIDENT_PRIORITIES_REQUEST,
  FETCH_INCIDENT_PRIORITIES_SUCCESS,
  FETCH_INCIDENT_PRIORITIES_FAILURE,
  FETCH_INCIDENT_PRIORITIES_RESET,
  CREATE_INCIDENT_PRIORITY_REQUEST,
  CREATE_INCIDENT_PRIORITY_SUCCESS,
  CREATE_INCIDENT_PRIORITY_FAILURE,
  CREATE_INCIDENT_PRIORITY_RESET,
} from '../constants/incidentPriorities';

const INITIAL_STATE = {
  incidentPrioritiesList: {
    error: null,
    requesting: false,
    success: false,
    incidentPriorities: [],
    count: null,
    limit: null,
    skip: null,
  },
  newIncidentPriority: {
    error: null,
    requesting: false,
    success: false,
  }
}

export default (state = INITIAL_STATE, action) => {
  let incidentPriorities,count;
  switch (action.type) {
    case FETCH_INCIDENT_PRIORITIES_SUCCESS:
      return Object.assign({}, state, {
        incidentPrioritiesList:
        {
          ...state.incidentPrioritiesList,
          error: null,
          success: true,
          requesting: false,
          incidentPriorities: action.payload.data,
          skip: action.payload.skip,
          limit: action.payload.limit,
          count: action.payload.count
        }
      });
    case FETCH_INCIDENT_PRIORITIES_REQUEST:
      return Object.assign({}, state, {
        incidentPrioritiesList:
        {
          ...state.incidentPrioritiesList,
          requesting: true,
          error: null,
          success: false
        }
      });
    case FETCH_INCIDENT_PRIORITIES_FAILURE:
      return Object.assign({}, state, {
        incidentPrioritiesList:
        {
          ...state.incidentPrioritiesList,
          requesting: false,
          success: false,
          error: action.payload,
        }
      });
    case FETCH_INCIDENT_PRIORITIES_RESET:
      return Object.assign({}, state, {
        incidentPrioritiesList:
        {
          ...INITIAL_STATE.incidentPrioritiesList
        }
      });

    case CREATE_INCIDENT_PRIORITY_REQUEST:
      return Object.assign({}, state, {
        newIncidentPriority: {
          ...state.newIncidentPriority,
          error: null,
          requesting: true,
          success: false,
        }
      });
    case CREATE_INCIDENT_PRIORITY_SUCCESS:
      incidentPriorities=Object.assign([],state.incidentPrioritiesList.incidentPriorities);
      incidentPriorities.push(action.payload);
      count = state.incidentPrioritiesList.count+1;
      return Object.assign({}, state, {
        incidentPrioritiesList:{
          ...state.incidentPrioritiesList,
          incidentPriorities,
          count,
        },
        newIncidentPriority: {
          ...state.newIncidentPriority,
          error: null,
          requesting: false,
          success: true,
        }
      });
    case CREATE_INCIDENT_PRIORITY_FAILURE:
      return Object.assign({}, state, {
        newIncidentPriority: {
          ...state.newIncidentPriority,
          error: action.payload,
          requesting: false,
          success: false,
        }
      });
    case CREATE_INCIDENT_PRIORITY_RESET:
      return Object.assign({}, state, {
        newIncidentPriority: {
          ...state.newIncidentPriority,
          error: null,
          requesting: false,
          success: false,
        }
      });
    default:
      return state;
  }
}