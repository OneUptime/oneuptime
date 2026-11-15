import Monitor from "../../../../Models/DatabaseModels/Monitor";
import LatestIncomingRequest, {
  LatestIncomingRequestColumns,
} from "../../../../Server/Utils/Monitor/LatestIncomingRequest";
import MonitorRecordEvidence from "../../../../Server/Utils/Monitor/MonitorRecordEvidence";
import { REDACTED } from "../../../../Server/Utils/LogRedaction";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorSummarySnapshot, {
  MonitorSummarySnapshotSource,
  MonitorSummarySnapshotVersion,
} from "../../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import IncomingRequestSubscriptionConfirmationUtil, {
  SubscriptionConfirmationAction,
} from "../../../../Utils/Monitor/IncomingRequestSubscriptionConfirmation";
import {
  EVENT_GRID_VALIDATION_URL,
  SNS_CONFIRMATION_HEADERS,
  SNS_SIGNATURE,
  SNS_SUBSCRIBE_URL,
  SNS_TOKEN,
  SNS_TOPIC_ARN,
  eventGridValidation,
  snsNotification,
  snsSubscriptionConfirmation,
  snsUnsubscribeConfirmation,
} from "../../../Utils/Monitor/SubscriptionConfirmationFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * A SUBSCRIPTION CONFIRMATION KEEPS ITS LINK IN EVERY COPY PEOPLE READ.
 *
 * https://github.com/OneUptime/oneuptime/issues/7723
 *
 * Amazon SNS sends an HTTPS subscription nothing until its owner opens the
 * SubscribeURL of the SubscriptionConfirmation it posted; Azure Event Grid
 * validates a webhook once its owner opens the validationUrl. The copies
 * of an incoming request people read were cut by the credential rules,
 * which read the Token field and token= in a URL as credentials, so the
 * owner was shown ...&Token=[REDACTED] and could never confirm.
 *
 * Every copy is cut by MonitorRecordEvidence, and each keeps the link and
 * the token it carries: the overview's latest request
 * (Monitor.incomingMonitorRequest), an incident's or an alert's raw check
 * and summary, and - in MonitorLogUtilRedaction.test.ts - a monitoring
 * log's row. Everything else in the request is cut as before: the
 * message's signature, a body that only looks like a confirmation, a
 * credential anywhere else.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7723aaaa-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "7723aaaa-0000-4000-8000-000000000002",
);

function incomingRequest(
  requestBody: JSONObject | JSONArray,
  extra: Partial<IncomingMonitorRequest> = {},
): IncomingMonitorRequest {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    requestMethod: "POST",
    requestHeaders: { ...SNS_CONFIRMATION_HEADERS },
    requestBody: requestBody as JSONObject,
    incomingRequestReceivedAt: new Date("2026-11-13T15:59:15.000Z"),
    checkedAt: new Date("2026-11-13T15:59:16.000Z"),
    onlyCheckForIncomingRequestReceivedAt: false,
    ...extra,
  } as unknown as IncomingMonitorRequest;
}

// The latest request as everyone who can read the monitor reads it.
function readersCopy(
  request: IncomingMonitorRequest,
  keepResponseContent: boolean = true,
): JSONObject {
  return MonitorRecordEvidence.toStoredLatestRequest({
    request: request,
    keepResponseContent: keepResponseContent,
  }) as unknown as JSONObject;
}

function bodyOf(copy: JSONObject): JSONObject {
  return copy["requestBody"] as JSONObject;
}

