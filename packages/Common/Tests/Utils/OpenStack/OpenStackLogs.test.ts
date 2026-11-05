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

  test("a logger can hold a colon, as a Keystone extension's notifications do", () => {
    expect(
      lineOf(
        'INFO oslo.messaging.notification.identity.OS-TRUST:trust.created [None req-1 admin admin] {"event_type": "x"}',
      ).logger,
    ).toBe("oslo.messaging.notification.identity.OS-TRUST:trust.created");
  });

  test("a colon after a word is no logger's, so that line is no oslo.log's", () => {
    expect(readOpenStackLogLine("INFO nova.compute: it happened")).toBeNull();
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

  // A line in text ends with the exception being handled, and this says it beside the message.
  test("the exception it was handling stays with the message, where a failure's words are read", () => {
    const read: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: JSON.stringify({
        ...record,
        message: "Error during ComputeManager._instance_usage_audit",
        error_summary:
          "oslo_messaging.exceptions.MessagingTimeout: Timed out waiting for a reply to message ID abc",
        traceback: null,
      }),
      severityNumber: 0,
    });

    expect(read.body).toBe(
      "Error during ComputeManager._instance_usage_audit: oslo_messaging.exceptions.MessagingTimeout: Timed out waiting for a reply to message ID abc",
    );
    expect(read.attributes[OpenStackLogAttribute.Signal]).toBe(
      OpenStackLogSignal.RabbitMqConnectionLost,
    );
  });

  test("an empty summary, as most lines have, adds nothing", () => {
    const read: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: JSON.stringify({ ...record, error_summary: "", traceback: null }),
      severityNumber: 0,
    });

    expect(read.body).toBe("Failed to build");
  });

  /*
   * Read off a real line. The scrub of a line reads text: to it this names a password and opens
   * a value at the quote that closes the string, and what it took then no longer parsed. The
   * line lost its level, its request and its service's own words.
   */
  test("a message ending in a secret's name reads as itself, with nothing after it", () => {
    const read: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: JSON.stringify({
        message: "keystone_authtoken.memcache_password = ",
        levelname: "DEBUG",
        name: "uwsgi",
        context: { request_id: REQUEST },
      }),
      severityNumber: 0,
    });

    expect(read.attributes[OpenStackLogAttribute.Format]).toBe(
      OpenStackLogFormat.OsloJson,
    );
    expect(read.attributes[OpenStackLogAttribute.Level]).toBe("DEBUG");
    expect(read.attributes[OpenStackLogAttribute.RequestId]).toBe(REQUEST);
    expect(read.body).toBe("keystone_authtoken.memcache_password = ");
  });

  test.each([
    ["a password in its words", "connecting with password=hunter2"],
    ["a URL's password", "transport_url=rabbit://u:hunter2@host:5672/"],
    ["a token", `validating gAAAAABl${"a".repeat(100)}hunter2`],
  ])("%s is gone from the message", (_what: string, message: string) => {
    const read: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: JSON.stringify({ ...record, message, traceback: null }),
      severityNumber: 0,
    });

    expect(read.attributes[OpenStackLogAttribute.Format]).toBe(
      OpenStackLogFormat.OsloJson,
    );
    expect(read.body).not.toContain("hunter2");
  });

  test("and from a traceback's lines", () => {
    const read: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: JSON.stringify({
        ...record,
        traceback: ["Traceback (most recent call last):", "password=hunter2"],
      }),
      severityNumber: 0,
    });

    expect(read.body).toContain("Traceback");
    expect(read.body).not.toContain("hunter2");
  });

  test("a notification written by this formatter is read as one", () => {
    const read: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: JSON.stringify({
        message: JSON.stringify({
          event_type: "instance.reboot.end",
          priority: "INFO",
          publisher_id: "nova-compute:compute-01",
          timestamp: "2026-10-30 10:00:00.654321",
          payload: {
            "nova_object.data": {
              uuid: INSTANCE,
              display_name: "web-1",
              request_id: REQUEST,
            },
          },
        }),
        levelname: "INFO",
        name: "oslo.messaging.notification.instance.reboot.end",
        context: { request_id: REQUEST },
      }),
      severityNumber: 0,
    });

    expect(read.event?.type).toBe("instance.reboot.end");
    expect(read.attributes[OpenStackLogAttribute.Format]).toBe(
      OpenStackLogFormat.OsloJson,
    );
    expect(JSON.parse(read.body)["event_type"]).toBe("instance.reboot.end");
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
        "journald.exception_info":
          "Traceback (most recent call last):\nValueError",
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

  /*
   * Read off a real recording: the journal handler formats its line as a file would, stack trace
   * and all, and says the stack trace again beside it.
   */
  test("a line that holds its traceback already does not hold it twice", () => {
    const body: string = `2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [None ${REQUEST} ${USER} ${PROJECT} - - default default] Failed\n2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager Traceback (most recent call last):\n2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager ValueError`;
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {
        "journald.logger_name": "nova.compute.manager",
        "journald.exception_info":
          "Traceback (most recent call last):\nValueError",
      },
      body,
      severityNumber: 0,
    });

    expect(stamp.body).toBe(body);
    expect(stamp.removedAttributes).toEqual(["journald.exception_info"]);
  });

  test("a traceback with no line to go with is the body", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {
        "journald.logger_name": "nova.compute.manager",
        "journald.exception_info": "ValueError: nope",
      },
      body: "",
      severityNumber: 0,
    });

    expect(stamp.body).toBe("ValueError: nope");
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
    expect(
      stamp.attributes[OpenStackLogAttribute.GlobalRequestId],
    ).toBeUndefined();
  });

  test("nothing when no request is named", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: "2026-10-30 10:00:00.123 1234 INFO nova.compute.manager [-] Periodic",
      severityNumber: 0,
    });

    expect(
      stamp.attributes[OpenStackLogAttribute.RequestRootId],
    ).toBeUndefined();
  });
});

