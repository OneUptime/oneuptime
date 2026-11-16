import { describe, expect, test } from "@jest/globals";
import Project from "../../../Models/DatabaseModels/Project";
import {
  createProjectSearch,
  ProjectSearch,
  searchProjects,
} from "../../../UI/Components/Header/ProjectPicker/ProjectSearch";

/*
 * THE PROJECT LIST'S SEARCH, BY WHAT IS TYPED AND WHAT IS FOUND.
 *
 * The box over the project list kept a project only when its name started
 * with what was typed: "kube" did not find "OneUptime Kubernetes", "acme"
 * did not find "Sample: Acme Shop", and what it found kept the list's
 * order. It now matches a name as Search (Cmd/Ctrl+K) matches a page's:
 * any word, in any order, case, accents and punctuation aside, inside a
 * word, and - when nothing matches better - by initials, a typo or the
 * letters in order; best match first.
 *
 * The names are the ones a real list holds, the header's own screenshot
 * among them: two projects called "Test Project\", a name with a colon, an
 * accent, brackets, Chinese, Persian, an emoji, and a project with no name.
 */

const KUBERNETES_ID: string = "b7000000-0000-4000-8000-0000000000d1";
const PROJECT_TEST_ID: string = "b7000000-0000-4000-8000-0000000000d2";
const FREE_DEMO_ID: string = "b7000000-0000-4000-8000-0000000000d3";
const ACME_SHOP_ID: string = "b7000000-0000-4000-8000-0000000000d4";
const TEST_PROJECT_ONE_ID: string = "b7000000-0000-4000-8000-0000000000d5";
const TEST_PROJECT_TWO_ID: string = "b7000000-0000-4000-8000-0000000000d6";
const CAFE_ID: string = "b7000000-0000-4000-8000-0000000000d7";
const ACME_STAGING_ID: string = "b7000000-0000-4000-8000-0000000000d8";
const PAYMENTS_ID: string = "b7000000-0000-4000-8000-0000000000d9";
const CHINESE_ID: string = "b7000000-0000-4000-8000-0000000000da";
const LAUNCH_ID: string = "b7000000-0000-4000-8000-0000000000db";
const PERSIAN_ID: string = "b7000000-0000-4000-8000-0000000000dc";
const KUBE_PROD_ID: string = "b7000000-0000-4000-8000-0000000000dd";
const NAMELESS_ID: string = "b7000000-0000-4000-8000-0000000000de";
const API_GATEWAY_ID: string = "b7000000-0000-4000-8000-0000000000df";
const ACME_PRODUCTION_ID: string = "b7000000-0000-4000-8000-0000000000e0";

function project(id: string, name?: string): Project {
  const item: Project = new Project();
  item._id = id;

  if (name !== undefined) {
    item.name = name;
  }

  return item;
}

const PROJECTS: Array<Project> = [
  project(KUBERNETES_ID, "OneUptime Kubernetes"),
  project(PROJECT_TEST_ID, "Project test"),
  project(FREE_DEMO_ID, "Free demo"),
  project(ACME_SHOP_ID, "Sample: Acme Shop"),
  project(TEST_PROJECT_ONE_ID, "Test Project\\"),
  project(TEST_PROJECT_TWO_ID, "Test Project\\"),
  project(CAFE_ID, "Café Production"),
  project(ACME_STAGING_ID, "Acme Staging"),
  project(PAYMENTS_ID, "[EU] Payments API"),
  project(CHINESE_ID, "生产环境项目"),
  project(LAUNCH_ID, "🚀 Launch Pad"),
  project(PERSIAN_ID, "پروژه آکمه"),
  project(KUBE_PROD_ID, "Kube Prod"),
  project(NAMELESS_ID),
  project(API_GATEWAY_ID, "API Gateway"),
  project(ACME_PRODUCTION_ID, "Acme Production"),
];

const search: ProjectSearch = createProjectSearch(PROJECTS);

// What a search finds, by id: two projects can share a name.
function found(text: string): Array<string> {
  return search(text).map((item: Project): string => {
    return item.id!.toString();
  });
}

// ...and by name, where the names say it best.
function foundNames(text: string): Array<string | undefined> {
  return search(text).map((item: Project): string | undefined => {
    return item.name;
  });
}

