import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import ExceptionDetailSection from "../Components/Exceptions/ExceptionDetailSection";

export interface ExceptionDetailDataPlan {
  loadServices: boolean;
  loadStackTrace: boolean;
  loadLatestOccurrence: boolean;
  resolveStackFrames: boolean;
  loadTraceBreadcrumbs: boolean;
  loadAIAssistance: boolean;
}

export function getExceptionDetailDataPlan(
  section: ExceptionDetailSection,
): ExceptionDetailDataPlan {
  return {
    loadServices: section === ExceptionDetailSection.Overview,
    loadStackTrace: section === ExceptionDetailSection.StackTrace,
    loadLatestOccurrence:
      section === ExceptionDetailSection.StackTrace ||
      section === ExceptionDetailSection.Context,
    resolveStackFrames: section === ExceptionDetailSection.StackTrace,
    loadTraceBreadcrumbs: section === ExceptionDetailSection.Context,
    loadAIAssistance: section === ExceptionDetailSection.AIAssistance,
  };
}

export interface ExceptionOccurrenceQueryOptions {
  projectId: ObjectID;
  fingerprint: string;
  primaryEntityId?: ObjectID | undefined;
}

export function buildExceptionOccurrenceQuery(
  options: ExceptionOccurrenceQueryOptions,
): Query<ExceptionInstance> {
  return {
    projectId: options.projectId,
    fingerprint: options.fingerprint,
    ...(options.primaryEntityId
      ? { primaryEntityId: options.primaryEntityId }
      : {}),
  };
}
