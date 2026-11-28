import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { ReactElement } from "react";
import DuplicateNameNotice, {
  ComponentProps,
  DUPLICATE_NAME_CHECK_DELAY_IN_MS,
  DUPLICATE_NAME_NOTICE_TEST_ID,
  DUPLICATE_NAME_REFUSED,
  DUPLICATE_NAME_REFUSED_BY_ARCHIVED,
  DUPLICATE_NAME_TAKEN,
  DUPLICATE_NAME_TAKEN_BY_ARCHIVED,
  DUPLICATE_NAME_TAKEN_BY_UNREADABLE,
  getDuplicateNameNoticeWords,
} from "../../../../UI/Components/Forms/DuplicateNameNotice";
import RecordPageContext, {
  GetRecordPageRoute,
  RecordPages,
} from "../../../../UI/Components/RecordPage/RecordPageContext";
import UniqueNamesApi from "../../../../UI/Utils/UniqueNamesApi";
import Route from "../../../../Types/API/Route";
import { UniqueNameCheckAnswer } from "../../../../Types/Database/RequiredUniqueNames";
import ObjectID from "../../../../Types/ObjectID";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import { getJestSpyOn } from "../../../Spy";

/*
 * THE WARNING UNDER A NAME FIELD: ANOTHER RECORD OF THIS KIND IS ALREADY
 * CALLED THIS (#10761).
 *
 * The issue: several monitors can share a name, and nobody notices until
 * two "API Health Check" monitors page someone. Every form of a kind with a
 * name of its own in a project now says so as the name is typed - "Another
 * monitor is already called API Health Check." with a link to that monitor
 * - whether or not the project requires unique names; where it does, a
 * second sentence says saving would be refused.
 *
 * Rendered here with the server's answer stubbed (UniqueNamesApi.check):
 * what it says for each answer, when it asks and what, the link, case and
 * spacing, an edit's own name, a failure, an answer that comes late, and
 * the words in German as the Dashboard ships them.
 */

const HOLDER_ID: string = "aaaaaaaa-0000-4000-8000-000000010761";
const EDITED_ID: string = "bbbbbbbb-0000-4000-8000-000000010761";

// The Dashboard's answer to where a record is opened, for these tests.
const pageOf: GetRecordPageRoute = (data: {
  tableName: string;
  modelId: ObjectID;
}): Route => {
  return new Route(
    `/dashboard/project-1/${data.tableName.toLowerCase()}s/${data.modelId.toString()}`,
  );
};

const HOLDER_PAGE: string = `/dashboard/project-1/monitors/${HOLDER_ID}`;

function answer(
  partial: Partial<UniqueNameCheckAnswer> = {},
): UniqueNameCheckAnswer {
  return {
    isRequired: false,
    takenBy: null,
    isTakenByUnreadable: false,
    ...partial,
  };
}

function takenBy(
  partial: Partial<{ name: string; isArchived: boolean }> = {},
): UniqueNameCheckAnswer["takenBy"] {
  return {
    id: HOLDER_ID,
    name: partial.name ?? "API Health Check",
    isArchived: partial.isArchived ?? false,
  };
}

interface NoticeProps extends Partial<ComponentProps> {
  // Whether the front end says where records are opened.
  pages?: RecordPages | null;
}

function Notice(props: NoticeProps): ReactElement {
  const { pages, ...noticeProps } = props;
  const notice: ReactElement = (
    <DuplicateNameNotice
      tableName="Monitor"
      singularName="Monitor"
      name="API Health Check"
      checkDelayInMs={1}
      {...noticeProps}
    />
  );

  if (pages === null) {
    return notice;
  }

  return (
    <RecordPageContext.Provider value={pages || { getRoute: pageOf }}>
      {notice}
    </RecordPageContext.Provider>
  );
}

function readText(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

let checkMock: jest.SpyInstance<any, any>;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 30);
    });
  });
}

async function findNotice(): Promise<HTMLElement> {
  return await screen.findByTestId(
    DUPLICATE_NAME_NOTICE_TEST_ID,
    {},
    { timeout: 5000 },
  );
}