describe("what the old search missed: a word anywhere in the name", () => {
  test("a word that is not the name's first: kube finds OneUptime Kubernetes", () => {
    expect(found("kube")).toContain(KUBERNETES_ID);
    expect(found("kubernetes")).toEqual([KUBERNETES_ID]);
  });

  test("acme finds Sample: Acme Shop, beside the projects whose names start with it", () => {
    expect(foundNames("acme")).toEqual([
      "Acme Staging",
      "Acme Production",
      "Sample: Acme Shop",
    ]);
  });

  test("the last word of a name: staging, shop, demo", () => {
    expect(found("staging")).toEqual([ACME_STAGING_ID]);
    expect(found("shop")).toEqual([ACME_SHOP_ID]);
    expect(found("demo")).toEqual([FREE_DEMO_ID]);
  });

  test("the words in any order: shop acme, demo free, payments eu", () => {
    expect(found("shop acme")).toEqual([ACME_SHOP_ID]);
    expect(found("demo free")).toEqual([FREE_DEMO_ID]);
    expect(found("payments eu")).toEqual([PAYMENTS_ID]);
  });

  test("each word typed so far, as a name is typed: sam ac sh", () => {
    expect(found("sam ac sh")).toEqual([ACME_SHOP_ID]);
    expect(found("acme sh")).toEqual([ACME_SHOP_ID]);
  });

  test("every word must be found: a second word the name lacks finds nothing", () => {
    expect(found("acme kubernetes")).toEqual([]);
    expect(found("free shop")).toEqual([]);
  });
});

describe("case, accents, punctuation and spacing aside", () => {
  test("in any case", () => {
    expect(found("ONEUPTIME KUBERNETES")).toEqual([KUBERNETES_ID]);
    expect(found("aCmE sTaGiNg")).toEqual([ACME_STAGING_ID]);
  });

  test("an accent typed or left out: cafe and café both find Café Production", () => {
    expect(found("cafe")).toEqual([CAFE_ID]);
    expect(found("café")).toEqual([CAFE_ID]);
    expect(found("CAFÉ PROD")).toEqual([CAFE_ID]);
  });

  test("punctuation in the name is not typed: sample acme finds Sample: Acme Shop, eu payments finds [EU] Payments API", () => {
    expect(found("sample acme")).toEqual([ACME_SHOP_ID]);
    expect(found("eu payments")).toEqual([PAYMENTS_ID]);
  });

  test("punctuation typed that the name does not have: sample: acme shop!", () => {
    expect(found("sample: acme shop!")).toEqual([ACME_SHOP_ID]);
    expect(found("[eu]-payments")).toEqual([PAYMENTS_ID]);
  });

  test("a name's words run together, or one word written as two", () => {
    expect(found("oneuptime-kubernetes")).toEqual([KUBERNETES_ID]);
    expect(found("oneuptimekubernetes")).toEqual([KUBERNETES_ID]);
    expect(found("one uptime kubernetes")).toEqual([KUBERNETES_ID]);
  });

  test("spaces around and between the words", () => {
    expect(found("   free    demo   ")).toEqual([FREE_DEMO_ID]);
    expect(found("\tacme\nstaging ")).toEqual([ACME_STAGING_ID]);
  });

  test("a name ending in a backslash is found by its words, with the backslash or without", () => {
    expect(found("test project\\")).toEqual([
      TEST_PROJECT_ONE_ID,
      TEST_PROJECT_TWO_ID,
      PROJECT_TEST_ID,
    ]);
    expect(found("test project")).toEqual([
      TEST_PROJECT_ONE_ID,
      TEST_PROJECT_TWO_ID,
      PROJECT_TEST_ID,
    ]);
  });
});

