import { describe, expect, test } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import {
  MAX_PROXMOX_BACKUP_ROWS,
  PROXMOX_NOTIFICATION_NODE_ATTRIBUTE,
  PROXMOX_NOTIFICATION_SCOPE_NAME,
  PROXMOX_NOTIFICATION_TARGET_NAME,
  PROXMOX_NOTIFICATION_WEBHOOK_BODY,
  PROXMOX_NOTIFICATION_WEBHOOK_HEADERS,
  ProxmoxBackupGuestResult,
  ProxmoxNotificationAttribute,
  ProxmoxNotificationStamp,
  buildProxmoxNotificationRemoveCommands,
  buildProxmoxNotificationSetupCommands,
  encodeProxmoxBase64,
  getProxmoxNotificationLogsUrl,
  getProxmoxNotificationSeverityNumber,
  isProxmoxNotificationLogRecord,
  parseProxmoxBackupDetails,
  parseProxmoxBytes,
  parseProxmoxDuration,
  stampProxmoxNotification,
} from "../../../Utils/Proxmox/ProxmoxNotifications";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * Proxmox VE's own notifications, sent to OneUptime's logs endpoint through
 * a webhook target (Common/Utils/Proxmox/ProxmoxNotifications). These pin
 * the commands the Dashboard shows, the template they install, the reading
 * of a backup job's message and what the logs ingest makes of a record.
 * App's ProxmoxNotificationTemplate suite renders the template with a
 * Handlebars engine and sends the result through the real OTLP decoder.
 */

/*
 * A backup job's Details table as proxmox-notify's plaintext renderer
 * writes it: every column padded to its widest cell (or label) plus four
 * spaces, no separator line, a newline after each row.
 */
function renderGuestTable(rows: Array<Array<string>>): string {
  const labels: Array<string> = [
    "VMID",
    "Name",
    "Status",
    "Time",
    "Size",
    "Filename",
  ];
  const widths: Array<number> = labels.map(
    (label: string, index: number): number => {
      return (
        Math.max(
          label.length,
          ...rows.map((row: Array<string>): number => {
            return (row[index] || "").length;
          }),
        ) + 4
      );
    },
  );
  const line: (cells: Array<string>) => string = (
    cells: Array<string>,
  ): string => {
    return (
      cells
        .map((cell: string, index: number): string => {
          return cell.padEnd(widths[index] as number, " ");
        })
        .join("") + "\n"
    );
  };
  return line(labels) + rows.map(line).join("");
}

// The vzdump body template's text for one job (templates/default).
function vzdumpMessage(data: {
  error?: string | undefined;
  rows: Array<Array<string>>;
  logs?: string | undefined;
}): string {
  return [
    data.error || "",
    "Details",
    "=======",
    renderGuestTable(data.rows) + "Total running time: 3m 50s",
    "Total size: 19.6 GiB",
    "",
    "Logs",
    "====",
    data.logs ||
      "vzdump 100 103 --mode snapshot --storage pbs-offsite\n\n100: 2026-11-01 01:00:02 INFO: Starting Backup of VM 100 (qemu)",
  ].join("\n");
}

const SUCCESS_MESSAGE: string = vzdumpMessage({
  rows: [
    [
      "100",
      "web-01",
      "ok",
      "3m 32s",
      "18.4 GiB",
      "vzdump-qemu-100-2026_11_01-01_00_02.vma.zst",
    ],
    [
      "103",
      "cache-01",
      "ok",
      "18s",
      "1.2 GiB",
      "vzdump-lxc-103-2026_11_01-01_03_34.tar.zst",
    ],
  ],
});

const FAILURE_MESSAGE: string = vzdumpMessage({
  error: "job errors",
  rows: [
    [
      "100",
      "web-01",
      "ok",
      "1h 1m 40s",
      "512 MiB",
      "vm/100/2026-11-01T01:00:02Z",
    ],
    ["102", "db-01", "err", "41s", "0 B", "null"],
    ["104", "VM 104", "todo", "0s", "0 B", "null"],
  ],
});