describe("an Amazon SNS SubscriptionConfirmation, in the copy people read", () => {
  const copy: JSONObject = readersCopy(
    incomingRequest(snsSubscriptionConfirmation()),
  );

  test("keeps the SubscribeURL whole, its token included", () => {
    expect(bodyOf(copy)["SubscribeURL"]).toBe(SNS_SUBSCRIBE_URL);
  });

  test("keeps the Token the link carries", () => {
    expect(bodyOf(copy)["Token"]).toBe(SNS_TOKEN);
  });

  test("is still found as a confirmation, with a link to open", () => {
    expect(
      IncomingRequestSubscriptionConfirmationUtil.find(bodyOf(copy)),
    ).toMatchObject({
      action: SubscriptionConfirmationAction.ConfirmSubscription,
      url: SNS_SUBSCRIBE_URL,
      topic: SNS_TOPIC_ARN,
    });
  });

  test("still masks the message's signature", () => {
    expect(bodyOf(copy)["Signature"]).toBe(REDACTED);
    expect(JSON.stringify(copy)).not.toContain(SNS_SIGNATURE);
  });

  test("shows which signature scheme it uses, which is no secret", () => {
    expect(bodyOf(copy)["SignatureVersion"]).toBe("1");
  });

  test("keeps the rest of the message as it came", () => {
    const body: JSONObject = bodyOf(copy);
    const sent: JSONObject = snsSubscriptionConfirmation();

    for (const field of [
      "Type",
      "MessageId",
      "TopicArn",
      "Message",
      "Timestamp",
      "SigningCertURL",
    ]) {
      expect({ field, value: body[field] }).toEqual({
        field,
        value: sent[field],
      });
    }
  });

  test("keeps SNS's headers", () => {
    expect(copy["requestHeaders"]).toEqual(SNS_CONFIRMATION_HEADERS);
  });

  test("leaves the request being evaluated as it came", () => {
    const request: IncomingMonitorRequest = incomingRequest(
      snsSubscriptionConfirmation(),
    );

    readersCopy(request);

    expect(request.requestBody).toEqual(snsSubscriptionConfirmation());
  });
});

describe("an Amazon SNS UnsubscribeConfirmation, in the copy people read", () => {
  test("keeps the link that restores the subscription", () => {
    const body: JSONObject = bodyOf(
      readersCopy(incomingRequest(snsUnsubscribeConfirmation())),
    );

    expect(body["SubscribeURL"]).toBe(SNS_SUBSCRIBE_URL);
    expect(body["Token"]).toBe(SNS_TOKEN);
    expect(IncomingRequestSubscriptionConfirmationUtil.find(body)?.action).toBe(
      SubscriptionConfirmationAction.RestoreSubscription,
    );
  });
});

describe("an Azure Event Grid validation, in the copy people read", () => {
  test("keeps the validationUrl whole, its token included, and the code", () => {
    const copy: JSONObject = readersCopy(
      incomingRequest(eventGridValidation(), {
        requestHeaders: {
          "aeg-event-type": "SubscriptionValidation",
          "content-type": "application/json",
        },
      }),
    );
    const event: JSONObject = (
      copy["requestBody"] as JSONArray
    )[0] as JSONObject;
    const data: JSONObject = event["data"] as JSONObject;

    expect(data["validationUrl"]).toBe(EVENT_GRID_VALIDATION_URL);
    expect(data["validationCode"]).toBe("512d38b6-c7b8-40c8-89fe-f46f9e9622b6");
    expect(
      IncomingRequestSubscriptionConfirmationUtil.find(copy["requestBody"])
        ?.url,
    ).toBe(EVENT_GRID_VALIDATION_URL);
  });
});

describe("a monitor that keeps no request content", () => {
  test("keeps no confirmation either: no body, no headers, and says so", () => {
    const copy: JSONObject = readersCopy(
      incomingRequest(snsSubscriptionConfirmation()),
      false,
    );

    expect(copy["requestBody"]).toBeUndefined();
    expect(copy["requestHeaders"]).toBeUndefined();
    expect(copy["isResponseContentOmitted"]).toBe(true);
    expect(JSON.stringify(copy)).not.toContain(SNS_TOKEN);
  });
});

