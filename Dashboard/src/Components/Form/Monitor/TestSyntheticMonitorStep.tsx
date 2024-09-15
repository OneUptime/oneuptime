import BrowserType from 'Common/Types/BrowserType';
import SyntheticMonitorResponse from 'Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse';
import ScreenSizeType from 'Common/Types/ScreenSizeType';
import Button from 'Common/UI/Components/Button/Button';
import React, { FunctionComponent, ReactElement, useCallback, useReducer } from "react";
import SyntheticMonitorItemView from '../../Monitor/SummaryView/SyntheticMonitorItemView';
import API from 'Common/Utils/API';
import { APP_API_URL } from 'Common/UI/Config';
import ModelAPI from 'Common/UI/Utils/ModelAPI/ModelAPI';
import URL from "Common/Types/API/URL";
import OneUptimeDate from 'Common/Types/Date';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import CompactLoader from 'Common/UI/Components/ComponentLoader/CompactLoader';
import ErrorMessage from 'Common/UI/Components/ErrorMessage/ErrorMessage';

type ComponentProps = {
  monitorId: string;
  script: string;
  screenSizeTypes?: Array<ScreenSizeType> | undefined;
  browserTypes?: Array<BrowserType> | undefined;
}

type Data = {
  syntheticMonitorResponses: SyntheticMonitorResponse[],
  testedAt: Date,
}

type ComponentState = {
  data: Data | null,
  error: Error | null,
  isLoading: boolean,
}

type ComponentAction = {
  type: 'success',
  data: Data,
} | {
  type: 'failure',
  error: Error,
} | {
  type: 'loading',
  
} 

function reducer(state: ComponentState, action: ComponentAction): ComponentState {
  switch (action.type) {
    case 'success':
      return {
        ...state, error: null, isLoading: false, data: action.data
      }
    case 'failure':
      return {
        ...state, data: null, isLoading: false, error: action.error
      }
    case 'loading':
      return {
        ...state, data: null, error: null, isLoading: true
      }
    default:
      throw new Error('Unhandled action')
  }
}

const TestSyntheticMonitorStep: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {
  const [{ data, error, isLoading }, dispatch] = useReducer(reducer, {
    data: null,
    error: null,
    isLoading: false,
  })
  const handleClick = useCallback(async () => {
    dispatch({
      type: 'loading'
    })
    try {
      const testedAt = OneUptimeDate.getCurrentDate()
      const response: HTTPResponse<Array<SyntheticMonitorResponse>> | HTTPErrorResponse = await API.post<Array<SyntheticMonitorResponse>>(
        URL.fromString(APP_API_URL.toString()).addRoute(
          `/testmonitor/synthetic/${props.monitorId}`,
        ),
        {
          script: props.script,
          browserTypes: props.browserTypes,
          screenSizeTypes: props.screenSizeTypes,
        },
        {
          ...ModelAPI.getCommonHeaders(),
        },
      );

      if (response instanceof HTTPErrorResponse) {
        throw response
      }

      dispatch({
        type: 'success',
        data: {
          syntheticMonitorResponses: response.data,
          testedAt: testedAt
        }
      }) 
    } catch (err) {
      if (err instanceof Error) {
        dispatch({ type: 'failure', error: err })
      }
    }
  }, [props.monitorId, props.script, props.browserTypes, props.screenSizeTypes])
  
  if (isLoading) return <CompactLoader />
  if (error) return <ErrorMessage error={error.message} />  
  return (<>
    <Button title='Test Monitor' onClick={handleClick} />
    {data &&
      <div>
        {data.syntheticMonitorResponses.map((x, i) => <SyntheticMonitorItemView
          key={i}
          syntheticMonitorResponse={x}
          monitoredAt={data.testedAt} />)}
      </div>}
  </>)
}

export default TestSyntheticMonitorStep;