describe("ProxmoxNotifications - severity", () => {
  test.each([
    ["info", 9],
    ["notice", 10],
    ["warning", 13],
    ["error", 17],
    [" ERROR ", 17],
    ["unknown", 0],
    ["", 0],
    [null, 0],
    [undefined, 0],
    ["critical", 0],
  ] as Array<[string | null | undefined, number]>)(
    "%p is stored as severity number %p",
    (severity: string | null | undefined, expected: number) => {
      expect(getProxmoxNotificationSeverityNumber(severity)).toBe(expected);
    },
  );
});

describe("ProxmoxNotifications - base64", () => {
  test.each([
    ["nothing", ""],
    ["one byte", "a"],
    ["two bytes", "ab"],
    ["three bytes", "abc"],
    ["a header value", "application/json"],
    ["the token header's template", "{{ secrets.token }}"],
    ["a cluster name", "pve-prod"],
    ["German and a dash", "Rechenzentrum Süd — Cluster 2"],
    ["Chinese", "集群一号"],
    ["an emoji", "🚀 launch"],
    ["the body template", PROXMOX_NOTIFICATION_WEBHOOK_BODY],
  ])(
    "%s encodes as Node's UTF-8 base64 does",
    (_label: string, text: string) => {
      expect(encodeProxmoxBase64(text)).toBe(
        Buffer.from(text, "utf8").toString("base64"),
      );
    },
  );
});

describe("ProxmoxNotifications - the webhook body template", () => {
  test("is one fixed template: no cluster name or key is ever part of it", () => {
    expect(PROXMOX_NOTIFICATION_WEBHOOK_BODY).toContain(
      "{{ json secrets.cluster }}",
    );
    expect(PROXMOX_NOTIFICATION_WEBHOOK_BODY).toContain("{{ json message }}");
    expect(PROXMOX_NOTIFICATION_WEBHOOK_BODY).toContain(
      '"timeUnixNano": "{{ timestamp }}000000000"',
    );
    expect(PROXMOX_NOTIFICATION_WEBHOOK_BODY).toContain(
      `"name": "${PROXMOX_NOTIFICATION_SCOPE_NAME}"`,
    );
    for (const attribute of [
      ProxmoxNotificationAttribute.Type,
      ProxmoxNotificationAttribute.Severity,
      ProxmoxNotificationAttribute.Title,
      ProxmoxNotificationAttribute.JobId,
      PROXMOX_NOTIFICATION_NODE_ATTRIBUTE,
    ]) {
      expect(PROXMOX_NOTIFICATION_WEBHOOK_BODY).toContain(
        `"key": "${attribute}"`,
      );
    }
  });

  test("never puts a mustache beside a brace, which Handlebars reads as a triple-stash", () => {
    expect(PROXMOX_NOTIFICATION_WEBHOOK_BODY).not.toContain("{{{");
    expect(PROXMOX_NOTIFICATION_WEBHOOK_BODY).not.toContain("}}}");
  });

  test("writes every value it reads through json, so none can break the request", () => {
    const mustaches: Array<string> = [];
    let rest: string = PROXMOX_NOTIFICATION_WEBHOOK_BODY;
    while (rest.includes("{{")) {
      const start: number = rest.indexOf("{{");
      const end: number = rest.indexOf("}}", start);
      mustaches.push(rest.substring(start + 2, end).trim());
      rest = rest.substring(end + 2);
    }
    for (const mustache of mustaches) {
      const isBlock: boolean =
        mustache.startsWith("#if ") || mustache === "/if";
      const isTimestamp: boolean = mustache === "timestamp";
      expect(isBlock || isTimestamp || mustache.startsWith("json ")).toBe(true);
    }
    // The optional fields are written only when the notification has them.
    expect(mustaches).toContain("#if fields.hostname");
    expect(mustaches).toContain("#if fields.[job-id]");
  });

  test("sends JSON with the ingestion key read from the target's secret", () => {
    expect(PROXMOX_NOTIFICATION_WEBHOOK_HEADERS).toEqual([
      { name: "Content-Type", value: "application/json" },
      { name: "x-oneuptime-token", value: "{{ secrets.token }}" },
    ]);
  });
});

