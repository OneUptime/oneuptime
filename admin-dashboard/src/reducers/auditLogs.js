import {
  FETCH_AUDITLOGS_REQUEST,
  FETCH_AUDITLOGS_SUCCESS,
  FETCH_AUDITLOGS_FAILURE,
  SEARCH_AUDITLOGS_REQUEST,
  SEARCH_AUDITLOGS_SUCCESS,
  SEARCH_AUDITLOGS_FAILURE
} from '../constants/auditLogs';

const INITIAL_STATE = {
  auditLogs: {
    error: null,
    requesting: false,
    success: false,
    auditLogs: [],
    count: null,
    limit: null,
    skip: null
  },
  searchAuditLogs: {
    requesting: false,
    error: null,
    success: false
  }
};

export default function project(state = INITIAL_STATE, action) {
  switch (action.type) {
    // Fetch auditLogs list
    case FETCH_AUDITLOGS_REQUEST:
      return Object.assign({}, state, {
        auditLogs: {
          requesting: true,
          error: null,
          success: false
        }
      });

    case FETCH_AUDITLOGS_SUCCESS:
      return Object.assign({}, state, {
        auditLogs: {
          requesting: false,
          error: null,
          success: true,
          auditLogs: action.payload.data,
          count: action.payload.count,
          limit: action.payload.limit,
          skip: action.payload.skip
        }
      });

    case FETCH_AUDITLOGS_FAILURE:
      return Object.assign({}, state, {
        auditLogs: {
          requesting: false,
          error: action.payload,
          success: false
        }
      });

    // Search AuditLog list.
    case SEARCH_AUDITLOGS_REQUEST:
      return Object.assign({}, state, {
        searchAuditLogs: {
          requesting: true,
          error: null,
          success: false
        }
      });

    case SEARCH_AUDITLOGS_SUCCESS:
      return Object.assign({}, state, {
        auditLogs: {
          requesting: false,
          error: null,
          success: true,
          auditLogs: action.payload.data,
          count: action.payload.count,
          limit: action.payload.limit,
          skip: action.payload.skip
        },
        searchAuditLogs: {
          requesting: false,
          error: null,
          success: true
        }
      });

    case SEARCH_AUDITLOGS_FAILURE:
      return Object.assign({}, state, {
        searchAuditLogs: {
          requesting: false,
          error: action.payload,
          success: false
        }
      });

    default:
      return state;
  }
}