beforeEach(() => {
  checkMock = getJestSpyOn(UniqueNamesApi, "check").mockResolvedValue(answer());
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what the warning says, from the server's answer", () => {
  test("nothing to say without an answer, or for a name no record has", () => {
    expect(getDuplicateNameNoticeWords(null)).toBeNull();
    expect(getDuplicateNameNoticeWords(answer())).toBeNull();
    expect(
      getDuplicateNameNoticeWords(answer({ isRequired: true })),
    ).toBeNull();
  });

  test("another record has it: names it, and adds nothing where names may repeat", () => {
    expect(getDuplicateNameNoticeWords(answer({ takenBy: takenBy() }))).toEqual(
      { taken: DUPLICATE_NAME_TAKEN, refused: null },
    );
  });

  test("where the project requires unique names, it says saving would be refused", () => {
    expect(
      getDuplicateNameNoticeWords(
        answer({ takenBy: takenBy(), isRequired: true }),
      ),
    ).toEqual({ taken: DUPLICATE_NAME_TAKEN, refused: DUPLICATE_NAME_REFUSED });
  });

  test("an archived record has it: says it is archived, and to unarchive it where it would be refused", () => {
    expect(
      getDuplicateNameNoticeWords(
        answer({ takenBy: takenBy({ isArchived: true }) }),
      ),
    ).toEqual({ taken: DUPLICATE_NAME_TAKEN_BY_ARCHIVED, refused: null });
    expect(
      getDuplicateNameNoticeWords(
        answer({ takenBy: takenBy({ isArchived: true }), isRequired: true }),
      ),
    ).toEqual({
      taken: DUPLICATE_NAME_TAKEN_BY_ARCHIVED,
      refused: DUPLICATE_NAME_REFUSED_BY_ARCHIVED,
    });
  });

  test("a record the reader cannot open has it: said only where saving would be refused, and never named", () => {
    expect(
      getDuplicateNameNoticeWords(answer({ isTakenByUnreadable: true })),
    ).toBeNull();
    expect(
      getDuplicateNameNoticeWords(
        answer({ isTakenByUnreadable: true, isRequired: true }),
      ),
    ).toEqual({
      taken: DUPLICATE_NAME_TAKEN_BY_UNREADABLE,
      refused: DUPLICATE_NAME_REFUSED,
    });
    expect(DUPLICATE_NAME_TAKEN_BY_UNREADABLE).not.toContain("{{name}}");
  });

  test("the sentences say what happened and what to do, with the kind and the name as values", () => {
    expect(DUPLICATE_NAME_TAKEN).toBe(
      "Another {{kind}} is already called {{name}}.",
    );
    expect(DUPLICATE_NAME_TAKEN_BY_ARCHIVED).toBe(
      "An archived {{kind}} is already called {{name}}.",
    );
    expect(DUPLICATE_NAME_REFUSED).toBe(
      "Pick another name: names are unique in this project.",
    );
    expect(DUPLICATE_NAME_REFUSED_BY_ARCHIVED).toBe(
      "Unarchive it, or pick another name: names are unique in this project.",
    );
  });
});

