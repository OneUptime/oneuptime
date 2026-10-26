import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";

/*
 * EXPORT JSON IN BULK ACTIONS (issue #5299).
 *
 * The export reads each selected row in full for the file. It used to read
 * them one after another; it now reads several at once through the shared
 * runner (runBulkAction) - and the file still lists the rows in the order
 * they were selected, whichever read came back first. The run cannot be
 * stopped: a read changes nothing, and a file of part of the selection
 * would read as all of it.
 *
 * The table itself is a stand-in that hands back the bulk actions
 * ModelTable gives it; the reads and the download are the network and
 * browser boundary, stubbed and watched.
 */

interface CapturedTableProps {
  bulkActions?: {
    buttons?: Array<{
      title: string;
      onClick: (props: unknown) => Promise<void>;
    }>;
  };
}

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../../UI/Components/ModelTable/BaseModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): ReactElement => {
      capturedTableProps = props;
      return <div data-testid="table-stand-in" />;
    },
  };
});

interface ExportRead {
  id: string;
  startedAt: number;
  finishedAt: number;
}

const exportReads: Array<ExportRead> = [];
let downloadedIds: Array<Array<string>> = [];
let failingIds: Array<string> = [];
let tick: number = 0;

jest.mock("../../../../UI/Utils/ModelImportExport", () => {
  return {
    __esModule: true,
    default: {
      fetchItemForExport: async (data: {
        modelId: { toString: () => string };
      }): Promise<unknown> => {
        const id: string = data.modelId.toString();
        const startedAt: number = ++tick;
        // Later rows answer sooner, so the answers come back out of order.
        const wait: number = 40 - Number(id.slice(-2)) * 3;

        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, Math.max(wait, 1));
        });

        exportReads.push({ id, startedAt, finishedAt: ++tick });

        if (failingIds.includes(id)) {
          throw new Error(`Could not read ${id}.`);
        }

        return { _id: id, exported: true };
      },
      downloadExportFile: (data: { items: Array<{ _id: string }> }): void => {
        downloadedIds.push(
          data.items.map((item: { _id: string }) => {
            return item._id;
          }),
        );
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import ModelTable, {
  ComponentProps as ModelTableProps,
} from "../../../../UI/Components/ModelTable/ModelTable";
import { BULK_ACTION_CONCURRENCY } from "../../../../UI/Components/BulkUpdate/BulkActionConcurrency";
import {
  BulkActionOnClickProps,
  BulkActionStartOptions,
  ProgressInfo,
} from "../../../../UI/Components/BulkUpdate/BulkUpdateForm";
import Monitor from "../../../../Models/DatabaseModels/Monitor";

const monitorId: (index: number) => string = (index: number): string => {
  return `77777777-7777-4777-8777-0000000000${String(index).padStart(2, "0")}`;
};

const monitors: (count: number) => Array<Monitor> = (
  count: number,
): Array<Monitor> => {
  const rows: Array<Monitor> = [];

  for (let index: number = 1; index <= count; index++) {
    const row: Monitor = new Monitor();
    row._id = monitorId(index);
    rows.push(row);
  }

  return rows;
};

interface ExportRun {
  progress: Array<ProgressInfo<Monitor>>;
  startOptions: Array<BulkActionStartOptions | undefined>;
  ends: number;
}

const runExport: (items: Array<Monitor>) => Promise<ExportRun> = async (
  items: Array<Monitor>,
): Promise<ExportRun> => {
  render(
    <ModelTable<Monitor>
      {...({
        modelType: Monitor,
        id: "monitors-table",
        name: "Monitors",
        singularName: "Monitor",
        pluralName: "Monitors",
        columns: [],
        filters: [],
        formFields: [],
        enableJsonImportExport: true,
        isDeleteable: false,
        isEditable: false,
        isCreateable: false,
        isViewable: false,
      } as unknown as ModelTableProps<Monitor>)}
    />,
  );

  const exportAction:
    | { title: string; onClick: (props: unknown) => Promise<void> }
    | undefined = capturedTableProps?.bulkActions?.buttons?.find(
    (button: { title: string }) => {
      return button.title === "Export JSON";
    },
  );

  expect(exportAction).toBeDefined();

  const run: ExportRun = { progress: [], startOptions: [], ends: 0 };

  await exportAction!.onClick({
    items: items,
    onProgressInfo: (info: ProgressInfo<Monitor>): void => {
      run.progress.push(info);
    },
    onBulkActionStart: (options?: BulkActionStartOptions): void => {
      run.startOptions.push(options);
    },
    onBulkActionEnd: (): void => {
      run.ends++;
    },
  } as BulkActionOnClickProps<Monitor>);

  return run;
};

// The most reads in flight at once.
const mostReadsAtOnce: () => number = (): number => {
  return Math.max(
    ...exportReads.map((read: ExportRead) => {
      return exportReads.filter((other: ExportRead) => {
        return (
          other.startedAt <= read.startedAt && read.startedAt < other.finishedAt
        );
      }).length;
    }),
  );
};

beforeEach(() => {
  capturedTableProps = null;
  exportReads.length = 0;
  downloadedIds = [];
  failingIds = [];
  tick = 0;
});

afterEach(() => {
  cleanup();
});

describe("Export JSON in Bulk Actions", () => {
  test("reads several rows at once, and the file lists them in the order they were selected", async () => {
    const items: Array<Monitor> = monitors(10);

    const run: ExportRun = await runExport(items);

    expect(mostReadsAtOnce()).toBe(BULK_ACTION_CONCURRENCY);
    // The reads came back out of order...
    expect(
      exportReads.map((read: ExportRead) => {
        return read.id;
      }),
    ).not.toEqual(
      items.map((item: Monitor) => {
        return item._id;
      }),
    );
    // ...and the one file lists them as they were selected.
    expect(downloadedIds).toEqual([
      items.map((item: Monitor) => {
        return item._id!;
      }),
    ]);
    expect(run.ends).toBe(1);
    expect(run.progress[run.progress.length - 1]!.successItems).toHaveLength(
      10,
    );
  });

  test("offers no Stop: a file of part of the selection would read as all of it", async () => {
    const run: ExportRun = await runExport(monitors(3));

    expect(run.startOptions).toEqual([{ isStoppable: false }]);
  });

  test("a row that cannot be read is reported and left out of the file, the rest in their order", async () => {
    const items: Array<Monitor> = monitors(5);
    failingIds = [monitorId(2)];

    const run: ExportRun = await runExport(items);
    const last: ProgressInfo<Monitor> = run.progress[run.progress.length - 1]!;

    expect(
      last.failed.map((failure: { item: Monitor }) => {
        return failure.item._id;
      }),
    ).toEqual([monitorId(2)]);
    expect(downloadedIds).toEqual([
      [monitorId(1), monitorId(3), monitorId(4), monitorId(5)],
    ]);
  });

  test("downloads nothing when no row could be read", async () => {
    failingIds = [monitorId(1), monitorId(2)];

    await runExport(monitors(2));

    expect(downloadedIds).toEqual([]);
  });
});