describe("ProxmoxNotifications - the setup commands", () => {
  const KEY: string = "5a000000-0000-4000-8000-000000000001";

  /*
   * What a shell on a node runs: pvesh stands in as a function printing
   * each argument on a line, so the real quoting and the real base64 of
   * the command decide what Proxmox VE's API would receive.
   */
  function runInShell(commands: string): Array<Array<string>> {
    const shell: SpawnSyncReturns<string> = spawnSync(
      "bash",
      [
        "-c",
        `set -e\npvesh() { printf '%s\\n' "$@"; printf '%s\\n' '--end--'; }\n${commands}`,
      ],
      { encoding: "utf8" },
    );
    expect(shell.stderr).toBe("");
    expect(shell.status).toBe(0);
    return shell.stdout
      .split("--end--\n")
      .filter((chunk: string): boolean => {
        return chunk.length > 0;
      })
      .map((chunk: string): Array<string> => {
        return chunk.split("\n").filter((argument: string): boolean => {
          return argument.length > 0;
        });
      });
  }

  function valuesOf(argv: Array<string>, option: string): Array<string> {
    const values: Array<string> = [];
    argv.forEach((argument: string, index: number) => {
      if (argument === option) {
        values.push(argv[index + 1] as string);
      }
    });
    return values;
  }

  function decodeProperty(property: string): { name: string; value: string } {
    const [namePart, valuePart] = property.split(",");
    expect(namePart?.startsWith("name=")).toBe(true);
    expect(valuePart?.startsWith("value=")).toBe(true);
    return {
      name: (namePart as string).substring("name=".length),
      value: Buffer.from(
        (valuePart as string).substring("value=".length),
        "base64",
      ).toString("utf8"),
    };
  }

  test("create the webhook target, then a matcher that sends every notification to it", () => {
    const [target, matcher] = runInShell(
      buildProxmoxNotificationSetupCommands({
        oneUptimeUrl: "https://oneuptime.com",
        clusterName: "pve-prod",
        ingestionKey: KEY,
      }),
    ) as [Array<string>, Array<string>];

    expect(target.slice(0, 4)).toEqual([
      "create",
      "/cluster/notifications/endpoints/webhook",
      "--name",
      PROXMOX_NOTIFICATION_TARGET_NAME,
    ]);
    expect(valuesOf(target, "--method")).toEqual(["post"]);
    expect(valuesOf(target, "--url")).toEqual([
      "https://oneuptime.com/otlp/v1/logs",
    ]);
    expect(valuesOf(target, "--header").map(decodeProperty)).toEqual([
      { name: "Content-Type", value: "application/json" },
      { name: "x-oneuptime-token", value: "{{ secrets.token }}" },
    ]);
    expect(valuesOf(target, "--secret").map(decodeProperty)).toEqual([
      { name: "token", value: KEY },
      { name: "cluster", value: "pve-prod" },
    ]);
    expect(
      Buffer.from(valuesOf(target, "--body")[0] as string, "base64").toString(
        "utf8",
      ),
    ).toBe(PROXMOX_NOTIFICATION_WEBHOOK_BODY);

    // A matcher with no match rules: Proxmox VE sends it everything.
    expect(matcher).toEqual([
      "create",
      "/cluster/notifications/matchers",
      "--name",
      PROXMOX_NOTIFICATION_TARGET_NAME,
      "--target",
      PROXMOX_NOTIFICATION_TARGET_NAME,
      "--comment",
      "Every notification, to OneUptime",
    ]);
  });

  test("the key and the cluster's name stay readable in the command, never in the body", () => {
    const commands: string = buildProxmoxNotificationSetupCommands({
      oneUptimeUrl: "https://oneuptime.com",
      clusterName: "pve-prod",
      ingestionKey: KEY,
    });
    expect(commands).toContain(`printf %s '${KEY}' | base64 -w0`);
    expect(commands).toContain("printf %s 'pve-prod' | base64 -w0");
    expect(PROXMOX_NOTIFICATION_WEBHOOK_BODY).not.toContain(KEY);
    expect(PROXMOX_NOTIFICATION_WEBHOOK_BODY).not.toContain("pve-prod");
  });

  test("with no key yet, the placeholder is what the secret holds, for the reader to replace", () => {
    const [target] = runInShell(
      buildProxmoxNotificationSetupCommands({
        oneUptimeUrl: "https://oneuptime.com",
        clusterName: "my-proxmox-cluster",
        ingestionKey: "<YOUR_API_KEY>",
      }),
    ) as [Array<string>];
    expect(valuesOf(target, "--secret").map(decodeProperty)[0]).toEqual({
      name: "token",
      value: "<YOUR_API_KEY>",
    });
  });

  test.each([
    ["https://oneuptime.acme.com/", "https://oneuptime.acme.com/otlp/v1/logs"],
    ["https://acme.com/oneuptime//", "https://acme.com/oneuptime/otlp/v1/logs"],
    ["http://10.0.0.5:8080", "http://10.0.0.5:8080/otlp/v1/logs"],
    ["  https://oneuptime.com  ", "https://oneuptime.com/otlp/v1/logs"],
  ])("the logs URL of %p is %p", (url: string, expected: string) => {
    expect(getProxmoxNotificationLogsUrl(url)).toBe(expected);
  });

  test("a cluster name, key or URL with shell characters never changes the command a shell runs", () => {
    const clusterName: string = `it's "prod" $(echo injected) \`echo injected\` ; echo hi`;
    const key: string = `k'ey" $(id)`;
    const url: string = "https://oneuptime.acme.com/a'b";
    const invocations: Array<Array<string>> = runInShell(
      buildProxmoxNotificationSetupCommands({
        oneUptimeUrl: url,
        clusterName: clusterName,
        ingestionKey: key,
      }),
    );

    expect(invocations).toHaveLength(2);
    const target: Array<string> = invocations[0] as Array<string>;
    expect(valuesOf(target, "--url")).toEqual([
      "https://oneuptime.acme.com/a'b/otlp/v1/logs",
    ]);
    expect(valuesOf(target, "--secret").map(decodeProperty)).toEqual([
      { name: "token", value: key },
      { name: "cluster", value: clusterName },
    ]);
    expect(valuesOf(target, "--comment")).toEqual([
      "Sends this cluster's notifications to OneUptime",
    ]);
  });

  test("the remove commands take the matcher away first, then the target", () => {
    expect(buildProxmoxNotificationRemoveCommands()).toBe(
      [
        `pvesh delete /cluster/notifications/matchers/${PROXMOX_NOTIFICATION_TARGET_NAME}`,
        `pvesh delete /cluster/notifications/endpoints/webhook/${PROXMOX_NOTIFICATION_TARGET_NAME}`,
      ].join("\n"),
    );
  });
});

