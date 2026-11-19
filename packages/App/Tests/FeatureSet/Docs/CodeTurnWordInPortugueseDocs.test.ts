import { readPage } from "./DocsContentSupport";
import { dashboardLocale } from "./DocsDashboardLabels";
import { describe, expect, it } from "@jest/globals";

/*
 * The Portuguese Code page names a task's turn the way the Portuguese
 * Dashboard does (issue #9813). The Dashboard calls it a "turno" everywhere
 * it names one - "Turno {{number}}" in the Log page's picker, "{{count}}
 * turnos anteriores não são mostrados", the button Mostrar turnos
 * anteriores - while the docs called it a "vez": a reader was told about
 * "vezes" and then saw "turnos" on the page.
 *
 * "vez" stays where it only means "time" in a phrase: "outra vez" (again),
 * "em vez de" (instead), "de cada vez" (at a time), "uma vez" (once), "10
 * vezes por dia" (ten times a day), and the queue's "esperam a vez delas"
 * (wait their turn), which is no task's turn.
 */

const PAGE: string = "ai/ai-agent";

const ALLOWED_PHRASES: ReadonlyArray<RegExp> = [
  /\boutra vez\b/giu,
  /\bem vez (?:de|disso)\b/giu,
  /\bde cada vez\b/giu,
  /\buma vez\b/giu,
  /\b\d+ vezes por dia\b/giu,
  /\besperam a vez delas\b/giu,
];

const portuguesePage: string = readPage("pt", PAGE);

// The Dashboard's word for a turn: "Turno {{number}}", lower-cased.
const dashboardTurnWord: () => string = (): string => {
  const drawn: unknown = dashboardLocale("pt")["Turn {{number}}"];

  expect(typeof drawn).toBe("string");

  return (drawn as string).replace("{{number}}", "").trim().toLowerCase();
};

describe("the Portuguese Code page names a task's turn as the Dashboard does", () => {
  it("the Dashboard calls a turn a 'turno'", () => {
    expect(dashboardTurnWord()).toBe("turno");
    expect(dashboardLocale("pt")["Show earlier turns"]).toBe(
      "Mostrar turnos anteriores",
    );
  });

  it("the conversation's section says 'turno', and the earlier turns' line counts 'turnos'", () => {
    const word: string = dashboardTurnWord();
    const conversation: string = portuguesePage.substring(
      portuguesePage.indexOf("## A conversa de uma tarefa"),
      portuguesePage.indexOf(
        "## ",
        portuguesePage.indexOf("## A conversa de uma tarefa") + 3,
      ),
    );

    expect(conversation).toContain(`depois o ${word} da IA`);
    expect(conversation).toContain(
      `Cada resposta é o próximo ${word} da mesma tarefa`,
    );
    expect(conversation).toContain(
      `Uma tarefa com mais de 200 ${word}s mostra o primeiro ${word} e os 199 mais recentes, com uma linha entre eles que diz quantos ${word}s anteriores não são mostrados.`,
    );
    expect(conversation).toContain(`O **Registro** de cada ${word}`);
    expect(conversation).toContain(
      `enquanto o ${word} mais recente está fora de vista`,
    );
  });

  it("a failed turn and its Log are a 'turno' too", () => {
    const word: string = dashboardTurnWord();

    expect(portuguesePage).toContain(
      `| **Falhou** | O ${word} não pôde terminar`,
    );
    expect(portuguesePage).toContain(`então o ${word} diz isso no lugar.`);
    expect(portuguesePage).toContain(`Quando o ${word} falha definitivamente`);
    expect(portuguesePage).toContain(
      `O **Registro** do ${word} tem o log completo da execução.`,
    );
    expect(portuguesePage).toContain(
      `e o **Registro** de cada ${word} tem uma linha para cada arquivo`,
    );
  });

  it("no 'vez' on the page is a task's turn: each is a phrase that only means 'time'", () => {
    let rest: string = portuguesePage;

    for (const phrase of ALLOWED_PHRASES) {
      rest = rest.replace(phrase, "");
    }

    const turns: Array<string> = [];
    const pattern: RegExp = /.{0,40}\bvez(?:es)?\b.{0,40}/giu;
    let match: RegExpExecArray | null = pattern.exec(rest);

    while (match) {
      turns.push(match[0]);
      match = pattern.exec(rest);
    }

    expect(turns).toEqual([]);
  });
});
