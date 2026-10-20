import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import FlamegraphView, {
  FlamegraphNode,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/FlamegraphView";
import { PROFILE_ORIGIN_LABELS } from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileCopy";
import ProfileUtil, {
  ModuleCategory,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProfileUtil";
import { ProfileFrameOrigin } from "../../../Utils/Profiles/ProfileFrames";

/*
 * ONE VOCABULARY FOR WHOSE CODE A FRAME IS.
 *
 * The Profiler draws the flame graph (its legend and tooltip) beside the
 * function list and the function panel. All three name whose code a frame
 * is, so they use the same words: Your code, Library, Runtime, System. The
 * flame graph once said Dependencies and Native / kernel where the list
 * beside it said Library and System.
 */

const CATEGORY_ORIGINS: Array<[ModuleCategory, ProfileFrameOrigin]> = [
  ["own", ProfileFrameOrigin.Own],
  ["vendor", ProfileFrameOrigin.Dependency],
  ["runtime", ProfileFrameOrigin.Runtime],
  ["native", ProfileFrameOrigin.Native],
];

function frame(
  name: string,
  fileName: string,
  category: ModuleCategory,
  children: Array<FlamegraphNode> = [],
): FlamegraphNode {
  const childTotal: number = children.reduce(
    (sum: number, child: FlamegraphNode): number => {
      return sum + child.totalValue;
    },
    0,
  );

  return {
    name,
    fileName,
    lineNumber: 0,
    frameType: "",
    category,
    selfValue: 10,
    totalValue: 10 + childTotal,
    children,
  };
}

afterEach(() => {
  cleanup();
});

describe("whose code a frame is, said the same way everywhere", () => {
  test.each(CATEGORY_ORIGINS)(
    "the flame graph's %s frames read as the list's words",
    (category: ModuleCategory, origin: ProfileFrameOrigin) => {
      expect(ProfileUtil.getModuleCategoryLabel(category)).toBe(
        PROFILE_ORIGIN_LABELS[origin],
      );
    },
  );

  test("the flame graph's legend reads Your code, Library, Runtime and System", () => {
    const root: FlamegraphNode = frame("main", "src/server.ts", "own", [
      frame("Router.handle", "node_modules/express/router.js", "vendor"),
      frame("JSON.parse", "node:internal/json", "runtime"),
    ]);

    render(<FlamegraphView root={root} unit="nanoseconds" />);

    for (const word of ["Your code", "Library", "Runtime", "System"]) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
    expect(screen.queryByText("Dependencies")).toBeNull();
    expect(screen.queryByText("Native / kernel")).toBeNull();
  });
});