describe("under a name field", () => {
  test("says another monitor is already called the name, the name a link to that monitor in a new tab", async () => {
    checkMock.mockResolvedValue(answer({ takenBy: takenBy() }));

    render(<Notice />);

    const notice: HTMLElement = await findNotice();

    expect(readText(notice)).toBe(
      "Another monitor is already called API Health Check.",
    );
    // Said politely, after what the screen reader is saying: it only helps.
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveAttribute("aria-live", "polite");

    const link: HTMLElement = screen.getByTestId("duplicate-name-notice-link");

    expect(link).toHaveAttribute("href", HOLDER_PAGE);
    // A new tab: the form keeps what was typed.
    expect(link).toHaveAttribute("target", "_blank");
    expect(readText(link)).toBe("API Health Check");
    expect(link.querySelector("bdi")).toHaveTextContent("API Health Check");
    expect(screen.queryByTestId("duplicate-name-notice-refused")).toBeNull();
  });

  test("asks the server once, with the kind, the name as written and no record to leave out", async () => {
    checkMock.mockResolvedValue(answer({ takenBy: takenBy() }));

    render(<Notice />);
    await findNotice();

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(checkMock.mock.calls[0]![0]).toEqual({
      tableName: "Monitor",
      name: "API Health Check",
      exceptId: null,
    });
  });

  test("a name in another case, with spaces around and between its words, is the same name: the warning names the other monitor as it is written", async () => {
    checkMock.mockResolvedValue(answer({ takenBy: takenBy() }));

    render(<Notice name={"  api   HEALTH\tcheck "} />);

    const notice: HTMLElement = await findNotice();

    // The name asked about as it reads: trimmed, its spaces one.
    expect(checkMock.mock.calls[0]![0]).toMatchObject({
      name: "api HEALTH check",
    });
    expect(readText(notice)).toBe(
      "Another monitor is already called API Health Check.",
    );
  });

  test("typing over only the case keeps the warning, and asks nothing more", async () => {
    checkMock.mockResolvedValue(answer({ takenBy: takenBy() }));

    const { rerender } = render(<Notice name="API Health Check" />);
    await findNotice();

    rerender(<Notice name="api health check" />);
    await settle();

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId(DUPLICATE_NAME_NOTICE_TEST_ID),
    ).toBeInTheDocument();
  });

  test("where the project requires unique names, a second sentence says saving would be refused", async () => {
    checkMock.mockResolvedValue(
      answer({ takenBy: takenBy(), isRequired: true }),
    );

    render(<Notice />);

    const notice: HTMLElement = await findNotice();

    expect(readText(notice)).toBe(
      "Another monitor is already called API Health Check. Pick another name: names are unique in this project.",
    );
    expect(
      screen.getByTestId("duplicate-name-notice-refused"),
    ).toHaveTextContent(DUPLICATE_NAME_REFUSED);
  });

  test("an archived monitor has it: says so, and how to free the name where it would be refused", async () => {
    checkMock.mockResolvedValue(
      answer({ takenBy: takenBy({ isArchived: true }), isRequired: true }),
    );

    render(<Notice />);

    expect(readText(await findNotice())).toBe(
      "An archived monitor is already called API Health Check. Unarchive it, or pick another name: names are unique in this project.",
    );
  });

  test("a monitor the reader may not open has it: says the name is taken where saving would be refused, without naming or linking it", async () => {
    checkMock.mockResolvedValue(
      answer({ isTakenByUnreadable: true, isRequired: true }),
    );

    render(<Notice />);

    expect(readText(await findNotice())).toBe(
      "Another monitor already has this name. Pick another name: names are unique in this project.",
    );
    expect(screen.queryByTestId("duplicate-name-notice-link")).toBeNull();
  });

  test("a monitor the reader may not open has it, where names may repeat: says nothing", async () => {
    checkMock.mockResolvedValue(answer({ isTakenByUnreadable: true }));

    render(<Notice />);

    await waitFor(() => {
      expect(checkMock).toHaveBeenCalledTimes(1);
    });
    await settle();

    expect(screen.queryByTestId(DUPLICATE_NAME_NOTICE_TEST_ID)).toBeNull();
  });

  test("a name no other monitor has: nothing is drawn", async () => {
    render(<Notice name="Billing API" />);

    await waitFor(() => {
      expect(checkMock).toHaveBeenCalledTimes(1);
    });
    await settle();

    expect(screen.queryByTestId(DUPLICATE_NAME_NOTICE_TEST_ID)).toBeNull();
  });

  test("where the front end says no record is opened anywhere, the name is in bold, without a link", async () => {
    checkMock.mockResolvedValue(answer({ takenBy: takenBy() }));

    render(<Notice pages={null} />);

    const notice: HTMLElement = await findNotice();

    expect(readText(notice)).toBe(
      "Another monitor is already called API Health Check.",
    );
    expect(screen.queryByTestId("duplicate-name-notice-link")).toBeNull();
    expect(notice.querySelector("strong")).toHaveTextContent(
      "API Health Check",
    );
  });

  test("a kind with no page of its own: the name in bold, without a link", async () => {
    checkMock.mockResolvedValue(answer({ takenBy: takenBy() }));

    render(
      <Notice
        pages={{
          getRoute: (): null => {
            return null;
          },
        }}
      />,
    );

    const notice: HTMLElement = await findNotice();

    expect(screen.queryByTestId("duplicate-name-notice-link")).toBeNull();
    expect(notice.querySelector("strong")).toHaveTextContent(
      "API Health Check",
    );
    // A front end that says nothing of pages it has none of says nothing more.
    expect(screen.queryByTestId("duplicate-name-notice-no-page")).toBeNull();
  });

  /*
   * A kind opened under another record (#11020): the front end is handed
   * what the server sent of the record that has the name, to build its
   * page's address - an OpenStack budget's cloud.
   */
  test("the record's page fields reach the front end that builds its link", async () => {
    checkMock.mockResolvedValue(
      answer({
        takenBy: {
          id: HOLDER_ID,
          name: "Compute",
          isArchived: false,
          pageFields: {
            openStackCloudId: "cccccccc-0000-4000-8000-000000011020",
          },
        },
      }),
    );

    const asked: Array<unknown> = [];

    render(
      <Notice
        tableName="OpenStackBudget"
        singularName="OpenStack Budget"
        name="Compute"
        pages={{
          getRoute: (data: {
            tableName: string;
            modelId: ObjectID;
            pageFields?: Record<string, string> | undefined;
          }): Route | null => {
            asked.push(data);
            return data.pageFields?.["openStackCloudId"]
              ? new Route(
                  `/dashboard/project-1/openstack/${data.pageFields["openStackCloudId"]}/spend`,
                )
              : null;
          },
        }}
      />,
    );

    await findNotice();

    expect(asked).toContainEqual({
      tableName: "OpenStackBudget",
      modelId: new ObjectID(HOLDER_ID),
      pageFields: { openStackCloudId: "cccccccc-0000-4000-8000-000000011020" },
    });
    expect(screen.getByTestId("duplicate-name-notice-link")).toHaveAttribute(
      "href",
      "/dashboard/project-1/openstack/cccccccc-0000-4000-8000-000000011020/spend",
    );
    expect(screen.queryByTestId("duplicate-name-notice-no-page")).toBeNull();
  });

  /*
   * A kind no page shows (#11020): the name in bold, and the front end's
   * words for why there is no link - never a link that leads nowhere.
   */
  test("a kind shown on no page says so in the front end's words", async () => {
    checkMock.mockResolvedValue(
      answer({ isRequired: true, takenBy: takenBy({ name: "Triage Bot" }) }),
    );

    render(
      <Notice
        tableName="AIAgent"
        singularName="AI Agent"
        name="Triage Bot"
        pages={{
          getRoute: (): null => {
            return null;
          },
          getNoPageNote: (tableName: string): string | null => {
            return tableName === "AIAgent"
              ? "AI agents have no page in the dashboard: rename one with the API or Terraform."
              : null;
          },
        }}
      />,
    );

    const notice: HTMLElement = await findNotice();

    expect(readText(notice)).toBe(
      "Another AI agent is already called Triage Bot. AI agents have no page in the dashboard: rename one with the API or Terraform. Pick another name: names are unique in this project.",
    );
    expect(screen.queryByTestId("duplicate-name-notice-link")).toBeNull();
    expect(notice.querySelector("strong")).toHaveTextContent("Triage Bot");
  });

  test("a kind with a page never says it has none, whatever the front end would say", async () => {
    checkMock.mockResolvedValue(answer({ takenBy: takenBy() }));

    render(
      <Notice
        pages={{
          getRoute: pageOf,
          getNoPageNote: (): string => {
            return "No page.";
          },
        }}
      />,
    );

    await findNotice();

    expect(screen.getByTestId("duplicate-name-notice-link")).toHaveAttribute(
      "href",
      HOLDER_PAGE,
    );
    expect(screen.queryByTestId("duplicate-name-notice-no-page")).toBeNull();
  });

  test("a record the reader may not read is named nowhere, and no page is said", async () => {
    checkMock.mockResolvedValue(
      answer({ isRequired: true, isTakenByUnreadable: true }),
    );

    render(
      <Notice
        tableName="AIAgent"
        singularName="AI Agent"
        name="Triage Bot"
        pages={{
          getRoute: (): null => {
            return null;
          },
          getNoPageNote: (): string => {
            return "AI agents have no page in the dashboard: rename one with the API or Terraform.";
          },
        }}
      />,
    );

    const notice: HTMLElement = await findNotice();

    expect(readText(notice)).toBe(
      "Another AI agent already has this name. Pick another name: names are unique in this project.",
    );
    expect(screen.queryByTestId("duplicate-name-notice-no-page")).toBeNull();
  });

  test("editing a monitor with its own name again - in any case or spacing - asks nothing and says nothing", async () => {
    checkMock.mockResolvedValue(answer({ takenBy: takenBy() }));

    render(
      <Notice
        name=" api health   CHECK"
        originalName="API Health Check"
        exceptId={new ObjectID(EDITED_ID)}
      />,
    );
    await settle();

    expect(checkMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId(DUPLICATE_NAME_NOTICE_TEST_ID)).toBeNull();
  });

  test("renaming a monitor leaves the monitor itself out of the question", async () => {
    checkMock.mockResolvedValue(answer({ takenBy: takenBy() }));

    render(
      <Notice
        name="API Health Check"
        originalName="Old name"
        exceptId={new ObjectID(EDITED_ID)}
      />,
    );
    await findNotice();

    const asked: { exceptId: ObjectID } = checkMock.mock.calls[0]![0] as {
      exceptId: ObjectID;
    };

    expect(asked.exceptId.toString()).toBe(EDITED_ID);
  });

  test("renaming back to its own name puts the warning away", async () => {
    checkMock.mockResolvedValue(answer({ takenBy: takenBy() }));

    const { rerender } = render(
      <Notice name="API Health Check" originalName="Old name" />,
    );
    await findNotice();

    rerender(<Notice name="Old name" originalName="Old name" />);

    expect(screen.queryByTestId(DUPLICATE_NAME_NOTICE_TEST_ID)).toBeNull();
  });

  test("an empty name, or only spaces, asks nothing", async () => {
    render(<Notice name="   " />);
    await settle();

    render(<Notice name={undefined} />);
    await settle();

    expect(checkMock).not.toHaveBeenCalled();
  });

  test("hidden while the field shows an error of its own - the server's refusal - and back once it is put away", async () => {
    checkMock.mockResolvedValue(
      answer({ takenBy: takenBy(), isRequired: true }),
    );

    const { rerender } = render(<Notice hasFieldError={true} />);

    await waitFor(() => {
      expect(checkMock).toHaveBeenCalledTimes(1);
    });
    await settle();

    expect(screen.queryByTestId(DUPLICATE_NAME_NOTICE_TEST_ID)).toBeNull();

    rerender(<Notice hasFieldError={false} />);

    expect(await findNotice()).toBeInTheDocument();
  });

  test("the warning only helps: a question that fails says nothing, and throws nothing", async () => {
    checkMock.mockRejectedValue(new Error("Network down"));

    render(<Notice />);

    await waitFor(() => {
      expect(checkMock).toHaveBeenCalledTimes(1);
    });
    await settle();

    expect(screen.queryByTestId(DUPLICATE_NAME_NOTICE_TEST_ID)).toBeNull();
  });

  test("typing on: asks once, for the name typing stopped at", async () => {
    checkMock.mockResolvedValue(answer({ takenBy: takenBy() }));

    const { rerender } = render(<Notice name="A" checkDelayInMs={60} />);

    rerender(<Notice name="API" checkDelayInMs={60} />);
    rerender(<Notice name="API Health" checkDelayInMs={60} />);
    rerender(<Notice name="API Health Check" checkDelayInMs={60} />);

    await findNotice();

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(checkMock.mock.calls[0]![0]).toMatchObject({
      name: "API Health Check",
    });
  });

  test("an answer about a name typed over since is dropped", async () => {
    let answerFirst: (value: UniqueNameCheckAnswer) => void = (): void => {};

    checkMock.mockImplementationOnce((): Promise<UniqueNameCheckAnswer> => {
      return new Promise((resolve: (value: UniqueNameCheckAnswer) => void) => {
        answerFirst = resolve;
      });
    });
    checkMock.mockResolvedValue(answer());

    const { rerender } = render(<Notice name="API Health Check" />);

    await waitFor(() => {
      expect(checkMock).toHaveBeenCalledTimes(1);
    });

    rerender(<Notice name="Billing API" />);

    await waitFor(() => {
      expect(checkMock).toHaveBeenCalledTimes(2);
    });

    // The first question's answer arrives after the second was asked.
    await act(async () => {
      answerFirst(answer({ takenBy: takenBy() }));
    });
    await settle();

    expect(screen.queryByTestId(DUPLICATE_NAME_NOTICE_TEST_ID)).toBeNull();
  });

  test("by default it asks a moment after typing stops, not on every keystroke", async () => {
    expect(DUPLICATE_NAME_CHECK_DELAY_IN_MS).toBe(400);

    checkMock.mockResolvedValue(answer({ takenBy: takenBy() }));

    render(
      <RecordPageContext.Provider value={{ getRoute: pageOf }}>
        <DuplicateNameNotice
          tableName="Monitor"
          singularName="Monitor"
          name="API Health Check"
        />
      </RecordPageContext.Provider>,
    );

    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 100);
      });
    });

    expect(checkMock).not.toHaveBeenCalled();

    expect(await findNotice()).toBeInTheDocument();
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  test("a kind of more words is said in the middle of the sentence as English writes it", async () => {
    checkMock.mockResolvedValue(answer({ takenBy: takenBy({ name: "Edge" }) }));

    render(
      <Notice
        tableName="MonitorGroup"
        singularName="Monitor Group"
        name="edge"
      />,
    );

    expect(readText(await findNotice())).toBe(
      "Another monitor group is already called Edge.",
    );
  });
});

