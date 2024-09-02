enum CopilotActionStatus {

  // Processed States. 
  PR_CREATED = "Pull Request Created", // PR created and waiting for review
  NO_ACTION_REQUIRED = "No Action Required", // Code is all good. No action required. No PR created.
  CANNOT_FIX = "Cannot Fix", // OneUptime Copilot tried to fix the issue but failed. 

  // Processing States
  PROCESSING = "Processing", // Action is being processed. 

  // In Queue 
  IN_QUEUE = "In Queue", // Action is in queue.
}

export interface CopilotActionStatusData { 
  status: CopilotActionStatus; 
  description: string; 
}

export class CopilotActionStatusUtil {
  public static getAllCopilotActionStatuses(): Array<CopilotActionStatus> {
    return [
      CopilotActionStatus.PR_CREATED,
      CopilotActionStatus.NO_ACTION_REQUIRED,
      CopilotActionStatus.CANNOT_FIX,
      CopilotActionStatus.PROCESSING,
      CopilotActionStatus.IN_QUEUE,
    ];
  }

  public static getCopilotActionStatus(status: string): CopilotActionStatus {
    switch (status) {
      case CopilotActionStatus.PR_CREATED:
        return CopilotActionStatus.PR_CREATED;
      case CopilotActionStatus.NO_ACTION_REQUIRED:
        return CopilotActionStatus.NO_ACTION_REQUIRED;
      case CopilotActionStatus.CANNOT_FIX:
        return CopilotActionStatus.CANNOT_FIX;
      case CopilotActionStatus.PROCESSING:
        return CopilotActionStatus.PROCESSING;
      case CopilotActionStatus.IN_QUEUE:
        return CopilotActionStatus.IN_QUEUE;
      default:
        throw new Error(`Invalid CopilotActionStatus: ${status}`);
    }
  }

  public static isCopilotActionStatus(status: string): boolean {
    return CopilotActionStatusUtil.getAllCopilotActionStatuses().includes(
      status as CopilotActionStatus,
    );
  }

  public static isCopilotActionStatusArray(statuses: Array<string>): boolean {
    return statuses.every((status) => CopilotActionStatusUtil.isCopilotActionStatus(status));
  }

  // get processing status
  public static getProcessingStatus(): CopilotActionStatus {
    return CopilotActionStatus.PROCESSING;
  }

  // get in queue status
  public static getInQueueStatus(): CopilotActionStatus {
    return CopilotActionStatus.IN_QUEUE;
  }

  // get processed status
  public static getProcessedStatus(): Array<CopilotActionStatus> {
    return [
      CopilotActionStatus.PR_CREATED,
      CopilotActionStatus.NO_ACTION_REQUIRED,
      CopilotActionStatus.CANNOT_FIX,
    ];
  }

  // get copilot actiomn status data
  public static getCopilotActionStatusData(
    status: CopilotActionStatus,
  ): CopilotActionStatusData {
    switch (status) {
      case CopilotActionStatus.PR_CREATED:
        return {
          status: CopilotActionStatus.PR_CREATED,
          description: "Pull Request Created",
        };
      case CopilotActionStatus.NO_ACTION_REQUIRED:
        return {
          status: CopilotActionStatus.NO_ACTION_REQUIRED,
          description: "No Action Required",
        };
      case CopilotActionStatus.CANNOT_FIX:
        return {
          status: CopilotActionStatus.CANNOT_FIX,
          description: "Cannot Fix",
        };
      case CopilotActionStatus.PROCESSING:
        return {
          status: CopilotActionStatus.PROCESSING,
          description: "Processing",
        };
      case CopilotActionStatus.IN_QUEUE:
        return {
          status: CopilotActionStatus.IN_QUEUE,
          description: "In Queue",
        };
      default:
        throw new Error(`Invalid CopilotActionStatus: ${status}`);
    }
  }
}

export default CopilotActionStatus;
