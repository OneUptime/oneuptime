import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageReadAccess from "../../../../Server/Utils/StatusPage/StatusPageReadAccess";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Limiting an incident (or an incident template) to a status page decides
 * who is told about it, so picking a page needs read access to it - through
 * the API as well as the dashboard picker, which only lists readable pages.
 * The status page service answers with the caller's own permissions and
 * labels; it is stubbed here, as is which pages the caller may read.
 */

const PAGE_A: string = "b0000000-0000-4000-8000-00000000000a";
const PAGE_B: string = "b0000000-0000-4000-8000-00000000000b";
const PAGE_C: string = "b0000000-0000-4000-8000-00000000000c";

const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e02"),
  tenantId: new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e01"),
};

// The pages the caller may read; null means no status page access at all.
let readable: Array<string> | null = [];
let findBy: MockFunction;

function requestedIds(query: { _id: unknown }): Array<string> {
  const operator: { objectLiteralParameters?: Dictionary<unknown> } =
    query._id as { objectLiteralParameters?: Dictionary<unknown> };

  return (
    Object.values(operator.objectLiteralParameters || {}) as Array<
      Array<string>
    >
  )
    .flat()
    .map((id: string): string => {
      return id.toLowerCase();
    });
}

beforeEach(() => {
  readable = [PAGE_A];

  findBy = getJestMockFunction();
  findBy.mockImplementation(
    (data: { query: { _id: unknown } }): Promise<Array<StatusPage>> => {
      if (readable === null) {
        return Promise.reject(
          new NotAuthorizedException(
            "You do not have permissions to read Status Page.",
          ),
        );
      }

      return Promise.resolve(
        requestedIds(data.query)
          .filter((id: string): boolean => {
            return readable!.includes(id);
          })
          .map((id: string): StatusPage => {
            const page: StatusPage = new StatusPage();
            page._id = id;
            return page;
          }),
      );
    },
  );

  jest.spyOn(StatusPageService, "findBy").mockImplementation(findBy as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StatusPageReadAccess.getReadableStatusPageIds", () => {
  test("asks the status page service with the caller's own props", async () => {
    expect(
      await StatusPageReadAccess.getReadableStatusPageIds({
        statusPageIds: [PAGE_A, PAGE_B.toUpperCase()],
        props: CALLER,
      }),
    ).toEqual([PAGE_A]);

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0].props).toBe(CALLER);
    expect(requestedIds(findBy.mock.calls[0]![0].query)).toEqual([
      PAGE_A,
      PAGE_B,
    ]);
  });

  test("a caller with no status page access reads none of them", async () => {
    readable = null;

    expect(
      await StatusPageReadAccess.getReadableStatusPageIds({
        statusPageIds: [PAGE_A],
        props: CALLER,
      }),
    ).toEqual([]);
  });

  test("any other failure is not swallowed", async () => {
    findBy.mockImplementation(() => {
      return Promise.reject(new Error("connection lost"));
    });

    await expect(
      StatusPageReadAccess.getReadableStatusPageIds({
        statusPageIds: [PAGE_A],
        props: CALLER,
      }),
    ).rejects.toThrow("connection lost");
  });

  test("root reads every page, and nothing is asked", async () => {
    expect(
      await StatusPageReadAccess.getReadableStatusPageIds({
        statusPageIds: [PAGE_A, PAGE_C],
        props: { isRoot: true },
      }),
    ).toEqual([PAGE_A, PAGE_C]);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("no pages, no question", async () => {
    expect(
      await StatusPageReadAccess.getReadableStatusPageIds({
        statusPageIds: [],
        props: CALLER,
      }),
    ).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });
});

describe("StatusPageReadAccess.assertCallerCanPickStatusPages", () => {
  test("pages the caller can read are fine", async () => {
    await expect(
      StatusPageReadAccess.assertCallerCanPickStatusPages({
        statusPageIds: [PAGE_A],
        props: CALLER,
        subject: "incident",
      }),
    ).resolves.toBeUndefined();
  });

  test("a page the caller cannot read is refused, naming the role that fixes it", async () => {
    await expect(
      StatusPageReadAccess.assertCallerCanPickStatusPages({
        statusPageIds: [PAGE_A, PAGE_B],
        props: CALLER,
        subject: "incident template",
      }),
    ).rejects.toThrow(
      "You do not have access to some of the status pages you picked, so this incident template cannot be limited to them. Picking status pages needs a role that can read them, such as Status Page Viewer (it can be limited to pages with certain labels).",
    );
  });

  test("the refusal is a NotAuthorizedException", async () => {
    readable = null;

    await expect(
      StatusPageReadAccess.assertCallerCanPickStatusPages({
        statusPageIds: [PAGE_A],
        props: CALLER,
        subject: "incident",
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("pages allowed without reading them (a template's) are not asked about", async () => {
    await expect(
      StatusPageReadAccess.assertCallerCanPickStatusPages({
        statusPageIds: [PAGE_A, PAGE_C],
        props: CALLER,
        subject: "incident",
        allowedStatusPageIds: [PAGE_C.toUpperCase()],
      }),
    ).resolves.toBeUndefined();

    expect(requestedIds(findBy.mock.calls[0]![0].query)).toEqual([PAGE_A]);
  });

  test("nothing to pick, nothing asked", async () => {
    await StatusPageReadAccess.assertCallerCanPickStatusPages({
      statusPageIds: [],
      props: CALLER,
      subject: "incident",
    });

    expect(findBy).not.toHaveBeenCalled();
  });

  test("root picks any page", async () => {
    readable = null;

    await expect(
      StatusPageReadAccess.assertCallerCanPickStatusPages({
        statusPageIds: [PAGE_B],
        props: { isRoot: true },
        subject: "incident",
      }),
    ).resolves.toBeUndefined();
    expect(findBy).not.toHaveBeenCalled();
  });
});
