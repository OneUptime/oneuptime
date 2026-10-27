/*
 * The integrations pages' behaviour: the index's search, and on each
 * OpenTelemetry guide its code blocks' Copy buttons, its tabs and its
 * contents list. Everything works without it - every code block is there to
 * select, the first tab of each set is open and the contents are links - so
 * this only adds to what the page already shows.
 */
(function () {
  'use strict';

  var TAB_CHOICE_KEY = 'oneuptime-integrations-tab-';

  function readChoice(group) {
    try {
      return window.localStorage.getItem(TAB_CHOICE_KEY + group);
    } catch (error) {
      return null;
    }
  }

  function saveChoice(group, value) {
    try {
      window.localStorage.setItem(TAB_CHOICE_KEY + group, value);
    } catch (error) {
      /* A private window refuses storage: the choice lasts for this page. */
    }
  }

  /*
   * Text onto the clipboard, resolving whether it got there: the async
   * clipboard, then - when that is missing or refuses - the older copy
   * command (the website's copy of Common/UI/Utils/Clipboard.ts).
   */
  function copyWithCommand(text) {
    if (typeof document.execCommand !== 'function' || !document.body) {
      return false;
    }
    var focused = document.activeElement;
    var scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.setAttribute('aria-hidden', 'true');
    scratch.setAttribute('tabindex', '-1');
    scratch.style.position = 'fixed';
    scratch.style.top = '0';
    scratch.style.left = '-9999px';
    scratch.style.opacity = '0';
    scratch.style.fontSize = '16px';
    document.body.appendChild(scratch);
    try {
      scratch.select();
      scratch.setSelectionRange(0, text.length);
      return document.execCommand('copy') === true;
    } catch (error) {
      return false;
    } finally {
      document.body.removeChild(scratch);
      if (focused && focused !== document.body && typeof focused.focus === 'function') {
        focused.focus();
      }
    }
  }

  function copyText(text) {
    var useCommand = function () {
      return copyWithCommand(text);
    };
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text).then(function () {
          return true;
        }, useCommand);
      }
    } catch (error) {
      /* Refused outright: the older command may still copy. */
    }
    return Promise.resolve(useCommand());
  }

  function setUpCopyButtons() {
    document.querySelectorAll('[data-copy-button]').forEach(function (button) {
      var block = button.closest('[data-code-block]');
      var code = block ? block.querySelector('code') : null;
      var label = button.querySelector('[data-copy-label]');
      if (!code || !label) {
        return;
      }
      var idle = label.textContent;
      var timer = null;

      button.hidden = false;
      button.addEventListener('click', function () {
        copyText(code.textContent || '').then(function (copied) {
          clearTimeout(timer);
          label.textContent = copied ? 'Copied' : 'Copy failed';
          button.setAttribute('data-copy-state', copied ? 'copied' : 'failed');
          if (!copied && window.getSelection) {
            // The code, selected where it is, to copy by hand.
            window.getSelection().selectAllChildren(code);
          }
          timer = setTimeout(function () {
            label.textContent = idle;
            button.removeAttribute('data-copy-state');
          }, copied ? 2000 : 4000);
        });
      });
    });
  }

  /*
   * Opens one tab of a set, without moving the reader's focus or scroll. A
   * choice the set does not offer - remembered from a guide whose tabs
   * differ - leaves the set as it is.
   */
  function selectTab(tabs, value) {
    var buttons = Array.prototype.slice.call(tabs.querySelectorAll('[data-tab-button]'));
    var offered = buttons.some(function (button) {
      return button.getAttribute('data-tab-value') === value;
    });
    if (!offered) {
      return;
    }
    buttons.forEach(function (button) {
      var isSelected = button.getAttribute('data-tab-value') === value;
      button.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      button.setAttribute('tabindex', isSelected ? '0' : '-1');
    });
    tabs.querySelectorAll('[data-tab-panel]').forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-tab-value') !== value;
    });
  }

  function setUpTabs() {
    var sets = document.querySelectorAll('[data-tabs]');

    sets.forEach(function (tabs) {
      var group = tabs.getAttribute('data-tabs');
      var saved = readChoice(group);
      if (saved) {
        selectTab(tabs, saved);
      }

      var buttons = Array.prototype.slice.call(tabs.querySelectorAll('[data-tab-button]'));

      buttons.forEach(function (button, index) {
        button.addEventListener('click', function () {
          var value = button.getAttribute('data-tab-value');
          saveChoice(group, value);
          // Every set of the group follows the reader's choice.
          document.querySelectorAll('[data-tabs="' + group + '"]').forEach(function (other) {
            selectTab(other, value);
          });
        });

        // Arrow keys move between the tabs of a set, as a tab list's do.
        button.addEventListener('keydown', function (event) {
          var next = null;
          if (event.key === 'ArrowRight') {
            next = buttons[(index + 1) % buttons.length];
          } else if (event.key === 'ArrowLeft') {
            next = buttons[(index - 1 + buttons.length) % buttons.length];
          }
          if (next) {
            event.preventDefault();
            next.focus();
            next.click();
          }
        });
      });
    });
  }

  // Marks the contents list's entry for the section being read.
  function setUpContents() {
    var links = Array.prototype.slice.call(document.querySelectorAll('[data-contents-link]'));
    if (links.length === 0 || typeof window.IntersectionObserver !== 'function') {
      return;
    }

    var byId = {};
    links.forEach(function (link) {
      byId[link.getAttribute('href').slice(1)] = link;
    });

    var observer = new window.IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) {
          return;
        }
        links.forEach(function (link) {
          link.removeAttribute('aria-current');
        });
        var current = byId[entry.target.id];
        if (current) {
          current.setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '0px 0px -70% 0px' });

    Object.keys(byId).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) {
        observer.observe(section);
      }
    });
  }

  // The index's search: a card stays while every word typed is in its words.
  function setUpSearch() {
    var input = document.querySelector('[data-integrations-search]');
    if (!input) {
      return;
    }
    var cards = Array.prototype.slice.call(document.querySelectorAll('[data-integration-card]'));
    var groups = Array.prototype.slice.call(document.querySelectorAll('[data-integrations-group]'));
    var empty = document.querySelector('[data-integrations-empty]');
    var count = document.querySelector('[data-integrations-count]');


    var filter = function () {
      var words = input.value.toLowerCase().split(' ').filter(function (word) {
        return word.length > 0;
      });
      var shown = 0;

      cards.forEach(function (card) {
        var text = card.getAttribute('data-search') || '';
        var matches = words.every(function (word) {
          return text.indexOf(word) !== -1;
        });
        card.hidden = !matches;
        if (matches) {
          shown++;
        }
      });

      groups.forEach(function (group) {
        group.hidden = group.querySelectorAll('[data-integration-card]:not([hidden])').length === 0;
      });

      if (empty) {
        empty.hidden = shown !== 0;
      }
      if (count) {
        count.textContent = words.length === 0 ? '' : shown === 1 ? '1 guide' : shown + ' guides';
      }
    };

    input.addEventListener('input', filter);
    filter();
  }

  function setUp() {
    setUpCopyButtons();
    setUpTabs();
    setUpContents();
    setUpSearch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setUp);
  } else {
    setUp();
  }
})();