describe("best match first", () => {
  test("the whole name first, then the names that start with the search, then those that hold its words", () => {
    // Test Project\ is the whole search; Project test only holds its words.
    expect(found("test project")).toEqual([
      TEST_PROJECT_ONE_ID,
      TEST_PROJECT_TWO_ID,
      PROJECT_TEST_ID,
    ]);
    // Kube Prod starts with "kube"; OneUptime Kubernetes has a word that does.
    expect(foundNames("kube")).toEqual(["Kube Prod", "OneUptime Kubernetes"]);
    // The whole name, and nothing that holds only some of its words.
    expect(found("kube prod")).toEqual([KUBE_PROD_ID]);
    expect(found("acme production")).toEqual([ACME_PRODUCTION_ID]);
  });

  test("test: the two named Test Project\\ before Project test, which only holds the word", () => {
    expect(found("test")).toEqual([
      TEST_PROJECT_ONE_ID,
      TEST_PROJECT_TWO_ID,
      PROJECT_TEST_ID,
    ]);
  });

  test("project: Project test before the two that hold the word second", () => {
    expect(found("project")).toEqual([
      PROJECT_TEST_ID,
      TEST_PROJECT_ONE_ID,
      TEST_PROJECT_TWO_ID,
    ]);
  });

  test("matches that are as good as each other keep the list's order", () => {
    // Every one of them holds a word starting "prod", none starts with it.
    expect(foundNames("prod")).toEqual([
      "Café Production",
      "Kube Prod",
      "Acme Production",
    ]);

    // The same projects listed the other way round are found the other way round.
    const reversed: Array<Project> = [...PROJECTS].reverse();
    expect(
      searchProjects(reversed, "prod").map(
        (item: Project): string | undefined => {
          return item.name;
        },
      ),
    ).toEqual(["Acme Production", "Kube Prod", "Café Production"]);
  });

  test("two projects that share a name are both found, in the list's order", () => {
    const sameName: Array<string> = found("test project\\").slice(0, 2);
    expect(sameName).toEqual([TEST_PROJECT_ONE_ID, TEST_PROJECT_TWO_ID]);

    const swapped: Array<Project> = [
      PROJECTS[5]!,
      PROJECTS[4]!,
      ...PROJECTS.slice(0, 4),
    ];
    expect(
      searchProjects(swapped, "test project")
        .slice(0, 2)
        .map((item: Project): string => {
          return item.id!.toString();
        }),
    ).toEqual([TEST_PROJECT_TWO_ID, TEST_PROJECT_ONE_ID]);
  });

  test("a word of a name before a few letters inside one: ap finds API Gateway, then [EU] Payments API", () => {
    expect(found("ap")).toEqual([API_GATEWAY_ID, PAYMENTS_ID]);
  });
});

describe("inside a word, and in a script with no spaces", () => {
  test("letters inside a word: ernet finds OneUptime Kubernetes", () => {
    expect(found("ernet")).toEqual([KUBERNETES_ID]);
    expect(found("uptime")).toEqual([KUBERNETES_ID]);
  });

  test("Chinese, which writes a name as one run of letters: 环境 finds 生产环境项目", () => {
    expect(found("环境")).toEqual([CHINESE_ID]);
    expect(found("生产")).toEqual([CHINESE_ID]);
    expect(found("项目")).toEqual([CHINESE_ID]);
  });

  test("Persian, as written: آکمه finds پروژه آکمه", () => {
    expect(found("آکمه")).toEqual([PERSIAN_ID]);
    expect(found("پروژه")).toEqual([PERSIAN_ID]);
  });

  test("one or two letters inside a word come after the names they start a word of", () => {
    // "eu" starts a word of [EU] Payments API and sits inside OneUptime.
    expect(found("eu")).toEqual([PAYMENTS_ID, KUBERNETES_ID]);
  });
});

describe("when nothing matches better: initials, a typo, letters in order", () => {
  test("a name's initials: ouk finds OneUptime Kubernetes, fd finds Free demo", () => {
    expect(found("ouk")).toEqual([KUBERNETES_ID]);
    expect(found("fd")).toEqual([FREE_DEMO_ID]);
  });

  test("a typo in a long word: kubernetse and kuberntes find OneUptime Kubernetes", () => {
    expect(found("kubernetse")).toEqual([KUBERNETES_ID]);
    expect(found("kuberntes")).toEqual([KUBERNETES_ID]);
    expect(found("stagign")).toEqual([ACME_STAGING_ID]);
  });

  test("the name's letters in order: knts finds OneUptime Kubernetes", () => {
    expect(found("knts")).toEqual([KUBERNETES_ID]);
  });

  test("never in place of a better match: ap is API Gateway's start, not Acme Production's initials", () => {
    // Acme Production's initials are "ap", but a name starts with "ap".
    expect(found("ap")).not.toContain(ACME_PRODUCTION_ID);

    // Alone, the initials find it.
    expect(
      searchProjects([PROJECTS[15]!], "ap").map((item: Project): string => {
        return item.id!.toString();
      }),
    ).toEqual([ACME_PRODUCTION_ID]);
  });

  test("a short word is never taken for a typo: rule does not find role", () => {
    expect(
      searchProjects([project(API_GATEWAY_ID, "Role Admin")], "rule"),
    ).toEqual([]);
  });
});

