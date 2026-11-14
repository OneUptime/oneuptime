import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import AppLink from "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink";
import {
  DashboardWidgetPreviewProvider,
  useIsDashboardWidgetPreview,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetPreview";
import Route from "../../../Types/API/Route";

/*
 * THE PREVIEW'S PROVIDER WITH AppLink STOOD IN FOR (issue #6859).
 *
 * Many suites draw widgets with AppLink replaced by a plain span, its
 * module mocked down to a default export. The widget settings' preview
 * draws every widget inside DashboardWidgetPreviewProvider, which gives
 * AppLink its words-only context - so that context lives in a module of
 * its own (AppLink/AppLinkAsText). Read from AppLink's module, a mock that
 * leaves it out made the provider throw, and the preview drew no widget:
 * the Sort setting's preview headers were the first suite to go.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return <span data-testid="stand-in-link">{props.children}</span>;
      },
    };
  },
);

function Widget(): ReactElement {
  const isPreview: boolean = useIsDashboardWidgetPreview();

  return (
    <div>
      <output data-testid="widget-reads-preview">{String(isPreview)}</output>
      <AppLink to={new Route("/dashboard/project/monitors/view/1")}>
        checkout
      </AppLink>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe("the preview's provider, with AppLink mocked to its default alone", () => {
  test.each([true, false])(
    "isPreview %s: the widget is drawn, reads the preview, and its link is the stand-in",
    (isPreview: boolean) => {
      render(
        <DashboardWidgetPreviewProvider isPreview={isPreview}>
          <Widget />
        </DashboardWidgetPreviewProvider>,
      );

      expect(screen.getByTestId("widget-reads-preview")).toHaveTextContent(
        String(isPreview),
      );
      expect(screen.getByTestId("stand-in-link")).toHaveTextContent("checkout");
    },
  );
});
