import { describe, expect, test } from "@jest/globals";
import { listPages, readPage } from "./DocsContentSupport";

/*
 * THE KOREAN DOCS' PARTICLES AGREE WITH THE WORD THEY FOLLOW.
 *
 * A Korean particle takes one form after a syllable that ends in a
 * consonant and another after one that ends in a vowel: 설정을 but 템플릿
 * 추가를, 상태 변경은 but 종료는, 색상으로 but 완료로 (a final ㄹ takes 로
 * too: 규칙으로 but 메일로). The translated docs quote the Dashboard's
 * labels in bold and put the particle after them - "**완료** 로 닫습니다" -
 * so a label that is translated anew, or a particle written for the English
 * word it replaced, can leave the wrong one: #5287 synced 13,936 labels and
 * left 133 mismatches on lines it did not touch, and 151 were on the pages
 * when they were fixed.
 *
 * A bold label ending in a Hangul syllable has one right particle, and this
 * holds every page to it. A label ending in a Latin letter or a digit is
 * read aloud in a way the letters do not settle (API, Slack, 2FA), so it is
 * left to the writer. A 이 after a space can be a word of its own (이 =
 * this), so only an unspaced 이 is read; 가 never is a word on its own.
 */

// [after a final consonant, after a vowel], longest first where one starts another.
const PARTICLE_PAIRS: ReadonlyArray<[string, string]> = [
  ["이라는", "라는"],
  ["으로", "로"],
  ["이나", "나"],
  ["이며", "며"],
  ["이라", "라"],
  ["이란", "란"],
  ["이든", "든"],
  ["을", "를"],
  ["은", "는"],
  ["이", "가"],
  ["과", "와"],
];

const PARTICLES: ReadonlyArray<string> = PARTICLE_PAIRS.flatMap(
  (pair: [string, string]): Array<string> => {
    return [pair[0], pair[1]];
  },
).sort((a: string, b: string): number => {
  return b.length - a.length;
});

const FIRST_HANGUL_SYLLABLE: number = 0xac00;
const LAST_HANGUL_SYLLABLE: number = 0xd7a3;
const SYLLABLE_FINALS: number = 28;
// The final ㄹ (rieul), which takes 로 where other finals take 으로.
const FINAL_RIEUL: number = 8;

function isHangulSyllable(character: string): boolean {
  const code: number = character.charCodeAt(0);

  return code >= FIRST_HANGUL_SYLLABLE && code <= LAST_HANGUL_SYLLABLE;
}

// The final consonant of a Hangul syllable (0 for none), or null for anything else.
function finalOf(character: string): number | null {
  if (!character || !isHangulSyllable(character)) {
    return null;
  }

  return (character.charCodeAt(0) - FIRST_HANGUL_SYLLABLE) % SYLLABLE_FINALS;
}

// The form of a particle that suits a word's last syllable, or null when no rule settles it.
function particleFor(word: string, particle: string): string | null {
  const final: number | null = finalOf(word.trimEnd().slice(-1));

  if (final === null) {
    return null;
  }

  for (const [afterConsonant, afterVowel] of PARTICLE_PAIRS) {
    if (particle !== afterConsonant && particle !== afterVowel) {
      continue;
    }

    if (final === 0) {
      return afterVowel;
    }

    if (final === FINAL_RIEUL && afterConsonant === "으로") {
      return afterVowel;
    }

    return afterConsonant;
  }

  return null;
}

interface ParticleAfterLabel {
  label: string;
  particle: string;
  isSpaced: boolean;
}

// The text with each inline code span blanked out, so a ** inside code is never a marker.
function withoutCodeSpans(line: string): string {
  let result: string = "";
  let inCode: boolean = false;

  for (const character of line) {
    if (character === "`") {
      inCode = !inCode;
      result += " ";
      continue;
    }

    result += inCode ? " " : character;
  }

  return result;
}

// The particle written right after each bold span of a line (none, when none is).
function particlesAfterBoldLabels(line: string): Array<ParticleAfterLabel> {
  const masked: string = withoutCodeSpans(line);
  const markers: Array<number> = [];
  let at: number = masked.indexOf("**");

  while (at !== -1) {
    markers.push(at);
    at = masked.indexOf("**", at + 2);
  }

  const found: Array<ParticleAfterLabel> = [];

  for (let index: number = 0; index + 1 < markers.length; index += 2) {
    const opening: number = markers[index] as number;
    const closing: number = markers[index + 1] as number;
    const label: string = line.slice(opening + 2, closing);
    let after: string = line.slice(closing + 2);
    const isSpaced: boolean = after.startsWith(" ");

    if (isSpaced) {
      after = after.slice(1);
    }

    for (const particle of PARTICLES) {
      if (!after.startsWith(particle)) {
        continue;
      }

      const next: string = after.charAt(particle.length);

      // 가능 is a word, not 가 and 능.
      if (next && isHangulSyllable(next)) {
        break;
      }

      found.push({ label: label, particle: particle, isSpaced: isSpaced });
      break;
    }
  }

  return found;
}

