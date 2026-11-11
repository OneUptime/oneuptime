/*
 * The journey counter, in the page: added before any of the page's own
 * scripts (page.addInitScript), it watches what the person does and what
 * the product shows them, and keeps the counts on window.__journeyCounter.
 *
 * Only what the person does is counted: trusted events, which a page's own
 * code cannot make. What it counts (Journeys/README.md says how to read each):
 *
 *   screens       distinct pages the person acted on inside the page's
 *                 content or a dialog over it - not the header or the
 *                 products menu, which are how they move between pages
 *   dialogs       dialogs (Modal, SideOver, FullPageModal) that opened
 *   clicks        clicks
 *   keystrokes    keys pressed (a modifier alone is not one)
 *   fieldsTyped   distinct fields typed into
 *   defaultsKept  distinct fields left at the value they came with, read
 *                 when the person submits (noteSubmit)
 *   choices       options the person had to read to pick one: at each pick
 *                 of an option, a radio card or a menu item, the options
 *                 beside it that were on screen
 *   words         words on screen at each step (a page acted on, or a
 *                 dialog), the most each step showed, summed
 *   products      distinct products (the first part of a Dashboard path:
 *                 monitors, on-call-duty, user-settings...) acted on
 *
 * A page is named by its path with every id in it replaced by ":id", so the
 * same page for two records is one screen.
 *
 * Kept free of anything but the DOM, so a synthetic page can test it
 * (Journeys/JourneyCounter.spec.ts).
 */
