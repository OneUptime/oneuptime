import { expect, Page, Route, test } from "@playwright/test";
import Journey from "./Journey";
import { JourneyRun, MEASURES } from "./JourneyBudget";

/*
 * The counter (Counter/InPageCounter.js) and the driver (Journey.ts) the
 * journeys are written with, held to synthetic pages whose every count is
 * known: what makes a screen, a dialog, a field typed, a choice, a default
 * kept and a word; what is left out (the header, the products menu, a
 * page's own events); that a page which reloads itself keeps its counts;
 * and that a form which starts asking for one more value, or a step that
 * cannot be done, fails the way Journeys/README.md says.
 *
 * The pages are answered in the browser (page.route) at a made-up origin:
 * nothing is fetched, and the fixture server is not used.
 */

const ORIGIN: string = "http://journey-counter.test";
const PROJECT: string = "10000000-0000-4000-8000-000000006831";
const RECORD_A: string = "20000000-0000-4000-8000-00000000000a";
const RECORD_B: string = "20000000-0000-4000-8000-00000000000b";

interface CounterApi {
  read: () => JourneyRun;
  reset: () => void;
  noteSubmit: () => void;
  quietFor: () => number;
}

/*
 * Serves `body` inside the page's root at every address of ORIGIN, with
 * the header a product page has above its content.
 */
