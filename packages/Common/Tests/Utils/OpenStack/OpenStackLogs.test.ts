import { describe, expect, test } from "@jest/globals";
import {
  OPENSTACK_CLOUD_LOG_ATTRIBUTE,
  OPENSTACK_LOG_NOISE_HEALTH_CHECK,
  MAX_OPENSTACK_LOG_BODY_LENGTH,
  OpenStackLogAttribute,
  OpenStackLogFormat,
  OpenStackLogLine,
  OpenStackLogSignal,
  OpenStackLogStamp,
  getOpenStackServiceOfFile,
  getOpenStackServiceOfUnit,
  isOpenStackLogRecord,
  isOpenStackUuid,
  readOpenStackLogLine,
  readOpenStackLogSignal,
  stampOpenStackLogRecord,
} from "../../../Utils/OpenStack/OpenStackLogs";
import {
  OpenStackEventAttribute,
  OpenStackEventImportance,
  OpenStackEventOutcome,
} from "../../../Utils/OpenStack/OpenStackNotifications";
import { OPENSTACK_SCRUBBED_VALUE } from "../../../Utils/OpenStack/OpenStackLogScrub";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * Reading a line of a cloud's logs, whoever configured it.
 *
 * HAND-WRITTEN FIXTURES. The lines in this file are written from oslo.log's source and format
 * strings. What the services really write, on five releases of DevStack, is held in
 * OpenStackRecordedLogs.test.ts, which reads what the rig records. So this file says what each
 * format means and that nothing long or strange breaks it, and that one says the formats are
 * what real services write.
 */

const INSTANCE: string = "1cd8b1e6-41ab-4e40-a4c6-b8b1a7d1f9f0";
const USER: string = "0123456789abcdef0123456789abcdef";
const PROJECT: string = "fedcba9876543210fedcba9876543210";
const REQUEST: string = "req-2d6c83a1-8d7d-4f53-a5a2-5cf0f9a5e0c1";
const GLOBAL: string = "req-a3f19c06-14e8-4a0c-9c9d-1a7b0d5a3e22";

function lineOf(text: string): OpenStackLogLine {
  const line: OpenStackLogLine | null = readOpenStackLogLine(text);

  expect(line).not.toBeNull();

  return line as OpenStackLogLine;
}

describe("a line in oslo.log's default format", () => {
  test("holds every field its format string names", () => {
    const line: OpenStackLogLine = lineOf(
      `2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [${GLOBAL} ${REQUEST} ${USER} ${PROJECT} - - default default] [instance: ${INSTANCE}] Failed to build`,
    );

    expect(line.format).toBe(OpenStackLogFormat.Oslo);
    expect(line.time?.toISOString()).toBe("2026-10-30T10:00:00.123Z");
    expect(line.processId).toBe("1234");
    expect(line.level).toBe("ERROR");
    expect(line.logger).toBe("nova.compute.manager");
    expect(line.globalRequestId).toBe(GLOBAL);
    expect(line.requestId).toBe(REQUEST);
    expect(line.userId).toBe(USER);
    expect(line.projectId).toBe(PROJECT);
    expect(line.instanceId).toBe(INSTANCE);
    expect(line.message).toBe("Failed to build");
  });

  test("with no global ID, says None where it would be", () => {
    const line: OpenStackLogLine = lineOf(
      `2026-10-30 10:00:00.123 1234 INFO nova.api [None ${REQUEST} ${USER} ${PROJECT} - - default default] Started`,
    );

    expect(line.globalRequestId).toBe("");
    expect(line.requestId).toBe(REQUEST);
  });

  test("with no request at all, is a dash", () => {
    const line: OpenStackLogLine = lineOf(
      "2026-10-30 10:00:00.123 1234 INFO nova.compute.manager [-] Periodic task",
    );

    expect(line.requestId).toBe("");
    expect(line.userId).toBe("");
    expect(line.message).toBe("Periodic task");
  });

  test("before global IDs, starts with the request", () => {
    const line: OpenStackLogLine = lineOf(
      `2026-10-30 10:00:00.123 1234 INFO cinder.volume.manager [${REQUEST} ${USER} ${PROJECT} - - -] Created`,
    );

    expect(line.requestId).toBe(REQUEST);
    expect(line.userId).toBe(USER);
    expect(line.projectId).toBe(PROJECT);
  });

  test("a line of a stack trace has its own prefix, and no request", () => {
    const line: OpenStackLogLine = lineOf(
      `2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [instance: ${INSTANCE}] Traceback (most recent call last):`,
    );

    expect(line.instanceId).toBe(INSTANCE);
    expect(line.requestId).toBe("");
    expect(line.message).toBe("Traceback (most recent call last):");
  });

  test("the instance's prefix may run into the message, as oslo.log writes it for exceptions", () => {
    const line: OpenStackLogLine = lineOf(
      `2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [instance: ${INSTANCE}]Traceback`,
    );

    expect(line.instanceId).toBe(INSTANCE);
    expect(line.message).toBe("Traceback");
  });

  test("something in instance's place that is no UUID is left in the message", () => {
    const line: OpenStackLogLine = lineOf(
      "2026-10-30 10:00:00.123 1234 INFO nova.compute.manager [-] [instance: none of it] Text",
    );

    expect(line.instanceId).toBe("");
    expect(line.message).toBe("[instance: none of it] Text");
  });

  test("reads only the first line for its fields, and keeps the rest as the message", () => {
    const line: OpenStackLogLine = lineOf(
      `2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [${GLOBAL} ${REQUEST} - - - - - -] Failed\n2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager Traceback`,
    );

    expect(line.requestId).toBe(REQUEST);
    expect(line.message).toContain("Failed\n");
    expect(line.message).toContain("Traceback");
  });
});