(() => {
  if (window.__journeyCounter) {
    return;
  }

  const DIALOGS =
    '[data-testid="modal"], [data-testid="side-over"], .full-page-modal';
  const CHOICE_ROLES = [
    "option",
    "radio",
    "menuitem",
    "menuitemradio",
    "menuitemcheckbox",
  ];
  const CHOICE_CONTAINERS = {
    option: '[role="listbox"]',
    radio: '[role="radiogroup"], [role="group"], fieldset',
    menuitem: '[role="menu"], [role="menubar"]',
    menuitemradio: '[role="menu"]',
    menuitemcheckbox: '[role="menu"]',
  };
  const TEXT_INPUT_TYPES = [
    "",
    "text",
    "email",
    "url",
    "tel",
    "number",
    "password",
    "search",
  ];
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

  const state = {
    clicks: 0,
    keystrokes: 0,
    dialogs: [],
    screens: [],
    products: [],
    fieldsTyped: [],
    defaultsKept: [],
    touched: [],
    choices: [],
    steps: {},
    stepOrder: [],
    lastMutationAt: performance.now(),
  };
  const seenDialogs = new WeakSet();

  /*
   * A page that reloads itself (after a save, say) is still the same
   * journey: what was counted is kept in the tab's sessionStorage as the
   * page goes, and read back when the next document starts.
   */
  const STORAGE_KEY = "__journeyCounterState";
  const COUNTS = [
    "clicks",
    "keystrokes",
    "screens",
    "products",
    "fieldsTyped",
    "defaultsKept",
    "touched",
    "choices",
    "steps",
    "stepOrder",
  ];

  function save() {
    try {
      const saved = {
        dialogs: dialogTitles().map((title, index) => {
          return { screen: state.dialogs[index].screen, title };
        }),
      };
      for (const key of COUNTS) {
        saved[key] = state[key];
      }
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // A tab without storage starts again after a reload.
    }
  }

  function load() {
    try {
      const saved = JSON.parse(
        window.sessionStorage.getItem(STORAGE_KEY) || "null",
      );
      if (!saved) {
        return;
      }
      for (const key of COUNTS) {
        state[key] = saved[key];
      }
      state.dialogs = saved.dialogs.map((dialog) => {
        return { screen: dialog.screen, title: dialog.title, element: null };
      });
    } catch {
      // Nothing kept: counting starts here.
    }
  }

  function now() {
    return performance.now();
  }

  function addOnce(list, value) {
    if (!list.includes(value)) {
      list.push(value);
    }
  }

  function screenOf(pathname) {
    const path = String(pathname || window.location.pathname)
      .replace(UUID, ":id")
      .replace(/\/+$/, "");
    return path || "/";
  }

  /*
   * The product a page belongs to: what follows the project in a Dashboard
   * path (/dashboard/:id/<product>/...), or the Admin Dashboard's section
   * (/admin/<section>/...).
   */
  function productOf(screen) {
    const parts = screen.split("/").filter(Boolean);
    if (parts[0] === "dashboard" && parts[1] === ":id") {
      return parts[2] || "home";
    }
    if (parts[0] === "admin") {
      return `admin/${parts[1] || "home"}`;
    }
    return parts[0] || "/";
  }

  function isVisible(element) {
    if (!element || !element.isConnected) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") {
      return false;
    }
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  function textOf(element) {
    return element
      ? String(element.innerText || element.textContent || "")
      : "";
  }

  function wordsIn(element) {
    return textOf(element)
      .split(/\s+/)
      .filter((word) => {
        return /[\p{L}\p{N}]/u.test(word);
      }).length;
  }

  function openDialogs() {
    return Array.from(document.querySelectorAll(DIALOGS)).filter(isVisible);
  }

  function titleOf(dialog) {
    const labelledBy = dialog.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = document.getElementById(labelledBy);
      if (label && textOf(label).trim()) {
        return textOf(label).trim();
      }
    }
    const heading = dialog.querySelector(
      '[data-testid="modal-title"], [data-testid="side-over-title"], h1, h2, h3',
    );
    return (
      textOf(heading).trim() || dialog.getAttribute("aria-label") || "Dialog"
    );
  }

  function topDialog() {
    const dialogs = openDialogs();
    return dialogs.length ? dialogs[dialogs.length - 1] : null;
  }

  // Where the person works: the dialog on top, else the page's content.
  function scope() {
    return topDialog() || document.querySelector("main") || document.body;
  }

  function stepKey() {
    const dialog = topDialog();
    return dialog ? `${screenOf()} > ${titleOf(dialog)}` : screenOf();
  }

  function isInWorkArea(element) {
    if (!element || !element.closest) {
      return false;
    }
    if (element.closest(DIALOGS)) {
      return true;
    }
    const main = document.querySelector("main");
    return main ? main.contains(element) : true;
  }

  function sampleStep() {
    const key = stepKey();
    const words = wordsIn(scope());
    if (!(key in state.steps)) {
      state.steps[key] = { words: 0, choices: 0 };
      state.stepOrder.push(key);
    }
    state.steps[key].words = Math.max(state.steps[key].words, words);
    return key;
  }

  function noteAction(target) {
    if (!isInWorkArea(target)) {
      return;
    }
    const screen = screenOf();
    addOnce(state.screens, screen);
    addOnce(state.products, productOf(screen));
    sampleStep();
  }

  function labelOf(control) {
    const labelledBy =
      control.getAttribute && control.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => {
          return textOf(document.getElementById(id)).trim();
        })
        .filter(Boolean)
        .join(" ");
      if (text) {
        return text;
      }
    }
    if (control.labels && control.labels.length) {
      return textOf(control.labels[0]).trim();
    }
    return (
      (control.getAttribute && control.getAttribute("aria-label")) ||
      control.placeholder ||
      control.name ||
      control.id ||
      control.tagName
    );
  }

  function fieldKey(control) {
    // The first line of a label is its title; a description may follow.
    const label = String(labelOf(control) || "")
      .split("\n")[0]
      .trim();
    return `${stepKey()} > ${label}`;
  }

  function isTextEntry(element) {
    if (!element) {
      return false;
    }
    if (element.isContentEditable) {
      return true;
    }
    if (element.tagName === "TEXTAREA") {
      return true;
    }
    return (
      element.tagName === "INPUT" &&
      TEXT_INPUT_TYPES.includes(
        String(element.getAttribute("type") || "").toLowerCase(),
      ) &&
      element.getAttribute("role") !== "combobox"
    );
  }

  // The control a click lands in: a picker, a switch, a box, a radio card.
  function controlOf(element) {
    if (!element || !element.closest) {
      return null;
    }
    const select = element.closest(".ou-select__control");
    if (select) {
      return select.querySelector("input") || select;
    }
    return element.closest(
      'input, textarea, select, [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"]',
    );
  }

  function countChoice(element) {
    if (!element || !element.closest) {
      return;
    }
    const selector = CHOICE_ROLES.map((role) => {
      return `[role="${role}"]`;
    }).join(", ");
    const choice = element.closest(selector);
    if (!choice) {
      return;
    }
    const role = choice.getAttribute("role");
    const container =
      choice.closest(CHOICE_CONTAINERS[role]) || choice.parentElement;
    const options = Array.from(
      container.querySelectorAll(`[role="${role}"]`),
    ).filter(isVisible);
    const count = Math.max(options.length, 1);
    state.choices.push({
      step: stepKey(),
      picked: textOf(choice).trim().split("\n")[0],
      offered: count,
    });
    const key = stepKey();
    if (state.steps[key]) {
      state.steps[key].choices += count;
    }
  }

  window.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted) {
        return;
      }
      state.clicks += 1;
      noteAction(event.target);
      const control = controlOf(event.target);
      if (control) {
        addOnce(state.touched, fieldKey(control));
      }
      countChoice(event.target);
    },
    true,
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (!event.isTrusted) {
        return;
      }
      if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)) {
        return;
      }
      state.keystrokes += 1;
      noteAction(event.target);
    },
    true,
  );

  window.addEventListener(
    "input",
    (event) => {
      if (!event.isTrusted || !isTextEntry(event.target)) {
        return;
      }
      const key = fieldKey(event.target);
      addOnce(state.fieldsTyped, key);
      addOnce(state.touched, key);
    },
    true,
  );

  function hasValue(control) {
    if (control.classList && control.classList.contains("ou-select__control")) {
      return Boolean(
        control.querySelector(
          ".ou-select__single-value, .ou-select__multi-value",
        ),
      );
    }
    const role = control.getAttribute("role");
    if (role === "switch" || role === "checkbox") {
      return true;
    }
    if (role === "radiogroup") {
      return Boolean(
        control.querySelector('[role="radio"][aria-checked="true"]'),
      );
    }
    if (control.type === "checkbox" || control.type === "radio") {
      return true;
    }
    return String(control.value || "").trim() !== "";
  }

  /*
   * Called by the driver just before it submits: every field on screen the
   * person did not touch, and that came with a value, kept its default.
   */
  function noteSubmit() {
    const area = scope();
    const controls = Array.from(
      area.querySelectorAll(
        'input:not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea, [role="switch"], .ou-select__control, [role="radiogroup"]',
      ),
    ).filter((control) => {
      // A picker's own search box is the picker.
      if (
        control.tagName === "INPUT" &&
        control.closest(".ou-select__control")
      ) {
        return false;
      }
      if (
        control.tagName === "INPUT" &&
        control.closest('[role="radiogroup"]')
      ) {
        return false;
      }
      return isVisible(control) || isVisible(control.parentElement);
    });
    for (const control of controls) {
      const key =
        control.classList && control.classList.contains("ou-select__control")
          ? fieldKey(control.querySelector("input") || control)
          : fieldKey(control);
      if (!state.touched.includes(key) && hasValue(control)) {
        addOnce(state.defaultsKept, key);
      }
    }
  }

  function watchDialogs(root) {
    const found = [];
    if (root.matches && root.matches(DIALOGS)) {
      found.push(root);
    }
    if (root.querySelectorAll) {
      found.push(...root.querySelectorAll(DIALOGS));
    }
    for (const dialog of found) {
      if (seenDialogs.has(dialog)) {
        continue;
      }
      seenDialogs.add(dialog);
      state.dialogs.push({ screen: screenOf(), title: null, element: dialog });
    }
  }

  function startObserving() {
    const observer = new MutationObserver((mutations) => {
      state.lastMutationAt = now();
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            watchDialogs(node);
          }
        }
      }
      // A dialog's title, read once it has drawn it, before it closes.
      for (const dialog of state.dialogs) {
        if (!dialog.title && dialog.element.isConnected) {
          const title = titleOf(dialog.element);
          if (title !== "Dialog") {
            dialog.title = title;
          }
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    watchDialogs(document.documentElement);
  }

  if (document.documentElement) {
    startObserving();
  } else {
    document.addEventListener("DOMContentLoaded", startObserving);
  }

  function dialogTitles() {
    return state.dialogs.map((dialog) => {
      if (!dialog.title && dialog.element && dialog.element.isConnected) {
        dialog.title = titleOf(dialog.element);
      }
      return dialog.title || "Dialog";
    });
  }

  load();
  window.addEventListener("pagehide", save);

  window.__journeyCounter = {
    screenOf,
    productOf,
    noteSubmit,
    /*
     * Milliseconds since the page last changed: the driver waits for quiet.
     * A document still loading, or whose app has drawn nothing yet, is not
     * quiet (-1): a full page load would otherwise read as at rest.
     */
    quietFor() {
      const root = document.getElementById("root");
      if (
        document.readyState !== "complete" ||
        (root && root.childElementCount === 0)
      ) {
        return -1;
      }
      return now() - state.lastMutationAt;
    },
    // Forget everything: the journey starts here.
    reset() {
      state.clicks = 0;
      state.keystrokes = 0;
      state.dialogs = [];
      state.screens = [];
      state.products = [];
      state.fieldsTyped = [];
      state.defaultsKept = [];
      state.touched = [];
      state.choices = [];
      state.steps = {};
      state.stepOrder = [];
      for (const dialog of openDialogs()) {
        seenDialogs.add(dialog);
      }
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nothing was kept.
      }
    },
    // Keep each open dialog's title while it is still on screen.
    rememberTitles() {
      dialogTitles();
    },
    read() {
      const titles = dialogTitles();
      const steps = state.stepOrder.map((key) => {
        return { step: key, ...state.steps[key] };
      });
      return {
        measures: {
          screens: state.screens.length,
          dialogs: state.dialogs.length,
          clicks: state.clicks,
          fieldsTyped: state.fieldsTyped.length,
          products: state.products.length,
          keystrokes: state.keystrokes,
          defaultsKept: state.defaultsKept.length,
          choices: state.choices.reduce((sum, choice) => {
            return sum + choice.offered;
          }, 0),
          words: steps.reduce((sum, step) => {
            return sum + step.words;
          }, 0),
        },
        details: {
          screens: [...state.screens],
          dialogs: titles,
          products: [...state.products],
          fieldsTyped: [...state.fieldsTyped],
          defaultsKept: [...state.defaultsKept],
          choices: state.choices.map((choice) => {
            return { ...choice };
          }),
          steps,
        },
      };
    },
  };
})();