describe("in the reader's language", () => {
  const DE: Record<string, string> = readDashboardLocale("de");
  const FA: Record<string, string> = readDashboardLocale("fa");

  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: {
        de: { translation: DE },
        fa: { translation: FA },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await act(async () => {
      await i18next.changeLanguage("en");
    });
  });

  test("German: the sentence, the kind and the refusal in German, the other monitor's name still a link", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    checkMock.mockResolvedValue(
      answer({ takenBy: takenBy(), isRequired: true }),
    );

    render(<Notice />);

    const notice: HTMLElement = await findNotice();
    const expected: string = `${DE[DUPLICATE_NAME_TAKEN]!.replace(
      "{{kind}}",
      DE["Monitor"]!,
    ).replace("{{name}}", "API Health Check")} ${DE[DUPLICATE_NAME_REFUSED]!}`;

    expect(DE[DUPLICATE_NAME_TAKEN]).not.toBe(DUPLICATE_NAME_TAKEN);
    expect(readText(notice)).toBe(expected);
    expect(screen.getByTestId("duplicate-name-notice-link")).toHaveAttribute(
      "href",
      HOLDER_PAGE,
    );
  });

  test("Persian: the sentence in Persian, the Latin name set apart from it", async () => {
    await act(async () => {
      await i18next.changeLanguage("fa");
    });

    checkMock.mockResolvedValue(
      answer({ takenBy: takenBy({ isArchived: true }) }),
    );

    render(<Notice />);

    const notice: HTMLElement = await findNotice();

    expect(readText(notice)).toBe(
      FA[DUPLICATE_NAME_TAKEN_BY_ARCHIVED]!.replace(
        "{{kind}}",
        FA["Monitor"]!,
      ).replace("{{name}}", "API Health Check"),
    );
    // The name reads left to right inside the right-to-left sentence.
    expect(
      screen.getByTestId("duplicate-name-notice-link").querySelector("bdi"),
    ).toHaveTextContent("API Health Check");
  });
});