describe("a line as DevStack writes it to the journal", () => {
  test("has no time or process, and names and not ids", () => {
    const line: OpenStackLogLine = lineOf(
      `ERROR nova.compute.manager [None ${REQUEST} demo admin] [instance: ${INSTANCE}] Failed`,
    );

    expect(line.time).toBeNull();
    expect(line.processId).toBe("");
    expect(line.level).toBe("ERROR");
    expect(line.requestId).toBe(REQUEST);
    // %(project_name)s %(user_name)s: the project comes first.
    expect(line.projectName).toBe("demo");
    expect(line.userName).toBe("admin");
    expect(line.userId).toBe("");
    expect(line.projectId).toBe("");
  });

  test("its colours are taken out before it is read", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `\u001b[01;31mERROR nova.compute.manager [\u001b[01;36mNone ${REQUEST} \u001b[00;36mdemo admin\u001b[01;31m] \u001b[01;35m[instance: ${INSTANCE}] \u001b[01;31mFailed\u001b[00m`,
      severityNumber: 0,
    });

    expect(stamp.body).not.toContain("\u001b");
    expect(stamp.attributes[OpenStackLogAttribute.Level]).toBe("ERROR");
    expect(stamp.attributes[OpenStackLogAttribute.RequestId]).toBe(REQUEST);
    expect(stamp.attributes[OpenStackLogAttribute.InstanceId]).toBe(INSTANCE);
    expect(stamp.severityNumber).toBe(17);
  });
});

describe("lines that are not oslo.log's", () => {
  test.each([
    "",
    "plain words",
    "INFO",
    "2026-10-30 10:00:00.123",
    "2026-10-30 10:00:00.123 ",
    "2026-10-30 10:00:00.123 abc INFO x [-] y",
    "NOTALEVEL nova.compute.manager [-] x",
    "[pid: 1234|app: 0|req: 1/1] 127.0.0.1 () {38 vars in 500 bytes} GET / => generated 0 bytes",
    '{"not": "oslo"}',
    "2026-10-30T10:00:00Z ERROR",
  ])("%j reads as nothing", (text: string) => {
    expect(readOpenStackLogLine(text)).toBeNull();
  });

  test("a level and a logger with nothing after them still read", () => {
    expect(lineOf("INFO nova.compute").logger).toBe("nova.compute");
  });

  test("keeps its body and says it could not read it", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: { "journald.unit": "devstack@n-cpu.service" },
      body: "a sentence from uWSGI",
      severityNumber: 0,
    });

    expect(stamp.body).toBe("a sentence from uWSGI");
    expect(stamp.attributes[OpenStackLogAttribute.Format]).toBe(
      OpenStackLogFormat.Other,
    );
    expect(stamp.attributes[OpenStackLogAttribute.Service]).toBe(
      "nova-compute",
    );
  });
});