describe("ProxmoxNotifications - durations and sizes as Proxmox VE writes them", () => {
  test.each([
    ["0s", 0],
    ["41s", 41],
    ["3m 32s", 212],
    ["1h 1m 40s", 3700],
    ["2d 3h", 2 * 86400 + 3 * 3600],
    ["1w 1s", 7 * 86400 + 1],
    ["0.5s", 0.5],
    ["<0.1s", 0.1],
  ])("%p is %p seconds", (text: string, seconds: number) => {
    expect(parseProxmoxDuration(text)).toBe(seconds);
  });

  test.each(["", "3 minutes", "3x", "s", "1.2.3s", "ok", "-3s"])(
    "%p is no duration",
    (text: string) => {
      expect(parseProxmoxDuration(text)).toBeNull();
    },
  );

  test.each([
    ["0 B", 0],
    ["512 B", 512],
    ["1.5 KiB", 1536],
    ["512 MiB", 512 * 1024 * 1024],
    ["18.4 GiB", Math.round(18.4 * 1024 ** 3)],
    ["2 TiB", 2 * 1024 ** 4],
    ["3 GB", 3 * 1000 ** 3],
  ])("%p is %p bytes", (text: string, bytes: number) => {
    expect(parseProxmoxBytes(text)).toBe(bytes);
  });

  test.each(["", "18.4", "GiB", "18.4 GB extra", "x GiB", "18,4 GiB"])(
    "%p is no size",
    (text: string) => {
      expect(parseProxmoxBytes(text)).toBeNull();
    },
  );
});

