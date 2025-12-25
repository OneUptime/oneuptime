import AIAgentTaskType from "./AIAgentTaskType";

// Base interface for all task metadata
export interface AIAgentTaskMetadataBase {
  taskType: AIAgentTaskType;
}

// Metadata for FixException task type
export interface FixExceptionTaskMetadata extends AIAgentTaskMetadataBase {
  taskType: AIAgentTaskType.FixException;
  exceptionId: string;
  telemetryServiceId?: string;
  stackTrace?: string;
  errorMessage?: string;
}

// Union type for all task metadata types
export type AIAgentTaskMetadata = FixExceptionTaskMetadata; // More tasks can be added here in the future

// Type guard functions
export function isFixExceptionMetadata(
  metadata: AIAgentTaskMetadata,
): metadata is FixExceptionTaskMetadata {
  return metadata.taskType === AIAgentTaskType.FixException;
}