describe("a line with oslo.log's JSON formatter", () => {
  const record: Record<string, unknown> = {
    message: "Failed to build",
    msg: "Failed to build %s",
    args: ["hunter2-should-not-stay"],
    levelname: "ERROR",
    name: "nova.compute.manager",
    process: 1234,
    hostname: "compute-01.example.internal",
    created: 1793354400.5,
    context: {
      request_id: REQUEST,
      global_request_id: GLOBAL,
      user: USER,
      user_name: "admin",
      project: PROJECT,
      project_name: "demo",
      auth_token: "gAAAAABlooks-like-a-token-of-sufficient-length-yes",
    },
    extra: { instance: { uuid: INSTANCE } },
    traceback: ["Traceback (most recent call last):", "ValueError: nope"],
  };

  const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
    attributes: {},
    body: JSON.stringify(record),
    severityNumber: 0,
  });

  test("reads its fields", () => {
    expect(stamp.attributes[OpenStackLogAttribute.Format]).toBe(
      OpenStackLogFormat.OsloJson,
    );
    expect(stamp.attributes[OpenStackLogAttribute.RequestId]).toBe(REQUEST);
    expect(stamp.attributes[OpenStackLogAttribute.GlobalRequestId]).toBe(
      GLOBAL,
    );
    expect(stamp.attributes[OpenStackLogAttribute.UserId]).toBe(USER);
    expect(stamp.attributes[OpenStackLogAttribute.UserName]).toBe("admin");
    expect(stamp.attributes[OpenStackLogAttribute.ProjectName]).toBe("demo");
    expect(stamp.attributes[OpenStackLogAttribute.InstanceId]).toBe(INSTANCE);
    expect(stamp.attributes[OpenStackLogAttribute.Host]).toBe("compute-01");
    expect(stamp.severityNumber).toBe(17);
    expect(stamp.time?.getTime()).toBe(1793354400500);
  });

  test("keeps the message and its traceback together as one body", () => {
    expect(stamp.body).toBe(
      "Failed to build\nTraceback (most recent call last):\nValueError: nope",
    );
  });

  test("what the service was only logging as values does not stay", () => {
    expect(stamp.body).not.toContain("hunter2-should-not-stay");
    expect(stamp.body).not.toContain("gAAAA");
  });
});

describe("oslo.log's own journal handler, whose fields sit beside the line", () => {
  test("fills what the line leaves out", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {
        "journald.unit": "nova-compute.service",
        "journald.logger_name": "nova.compute.manager",
        "journald.logger_level": "ERROR",
        "journald.request_id": REQUEST,
        "journald.global_request_id": GLOBAL,
        "journald.project_id": PROJECT,
        "journald.project_name": "demo",
        "journald.user_id": USER,
        "journald.user_name": "admin",
        "journald.hostname": "compute-01.example.internal",
        "journald.exception_info": "Traceback (most recent call last):\nValueError",
      },
      body: "Failed to build",
      severityNumber: 0,
    });

    expect(stamp.attributes[OpenStackLogAttribute.Logger]).toBe(
      "nova.compute.manager",
    );
    expect(stamp.attributes[OpenStackLogAttribute.Level]).toBe("ERROR");
    expect(stamp.attributes[OpenStackLogAttribute.RequestId]).toBe(REQUEST);
    expect(stamp.attributes[OpenStackLogAttribute.GlobalRequestId]).toBe(
      GLOBAL,
    );
    expect(stamp.attributes[OpenStackLogAttribute.RequestRootId]).toBe(GLOBAL);
    expect(stamp.attributes[OpenStackLogAttribute.Host]).toBe("compute-01");
    expect(stamp.attributes[OpenStackLogAttribute.Service]).toBe(
      "nova-compute",
    );
    // The traceback belongs in the body, and does not stay beside it too.
    expect(stamp.body).toBe(
      "Failed to build\nTraceback (most recent call last):\nValueError",
    );
    expect(stamp.removedAttributes).toEqual(["journald.exception_info"]);
    expect(stamp.severityNumber).toBe(17);
  });

  test("a line with no level of its own takes its severity from the priority", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: { "journald.priority": "3" },
      body: "free text",
      severityNumber: 0,
    });

    expect(stamp.severityNumber).toBe(17);
  });
});