describe("what only looks like a confirmation is cut as before", () => {
  test("a SubscribeURL off SNS's own hosts keeps its token masked", () => {
    const forged: string = SNS_SUBSCRIBE_URL.replace(
      "sns.eu-west-1.amazonaws.com",
      "sns.eu-west-1.amazonaws.com.evil.example",
    );
    const body: JSONObject = bodyOf(
      readersCopy(
        incomingRequest(snsSubscriptionConfirmation({ SubscribeURL: forged })),
      ),
    );

    expect(body["Token"]).toBe(REDACTED);
    expect(body["SubscribeURL"]).not.toContain(SNS_TOKEN);
    expect(IncomingRequestSubscriptionConfirmationUtil.find(body)).toBeNull();
  });

  test("a link to another action than confirming keeps its token masked", () => {
    const unsubscribe: string = SNS_SUBSCRIBE_URL.replace(
      "Action=ConfirmSubscription",
      "Action=Unsubscribe",
    );
    const copy: JSONObject = readersCopy(
      incomingRequest(
        snsSubscriptionConfirmation({ SubscribeURL: unsubscribe }),
      ),
    );

    expect(JSON.stringify(copy)).not.toContain(SNS_TOKEN);
  });

  test("a credential in any other request is masked as it always was", () => {
    const secret: string = "tok_live_9f8e7d6c5b4a";
    const body: JSONObject = bodyOf(
      readersCopy(
        incomingRequest({
          Type: "Notification",
          Token: secret,
          callback: `https://hooks.acme.example/done?token=${secret}`,
          apiKey: secret,
        }),
      ),
    );

    expect(body["Token"]).toBe(REDACTED);
    expect(body["apiKey"]).toBe(REDACTED);
    expect(body["callback"]).toBe(
      `https://hooks.acme.example/done?token=${REDACTED}`,
    );
  });

  test("an SNS notification keeps its signature masked and its links as they are", () => {
    const body: JSONObject = bodyOf(
      readersCopy(incomingRequest(snsNotification())),
    );

    expect(body["Signature"]).toBe(REDACTED);
    expect(body["SignatureVersion"]).toBe("1");
    expect(body["UnsubscribeURL"]).toBe(snsNotification()["UnsubscribeURL"]);
    expect(body["Message"]).toBe(snsNotification()["Message"]);
  });
});

describe("the two copies of the latest request", () => {
  test("the one people read keeps the link; the one judged is the request as it came", () => {
    const request: IncomingMonitorRequest = incomingRequest(
      snsSubscriptionConfirmation(),
    );
    const columns: LatestIncomingRequestColumns =
      LatestIncomingRequest.toColumns({
        request: request,
        keepResponseContent: true,
      });

    expect(
      (columns.incomingMonitorRequest.requestBody as JSONObject)[
        "SubscribeURL"
      ],
    ).toBe(SNS_SUBSCRIBE_URL);
    expect(
      (columns.incomingMonitorRequest.requestBody as JSONObject)["Signature"],
    ).toBe(REDACTED);
    expect(columns.incomingMonitorRequestAsReceived.requestBody).toEqual(
      snsSubscriptionConfirmation(),
    );
  });

  test("a copy cut again - after the switch is turned back on - keeps the link", () => {
    const asReceived: IncomingMonitorRequest = JSON.parse(
      JSON.stringify(incomingRequest(snsSubscriptionConfirmation())),
    );
    const monitor: Monitor = new Monitor();
    monitor.keepResponseContent = true;
    monitor.incomingMonitorRequestAsReceived = asReceived;
    monitor.incomingMonitorRequest = readersCopy(
      incomingRequest(snsSubscriptionConfirmation()),
      false,
    ) as unknown as IncomingMonitorRequest;

    const rewrite: ReturnType<
      typeof LatestIncomingRequest.getReadersCopyRewrite
    > = LatestIncomingRequest.getReadersCopyRewrite(monitor);

    expect(
      (rewrite?.data.incomingMonitorRequest.requestBody as JSONObject)[
        "SubscribeURL"
      ],
    ).toBe(SNS_SUBSCRIBE_URL);
  });
});

describe("what an incident or an alert keeps of the request", () => {
  test("its raw check keeps the link", () => {
    const stored: JSONObject = MonitorRecordEvidence.toStoredCheck({
      dataToProcess: incomingRequest(snsSubscriptionConfirmation()),
      keepResponseContent: true,
    });

    expect(bodyOf(stored)["SubscribeURL"]).toBe(SNS_SUBSCRIBE_URL);
    expect(bodyOf(stored)["Token"]).toBe(SNS_TOKEN);
    expect(bodyOf(stored)["Signature"]).toBe(REDACTED);
  });

  test("its monitor summary keeps the link", () => {
    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.IncomingRequest;

    const snapshot: MonitorSummarySnapshot =
      MonitorRecordEvidence.redactSnapshot({
        snapshot: {
          version: MonitorSummarySnapshotVersion,
          source: MonitorSummarySnapshotSource.Captured,
          monitorType: MonitorType.IncomingRequest,
          capturedAt: new Date("2026-11-13T15:59:16.000Z"),
          incomingMonitorRequest: incomingRequest(
            snsSubscriptionConfirmation(),
          ),
        },
        monitor: monitor,
      });
    const body: JSONObject = snapshot.incomingMonitorRequest
      ?.requestBody as JSONObject;

    expect(body["SubscribeURL"]).toBe(SNS_SUBSCRIBE_URL);
    expect(body["Token"]).toBe(SNS_TOKEN);
  });
});
