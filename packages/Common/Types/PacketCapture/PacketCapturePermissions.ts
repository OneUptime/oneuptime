import Permission from "../Permission";
import ProductKey from "../Product/ProductKey";
import { withProductLevelsOf } from "../Product/ProductLevels";

/*
 * Who may do what with a packet capture, outside the table's own lists.
 *
 * Starting a capture is a create, so the PacketCapture model's create list
 * decides it. Stopping one is part of starting it - whoever may start a
 * capture may end one early - and downloading its file is a permission of
 * its own, because the file holds the traffic itself: passwords, tokens and
 * personal data that crossed the wire. Both are checked by the packet
 * capture routes (Server/API/PacketCaptureAPI), and the dashboard shows the
 * Stop and Download buttons by the same lists.
 *
 * Kept free of server and React code, so the server, the dashboard and the
 * tests read the same lists. A test holds PACKET_CAPTURE_START_PERMISSIONS
 * to the model's create list.
 */

/*
 * Who may start a capture: the PacketCapture model's create list, with
 * Network's levels as the model's list takes them (Types/Product/
 * ProductLevels): Network Admin, as Project Admin.
 */
export const PACKET_CAPTURE_START_PERMISSIONS: ReadonlyArray<Permission> =
  withProductLevelsOf({
    products: [ProductKey.Network],
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreatePacketCapture,
    ],
  });

// Who may stop a running capture: whoever may start one.
export const PACKET_CAPTURE_STOP_PERMISSIONS: ReadonlyArray<Permission> = [
  ...PACKET_CAPTURE_START_PERMISSIONS,
];

// Who may download a capture's pcap file: Network Admin too, as Project Admin.
export const PACKET_CAPTURE_DOWNLOAD_PERMISSIONS: ReadonlyArray<Permission> =
  withProductLevelsOf({
    products: [ProductKey.Network],
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.DownloadPacketCapture,
    ],
  });

export const PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE: string =
  "You do not have permission to download packet captures. Ask a Project Admin for the Download Packet Capture permission.";

export const PACKET_CAPTURE_STOP_REFUSED_MESSAGE: string =
  "You do not have permission to stop packet captures. Ask a Project Admin for the Start Packet Capture permission.";

export const PACKET_CAPTURE_NOT_FOUND_MESSAGE: string =
  "This packet capture was not found.";