describe("the request every line of a build shares", () => {
  test("is its global ID where it has one", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `2026-10-30 10:00:00.123 1234 INFO neutron.wsgi [${GLOBAL} ${REQUEST} - - - - - -] Port`,
      severityNumber: 0,
    });

    expect(stamp.attributes[OpenStackLogAttribute.RequestRootId]).toBe(GLOBAL);
  });

  test("and its own ID where it has none, so the first service's lines still join", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `2026-10-30 10:00:00.123 1234 INFO nova.api [None ${REQUEST} - - - - - -] Boot`,
      severityNumber: 0,
    });

    expect(stamp.attributes[OpenStackLogAttribute.RequestRootId]).toBe(REQUEST);
    expect(stamp.attributes[OpenStackLogAttribute.GlobalRequestId]).toBeUndefined();
  });

  test("nothing when no request is named", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: "2026-10-30 10:00:00.123 1234 INFO nova.compute.manager [-] Periodic",
      severityNumber: 0,
    });

    expect(stamp.attributes[OpenStackLogAttribute.RequestRootId]).toBeUndefined();
  });
});

describe("an instance named in a line that has no prefix for it", () => {
  test.each([
    [`Binding port for instance ${INSTANCE}`],
    [`instance_uuid=${INSTANCE} volume attached`],
    [`{'instance_id': '${INSTANCE}'}`],
    [`Instance ${INSTANCE} is gone`],
  ])("%s", (message: string) => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `2026-10-30 10:00:00.123 1234 INFO neutron.plugins.ml2 [-] ${message}`,
      severityNumber: 0,
    });

    expect(stamp.attributes[OpenStackLogAttribute.InstanceId]).toBe(INSTANCE);
  });

  test("a UUID that is not an instance's says nothing", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `2026-10-30 10:00:00.123 1234 INFO neutron.plugins.ml2 [-] Port ${INSTANCE} bound`,
      severityNumber: 0,
    });

    expect(stamp.attributes[OpenStackLogAttribute.InstanceId]).toBeUndefined();
  });
});

describe("who wrote it", () => {
  test.each([
    ["devstack@n-cpu.service", "nova-compute"],
    ["devstack@n-sch.service", "nova-scheduler"],
    ["devstack@n-cond-cell1.service", "nova-conductor"],
    ["devstack@n-super-cond.service", "nova-conductor"],
    ["devstack@n-api.service", "nova-api"],
    ["devstack@q-svc.service", "neutron-server"],
    ["devstack@neutron-api.service", "neutron-server"],
    ["devstack@c-vol.service", "cinder-volume"],
    ["devstack@keystone.service", "keystone"],
    ["devstack@g-api.service", "glance-api"],
    ["nova-compute.service", "nova-compute"],
    ["neutron-server.service", "neutron-server"],
    ["keystone-wsgi-public.service", "keystone"],
    ["nova-api-os-compute.service", "nova-api"],
  ])("the unit %s is %s", (unit: string, service: string) => {
    expect(getOpenStackServiceOfUnit(unit)).toBe(service);
  });

  test.each([
    ["/var/log/kolla/nova/nova-compute.log", "nova-compute"],
    ["/var/log/kolla/neutron/neutron-server.log", "neutron-server"],
    ["/var/log/kolla/keystone/keystone-wsgi-public.log", "keystone"],
    ["nova-api-wsgi.log", "nova-api"],
  ])("the file %s is %s", (file: string, service: string) => {
    expect(getOpenStackServiceOfFile(file)).toBe(service);
  });

  test("a pod's container names it, on the cluster that runs it", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {
        "resource.k8s.container.name": "nova-compute",
        "resource.k8s.node.name": "node-1.example.internal",
      },
      body: "2026-10-30 10:00:00.123 1234 INFO nova.compute.manager [-] Started",
      severityNumber: 0,
    });

    expect(stamp.attributes[OpenStackLogAttribute.Service]).toBe(
      "nova-compute",
    );
    expect(stamp.attributes[OpenStackLogAttribute.Host]).toBe("node-1");
  });

  test("the project a service belongs to is the first word of its name", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: { "journald.unit": "devstack@q-svc.service" },
      body: "2026-10-30 10:00:00.123 1234 INFO neutron.wsgi [-] Started",
      severityNumber: 0,
    });

    expect(stamp.attributes[OpenStackLogAttribute.Component]).toBe("neutron");
  });
});