describe("ProxmoxNotifications - a backup job's guests", () => {
  test("every guest of a successful job, with its time, size and file", () => {
    expect(parseProxmoxBackupDetails(SUCCESS_MESSAGE)).toEqual([
      {
        vmid: 100,
        name: "web-01",
        status: "ok",
        durationSeconds: 212,
        bytes: Math.round(18.4 * 1024 ** 3),
        filename: "vzdump-qemu-100-2026_11_01-01_00_02.vma.zst",
      },
      {
        vmid: 103,
        name: "cache-01",
        status: "ok",
        durationSeconds: 18,
        bytes: Math.round(1.2 * 1024 ** 3),
        filename: "vzdump-lxc-103-2026_11_01-01_03_34.tar.zst",
      },
    ] as Array<ProxmoxBackupGuestResult>);
  });

  test("a failed job: err and a guest it never got to are failures, a name with a space is kept", () => {
    const guests: Array<ProxmoxBackupGuestResult> =
      parseProxmoxBackupDetails(FAILURE_MESSAGE);

    expect(
      guests.map((guest: ProxmoxBackupGuestResult) => {
        return [guest.vmid, guest.name, guest.status, guest.durationSeconds];
      }),
    ).toEqual([
      [100, "web-01", "ok", 3700],
      [102, "db-01", "failed", 41],
      [104, "VM 104", "failed", 0],
    ]);
    // A PBS snapshot path is the file; a failed guest has no file, size 0.
    expect(guests[0]?.filename).toBe("vm/100/2026-11-01T01:00:02Z");
    expect(guests[1]?.bytes).toBe(0);
    expect(guests[1]?.filename).toBeNull();
    expect(guests[2]?.filename).toBeNull();
  });

  test("Windows line endings read the same", () => {
    expect(
      parseProxmoxBackupDetails(SUCCESS_MESSAGE.split("\n").join("\r\n")),
    ).toEqual(parseProxmoxBackupDetails(SUCCESS_MESSAGE));
  });

  test("the logs after the table are never read as guests", () => {
    const message: string = vzdumpMessage({
      rows: [["100", "web-01", "ok", "18s", "1 GiB", "a.vma.zst"]],
      logs: "101     sneaky     ok     1s     1 B     b.vma.zst\n102 VM ok 1s 1 B c",
    });
    expect(
      parseProxmoxBackupDetails(message).map(
        (guest: ProxmoxBackupGuestResult): number => {
          return guest.vmid;
        },
      ),
    ).toEqual([100]);
  });

  test.each([
    ["no message", null],
    ["an empty message", ""],
    [
      "a replication failure",
      "Replication job '100-0' failed: no route to host",
    ],
    [
      "a job that failed before any guest ran",
      "could not activate storage 'pbs-offsite': connection refused\nDetails\n=======\n\nTotal running time: 1s",
    ],
    [
      "a Details heading without its underline",
      "Details\nVMID Name Status\n100 a ok 1s 1 B f",
    ],
  ] as Array<[string, string | null]>)(
    "%s has no guests",
    (_label: string, message: string | null) => {
      expect(parseProxmoxBackupDetails(message)).toEqual([]);
    },
  );

  test("rows that are not a guest's are skipped, the rest kept", () => {
    const message: string = [
      "Details",
      "=======",
      "VMID    Name    Status    Time    Size    Filename",
      "abc     x       ok        1s      1 B     f",
      "0       zero    ok        1s      1 B     f",
      "105     noStatus",
      "106     fine    ok        1s      1 B     g.vma",
      "",
      "Total running time: 2s",
    ].join("\n");
    expect(
      parseProxmoxBackupDetails(message).map(
        (guest: ProxmoxBackupGuestResult): number => {
          return guest.vmid;
        },
      ),
    ).toEqual([106]);
  });

  test("a table longer than any cluster stops at the bound", () => {
    const rows: Array<string> = [];
    for (let vmid: number = 1; vmid <= MAX_PROXMOX_BACKUP_ROWS + 5; vmid++) {
      rows.push(`${vmid}    g${vmid}    ok    1s    1 B    f${vmid}`);
    }
    const message: string = `Details\n=======\nVMID    Name    Status    Time    Size    Filename\n${rows.join("\n")}\n\nTotal running time: 1s`;
    expect(parseProxmoxBackupDetails(message)).toHaveLength(
      MAX_PROXMOX_BACKUP_ROWS,
    );
  });

  /*
   * The message holds the whole backup log, written by Proxmox VE - outside
   * text - so reading it must take time in line with its length. The worst
   * case for a token reader is one enormous row: 400,000 characters of
   * single-character tokens after a status word.
   */
  test("400,000 characters of the worst row take time in line with them", () => {
    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        const message: string = `Details\n=======\nVMID    Name    Status\n100 name ok ${"1 ".repeat(200_000)}\n`;
        return parseProxmoxBackupDetails(message).length;
      },
      limitInMs: 2000,
    });
    expect(run.result).toBe(1);
    expect(run.inMs).toBeLessThan(2000);
  });
});