describe("a search of symbols alone", () => {
  test("an emoji finds the names that hold it, as the old search found the names that started with it", () => {
    expect(found("🚀")).toEqual([LAUNCH_ID]);
    expect(found(" 🚀 ")).toEqual([LAUNCH_ID]);
  });

  test("a backslash finds the names that hold one", () => {
    expect(found("\\")).toEqual([TEST_PROJECT_ONE_ID, TEST_PROJECT_TWO_ID]);
  });

  test("a symbol no name holds finds nothing", () => {
    expect(found("#")).toEqual([]);
    expect(found("&&")).toEqual([]);
  });

  test("an emoji with a word is matched by the word", () => {
    expect(found("🚀 launch")).toEqual([LAUNCH_ID]);
    expect(found("🚀 pad")).toEqual([LAUNCH_ID]);
  });
});

describe("nothing typed, and nothing found", () => {
  test("nothing typed lists every project, the nameless one too, in the list's order", () => {
    expect(search("")).toEqual(PROJECTS);
    expect(search("   ")).toEqual(PROJECTS);
    expect(search("\t\n")).toEqual(PROJECTS);
  });

  test("a project with no name is listed, and never found by a search", () => {
    expect(found("")).toContain(NAMELESS_ID);
    expect(found("undefined")).toEqual([]);
    expect(found("a")).not.toContain(NAMELESS_ID);
  });

  test("a search no name matches finds nothing", () => {
    expect(found("zzz")).toEqual([]);
    expect(found("kubernetes acme")).toEqual([]);
    expect(found("qwertyuiop")).toEqual([]);
  });

  test("an empty list finds nothing, whatever is typed", () => {
    const empty: ProjectSearch = createProjectSearch([]);

    expect(empty("")).toEqual([]);
    expect(empty("acme")).toEqual([]);
    expect(empty("🚀")).toEqual([]);
  });
});

describe("the search over one list", () => {
  test("gives back the list's own projects, not copies", () => {
    const first: Project | undefined = search("oneuptime kubernetes")[0];
    expect(first).toBe(PROJECTS[0]);

    search("acme").forEach((item: Project): void => {
      expect(PROJECTS).toContain(item);
    });
  });

  test("answers each search on its own: what was typed before does not change what is found", () => {
    expect(found("acme")).toEqual(found("acme"));
    found("kube");
    found("zzz");
    found("🚀");
    expect(foundNames("acme")).toEqual([
      "Acme Staging",
      "Acme Production",
      "Sample: Acme Shop",
    ]);
  });

  test("searches the list it was made for: a new list is searched by a new search", () => {
    const renamed: Array<Project> = [
      project(KUBERNETES_ID, "Platform Cluster"),
      project(ACME_SHOP_ID, "Acme Shop"),
    ];

    expect(searchProjects(renamed, "kube")).toEqual([]);
    expect(
      searchProjects(renamed, "platform").map((item: Project): string => {
        return item.id!.toString();
      }),
    ).toEqual([KUBERNETES_ID]);
    // The first list's search is as it was.
    expect(found("kube")).toEqual([KUBE_PROD_ID, KUBERNETES_ID]);
  });

  test("keeps up with a long list: a thousand projects searched letter by letter", () => {
    const many: Array<Project> = [];

    for (let index: number = 0; index < 1000; index++) {
      many.push(
        project(
          `b7000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          `Customer ${index} ${
            ["Production", "Staging", "Kubernetes Cluster", "Payments API"][
              index % 4
            ]
          }`,
        ),
      );
    }

    const manySearch: ProjectSearch = createProjectSearch(many);
    let lastFound: Array<Project> = [];

    for (const typed of ["k", "ku", "kub", "kube", "kuber", "kubernetes"]) {
      lastFound = manySearch(typed);
    }

    expect(lastFound).toHaveLength(250);
    expect(
      lastFound.every((item: Project): boolean => {
        return Boolean(item.name?.endsWith("Kubernetes Cluster"));
      }),
    ).toBe(true);

    /*
     * A number in a name is a word of it too: "customer 42" starts the
     * names of Customer 42 and Customer 420 to 429, Customer 42 first.
     */
    const customer42: Array<string | undefined> = manySearch("customer 42").map(
      (item: Project): string | undefined => {
        return item.name;
      },
    );
    expect(customer42).toHaveLength(11);
    expect(customer42[0]).toBe("Customer 42 Kubernetes Cluster");
    expect(customer42[1]).toBe("Customer 420 Production");
  });
});
