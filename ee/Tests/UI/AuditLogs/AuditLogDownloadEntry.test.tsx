import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";
import AuditLogChangesModal from "../../../Dashboard/AuditLogs/AuditLogChangesModal";

/*
 * A Download entry - someone took a copy of a packet capture's pcap file -
 * reads as what it is: not a change, so no "fields changed" and no before
 * and after, but what was downloaded. The table gives the action a badge of
 * its own.
 */

afterEach(() => {
  cleanup();
});

describe("the details of a Download entry", () => {
  test("say what was downloaded, field by field", () => {
    render(
      <AuditLogChangesModal
        isOpen={true}
        onClose={jest.fn()}
        action="Download"
        resourceType="Packet Capture"
        resourceName="eth0: host 10.0.0.5"
        changes={[
          { field: "interfaceName", newValue: "eth0" },
          { field: "bpfFilter", newValue: "host 10.0.0.5" },
          { field: "packetCount", newValue: 42 },
        ]}
      />,
    );

    expect(
      screen.getByText("Download · Packet Capture — eth0: host 10.0.0.5"),
    ).toBeInTheDocument();
    expect(screen.getByText("What was downloaded")).toBeInTheDocument();
    expect(screen.queryByText(/fields? changed/)).not.toBeInTheDocument();
    expect(screen.queryByText("Before")).not.toBeInTheDocument();
    expect(screen.getByText("Interface Name")).toBeInTheDocument();
    expect(screen.getByText("host 10.0.0.5")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});

describe("the Download badge", () => {
  const table: string = fs.readFileSync(
    path.join(__dirname, "../../../Dashboard/AuditLogs/AuditLogsTable.tsx"),
    "utf8",
  );

  test("the table styles the Download action with a label and an icon of its own", () => {
    const start: number = table.indexOf("Download: {");

    expect(start).toBeGreaterThan(-1);

    const style: string = table.substring(start, table.indexOf("},", start));

    expect(style).toContain('label: "Download"');
    expect(style).toContain("icon: IconProp.Download");
  });
});
