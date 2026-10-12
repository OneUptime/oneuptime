import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import "Common/UI/Styles/Theme.css";
import Pagination from "Common/UI/Components/Pagination/Pagination";

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

/*
 * One list of monitors, paged by the production footer the way a table pages
 * its rows. The query string sets it up:
 *
 *   ?total=   how many monitors exist (default 23)
 *   ?page=    the page the list opens on (default 1)
 *   ?size=    rows per page (default 10; any number, as a shared link can)
 *   ?state=   loading | error | disabled - freezes the footer
 *   ?hasMore=1  the analytics lists' mode: the count is only a lower bound
 *
 * Every call the footer makes is appended to [data-testid=navigations] as
 * "page/size", so a test sees exactly what a caller would be asked to fetch.
 */
const params = new URLSearchParams(window.location.search);

const readNumber = (name, fallback) => {
  const value = params.get(name);
  return value === null ? fallback : Number(value);
};

const TOTAL = readNumber("total", 23);
const STATE = params.get("state") || "";
const HAS_MORE_MODE = params.get("hasMore") === "1";

function Fixture() {
  const [pageNumber, setPageNumber] = useState(readNumber("page", 1));
  const [itemsOnPage, setItemsOnPage] = useState(readNumber("size", 10));
  const [navigations, setNavigations] = useState([]);

  const firstIndex = (pageNumber - 1) * itemsOnPage;
  const rows = [];

  for (
    let index = firstIndex;
    index < Math.min(firstIndex + itemsOnPage, TOTAL);
    index++
  ) {
    rows.push(`Monitor ${index + 1}`);
  }

  /*
   * Has-more mode, as the analytics endpoints answer: they fetch one probe
   * row past the page and count it, so the total is the rows seen so far
   * plus one when more follow - never the real count.
   */
  const hasMore = HAS_MORE_MODE ? firstIndex + itemsOnPage < TOTAL : undefined;
  const totalItemsCount = HAS_MORE_MODE
    ? firstIndex + rows.length + (hasMore ? 1 : 0)
    : TOTAL;

  return (
    <main className="mx-auto max-w-5xl p-6 text-gray-700">
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <h1 className="border-b border-gray-200 px-6 py-4 text-base font-semibold">
          Monitors
        </h1>
        <ul aria-label="Monitors" data-testid="rows" className="divide-y">
          {rows.map((row) => {
            return (
              <li key={row} className="px-6 py-2 text-sm">
                {row}
              </li>
            );
          })}
        </ul>
        <Pagination
          currentPageNumber={pageNumber}
          totalItemsCount={totalItemsCount}
          itemsOnPage={itemsOnPage}
          hasMore={hasMore}
          itemsOnCurrentPage={HAS_MORE_MODE ? rows.length : undefined}
          isLoading={STATE === "loading"}
          isError={STATE === "error"}
          isDisabled={STATE === "disabled"}
          singularLabel="Monitor"
          pluralLabel="Monitors"
          dataTestId="monitors-pagination"
          onNavigateToPage={(newPageNumber, newItemsOnPage) => {
            setNavigations((previous) => {
              return [...previous, `${newPageNumber}/${newItemsOnPage}`];
            });
            setPageNumber(newPageNumber);
            setItemsOnPage(newItemsOnPage);
          }}
        />
      </section>
      <p className="mt-4 text-xs text-gray-500">
        Requested pages:{" "}
        <span data-testid="navigations">{navigations.join(" ")}</span>
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<Fixture />);