describe("the failures every operator knows by their words", () => {
  test.each([
    [
      "ERROR",
      "Failed to schedule instances: No valid host was found. There are not enough hosts available.",
      OpenStackLogSignal.NoValidHost,
    ],
    ["ERROR", "nova.exception.NoValidHost: x", OpenStackLogSignal.NoValidHost],
    [
      "ERROR",
      "AMQP server on 10.0.0.11:5672 is unreachable: [Errno 111] ECONNREFUSED. Trying again in 1 seconds.",
      OpenStackLogSignal.RabbitMqConnectionLost,
    ],
    [
      "ERROR",
      "oslo_messaging.exceptions.MessagingTimeout: Timed out waiting for a reply to message ID 1",
      OpenStackLogSignal.RabbitMqConnectionLost,
    ],
    [
      "WARNING",
      "Lost connection to MySQL server during query",
      OpenStackLogSignal.DatabaseConnectionLost,
    ],
    [
      "ERROR",
      "oslo_db.exception.DBConnectionError: (pymysql.err.OperationalError)",
      OpenStackLogSignal.DatabaseConnectionLost,
    ],
    [
      "WARNING",
      "Identity response: Authorization failed. Failed to validate token",
      OpenStackLogSignal.TokenValidationFailing,
    ],
    [
      "ERROR",
      "This is not a recognized Fernet token gAAAAA",
      OpenStackLogSignal.TokenValidationFailing,
    ],
  ])(
    "%s %s",
    (level: string, text: string, signal: OpenStackLogSignal) => {
      expect(readOpenStackLogSignal({ level, text })).toBe(signal);
    },
  );

  test.each(["DEBUG", "INFO", "TRACE", "AUDIT"])(
    "a %s line mentioning one is not one",
    (level: string) => {
      expect(
        readOpenStackLogSignal({ level, text: "No valid host was found" }),
      ).toBeNull();
    },
  );

  test("the AMQP server's words need both their pieces", () => {
    expect(
      readOpenStackLogSignal({ level: "ERROR", text: "AMQP server on host" }),
    ).toBeNull();
    expect(
      readOpenStackLogSignal({ level: "ERROR", text: "x is unreachable" }),
    ).toBeNull();
  });

  test("an ordinary error says none of them", () => {
    expect(
      readOpenStackLogSignal({ level: "ERROR", text: "Disk is full" }),
    ).toBeNull();
  });

  test("a whole record is stamped with what it says", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `2026-10-30 10:00:00.123 1234 ERROR nova.conductor.manager [${GLOBAL} ${REQUEST} - - - - - -] [instance: ${INSTANCE}] Failed to schedule instances: nova.exception_Remote.NoValidHost_Remote: No valid host was found.`,
      severityNumber: 0,
    });

    expect(stamp.attributes[OpenStackLogAttribute.Signal]).toBe(
      OpenStackLogSignal.NoValidHost,
    );
  });
});

describe("a load balancer's check of an API", () => {
  test.each([
    '192.0.2.1 "GET / HTTP/1.1" status: 200 len: 123 time: 0.001',
    '192.0.2.1 "GET /healthcheck HTTP/1.1" status: 200',
    '"HEAD / HTTP/1.0" 200',
    '"OPTIONS /healthz HTTP/1.0" 200',
  ])("%s is noise", (message: string) => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `2026-10-30 10:00:00.123 1234 INFO nova.api.openstack.requestlog [-] ${message}`,
      severityNumber: 0,
    });

    expect(stamp.attributes[OpenStackLogAttribute.Noise]).toBe(
      OPENSTACK_LOG_NOISE_HEALTH_CHECK,
    );
  });

  test("a real request is not, and neither is an error about one", () => {
    const request: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: '2026-10-30 10:00:00.123 1234 INFO nova.api [-] 192.0.2.1 "GET /v2.1/servers HTTP/1.1" status: 200',
      severityNumber: 0,
    });
    const error: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: '2026-10-30 10:00:00.123 1234 ERROR nova.api [-] 192.0.2.1 "GET / HTTP/1.1" status: 500',
      severityNumber: 0,
    });

    expect(request.attributes[OpenStackLogAttribute.Noise]).toBeUndefined();
    expect(error.attributes[OpenStackLogAttribute.Noise]).toBeUndefined();
  });
});

