import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An empty Exceptions or Logs chart, or the empty Logs page, whose telemetry
 * is refused at ingest (issue #6378): the fix is its one action - another
 * key in a dialog the page opens, or a link to the refused key's page, the
 * project's budgets or Billing.
 */

const navigateMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>): unknown => {
        return navigateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000063");
      },
    },
  };
});

// A plain anchor, so hrefs can be read without a router.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        className?: string;
        dataTestId?: string;
        children: React.ReactNode;
      }) => {
        return (
          <a
            href={props.to ? props.to.toString() : ""}
            className={props.className}
            data-testid={props.dataTestId}
          >
            {props.children}
          </a>
        );
      },
    };
  },
);

import RumSignalEmptyState, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalEmptyState";
import {
  RumSignalAction,
  RumSignalEmptyCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalWords";
import Route from "../../../Types/API/Route";
import Icon from "../../../UI/Components/Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";

const PROJECT: string = "10000000-0000-4000-8000-000000000063";
const KEY_ID: string = "6c3d0000-0000-4000-8000-0000000000d4";

// The shape an icon draws, to tell one icon from another.
function shapeOf(icon: IconProp): string {
  const drawn: { container: HTMLElement; unmount: () => void } = render(
    <Icon icon={icon} />,
  );
  const shape: string = drawn.container.querySelector("svg")?.innerHTML || "";
  drawn.unmount();
  return shape;
}

const DOCUMENTATION: Route = new Route("/dashboard/p/rum/a/documentation");

function refused(action: RumSignalAction | undefined): RumSignalEmptyCopy {
  return {
    title: "Logs are being refused",
    detail:
      'The key "Storefront browser key" is turned off, so everything sent with it is refused.',
    evidence: "The latest was refused 4 minutes ago.",
    action,
    helpLink: {
      text: "Why nothing arrives",
      url: "/docs/rum/troubleshooting#exceptions-or-logs-are-empty",
    },
  };
}

const onPickKey: MockFunction = getJestMockFunction();
const onSetUp: MockFunction = getJestMockFunction();

function draw(
  props: Partial<ComponentProps> & { copy: RumSignalEmptyCopy },
): void {
  render(
    <RumSignalEmptyState
      signal="logs"
      state="not-arriving"
      variant="chart"
      documentationRoute={DOCUMENTATION}
      onSetUp={(...args: Array<unknown>): void => {
        onSetUp(...args);
      }}
      onPickKey={(): void => {
        onPickKey();
      }}
      {...props}
    />,
  );
}

beforeEach(() => {
  for (const mock of [navigateMock, onPickKey, onSetUp]) {
    mock.mockReset();
  }
});

afterEach(() => {
  cleanup();
});

interface LinkCase {
  action: RumSignalAction;
  href: string;
  icon: IconProp;
}

const LINKS: Array<LinkCase> = [
  {
    action: { kind: "open-key", label: "Open the key", keyId: KEY_ID },
    href: `/dashboard/${PROJECT}/settings/telemetry-ingestion-keys/${KEY_ID}`,
    icon: IconProp.Key,
  },
  {
    action: { kind: "budgets", label: "See budgets" },
    href: `/dashboard/${PROJECT}/settings/usage-history`,
    icon: IconProp.ChartBar,
  },
  {
    action: { kind: "billing", label: "Add a payment method" },
    href: `/dashboard/${PROJECT}/settings/billing`,
    icon: IconProp.Billing,
  },
];

describe("an empty chart whose telemetry is refused", () => {
  test("says why and when, with Pick another key opening the page's dialog", () => {
    draw({ copy: refused({ kind: "pick-key", label: "Pick another key" }) });

    expect(screen.getByTestId("rum-logs-empty-title")).toHaveTextContent(
      "Logs are being refused",
    );
    expect(screen.getByTestId("rum-logs-empty-evidence")).toHaveTextContent(
      "The latest was refused 4 minutes ago.",
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Pick another key",
    });
    expect(button.querySelector("svg")?.innerHTML).toBe(shapeOf(IconProp.Key));
    fireEvent.click(button);

    expect(onPickKey).toHaveBeenCalledTimes(1);
    expect(onSetUp).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("a page that cannot open the dialog does not offer it, and still links why nothing arrives", () => {
    draw({
      copy: refused({ kind: "pick-key", label: "Pick another key" }),
      onPickKey: undefined,
    });

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("rum-logs-empty-help")).toHaveTextContent(
      "Why nothing arrives",
    );
  });

  test.each(LINKS)(
    "$action.kind links to where it is put right",
    ({ action, href, icon }: LinkCase) => {
      draw({ copy: refused(action) });

      const link: HTMLElement = screen.getByRole("link", {
        name: action.label,
      });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("data-testid", "rum-logs-empty-action");
      expect(link.querySelector("svg")?.innerHTML).toBe(shapeOf(icon));
    },
  );

  test("a refusal nothing here puts right draws no action", () => {
    draw({ copy: refused(undefined) });

    expect(screen.queryByTestId("rum-logs-empty-action")).toBeNull();
    expect(screen.getByTestId("rum-logs-empty-detail")).toHaveTextContent(
      "is turned off",
    );
  });
});

describe("the empty Logs page whose logs are refused", () => {
  test("Pick another key is the page's action, and opens its dialog", () => {
    draw({
      copy: refused({ kind: "pick-key", label: "Pick another key" }),
      variant: "page",
    });

    expect(screen.getByTestId("rum-logs-empty-note")).toHaveTextContent(
      "The latest was refused 4 minutes ago.",
    );
    fireEvent.click(screen.getByTestId("rum-logs-empty-action"));
    expect(onPickKey).toHaveBeenCalledTimes(1);
  });

  test.each(LINKS)(
    "$action.kind navigates to where it is put right",
    ({ action, href }: LinkCase) => {
      draw({ copy: refused(action), variant: "page" });

      fireEvent.click(screen.getByTestId("rum-logs-empty-action"));

      expect(navigateMock).toHaveBeenCalledTimes(1);
      expect((navigateMock.mock.calls[0]![0] as Route).toString()).toBe(href);
    },
  );

  test("without the dialog, only the help link", () => {
    draw({
      copy: refused({ kind: "pick-key", label: "Pick another key" }),
      variant: "page",
      onPickKey: undefined,
    });

    expect(screen.queryByTestId("rum-logs-empty-action")).toBeNull();
    expect(screen.getByTestId("rum-logs-empty-help")).toBeInTheDocument();
  });
});