async function open(
  page: Page,
  pathname: string,
  body: string,
  script: string = "",
): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><title>Counter</title></head><body><div id="root"><header><button id="products">Products</button></header>${body}</div><script>${script}</script></body></html>`,
    });
  });
  await Journey.prepare(page);
  await page.goto(`${ORIGIN}${pathname}`);
}

async function read(page: Page): Promise<JourneyRun> {
  return await page.evaluate(() => {
    return (
      window as unknown as { __journeyCounter: CounterApi }
    ).__journeyCounter.read();
  });
}

async function noteSubmit(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as { __journeyCounter: CounterApi }
    ).__journeyCounter.noteSubmit();
  });
}

// Moves to another address in the page, as the Dashboard's router does.
async function goTo(page: Page, pathname: string): Promise<void> {
  await page.evaluate((next: string) => {
    window.history.pushState(null, "", next);
  }, pathname);
}

test.describe("the journey counter", () => {
  test("counts every measure the budgets hold, starting at nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `/dashboard/${PROJECT}/home`, "<main>Home</main>");
    const run: JourneyRun = await read(page);

    expect(Object.keys(run.measures)).toEqual(MEASURES);
    expect(Object.values(run.measures)).toEqual(
      MEASURES.map(() => {
        return 0;
      }),
    );
  });

  test("makes a screen of a page acted on in its content, never of a click in the header", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `/dashboard/${PROJECT}/monitors`,
      '<main><button id="create">Create Monitor</button></main>',
    );

    await page.locator("#products").click();
    let run: JourneyRun = await read(page);
    expect([
      run.measures.clicks,
      run.measures.screens,
      run.measures.products,
    ]).toEqual([1, 0, 0]);

    await page.locator("#create").click();
    run = await read(page);
    expect(run.measures.clicks).toBe(2);
    expect(run.details.screens).toEqual(["/dashboard/:id/monitors"]);
    expect(run.details.products).toEqual(["monitors"]);
  });

  test("names a page by its path with every id taken out, and a product by what follows the project", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `/dashboard/${PROJECT}/monitors`,
      '<main><button id="act">Act</button></main>',
    );

    for (const pathname of [
      `/dashboard/${PROJECT}/monitors`,
      `/dashboard/${PROJECT}/monitors/${RECORD_A}`,
      `/dashboard/${PROJECT}/monitors/${RECORD_B}`,
      `/dashboard/${PROJECT}/on-call-duty/policies`,
      "/admin/settings/smtp",
    ]) {
      await goTo(page, pathname);
      await page.locator("#act").click();
    }
    const run: JourneyRun = await read(page);

    expect(run.details.screens).toEqual([
      "/dashboard/:id/monitors",
      "/dashboard/:id/monitors/:id",
      "/dashboard/:id/on-call-duty/policies",
      "/admin/settings/smtp",
    ]);
    expect(run.details.products).toEqual([
      "monitors",
      "on-call-duty",
      "admin/settings",
    ]);
  });

  test("counts each dialog that opens, by its title, and not the products menu or a picker's popup", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `/dashboard/${PROJECT}/monitors`, "<main>Monitors</main>");

    await page.evaluate(() => {
      const add: (html: string) => HTMLElement = (html: string) => {
        const holder: HTMLDivElement = document.createElement("div");
        holder.innerHTML = html;
        document.getElementById("root")!.appendChild(holder);
        return holder;
      };
      add(
        '<div data-testid="modal" role="dialog" aria-modal="true" aria-labelledby="t1"><h2 id="t1">Create New Monitor</h2></div>',
      );
      add(
        '<div role="dialog" aria-modal="true" aria-label="Products menu"><div role="listbox"></div></div>',
      );
      add(
        '<div data-testid="people-search-popup" role="dialog" aria-label="Add responder"></div>',
      );
    });
    // Drawn again with new attributes: the same dialog, still one.
    await page.evaluate(() => {
      document
        .querySelector('[data-testid="modal"]')!
        .setAttribute("class", "redrawn");
    });
    await page.evaluate(() => {
      document.querySelector('[data-testid="modal"]')!.parentElement!.remove();
      const holder: HTMLDivElement = document.createElement("div");
      holder.innerHTML =
        '<div data-testid="side-over" role="dialog"><h2 data-testid="side-over-title">Filters</h2></div><div class="full-page-modal" role="dialog" aria-modal="true"><h1>Workflow</h1></div>';
      document.getElementById("root")!.appendChild(holder);
    });
    await expect
      .poll(async () => {
        return (await read(page)).measures.dialogs;
      })
      .toBe(3);

    expect((await read(page)).details.dialogs).toEqual([
      "Create New Monitor",
      "Filters",
      "Workflow",
    ]);
  });

  test("counts the fields typed into and the keys pressed, not a picker's search, a modifier or the page's own events", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `/dashboard/${PROJECT}/monitors/create`,
      '<main><label for="name">Name</label><input id="name" /><label for="url">Website URL<span>The page to check.</span></label><input id="url" type="url" /><input id="search" role="combobox" aria-label="Search monitor types" /></main>',
    );

    await page.locator("#name").pressSequentially("Acme");
    await page.locator("#name").pressSequentially(" site");
    await page.locator("#url").pressSequentially("https://a.example");
    await page.locator("#search").pressSequentially("ssl");
    await page.keyboard.press("Shift");
    await page.evaluate(() => {
      const input: HTMLInputElement = document.querySelector("#name")!;
      input.value = "typed by the page";
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    const run: JourneyRun = await read(page);

    expect(run.details.fieldsTyped).toEqual([
      "/dashboard/:id/monitors/create > Name",
      "/dashboard/:id/monitors/create > Website URLThe page to check.",
    ]);
    expect(run.measures.fieldsTyped).toBe(2);
    expect(run.measures.keystrokes).toBe(
      "Acme".length + " site".length + "https://a.example".length + 3,
    );
  });

  test("names a field typed in a dialog by the dialog too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `/dashboard/${PROJECT}/status-pages`,
      '<main>Status Pages</main><div data-testid="modal" role="dialog" aria-labelledby="t"><h2 id="t">Create New Status Page</h2><label for="n">Name</label><input id="n" /></div>',
    );

    await page.locator("#n").pressSequentially("Acme Status");

    expect((await read(page)).details.fieldsTyped).toEqual([
      "/dashboard/:id/status-pages > Create New Status Page > Name",
    ]);
  });

  test("counts the options on screen at each pick, not a plain button", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `/dashboard/${PROJECT}/monitors/create`,
      `<main>
        <div role="radiogroup">${[
          "Website",
          "API",
          "Ping",
          "Port",
          "SSL",
          "Incoming",
        ]
          .map((name: string) => {
            return `<div role="radio" aria-checked="false">${name}</div>`;
          })
          .join(
            "",
          )}<div role="radio" style="display:none">Kubernetes</div></div>
        <div role="listbox">${["Admins", "Members", "Owners", "Ada", "Grace"]
          .map((name: string) => {
            return `<div role="option">${name}</div>`;
          })
          .join("")}</div>
        <button id="next">Next</button>
      </main>`,
    );

    await page.getByRole("radio", { name: "Website" }).click();
    await page.getByRole("option", { name: "Ada" }).click();
    await page.locator("#next").click();
    const run: JourneyRun = await read(page);

    expect(run.details.choices).toEqual([
      { step: "/dashboard/:id/monitors/create", picked: "Website", offered: 6 },
      { step: "/dashboard/:id/monitors/create", picked: "Ada", offered: 5 },
    ]);
    expect(run.measures.choices).toBe(11);
  });

  test("reads the fields left at their default when the person submits, once each", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      "/admin/settings/smtp",
      `<main>
        <label for="port">Port</label><input id="port" value="587" />
        <label for="host">Hostname</label><input id="host" />
        <label for="user">Username</label><input id="user" />
        <span id="tls">Require TLS</span><button role="switch" aria-checked="true" aria-labelledby="tls"></button>
        <span id="probes">Probes</span><div class="ou-select__control"><div class="ou-select__multi-value">Probe US</div><input aria-labelledby="probes" /></div>
        <span id="team">Team</span><div class="ou-select__control"><input aria-labelledby="team" /></div>
      </main>`,
    );

    await page.locator("#user").pressSequentially("ada");
    await noteSubmit(page);
    await noteSubmit(page);
    const run: JourneyRun = await read(page);

    expect(run.details.defaultsKept).toEqual([
      "/admin/settings/smtp > Port",
      "/admin/settings/smtp > Require TLS",
      "/admin/settings/smtp > Probes",
    ]);
    expect(run.measures.defaultsKept).toBe(3);
  });

  test("counts the words each step showed at its most, a dialog a step of its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `/dashboard/${PROJECT}/monitors`,
      '<main><p id="text">one two three</p><button id="act">Act</button></main>',
    );

    await page.locator("#act").click();
    await page.evaluate(() => {
      document.querySelector("#text")!.textContent =
        "one two three four five six";
    });
    await page.locator("#act").click();
    await page.evaluate(() => {
      const holder: HTMLDivElement = document.createElement("div");
      holder.innerHTML =
        '<div data-testid="modal" role="dialog" aria-labelledby="t"><h2 id="t">Add Monitor</h2><p>Pick one monitor, then save.</p><button id="save">Save</button></div>';
      document.getElementById("root")!.appendChild(holder);
    });
    await page.locator("#save").click();
    const run: JourneyRun = await read(page);

    // "Act" is a word on screen too: 7 at the page's most, 8 in the dialog.
    expect(run.details.steps).toEqual([
      { step: "/dashboard/:id/monitors", words: 7, choices: 0 },
      { step: "/dashboard/:id/monitors > Add Monitor", words: 8, choices: 0 },
    ]);
    expect(run.measures.words).toBe(15);
  });

  test("keeps its counts through a page that reloads itself, and forgets them when told to start", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `/dashboard/${PROJECT}/settings/notification-settings`,
      '<main><button id="act">Recharge</button><div data-testid="modal" role="dialog" aria-labelledby="t"><h2 id="t">Recharge Balance</h2></div></main>',
    );

    await page.locator("#act").click();
    await page.reload();
    await page.locator("#act").click();
    let run: JourneyRun = await read(page);

    expect(run.measures.clicks).toBe(2);
    expect(run.details.screens).toEqual([
      "/dashboard/:id/settings/notification-settings",
    ]);
    // The dialog the reloaded page draws again is a new one; the first keeps its title.
    expect(run.details.dialogs).toEqual([
      "Recharge Balance",
      "Recharge Balance",
    ]);

    await page.evaluate(() => {
      (
        window as unknown as { __journeyCounter: CounterApi }
      ).__journeyCounter.reset();
    });
    await page.reload();
    run = await read(page);
    expect(run.measures.clicks).toBe(0);
  });

  test("is not at rest while the page has drawn nothing, and is once it stops changing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.route(`${ORIGIN}/**`, async (route: Route) => {
      await route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><body><div id="root"></div></body></html>',
      });
    });
    await Journey.prepare(page);
    await page.goto(`${ORIGIN}/dashboard/${PROJECT}/home`);
    const quietFor: () => Promise<number> = async () => {
      return await page.evaluate(() => {
        return (
          window as unknown as { __journeyCounter: CounterApi }
        ).__journeyCounter.quietFor();
      });
    };

    expect(await quietFor()).toBe(-1);
    await page.evaluate(() => {
      document.getElementById("root")!.innerHTML = "<main>Home</main>";
    });
    await expect.poll(quietFor).toBeGreaterThan(300);
  });
});

test.describe("the newcomer the journeys are written with", () => {
  // A step that cannot be done fails in seconds here.
  test.use({ actionTimeout: 1500 });

  // A form whose Create asks for a Team it never showed as required.
  const FORM: string = `<main>
    <h1>Create Monitor</h1>
    <label for="name">Name</label><input id="name" />
    <label for="team">Team</label><input id="team" placeholder="Platform" aria-describedby="team-error" />
    <p id="team-error" data-testid="error-message"></p>
    <button id="create">Create</button>
    <p id="done"></p>
  </main>`;
  const SCRIPT: string = `document.getElementById("create").addEventListener("click", function () {
    var team = document.getElementById("team");
    if (!team.value) {
      team.setAttribute("aria-invalid", "true");
      document.getElementById("team-error").textContent = "Team is required";
      return;
    }
    team.removeAttribute("aria-invalid");
    document.getElementById("team-error").textContent = "";
    document.getElementById("done").textContent = "Created " + team.value;
  });`;

  test("fills a value a form starts asking for, as a person would, and counts the field", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `/dashboard/${PROJECT}/monitors/create`, FORM, SCRIPT);
    const person: Journey = new Journey(page, "synthetic");

    await person.begin(
      `${ORIGIN}/dashboard/${PROJECT}/monitors/create`,
      page.getByRole("heading", { name: "Create Monitor" }),
    );
    await person.type("Name", "Acme website");
    await person.submit("Create");
    const run: JourneyRun = await person.finish();

    // The example in the box, as a person copies it.
    await expect(page.locator("#done")).toHaveText("Created Platform");
    expect(run.details.fieldsTyped).toEqual([
      "/dashboard/:id/monitors/create > Name",
      "/dashboard/:id/monitors/create > Team",
    ]);
    // Name, Create, then Team and Create again.
    expect(run.measures.clicks).toBe(4);
  });

  test("starts counting where the journey begins: getting there is free", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `/dashboard/${PROJECT}/monitors/create`, FORM, SCRIPT);
    await page.locator("#name").click();
    const person: Journey = new Journey(page, "synthetic");

    await person.begin(
      `${ORIGIN}/dashboard/${PROJECT}/monitors/create`,
      page.getByRole("heading", { name: "Create Monitor" }),
    );

    expect(Object.values((await person.finish()).measures)).toEqual(
      MEASURES.map(() => {
        return 0;
      }),
    );
  });

  test("a step that cannot be done says which journey and step, what was on screen, and what to do", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `/dashboard/${PROJECT}/monitors/create`, FORM, SCRIPT);
    const person: Journey = new Journey(page, "synthetic");
    await person.begin(
      `${ORIGIN}/dashboard/${PROJECT}/monitors/create`,
      page.getByRole("heading", { name: "Create Monitor" }),
    );
    await page.locator("#create").click();

    const failure: Error = await person
      .press("Review and create")
      .then(() => {
        return new Error("the step was done");
      })
      .catch((error: Error) => {
        return error;
      });

    expect(failure.message).toContain(
      'Journey synthetic could not press "Review and create".',
    );
    expect(failure.message).toContain('Step: press "Review and create"');
    expect(failure.message).toContain(
      `Page: ${ORIGIN}/dashboard/${PROJECT}/monitors/create`,
    );
    expect(failure.message).toContain("Dialogs open: none");
    expect(failure.message).toContain('Fields in error: "Team is required"');
    expect(failure.message).toContain(
      "raise its budget in Tests/Ops/JourneyBudgets.json",
    );
  });
});
