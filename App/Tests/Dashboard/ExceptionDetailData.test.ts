import { describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import ExceptionDetailSection from "../../FeatureSet/Dashboard/src/Components/Exceptions/ExceptionDetailSection";
import {
  buildExceptionOccurrenceQuery,
  ExceptionDetailDataPlan,
  getExceptionDetailDataPlan,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionDetailData";

describe("exception detail data ownership", () => {
  const plans: Array<[ExceptionDetailSection, ExceptionDetailDataPlan]> = [
    [
      ExceptionDetailSection.Overview,
      {
        loadServices: true,
        loadStackTrace: false,
        loadLatestOccurrence: false,
        resolveStackFrames: false,
        loadTraceBreadcrumbs: false,
        loadAIAssistance: false,
      },
    ],
    [
      ExceptionDetailSection.StackTrace,
      {
        loadServices: false,
        loadStackTrace: true,
        loadLatestOccurrence: true,
        resolveStackFrames: true,
        loadTraceBreadcrumbs: false,
        loadAIAssistance: false,
      },
    ],
    [
      ExceptionDetailSection.Occurrences,
      {
        loadServices: false,
        loadStackTrace: false,
        loadLatestOccurrence: false,
        resolveStackFrames: false,
        loadTraceBreadcrumbs: false,
        loadAIAssistance: false,
      },
    ],
    [
      ExceptionDetailSection.Context,
      {
        loadServices: false,
        loadStackTrace: false,
        loadLatestOccurrence: true,
        resolveStackFrames: false,
        loadTraceBreadcrumbs: true,
        loadAIAssistance: false,
      },
    ],
    [
      ExceptionDetailSection.AIAssistance,
      {
        loadServices: false,
        loadStackTrace: false,
        loadLatestOccurrence: false,
        resolveStackFrames: false,
        loadTraceBreadcrumbs: false,
        loadAIAssistance: true,
      },
    ],
    [
      ExceptionDetailSection.Settings,
      {
        loadServices: false,
        loadStackTrace: false,
        loadLatestOccurrence: false,
        resolveStackFrames: false,
        loadTraceBreadcrumbs: false,
        loadAIAssistance: false,
      },
    ],
  ];

  test.each(plans)("gives %s only its required data", (section, expected) => {
    expect(getExceptionDetailDataPlan(section)).toEqual(expected);
  });
});

describe("exception occurrence query scope", () => {
  const projectId: ObjectID = new ObjectID(
    "10000000-0000-4000-8000-000000000001",
  );
  const primaryEntityId: ObjectID = new ObjectID(
    "10000000-0000-4000-8000-000000000002",
  );

  test("scopes an exception group by project, service, and fingerprint", () => {
    expect(
      buildExceptionOccurrenceQuery({
        projectId,
        primaryEntityId,
        fingerprint: "same-stack-different-service",
      }),
    ).toEqual({
      projectId,
      primaryEntityId,
      fingerprint: "same-stack-different-service",
    });
  });

  test("omits the service filter only for legacy unattributed groups", () => {
    expect(
      buildExceptionOccurrenceQuery({
        projectId,
        fingerprint: "unattributed",
      }),
    ).toEqual({
      projectId,
      fingerprint: "unattributed",
    });
  });
});