describe("a notification in a log line", () => {
  const notification: Record<string, unknown> = {
    message_id: "6d3e8f6b-9f4a-4d3d-9a6b-1f1b2a3c4d5e",
    publisher_id: "nova-compute:compute-01",
    event_type: "instance.power_off.end",
    priority: "INFO",
    timestamp: "2026-10-30 10:00:00.654321",
    payload: {
      "nova_object.name": "InstanceActionPayload",
      "nova_object.data": {
        uuid: INSTANCE,
        display_name: "web-1",
        host: "compute-01",
        node: "compute-01.example.internal",
        state: "stopped",
        request_id: REQUEST,
        action_initiator_user: USER,
        action_initiator_project: PROJECT,
      },
    },
  };

  const asLine: string = `2026-10-30 10:00:01.000 1234 INFO oslo.messaging.notification.instance.power_off.end [${GLOBAL} ${REQUEST} ${USER} ${PROJECT} - - default default] ${JSON.stringify(notification)}`;

  test("reads as an event, dated by what it says", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: asLine,
      severityNumber: 0,
    });

    expect(stamp.event?.type).toBe("instance.power_off.end");
    expect(stamp.event?.part?.id).toBe(INSTANCE);
    expect(stamp.time?.toISOString()).toBe("2026-10-30T10:00:00.654Z");
    expect(stamp.attributes[OpenStackEventAttribute.Type]).toBe(
      "instance.power_off.end",
    );
    expect(stamp.attributes[OpenStackEventAttribute.Outcome]).toBe(
      OpenStackEventOutcome.Succeeded,
    );
    expect(stamp.attributes[OpenStackEventAttribute.Importance]).toBe(
      OpenStackEventImportance.Change,
    );
    expect(stamp.attributes[OpenStackLogAttribute.InstanceId]).toBe(INSTANCE);
    expect(stamp.attributes[OpenStackLogAttribute.RequestRootId]).toBe(GLOBAL);
  });

  test("the same notification on its own, as a probe sends one", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: JSON.stringify(notification),
      severityNumber: 0,
    });

    expect(stamp.attributes[OpenStackLogAttribute.Format]).toBe(
      OpenStackLogFormat.Notification,
    );
    expect(stamp.attributes[OpenStackLogAttribute.RequestId]).toBe(REQUEST);
    expect(stamp.attributes[OpenStackLogAttribute.Service]).toBe(
      "nova-compute",
    );
    expect(stamp.attributes[OpenStackLogAttribute.Host]).toBe("compute-01");
    expect(stamp.attributes[OpenStackLogAttribute.UserId]).toBe(USER);
    expect(stamp.severityNumber).toBe(9);
  });

  test("a body that looks like one and is not reads as a line that is not", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `2026-10-30 10:00:00.123 1234 INFO oslo.messaging.notification.bad [-] {not json`,
      severityNumber: 0,
    });

    expect(stamp.event).toBeNull();
    expect(stamp.attributes[OpenStackLogAttribute.Logger]).toBe(
      "oslo.messaging.notification.bad",
    );
  });

  test("what must never be stored leaves the fields, and the rest of the line stays", () => {
    const leaking: Record<string, unknown> = {
      ...notification,
      _context_auth_token: "abcdefgh-a-context-token",
      payload: {
        ...(notification["payload"] as Record<string, unknown>),
        user_data: "IyEvYmluL3NoIGVjaG8gc2VjcmV0",
        adminPass: "the-new-password",
      },
    };
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `2026-10-30 10:00:01.000 1234 INFO oslo.messaging.notification.instance.power_off.end [-] ${JSON.stringify(leaking)}`,
      severityNumber: 0,
    });

    expect(stamp.body).not.toContain("abcdefgh-a-context-token");
    expect(stamp.body).not.toContain("IyEvYmluL3NoIGVjaG8gc2VjcmV0");
    expect(stamp.body).not.toContain("the-new-password");
    expect(stamp.body).toContain("instance.power_off.end");
    expect(stamp.body).toContain("2026-10-30 10:00:01.000 1234 INFO");
  });
});

