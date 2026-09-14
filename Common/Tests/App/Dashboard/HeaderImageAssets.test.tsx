import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * The shape esbuild's file-loader actually hands these components: the imported
 * asset inlined as a "data:" URL (Common/UI/esbuild-config.js,
 * createFileLoaderPlugin). Every existing suite that mocks an .svg mocks it as
 * a plain path like "/blank-profile.svg" — which is exactly the shape that does
 * NOT reproduce this bug, and why the whole test suite stayed green while every
 * dashboard and admin page threw on first render.
 *
 * The "//" in the base64 payload is deliberate. Route collapses /+ into a
 * single /, so the tempting "just let Route accept data: URLs" fix would
 * silently corrupt the image — this payload makes that fix fail here too.
 *
 * ONE constant and ONE jest.mock for both assets on purpose: Common's
 * jest.config.json maps every .svg to Tests/__mocks__/styleMock.js, so two
 * jest.mock() calls naming two different .svg paths resolve to the same module
 * and only the last factory would ever register.
 */
const ASSET_DATA_URL: string = "data:image/svg+xml;base64,////bG9nbw==";

jest.mock("../../../UI/Images/logos/OneUptimeSVG/3-transparent.svg", () => {
  return ASSET_DATA_URL;
});

import DashboardLogo from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Logo";
import AdminDashboardLogo from "../../../../App/FeatureSet/AdminDashboard/src/Components/Header/Logo";
import Image from "../../../UI/Components/Image/Image";

/*
 * Regression cover for the crash that blocked every release from 2026-08-31.
 *
 * b2d2da71e8 taught Route to reject scheme-prefixed strings — correctly, it
 * guards an open-redirect. But these components were laundering an <img> src
 * through Route.fromString() purely to satisfy Image's prop type, and an
 * esbuild-inlined asset src is always "data:"-prefixed. So Route threw during
 * render, React unwound to the error boundary, and the dashboard never painted.
 *
 * An image src is not a Route. What these pin is that the header renders the
 * asset straight through as an <img src>, with no Route in the path.
 */
describe("header image assets", () => {
  test("the dashboard logo renders the inlined asset as its src", () => {
    render(
      <DashboardLogo
        onClick={() => {
          // no-op: the click target is not what regressed.
        }}
      />,
    );

    const logo: HTMLElement = screen.getByAltText("OneUptime");
    expect(logo).toHaveAttribute("src", ASSET_DATA_URL);
  });

  test("the admin dashboard logo renders the inlined asset as its src", () => {
    render(
      <AdminDashboardLogo
        onClick={() => {
          // no-op
        }}
      />,
    );

    const logo: HTMLElement = screen.getByAltText("OneUptime");
    expect(logo).toHaveAttribute("src", ASSET_DATA_URL);
  });

  /*
   * Straight at the type misuse rather than at one component: any scheme-
   * prefixed src has to survive <Image>. Before the fix this threw inside
   * Route.fromString at the call sites; now the string reaches <img> untouched.
   */
  test("Image passes a data: URL through to src without validating it", () => {
    render(<Image imageUrl={ASSET_DATA_URL} alt="asset" />);

    expect(screen.getByAltText("asset")).toHaveAttribute("src", ASSET_DATA_URL);
  });

  /*
   * An empty src must not fall through to the `file` branch and throw
   * "file or imageUrl required" — it renders an empty <img>, keeping the node
   * (and its test id) in the DOM.
   */
  test("an empty src renders an image rather than throwing", () => {
    render(<Image imageUrl="" alt="empty" data-testid="empty-image" />);

    expect(screen.getByTestId("empty-image")).toHaveAttribute("src", "");
  });
});
