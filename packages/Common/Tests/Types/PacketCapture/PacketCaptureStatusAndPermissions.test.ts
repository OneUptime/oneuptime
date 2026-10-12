import PacketCapture from "../../../Models/DatabaseModels/PacketCapture";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import PacketCaptureEndReason, {
  PacketCaptureEndReasonUtil,
} from "../../../Types/PacketCapture/PacketCaptureEndReason";
import {
  MAX_RUNNING_PACKET_CAPTURE_IDS_PER_REQUEST,
  PACKET_CAPTURE_PROBE_CONCURRENCY,
} from "../../../Types/PacketCapture/PacketCaptureJob";
import { PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE } from "../../../Types/PacketCapture/PacketCaptureLimits";
import {
  PACKET_CAPTURE_DOWNLOAD_PERMISSIONS,
  PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE,
  PACKET_CAPTURE_START_PERMISSIONS,
  PACKET_CAPTURE_STOP_PERMISSIONS,
  PACKET_CAPTURE_STOP_REFUSED_MESSAGE,
} from "../../../Types/PacketCapture/PacketCapturePermissions";
import PacketCaptureStatus, {
  ACTIVE_PACKET_CAPTURE_STATUSES,
  PacketCaptureStatusUtil,
  SETTLED_PACKET_CAPTURE_STATUSES,
} from "../../../Types/PacketCapture/PacketCaptureStatus";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The words a capture's status and end reason are stored as, and who may
 * do what with a capture. Starting one and downloading its file are
 * separate permissions on purpose - the file holds the traffic itself - and
 * both belong to project owners and admins by default, never to every
 * member: these tests hold the lists the routes and the dashboard read to
 * the model's own.
 */

function sorted(permissions: ReadonlyArray<Permission>): Array<Permission> {
  return [...permissions].sort();
}

function propsOf(permission: Permission): PermissionProps {
  const props: PermissionProps | undefined =
    PermissionHelper.getAllPermissionProps().find(
      (item: PermissionProps): boolean => {
        return item.permission === permission;
      },
    );

  expect(props).toBeDefined();

  return props as PermissionProps;
}

describe("PacketCaptureStatus", () => {
  test("is stored as the four words the claim query, the sweep and the dashboard read", () => {
    expect(PacketCaptureStatusUtil.getAll()).toEqual([
      "Pending",
      "Running",
      "Completed",
      "Failed",
    ]);
    expect(Object.values(PacketCaptureStatus).sort()).toEqual(
      [...PacketCaptureStatusUtil.getAll()].sort(),
    );
  });

  test("a status is active or settled, never both", () => {
    expect([...ACTIVE_PACKET_CAPTURE_STATUSES]).toEqual([
      PacketCaptureStatus.Pending,
      PacketCaptureStatus.Running,
    ]);
    expect([...SETTLED_PACKET_CAPTURE_STATUSES]).toEqual([
      PacketCaptureStatus.Completed,
      PacketCaptureStatus.Failed,
    ]);

    for (const status of PacketCaptureStatusUtil.getAll()) {
      expect(
        PacketCaptureStatusUtil.isActive(status) !==
          PacketCaptureStatusUtil.isSettled(status),
      ).toBe(true);
    }
  });

  test("parse reads exactly the stored words", () => {
    expect(PacketCaptureStatusUtil.parse("Running")).toBe(
      PacketCaptureStatus.Running,
    );
    expect(PacketCaptureStatusUtil.parse("running")).toBeUndefined();
    expect(PacketCaptureStatusUtil.parse(" Running")).toBeUndefined();
    expect(PacketCaptureStatusUtil.parse(1)).toBeUndefined();
    expect(PacketCaptureStatusUtil.parse(null)).toBeUndefined();
  });

  test("nothing that is not a status is active or settled", () => {
    expect(PacketCaptureStatusUtil.isActive("Done")).toBe(false);
    expect(PacketCaptureStatusUtil.isSettled("Done")).toBe(false);
    expect(PacketCaptureStatusUtil.isActive(undefined)).toBe(false);
    expect(PacketCaptureStatusUtil.isSettled(undefined)).toBe(false);
  });
});

describe("PacketCaptureEndReason", () => {
  test("names each way a capture that ran can stop", () => {
    expect(PacketCaptureEndReasonUtil.getAll()).toEqual([
      "DurationReached",
      "PacketLimitReached",
      "FileSizeLimitReached",
      "StoppedFromDashboard",
      "CaptureToolStopped",
    ]);
    expect(Object.values(PacketCaptureEndReason).sort()).toEqual(
      [...PacketCaptureEndReasonUtil.getAll()].sort(),
    );
  });

  test("parse reads exactly the stored words", () => {
    expect(PacketCaptureEndReasonUtil.parse("DurationReached")).toBe(
      PacketCaptureEndReason.DurationReached,
    );
    expect(PacketCaptureEndReasonUtil.parse("durationreached")).toBeUndefined();
    expect(PacketCaptureEndReasonUtil.parse("Timeout")).toBeUndefined();
    expect(PacketCaptureEndReasonUtil.parse(undefined)).toBeUndefined();
    expect(PacketCaptureEndReasonUtil.parse({})).toBeUndefined();
  });
});