describe("ProxmoxNotifications - a record at ingest", () => {
  function attributes(fields: Record<string, string>): Record<string, unknown> {
    return {
      "resource.proxmox.cluster.name": "pve-prod",
      [`resource.${PROXMOX_NOTIFICATION_NODE_ATTRIBUTE}`]: "pve1",
      ...fields,
    };
  }

  test("only a record that carries its type is a notification", () => {
    expect(
      isProxmoxNotificationLogRecord(
        attributes({ [ProxmoxNotificationAttribute.Type]: "vzdump" }),
      ),
    ).toBe(true);
    expect(isProxmoxNotificationLogRecord(attributes({}))).toBe(false);
    expect(
      isProxmoxNotificationLogRecord(
        attributes({ [ProxmoxNotificationAttribute.Type]: "  " }),
      ),
    ).toBe(false);
    expect(isProxmoxNotificationLogRecord(null)).toBe(false);
    expect(isProxmoxNotificationLogRecord(undefined)).toBe(false);
  });

  test("a failed backup job is an error, from its node and job, with each guest's result", () => {
    const stamp: ProxmoxNotificationStamp | null = stampProxmoxNotification({
      attributes: attributes({
        [ProxmoxNotificationAttribute.Type]: "vzdump",
        [ProxmoxNotificationAttribute.Severity]: "error",
        [ProxmoxNotificationAttribute.JobId]: "backup-6c6a2f1e-2b4d",
      }),
      body: FAILURE_MESSAGE,
    });

    expect(stamp).toMatchObject({
      type: "vzdump",
      severity: "error",
      severityNumber: 17,
      jobId: "backup-6c6a2f1e-2b4d",
      nodeName: "pve1",
    });
    expect(stamp?.backupResults).toHaveLength(3);
  });

  test("a notification of another kind carries no backup results, whatever its message says", () => {
    const stamp: ProxmoxNotificationStamp | null = stampProxmoxNotification({
      attributes: attributes({
        [ProxmoxNotificationAttribute.Type]: "fencing",
        [ProxmoxNotificationAttribute.Severity]: "error",
      }),
      body: SUCCESS_MESSAGE,
    });

    expect(stamp?.backupResults).toEqual([]);
    expect(stamp?.jobId).toBeNull();
    expect(stamp?.severityNumber).toBe(17);
  });

  test("a record without a severity is unknown, and the node may come without the resource prefix", () => {
    const stamp: ProxmoxNotificationStamp | null = stampProxmoxNotification({
      attributes: {
        [ProxmoxNotificationAttribute.Type]: "system-mail",
        [PROXMOX_NOTIFICATION_NODE_ATTRIBUTE]: "pve2",
      },
      body: "mail for root",
    });

    expect(stamp).toMatchObject({
      severity: "unknown",
      severityNumber: 0,
      nodeName: "pve2",
    });
  });

  test("any other record is not stamped", () => {
    expect(
      stampProxmoxNotification({ attributes: attributes({}), body: "hello" }),
    ).toBeNull();
  });
});