describe("secrets, on the way through", () => {
  test.each([
    ["a Fernet token", `token gAAAAABl${"a".repeat(180)} on the line`],
    ["a password", 'POST /v3/auth/tokens {"password": "the-password"}'],
    ["a URL's password", "transport_url=rabbit://stackrabbit:the-password@host:5672/"],
    ["a header", "X-Auth-Token: gAAAAABl${'a'.repeat(100)} and"],
  ])("%s does not stay", (_what: string, message: string) => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `2026-10-30 10:00:00.123 1234 DEBUG nova.api [-] ${message}`,
      severityNumber: 0,
    });

    expect(stamp.body).not.toContain("the-password");
    expect(stamp.body).not.toContain(`gAAAAABl${"a".repeat(100)}`);
    expect(stamp.body).toContain(OPENSTACK_SCRUBBED_VALUE);
  });

  test("a record that cannot be read has them taken out too", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `free text password=the-password and gAAAAABl${"a".repeat(100)}`,
      severityNumber: 0,
    });

    expect(stamp.body).not.toContain("the-password");
    expect(stamp.body).not.toContain("gAAAAABl");
  });
});

describe("how long a record may be", () => {
  test("is cut, and says so", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `INFO nova.api [-] ${"x".repeat(MAX_OPENSTACK_LOG_BODY_LENGTH + 100)}`,
      severityNumber: 0,
    });

    expect(stamp.body.length).toBeLessThan(MAX_OPENSTACK_LOG_BODY_LENGTH + 100);
    expect(stamp.body.endsWith("(truncated by OneUptime)")).toBe(true);
  });

  test("a value of a line's fields stays a reasonable length", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `2026-10-30 10:00:00.123 1234 INFO ${"a".repeat(150)} [req-${"b".repeat(500)} c d] message`,
      severityNumber: 0,
    });

    for (const value of Object.values(stamp.attributes)) {
      expect(value.length).toBeLessThanOrEqual(255);
    }
  });
});

describe("whose logs these are", () => {
  test("a record with a cloud's name is a cloud's", () => {
    expect(
      isOpenStackLogRecord({ [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: "production" }),
    ).toBe(true);
  });

  test.each([
    [{}],
    [{ [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: "" }],
    [{ [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: 12 }],
    [{ "resource.service.name": "api" }],
  ])("%j is not", (attributes: Record<string, unknown>) => {
    expect(isOpenStackLogRecord(attributes)).toBe(false);
  });
});

describe("a UUID", () => {
  test.each([
    INSTANCE,
    "00000000-0000-0000-0000-000000000000",
    "ABCDEF12-3456-7890-ABCD-EF1234567890",
  ])("%s is one", (value: string) => {
    expect(isOpenStackUuid(value)).toBe(true);
  });

  test.each([
    "",
    "x",
    "1cd8b1e641ab4e40a4c6b8b1a7d1f9f0",
    "1cd8b1e6-41ab-4e40-a4c6-b8b1a7d1f9fz",
    "1cd8b1e6041ab04e40-a4c6-b8b1a7d1f9f0",
  ])("%j is not", (value: string) => {
    expect(isOpenStackUuid(value)).toBe(false);
  });
});

describe("whatever arrives, a stamp is made and nothing throws", () => {
  const ALPHABET: ReadonlyArray<string> = [
    "2026-10-30 10:00:00.123 ",
    "1234 ",
    "ERROR ",
    "nova.compute.manager ",
    "[",
    "]",
    "[-] ",
    `[instance: ${INSTANCE}] `,
    "[instance: ",
    `${REQUEST} `,
    "None ",
    "{",
    "}",
    '"event_type"',
    '"payload"',
    ":",
    ",",
    '"',
    "\\",
    "\n",
    "\u001b[01;31m",
    "password=",
    "token",
    "gAAAAA",
    "://user:",
    "@",
    "oslo.messaging.notification.",
    "İ",
    "\ud83d",
    "null",
    "[]",
  ];

  test.each(
    generatedTexts(4000, 5737, ALPHABET).map(
      (text: string, index: number): [number, string] => {
        return [index, text];
      },
    ),
  )("generated line %i", (_index: number, text: string) => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: text,
      severityNumber: 0,
    });

    expect(typeof stamp.body).toBe("string");
    expect(stamp.attributes[OpenStackLogAttribute.Format]).toBeDefined();

    for (const value of Object.values(stamp.attributes)) {
      expect(typeof value).toBe("string");
    }
  });
});