describe("how many captures a probe runs", () => {
  test("a probe runs as many at once as it may have active", () => {
    expect(PACKET_CAPTURE_PROBE_CONCURRENCY).toBe(2);
    expect(PACKET_CAPTURE_PROBE_CONCURRENCY).toBe(
      PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE,
    );
  });

  test("a list request may name more running captures than a probe runs", () => {
    expect(MAX_RUNNING_PACKET_CAPTURE_IDS_PER_REQUEST).toBeGreaterThan(
      PACKET_CAPTURE_PROBE_CONCURRENCY,
    );
  });
});

describe("who may start, stop, download and delete a capture", () => {
  const model: PacketCapture = new PacketCapture();

  test("starting a capture is the model's create list: owners, admins and Start Packet Capture", () => {
    expect(sorted(PACKET_CAPTURE_START_PERMISSIONS)).toEqual(
      sorted(model.createRecordPermissions),
    );
    expect(sorted(PACKET_CAPTURE_START_PERMISSIONS)).toEqual(
      sorted([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CreatePacketCapture,
      ]),
    );
  });

  test("whoever may start a capture may stop one", () => {
    expect(sorted(PACKET_CAPTURE_STOP_PERMISSIONS)).toEqual(
      sorted(PACKET_CAPTURE_START_PERMISSIONS),
    );
  });

  test("downloading a file is a permission of its own, held by owners and admins", () => {
    expect(sorted(PACKET_CAPTURE_DOWNLOAD_PERMISSIONS)).toEqual(
      sorted([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.DownloadPacketCapture,
      ]),
    );
    expect(PACKET_CAPTURE_DOWNLOAD_PERMISSIONS).not.toContain(
      Permission.CreatePacketCapture,
    );
    expect(PACKET_CAPTURE_DOWNLOAD_PERMISSIONS).not.toContain(
      Permission.ReadPacketCapture,
    );
  });

  test("no ordinary member or viewer may start, stop, download or delete a capture", () => {
    for (const permission of [
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadPacketCapture,
    ]) {
      expect(PACKET_CAPTURE_START_PERMISSIONS).not.toContain(permission);
      expect(PACKET_CAPTURE_STOP_PERMISSIONS).not.toContain(permission);
      expect(PACKET_CAPTURE_DOWNLOAD_PERMISSIONS).not.toContain(permission);
      expect(model.deleteRecordPermissions).not.toContain(permission);
    }
  });

  test("deleting is owners, admins and Delete Packet Capture", () => {
    expect(sorted(model.deleteRecordPermissions)).toEqual(
      sorted([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.DeletePacketCapture,
      ]),
    );
  });

  test("everyone in the project can see that captures ran", () => {
    expect(sorted(model.readRecordPermissions)).toEqual(
      sorted([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.ReadPacketCapture,
      ]),
    );
  });

  test("nothing about a capture can be edited once it is started", () => {
    expect(model.updateRecordPermissions).toEqual([]);

    const columns: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const [column, access] of Object.entries(columns)) {
      expect({ column: column, update: access.update }).toEqual({
        column: column,
        update: [],
      });
    }
  });

  test("the file is readable by nobody through the API: only the download route hands it out", () => {
    for (const column of ["file", "fileId"]) {
      const access: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      expect(access).not.toBeNull();
      expect(access!.read).toEqual([]);
      expect(access!.create).toEqual([]);
    }
  });

  test("what the probe and the server write cannot be posted with a new capture", () => {
    for (const column of [
      "status",
      "statusMessage",
      "endReason",
      "startedAt",
      "completedAt",
      "stopRequestedAt",
      "packetCount",
      "fileSizeInBytes",
      "name",
    ]) {
      expect({
        column: column,
        create: model.getColumnAccessControlFor(column)?.create,
      }).toEqual({ column: column, create: [] });
    }
  });

  test("the four permissions are named as the dashboard and the docs name them", () => {
    expect(propsOf(Permission.CreatePacketCapture).title).toBe(
      "Start Packet Capture",
    );
    expect(propsOf(Permission.DownloadPacketCapture).title).toBe(
      "Download Packet Capture",
    );
    expect(propsOf(Permission.DeletePacketCapture).title).toBe(
      "Delete Packet Capture",
    );
    expect(propsOf(Permission.ReadPacketCapture).title).toBe(
      "Read Packet Capture",
    );
  });

  test("each can be given to a team, and none of them is a role", () => {
    for (const permission of [
      Permission.CreatePacketCapture,
      Permission.DownloadPacketCapture,
      Permission.DeletePacketCapture,
      Permission.ReadPacketCapture,
    ]) {
      const props: PermissionProps = propsOf(permission);

      expect(props.isAssignableToTenant).toBe(true);
      expect(props.isRolePermission).toBe(false);
      expect(props.isAccessControlPermission).toBe(false);
    }
  });

  test("starting and downloading say why they are given out with care", () => {
    expect(propsOf(Permission.CreatePacketCapture).description).toContain(
      "records the network traffic itself",
    );
    expect(propsOf(Permission.DownloadPacketCapture).description).toContain(
      "passwords and personal data",
    );
    expect(propsOf(Permission.ReadPacketCapture).description).toContain(
      "cannot download their files",
    );
  });

  test("a refusal names the permission to ask for", () => {
    expect(PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE).toContain(
      propsOf(Permission.DownloadPacketCapture).title,
    );
    expect(PACKET_CAPTURE_STOP_REFUSED_MESSAGE).toContain(
      propsOf(Permission.CreatePacketCapture).title,
    );
  });
});