// A fenced code block's opening or closing line.
const FENCE_LINE: RegExp = /^ {0,3}```/;

// Each particle on the Korean pages that does not suit the label before it.
function mismatches(): Array<string> {
  const wrong: Array<string> = [];

  for (const page of listPages("ko")) {
    const lines: Array<string> = readPage("ko", page).split("\n");
    let inFence: boolean = false;

    lines.forEach((line: string, index: number): void => {
      // Code is never prose: a diagram's or a sample's ** is no label.
      if (FENCE_LINE.test(line)) {
        inFence = !inFence;
        return;
      }

      if (inFence) {
        return;
      }

      for (const found of particlesAfterBoldLabels(line)) {
        // A spaced 이 may be the word "this".
        if (found.isSpaced && found.particle === "이") {
          continue;
        }

        const wanted: string | null = particleFor(found.label, found.particle);

        if (wanted !== null && wanted !== found.particle) {
          wrong.push(
            `${page}:${index + 1} **${found.label}**${found.isSpaced ? " " : ""}${found.particle} should be ${wanted}`,
          );
        }
      }
    });
  }

  return wrong;
}

describe("a particle's form follows the syllable before it", () => {
  test.each([
    ["설정", "를", "을"],
    ["템플릿 추가", "을", "를"],
    ["상태 변경", "는", "은"],
    ["종료", "은", "는"],
    ["저장되지 않은 변경 사항", "가", "이"],
    ["모두 추가", "은", "는"],
    ["지금 확인", "와", "과"],
    ["추가 필드", "이며", "며"],
    ["식별됨", "라는", "이라는"],
  ])(
    "**%s** takes %s's other form, %s",
    (label: string, given: string, wanted: string) => {
      expect(particleFor(label, given)).toBe(wanted);
    },
  );

  test("으로 after a consonant, 로 after a vowel or a final ㄹ", () => {
    expect(particleFor("사용자 지정 색상", "로")).toBe("으로");
    expect(particleFor("추가됨", "로")).toBe("으로");
    expect(particleFor("완료", "으로")).toBe("로");
    expect(particleFor("다시 시도", "으로")).toBe("로");
    expect(particleFor("메일", "으로")).toBe("로");
    expect(particleFor("규칙", "로")).toBe("으로");
  });

  test("a label ending in a Latin letter, a digit or a bracket is left to the writer", () => {
    expect(particleFor("Slack", "을")).toBeNull();
    expect(particleFor("API", "를")).toBeNull();
    expect(particleFor("p95", "는")).toBeNull();
    expect(particleFor("설정 (Settings)", "을")).toBeNull();
  });
});

describe("the particle after a bold label is read as the page writes it", () => {
  test("right after the label, or after one space", () => {
    expect(
      particlesAfterBoldLabels("**완료** 로 닫습니다. **설정**을 엽니다."),
    ).toEqual([
      { label: "완료", particle: "로", isSpaced: true },
      { label: "설정", particle: "을", isSpaced: false },
    ]);
  });

  test("a word that starts like a particle is no particle", () => {
    expect(particlesAfterBoldLabels("**경고** 가능합니다")).toEqual([]);
    expect(particlesAfterBoldLabels("**경고** 이벤트")).toEqual([]);
  });

  test("markers are paired in order, and a ** inside code is not one", () => {
    expect(particlesAfterBoldLabels("`**x**` **복제** 는 **이름** 을")).toEqual(
      [
        { label: "복제", particle: "는", isSpaced: true },
        { label: "이름", particle: "을", isSpaced: true },
      ],
    );
    // The text between two labels is never read as a label of its own.
    expect(particlesAfterBoldLabels("**편집** 를 누르고 **저장**")).toEqual([
      { label: "편집", particle: "를", isSpaced: true },
    ]);
  });
});

describe("the Korean docs", () => {
  test("every particle after a bold label suits the label's last syllable", () => {
    expect(mismatches()).toEqual([]);
  });
});