describe("an instance named in a line that has no prefix for it", () => {
  test.each([
    [`Binding port for instance ${INSTANCE}`],
    [`instance_uuid=${INSTANCE} volume attached`],
    [`{'instance_id': '${INSTANCE}'}`],
    [`Instance ${INSTANCE} is gone`],
    // Read off a real recording: how Neutron and Placement say it.
    [
      `Sending events: [{'server_uuid': '${INSTANCE}', 'name': 'network-vif-plugged'}]`,
    ],
    [`Port updated, device_id=${INSTANCE}`],
    [`Allocations for consumer ${INSTANCE} deleted`],
    [`Starting to schedule for instances: ['${INSTANCE}']`],
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

  /*
   * Read off a real recording: oslo.log names a file after the program, and a service under uWSGI
   * with log_dir and no log_file has none of its own.
   */
  test.each([
    ["/var/log/kolla/nova/<frozen importlib._bootstrap>.log", "nova"],
    ["/var/log/kolla/keystone/<frozen importlib._bootstrap>.log", "keystone"],
    ["<frozen importlib._bootstrap>.log", ""],
    ["/var/log/kolla/nova/nova-compute.log", "nova-compute"],
    ["/var/log/kolla/nova/privsep-helper.log", "privsep-helper"],
  ])("the file %s is %j", (file: string, service: string) => {
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
    // Read off a real recording, of RabbitMQ stopped under a running cloud.
    [
      "ERROR",
      "ERROR oslo.messaging._drivers.impl_rabbit [None req-a None None] Connection failed: [Errno 111] ECONNREFUSED (retrying in 1.0 seconds): ConnectionRefusedError: [Errno 111] ECONNREFUSED",
      OpenStackLogSignal.RabbitMqConnectionLost,
    ],
    [
      "ERROR",
      "ERROR oslo.messaging._drivers.impl_rabbit [-] Connection failed: timed out (retrying in 2.0 seconds): socket.timeout: timed out",
      OpenStackLogSignal.RabbitMqConnectionLost,
    ],
    [
      "ERROR",
      "Unable to connect to AMQP server on 192.0.2.10:5672 after inf tries: Basic.publish: (404) NOT_FOUND",
      OpenStackLogSignal.RabbitMqConnectionLost,
    ],
    [
      "WARNING",
      "SQL connection failed. 10 attempts left.",
      OpenStackLogSignal.DatabaseConnectionLost,
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
  ])("%s %s", (level: string, text: string, signal: OpenStackLogSignal) => {
    expect(readOpenStackLogSignal({ level, text })).toBe(signal);
  });

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

  test("a connection failing somewhere else is not the bus", () => {
    expect(
      readOpenStackLogSignal({
        level: "ERROR",
        text: "ERROR nova.virt.libvirt.host [-] Connection failed: to the hypervisor",
      }),
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

  // An API behind a path, as DevStack's Apache has them all. And uWSGI's own line for a request.
  test.each([
    'INFO nova.api.openstack.requestlog [None req-a None None] 10.1.0.200 "GET /compute/" status: 200 len: 1 microversion: - time: 0.001',
    'INFO nova.api.openstack.requestlog [None req-a None None] 10.1.0.200 "OPTIONS /compute/" status: 200 len: 1 microversion: - time: 0.001',
    'INFO neutron.api.wsgi [-] 10.1.0.200 "GET /networking/ HTTP/1.1" status: 200 len: 1 time: 0.001',
    'INFO glance.api [-] 10.1.0.200 "GET /image/healthcheck HTTP/1.1" 200 2 0.001',
  ])("%s is noise", (line: string) => {
    expect(
      stampOpenStackLogRecord({ attributes: {}, body: line, severityNumber: 0 })
        .attributes[OpenStackLogAttribute.Noise],
    ).toBe(OPENSTACK_LOG_NOISE_HEALTH_CHECK);
  });

  test.each([
    "[pid: 90122|app: 0|req: 1/1] 10.1.0.200 () {56 vars in 1129 bytes} [Wed Nov  4 21:37:49 2026] GET / => generated 267 bytes in 3 msecs (HTTP/1.1 200) 5 headers in 209 bytes (1 switches on core 0)",
    "[pid: 90122|app: 0|req: 1/1] 10.1.0.200 () {56 vars in 1129 bytes} [Wed Nov  4 21:37:49 2026] OPTIONS /identity/ => generated 0 bytes in 3 msecs (HTTP/1.1 200) 5 headers in 209 bytes (1 switches on core 0)",
  ])("uWSGI's own line for a check is too: %s", (line: string) => {
    expect(
      stampOpenStackLogRecord({ attributes: {}, body: line, severityNumber: 0 })
        .attributes[OpenStackLogAttribute.Noise],
    ).toBe(OPENSTACK_LOG_NOISE_HEALTH_CHECK);
  });

  test.each([
    "[pid: 90122|app: 0|req: 1/1] 10.1.0.200 () {56 vars in 1129 bytes} [Wed Nov  4 21:37:49 2026] POST /identity/v3/auth/tokens => generated 2599 bytes in 1149 msecs (HTTP/1.1 201) 5 headers in 209 bytes (1 switches on core 0)",
    "A sentence that says ] GET / => with no uWSGI about it",
    'INFO nova.api.openstack.requestlog [None req-a None None] 10.1.0.200 "GET /compute/v2.1/servers" status: 200 len: 1 microversion: 2.90 time: 0.001',
    'INFO nova.api.openstack.requestlog [None req-a None None] 10.1.0.200 "GET /other/" status: 200 len: 1 microversion: - time: 0.001',
  ])("%s is not", (line: string) => {
    expect(
      stampOpenStackLogRecord({ attributes: {}, body: line, severityNumber: 0 })
        .attributes[OpenStackLogAttribute.Noise],
    ).toBeUndefined();
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

  /*
   * Read off a real recording: oslo.log adds the exception being handled to an ERROR line, so
   * Nova's instance.create.error ends with it, and DevStack's format adds the function that
   * logged it to a DEBUG line. Either can hold a brace of its own.
   */
  test.each([
    [
      ": nova.exception.FlavorDiskSmallerThanImage: Flavor's disk is too small for requested image.",
    ],
    [": nova.exception.Foo: {'a': {'b': 1}}"],
    [
      " {{(pid=86917) notify /opt/stack/oslo_messaging/notify/_impl_log.py:43}}",
    ],
    [" log_notify /opt/stack/oslo_messaging/notify/_impl_log.py:43"],
  ])(
    "what follows the JSON, %s, leaves it readable and stays",
    (rest: string) => {
      const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
        attributes: {},
        body: `${asLine}${rest}`,
        severityNumber: 0,
      });

      expect(stamp.event?.type).toBe("instance.power_off.end");
      expect(stamp.body.endsWith(rest)).toBe(true);
      expect(stamp.attributes[OpenStackLogAttribute.RequestRootId]).toBe(
        GLOBAL,
      );
    },
  );

  test("a brace inside the JSON's own strings changes nothing", () => {
    const braces: Record<string, unknown> = {
      ...notification,
      payload: {
        "nova_object.data": {
          uuid: INSTANCE,
          display_name: 'web } { " \\ 1',
        },
      },
    };
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `2026-10-30 10:00:01.000 1234 INFO oslo.messaging.notification.instance.power_off.end [-] ${JSON.stringify(braces)} after`,
      severityNumber: 0,
    });

    expect(stamp.event?.part?.name).toBe('web } { " \\ 1');
    expect(stamp.body.endsWith(" after")).toBe(true);
  });

  test("a secret after it goes too", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `${asLine}: failed with password=hunter2`,
      severityNumber: 0,
    });

    expect(stamp.event).not.toBeNull();
    expect(stamp.body).not.toContain("hunter2");
  });

  test("JSON that never closes is no notification, and its secrets still go", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `2026-10-30 10:00:01.000 1234 INFO oslo.messaging.notification.x [-] {"event_type": "x", "adminPass": "hunter2", "payload": {`,
      severityNumber: 0,
    });

    expect(stamp.event).toBeNull();
    expect(stamp.body).not.toContain("hunter2");
  });

  // A field's name is read for what it says, and its text for what it holds, whatever else is there.
  test("a notification's fields lose their secrets and it stays a notification", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `2026-10-30 10:00:01.000 1234 INFO oslo.messaging.notification.instance.power_off.end [-] ${JSON.stringify(
        {
          ...notification,
          payload: {
            "nova_object.data": {
              uuid: INSTANCE,
              display_name: "memcache_password = ",
              admin_password: "hunter2",
              note: "it held password=hunter3",
              url: "rabbit://u:hunter4@host/",
            },
          },
        },
      )}`,
      severityNumber: 0,
    });

    expect(stamp.event?.part?.name).toBe("memcache_password =");
    expect(stamp.body).not.toContain("hunter2");
    expect(stamp.body).not.toContain("hunter3");
    expect(stamp.body).not.toContain("hunter4");
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
    [
      "a URL's password",
      "transport_url=rabbit://stackrabbit:the-password@host:5672/",
    ],
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

  // Its note is written last, so that nothing reading a value can take it for one.
  test.each([
    ["no secret", "x".repeat(MAX_OPENSTACK_LOG_BODY_LENGTH + 100)],
    [
      "a value that never ends",
      `password=${"x".repeat(MAX_OPENSTACK_LOG_BODY_LENGTH + 100)}`,
    ],
    [
      "a quote that never closes",
      `password='${"x".repeat(MAX_OPENSTACK_LOG_BODY_LENGTH + 100)}`,
    ],
    [
      "a key that never ends",
      `-----BEGIN PRIVATE KEY-----\n${"x".repeat(MAX_OPENSTACK_LOG_BODY_LENGTH + 100)}`,
    ],
  ])("says so, whatever it holds: %s", (_what: string, body: string) => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body,
      severityNumber: 0,
    });

    expect(stamp.body.endsWith("(truncated by OneUptime)")).toBe(true);
    expect(stamp.body.length).toBeLessThanOrEqual(
      MAX_OPENSTACK_LOG_BODY_LENGTH + 100,
    );
  });

  test("a secret longer than the most that is read goes, all of it", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `password=${"x".repeat(MAX_OPENSTACK_LOG_BODY_LENGTH * 2)}`,
      severityNumber: 0,
    });

    expect(stamp.body).not.toContain("xxxx");
  });

  test("a URL's password the cut fell inside goes, with no @ left to say so", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `${"a".repeat(MAX_OPENSTACK_LOG_BODY_LENGTH - 30)} rabbit://user:${"s".repeat(100)}@host:5672/`,
      severityNumber: 0,
    });

    expect(stamp.body).not.toContain("sss");
    expect(stamp.body.endsWith("(truncated by OneUptime)")).toBe(true);
  });

  test("the cut leaves no half of a character that takes two", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: `${"a".repeat(MAX_OPENSTACK_LOG_BODY_LENGTH - 1)}\ud83d\ude00 more`,
      severityNumber: 0,
    });

    expect(stamp.body).toBe(
      `${"a".repeat(MAX_OPENSTACK_LOG_BODY_LENGTH - 1)}… (truncated by OneUptime)`,
    );
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
