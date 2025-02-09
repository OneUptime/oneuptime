import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import Crypto from "Common/Utils/Crypto";

export default class ExceptionUtil {
  public static getFingerprint(exception: ExceptionInstance): string {
    const message: string = exception.message || "";
    const stackTrace: string = exception.stackTrace || "";
    const type: string = exception.exceptionType || "";
    const projectId: string = exception.projectId?.toString() || "";
    const serviceId: string = exception.serviceId?.toString() || "";

    const hash: string = Crypto.getSha256Hash(
      projectId + serviceId + message + stackTrace + type,
    );

    return hash;
  }

  public static async saveOrUpdateTelemetryException(
    exception: ExceptionInstance,
  ): Promise<void> {
    // Exception is saved to main database as well (not just analytics db), so users can assgin it, resolve it, etc.

    if (!exception.fingerprint) {
      throw new BadDataException(
        "Fingerprint is required to save exception status",
      );
    }

    if (!exception.projectId) {
      throw new BadDataException(
        "Project ID is required to save exception status",
      );
    }

    if (!exception.serviceId) {
      throw new BadDataException(
        "Service ID is required to save exception status",
      );
    }

    const fingerprint: string = exception.fingerprint;

    // check if the exception with the same fingerprint already exists in the database

    const existingExceptionStatus: TelemetryException | null =
      await TelemetryExceptionService.findOneBy({
        query: {
          fingerprint: fingerprint,
          projectId: exception.projectId,
          telemetryServiceId: exception.serviceId,
        },
        select: {
          _id: true,
          occuranceCount: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (existingExceptionStatus) {
      // then update last seen as and unmark as resolved/muted
      await TelemetryExceptionService.updateOneBy({
        query: {
          _id: existingExceptionStatus._id,
        },
        data: {
          lastSeenAt: OneUptimeDate.now(),
          markedAsResolvedByUserId: null,
          isResolved: false,
          markedAsResolvedAt: null, // unmark as resolved if it was marked as resolved
          occuranceCount: (existingExceptionStatus.occuranceCount || 0) + 1,
        },
        props: {
          isRoot: true,
        },
      });
    }

    if (!existingExceptionStatus) {
      // Create a new exception status if it doesn't exist
      const newExceptionStatus: TelemetryException = new TelemetryException();
      newExceptionStatus.fingerprint = exception.fingerprint;
      newExceptionStatus.projectId = exception.projectId;
      newExceptionStatus.telemetryServiceId = exception.serviceId;
      newExceptionStatus.lastSeenAt = OneUptimeDate.now();
      newExceptionStatus.firstSeenAt = OneUptimeDate.now();
      newExceptionStatus.occuranceCount = 1;

      if (exception.exceptionType) {
        newExceptionStatus.exceptionType = exception.exceptionType;
      }

      if (exception.message) {
        newExceptionStatus.message = exception.message;
      }

      if (exception.stackTrace) {
        newExceptionStatus.stackTrace = exception.stackTrace;
      }

      // Save the new exception status to the database
      await TelemetryExceptionService.create({
        data: newExceptionStatus,
        props: {
          isRoot: true,
        },
      });
    }
  }
}
