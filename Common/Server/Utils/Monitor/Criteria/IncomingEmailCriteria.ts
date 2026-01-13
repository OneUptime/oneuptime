import logger from "../../../Utils/Logger";
import DataToProcess from "../DataToProcess";
import OneUptimeDate from "../../../../Types/Date";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import IncomingEmailMonitorRequest from "../../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import Typeof from "../../../../Types/Typeof";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class IncomingEmailCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    // Incoming Email Monitoring Checks

    logger.debug(
      "Checking IncomingEmailCriteria for Monitor: " +
        input.dataToProcess.monitorId.toString(),
    );

    logger.debug(
      "Data to process: " + JSON.stringify(input.dataToProcess, null, 2),
    );

    logger.debug(
      "Criteria Filter: " + JSON.stringify(input.criteriaFilter, null, 2),
    );

    let value: number | string | undefined = input.criteriaFilter.value;

    const emailData: IncomingEmailMonitorRequest =
      input.dataToProcess as IncomingEmailMonitorRequest;

    // Check on Email Received time
    if (input.criteriaFilter.checkOn === CheckOn.EmailReceivedAt) {
      logger.debug(
        "Checking EmailReceivedAt for Monitor: " +
          input.dataToProcess.monitorId.toString(),
      );

      const lastEmailTime: Date = emailData.emailReceivedAt;

      logger.debug("Last Email Time: " + lastEmailTime);

      const differenceInMinutes: number = OneUptimeDate.getDifferenceInMinutes(
        lastEmailTime,
        emailData.checkedAt || OneUptimeDate.getCurrentDate(),
      );

      logger.debug("Difference in minutes: " + differenceInMinutes);

      if (!value) {
        return null;
      }

      if (typeof value === Typeof.String) {
        try {
          value = parseInt(value as string);
        } catch (err) {
          logger.error(err);
          return null;
        }
      }

      if (typeof value !== Typeof.Number) {
        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.RecievedInMinutes) {
        logger.debug(
          "Checking RecievedInMinutes for Monitor: " +
            input.dataToProcess.monitorId.toString(),
        );
        if (value && differenceInMinutes <= (value as number)) {
          logger.debug(
            "RecievedInMinutes for Monitor: " +
              input.dataToProcess.monitorId.toString() +
              " is true",
          );
          return `Email received in ${value} minutes. It was received ${differenceInMinutes} minutes ago.`;
        }
        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.NotRecievedInMinutes) {
        logger.debug(
          "Checking NotRecievedInMinutes for Monitor: " +
            input.dataToProcess.monitorId.toString(),
        );
        if (value && differenceInMinutes > (value as number)) {
          logger.debug(
            "NotRecievedInMinutes for Monitor: " +
              input.dataToProcess.monitorId.toString() +
              " is true",
          );
          return `Email not received in ${value} minutes. It was received ${differenceInMinutes} minutes ago.`;
        }
        return null;
      }
    }

    // Check on Email Subject
    if (
      input.criteriaFilter.checkOn === CheckOn.EmailSubject &&
      !emailData.onlyCheckForIncomingEmailReceivedAt
    ) {
      const subject: string = emailData.emailSubject || "";

      return this.evaluateStringCriteria(
        subject,
        input.criteriaFilter,
        "Email subject",
      );
    }

    // Check on Email From
    if (
      input.criteriaFilter.checkOn === CheckOn.EmailFrom &&
      !emailData.onlyCheckForIncomingEmailReceivedAt
    ) {
      const from: string = emailData.emailFrom || "";

      return this.evaluateStringCriteria(
        from,
        input.criteriaFilter,
        "Email from",
      );
    }

    // Check on Email Body
    if (
      input.criteriaFilter.checkOn === CheckOn.EmailBody &&
      !emailData.onlyCheckForIncomingEmailReceivedAt
    ) {
      const body: string = emailData.emailBody || "";

      return this.evaluateStringCriteria(
        body,
        input.criteriaFilter,
        "Email body",
      );
    }

    // Check on Email To
    if (
      input.criteriaFilter.checkOn === CheckOn.EmailTo &&
      !emailData.onlyCheckForIncomingEmailReceivedAt
    ) {
      const to: string = emailData.emailTo || "";

      return this.evaluateStringCriteria(to, input.criteriaFilter, "Email to");
    }

    return null;
  }

  /**
   * Evaluate string criteria filters
   */
  private static evaluateStringCriteria(
    fieldValue: string,
    criteriaFilter: CriteriaFilter,
    fieldName: string,
  ): string | null {
    const value: string | number | undefined = criteriaFilter.value;

    if (criteriaFilter.filterType === FilterType.Contains) {
      if (
        value &&
        fieldValue.toLowerCase().includes((value as string).toLowerCase())
      ) {
        return `${fieldName} contains "${value}".`;
      }
      return null;
    }

    if (criteriaFilter.filterType === FilterType.NotContains) {
      if (
        value &&
        !fieldValue.toLowerCase().includes((value as string).toLowerCase())
      ) {
        return `${fieldName} does not contain "${value}".`;
      }
      return null;
    }

    if (criteriaFilter.filterType === FilterType.EqualTo) {
      if (
        value &&
        fieldValue.toLowerCase() === (value as string).toLowerCase()
      ) {
        return `${fieldName} equals "${value}".`;
      }
      return null;
    }

    if (criteriaFilter.filterType === FilterType.NotEqualTo) {
      if (
        value &&
        fieldValue.toLowerCase() !== (value as string).toLowerCase()
      ) {
        return `${fieldName} does not equal "${value}".`;
      }
      return null;
    }

    if (criteriaFilter.filterType === FilterType.StartsWith) {
      if (
        value &&
        fieldValue.toLowerCase().startsWith((value as string).toLowerCase())
      ) {
        return `${fieldName} starts with "${value}".`;
      }
      return null;
    }

    if (criteriaFilter.filterType === FilterType.EndsWith) {
      if (
        value &&
        fieldValue.toLowerCase().endsWith((value as string).toLowerCase())
      ) {
        return `${fieldName} ends with "${value}".`;
      }
      return null;
    }

    if (criteriaFilter.filterType === FilterType.IsEmpty) {
      if (!fieldValue || fieldValue.trim() === "") {
        return `${fieldName} is empty.`;
      }
      return null;
    }

    if (criteriaFilter.filterType === FilterType.IsNotEmpty) {
      if (fieldValue && fieldValue.trim() !== "") {
        return `${fieldName} is not empty.`;
      }
      return null;
    }

    return null;
  }
}
