import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";

export interface SyntheticMonitorExecutionRequest {
  monitorId?: string | undefined;
  screenSizeTypes?: Array<ScreenSizeType> | undefined;
  browserTypes?: Array<BrowserType> | undefined;
  script: string;
  retryCountOnError?: number | undefined;
}

export interface SyntheticMonitorExecutionResponse {
  results: Array<SyntheticMonitorResponse>;
}

export interface SyntheticMonitorExecutionChildSuccessMessage {
  type: "success";
  payload: SyntheticMonitorExecutionResponse;
}

export interface SyntheticMonitorExecutionChildErrorMessage {
  type: "error";
  error: {
    message: string;
    stack?: string | undefined;
  };
}

export type SyntheticMonitorExecutionChildMessage =
  | SyntheticMonitorExecutionChildSuccessMessage
  | SyntheticMonitorExecutionChildErrorMessage;
