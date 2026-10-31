import { describe, expect, test } from "@jest/globals";
import {
  COMMAND_WORD_KEPT_WHOLE_MAX_LENGTH,
  splitCommandAtAddressSlashes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/CommandDisplay";
import { SETUP_GUIDE_URL_PLACEHOLDER } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";

/*
 * Where a command drawn in a narrow column may break inside a word: a
 * resource's connection card shows its diagnostic command in a third of the
 * card, and the address it downloads from is longer than the column. A
 * browser broke it wherever the line ended ("https://oneuptime.com/instal" /
 * "l/proxmox-agent/..."); the pieces allow a break after each slash of the
 * path instead, and only in a word too long for a line.
 */

const DIAGNOSE: string =
  "curl -fsSL https://oneuptime.com/install/proxmox-agent/troubleshoot.sh -o troubleshoot.sh && bash troubleshoot.sh";

describe("splitCommandAtAddressSlashes", () => {
  test("joined, the pieces are the command, character for character", () => {
    for (const command of [
      DIAGNOSE,
      `curl -fsSL '${SETUP_GUIDE_URL_PLACEHOLDER}/install/docker-swarm-agent/troubleshoot.sh' -o troubleshoot.sh`,
      "docker ps --filter name=oneuptime-proxmox-agent",
      "  two  spaces\tand a tab\nand a line  ",
      "https://",
      "/",
      "",
    ]) {
      expect(splitCommandAtAddressSlashes(command).join("")).toBe(command);
    }
  });

  test("an address breaks after each slash of its path", () => {
    expect(splitCommandAtAddressSlashes(DIAGNOSE)).toEqual([
      "curl -fsSL https://oneuptime.com/",
      "install/",
      "proxmox-agent/",
      "troubleshoot.sh -o troubleshoot.sh && bash troubleshoot.sh",
    ]);
  });

  test("never between the two slashes after the scheme, nor right after them", () => {
    for (const piece of splitCommandAtAddressSlashes(
      "https://oneuptime.acme-corp.example:8443/install/vmware-agent/systemd/oneuptime-vmware-agent-native.service",
    )) {
      expect(piece.endsWith("://")).toBe(false);
      expect(piece.endsWith(":/")).toBe(false);
    }
  });

  test("a quoted placeholder address breaks the same way", () => {
    expect(
      splitCommandAtAddressSlashes(
        `curl -fsSL '${SETUP_GUIDE_URL_PLACEHOLDER}/install/docker-swarm-agent/troubleshoot.sh' -o troubleshoot.sh`,
      ),
    ).toEqual([
      `curl -fsSL '${SETUP_GUIDE_URL_PLACEHOLDER}/`,
      "install/",
      "docker-swarm-agent/",
      "troubleshoot.sh' -o troubleshoot.sh",
    ]);
  });

  test("a word short enough for a line keeps its slashes whole: it breaks at a space", () => {
    const path: string = "/opt/oneuptime-proxmox-agent";

    expect(path.length).toBeLessThanOrEqual(COMMAND_WORD_KEPT_WHOLE_MAX_LENGTH);
    expect(splitCommandAtAddressSlashes(`cd ${path}`)).toEqual([`cd ${path}`]);
  });

  test("a slash that ends an address is no break: nothing comes after it", () => {
    expect(
      splitCommandAtAddressSlashes(
        "open https://oneuptime.example.com/install/proxmox-agent/",
      ),
    ).toEqual([
      "open https://oneuptime.example.com/",
      "install/",
      "proxmox-agent/",
    ]);
  });
});
