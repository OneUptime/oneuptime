import AndroidAgentRedactor, {
  REDACTOR_MAX_LENGTH,
} from "../../../Utils/Host/AndroidAgentRedactor";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import {
  JavaScriptPattern,
  KotlinStringLiteral,
  javaScriptForm,
  kotlinStringLiterals,
} from "../../Helpers/KotlinPatterns";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The Android agent's redaction, as OneUptime runs it over what it sends to
 * a device (a log session's note, #9966). Every case is one of the agent's
 * own (agents/AndroidAgent RedactorTest.kt), with the same answer: a text
 * reads the same on the device whichever of the two redacted it. Only the
 * token's own block and the patterns' at the end are ours: they hold the
 * server's patterns to the agent's, read from its Kotlin.
 */

const AGENT_REDACTOR: string =
  "agents/AndroidAgent/app/src/main/java/com/oneuptime/androidagent/logs/Redactor.kt";
const SERVER_REDACTOR: string =
  "packages/Common/Utils/Host/AndroidAgentRedactor.ts";

const JWT: string =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

function redact(text: string | null | undefined): string {
  return AndroidAgentRedactor.redact(text);
}

describe("a card number", () => {
  test("is taken out, whichever way it is written", () => {
    expect(redact("Declined 4111111111111111 at terminal 4")).toBe(
      "Declined [card number] at terminal 4",
    );
    expect(redact("card=4111 1111 1111 1111;")).toBe("card=[card number];");
    expect(redact("pan 5500-0000-0000-0004")).toBe("pan [card number]");
    expect(redact("Amex 378282246310005 ok")).toBe("Amex [card number] ok");
  });

  test("a long number that is not a card is kept", () => {
    // Fails the Luhn check.
    expect(redact("order 4111111111111112")).toBe("order 4111111111111112");
    // Millisecond and nanosecond timestamps start with 1, which no card number does.
    expect(redact("at 1795076857467")).toBe("at 1795076857467");
    expect(redact("t=1795076857467123456")).toBe("t=1795076857467123456");
    // Too short, and inside a word.
    expect(redact("id 411111111111")).toBe("id 411111111111");
    expect(redact("x4111111111111111y")).toBe("x4111111111111111y");
  });

  test("the Luhn check", () => {
    expect(AndroidAgentRedactor.passesLuhn("4111111111111111")).toBe(true);
    expect(AndroidAgentRedactor.passesLuhn("79927398713")).toBe(true);
    expect(AndroidAgentRedactor.passesLuhn("79927398710")).toBe(false);
    expect(AndroidAgentRedactor.passesLuhn("")).toBe(false);
    expect(AndroidAgentRedactor.passesLuhn("41a1")).toBe(false);
    expect(AndroidAgentRedactor.looksLikeCardNumber("4111111111111111")).toBe(
      true,
    );
    expect(AndroidAgentRedactor.looksLikeCardNumber("1111111111111117")).toBe(
      false,
    );
    // A digit of another script is no card's.
    expect(
      AndroidAgentRedactor.passesLuhn(
        "\u0664\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661",
      ),
    ).toBe(false);
    expect(AndroidAgentRedactor.passesLuhn("411111111111111\u0661")).toBe(
      false,
    );
    expect(
      AndroidAgentRedactor.looksLikeCardNumber("411111111111111\uff11"),
    ).toBe(false);
  });

  test("beside another number is taken out", () => {
    // Its expiry date, an amount or a code after it, one space or dash between.
    expect(redact("4111 1111 1111 1111 12/25")).toBe("[card number] 12/25");
    expect(redact("card 4111111111111111 123")).toBe("card [card number] 123");
    expect(redact("有效 4111111111111111 123元")).toBe(
      "有效 [card number] 123元",
    );
    expect(redact("卡号 4111 1111 1111 1111 12月到期")).toBe(
      "卡号 [card number] 12月到期",
    );
    expect(redact("4111-1111-1111-1111-1号")).toBe("[card number]-1号");
    // A number before it.
    expect(redact("1 4111 1111 1111 1111")).toBe("1 [card number]");
    expect(redact("号12 4111 1111 1111 1111")).toBe("号12 [card number]");
    expect(redact("订单号1234 4111 1111 1111 1111")).toBe(
      "订单号1234 [card number]",
    );
    // Two in one run, and a run too long for one.
    expect(redact("4111 1111 1111 1111 5500 0000 0000 0004")).toBe(
      "[card number] [card number]",
    );
    expect(redact("4111 1111 1111 1111 1111 1111")).toBe(
      "[card number] 1111 1111",
    );
    // Numbers that hold no card stay, whole.
    expect(redact("1795076857467 1795076857467")).toBe(
      "1795076857467 1795076857467",
    );
    expect(redact("12 34 56 78 90 12 34")).toBe("12 34 56 78 90 12 34");
    expect(redact("4111 1111 1111 1112 12/25")).toBe(
      "4111 1111 1111 1112 12/25",
    );
  });
});

describe("a secret written right against a letter of another script", () => {
  test("is taken out, as on the device (#10835)", () => {
    expect(redact("支付失败，卡号4111111111111111")).toBe(
      "支付失败，卡号[card number]",
    );
    expect(redact("4111111111111111已拒绝")).toBe("[card number]已拒绝");
    expect(redact("邮箱jane@example.com")).toBe("邮箱[email]");
    expect(redact("jane@example.com已发送")).toBe("[email]已发送");
    expect(redact("令牌Bearer abcdefghijklmnop")).toBe(
      "令牌Bearer [credential]",
    );
    expect(redact(`令牌${JWT}`)).toBe("令牌[token]");
    expect(redact("用户password=hunter2")).toBe("用户password=[redacted]");
    expect(redact("カード番号4111 1111 1111 1111です")).toBe(
      "カード番号[card number]です",
    );
    expect(redact(`トークン${JWT}を送信`)).toBe("トークン[token]を送信");
    expect(
      redact("メールjane.doe+kiosk@example.co.ukに送信しました"),
    ).toBe("メール[email]に送信しました");
    // Korean, Arabic, Cyrillic, Thai and Devanagari.
    expect(redact("카드번호4111111111111111승인거절")).toBe(
      "카드번호[card number]승인거절",
    );
    expect(redact("이메일jane@example.com으로")).toBe("이메일[email]으로");
    expect(redact("토큰Bearer abcdefghijklmnop")).toBe(
      "토큰Bearer [credential]",
    );
    expect(redact("رقم البطاقة5500-0000-0000-0004")).toBe(
      "رقم البطاقة[card number]",
    );
    expect(redact("البريدjane@example.com")).toBe("البريد[email]");
    expect(redact("номер4111111111111111отклонён")).toBe(
      "номер[card number]отклонён",
    );
    expect(redact("ключBasic dXNlcjpwYXNzd29yZA==")).toBe(
      "ключBasic [credential]",
    );
    expect(redact(`токен${JWT}`)).toBe("токен[token]");
    expect(redact("บัตร378282246310005")).toBe("บัตร[card number]");
    expect(redact("कार्ड4111111111111111")).toBe("कार्ड[card number]");
    // A secret's value after a long run of another script's letters.
    expect(redact(`${"中".repeat(41)}password=hunter2`)).toBe(
      `${"中".repeat(41)}password=[redacted]`,
    );
  });

  test("a mark, a joiner, a digit of another script or a folded letter beside it is no word's part either", () => {
    expect(redact(`x\u200b${JWT}`)).toBe("x\u200b[token]");
    expect(redact("x\u200bBearer abcdefghijklmnop")).toBe(
      "x\u200bBearer [credential]",
    );
    expect(redact("\u200d4111111111111111")).toBe("\u200d[card number]");
    expect(redact("jane@example.com\u200d")).toBe("[email]\u200d");
    expect(redact(`e\u0301${JWT}`)).toBe("e\u0301[token]");
    expect(redact("e\u0301Bearer abcdefghijklmnop")).toBe(
      "e\u0301Bearer [credential]",
    );
    expect(redact("jane@example.com\u0301")).toBe("[email]\u0301");
    expect(redact("4111111111111111\u0663")).toBe("[card number]\u0663");
    expect(redact("\u09674111111111111111")).toBe("\u0967[card number]");
    expect(redact("4111111111111111\uff11\uff12")).toBe(
      "[card number]\uff11\uff12",
    );
    expect(redact("\u017fBearer abcdefghijklmnop")).toBe(
      "\u017fBearer [credential]",
    );
    expect(redact("\u212apassword=hunter2")).toBe("\u212apassword=[redacted]");
    expect(redact(`\u{1d49c}${JWT}`)).toBe("\u{1d49c}[token]");
  });

  test("inside a longer ASCII word, is kept", () => {
    for (const text of [
      "x4111111111111111",
      "4111111111111111_",
      "v1.4111111111111111",
      "4111111111111111.5",
      "xBearer abcdefghijklmnop",
      "_basic abcdefghijklmnop",
      `${"a".repeat(41)}password=hunter2`,
      "卡号4111111111111111x",
      "x4111111111111111已拒绝",
    ]) {
      expect(redact(text)).toBe(text);
    }
  });
});

describe("an email address", () => {
  test("is taken out", () => {
    expect(redact("Receipt sent to jane.doe+kiosk@example.co.uk.")).toBe(
      "Receipt sent to [email].",
    );
    expect(redact("user=a@b.io")).toBe("user=[email]");
  });
});

describe("credentials and tokens", () => {
  test("are taken out, their names kept", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop")).toBe(
      "Authorization: Bearer [credential]",
    );
    expect(redact("authorization=Basic dXNlcjpwYXNzd29yZA==")).toBe(
      "authorization=Basic [credential]",
    );
    expect(redact("password=hunter2&user=7")).toBe(
      "password=[redacted]&user=7",
    );
    expect(redact('{"api_key": "sk_live_123", "n": 1}')).toBe(
      '{"api_key": "[redacted]", "n": 1}',
    );
    expect(redact("csrf_token: abc123 next")).toBe(
      "csrf_token: [redacted] next",
    );
    expect(redact("GET /pay?session_id=XYZ123&amount=5")).toBe(
      "GET /pay?session_id=[redacted]&amount=5",
    );
    expect(redact("pin=1234")).toBe("pin=[redacted]");

    const jwt: string =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redact(`token ${jwt} expired`)).toBe("token [token] expired");
    expect(redact(`id_token=${jwt}`)).toBe("id_token=[token]");
  });

  test("a name that only holds a secret's word, or a value already taken out, is kept", () => {
    expect(redact("max_tokens=5 spinner=3 mapping=x")).toBe(
      "max_tokens=5 spinner=3 mapping=x",
    );
    expect(redact("password=[redacted]")).toBe("password=[redacted]");
    expect(redact('password="[redacted]"')).toBe('password="[redacted]"');
  });
});

describe("what a crash is read by", () => {
  test("is kept", () => {
    const stack: string = [
      "java.lang.IllegalStateException: Printer offline (job 1234, pid 4321)",
      "\tat com.example.kiosk.TokenManager.refresh(TokenManager.kt:42)",
      "\tat com.example.kiosk.MainActivity.onCreate(MainActivity.kt:20)",
      "\tat android.app.Activity.performCreate(Activity.java:8595)",
    ].join("\n");

    expect(redact(stack)).toBe(stack);
    expect(
      redact(
        "  580  1029 I ActivityManager: Start proc 4321:com.example/u0a190",
      ),
    ).toBe("  580  1029 I ActivityManager: Start proc 4321:com.example/u0a190");
  });
});

describe("its bounds", () => {
  test("nothing in, nothing out, and a huge text is cut first", () => {
    expect(redact(null)).toBe("");
    expect(redact(undefined)).toBe("");
    expect(redact("")).toBe("");
    expect(redact("a".repeat(REDACTOR_MAX_LENGTH + 10))).toHaveLength(
      REDACTOR_MAX_LENGTH,
    );
  });

  test("a long text costs time in proportion to its length", () => {
    // A long word before a secret's name, a long number, a long run of "@".
    const texts: Array<string> = [
      "a".repeat(200_000) + " password" + "b".repeat(50_000) + "=x",
      "1".repeat(200_000),
      "x@".repeat(100_000),
    ];
    // The fastest of up to three attempts: one timing on a busy runner is noisy.
    const redacted: FastestRun<Array<string>> = fastestRun({
      run: (): Array<string> => {
        return texts.map(redact);
      },
      limitInMs: 5_000,
    });

    // None of them holds a secret, a card number or an address.
    expect(redacted.result).toEqual(texts);
    expect(redacted.inMs).toBeLessThan(5_000);
  });

  test("the same text twice reads the same: no pattern keeps a place between calls", () => {
    const text: string = "Call dana@example.com about 4111 1111 1111 1111";

    expect(redact(text)).toBe("Call [email] about [card number]");
    expect(redact(text)).toBe("Call [email] about [card number]");
  });
});

describe("a token, looked for once per run of its characters", () => {
  const jwt: string =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

  test("is taken out where no ASCII word runs into it, and only there", () => {
    // After a "-" in a run: the run's text before it stays.
    expect(redact(`trace-${jwt}`)).toBe("trace-[token]");
    expect(redact(`req a-b-${jwt}.more`)).toBe("req a-b-[token].more");
    // From the first place in the run a token may start: the token from there holds the later one.
    expect(redact(`x-eyJab-${jwt}`)).toBe("x-[token]");
    // Glued to a word, no token starts: the agent keeps it too.
    expect(redact(`x${jwt}`)).toBe(`x${jwt}`);
    expect(redact(`_${jwt}`)).toBe(`_${jwt}`);
    // Each token of a line, and a segment of fewer than five characters is none.
    expect(redact(`${jwt} ${jwt}`)).toBe("[token] [token]");
    expect(redact(`a=${jwt};b=${jwt}`)).toBe("a=[token];b=[token]");
    expect(redact("eyJabcd.efghi.jklmn")).toBe("eyJabcd.efghi.jklmn");
    expect(redact("eyJabcde.efghi.jklmn")).toBe("[token]");
  });

  test("every match of a long text is replaced, and the text between them kept", () => {
    expect(redact("4111111111111111 x ".repeat(1000))).toBe(
      "[card number] x ".repeat(1000),
    );
    expect(redact("password=hunter2&".repeat(1000))).toBe(
      "password=[redacted]&".repeat(1000),
    );
    expect(redact("Bearer abcdefghijklmnop ".repeat(1000))).toBe(
      "Bearer [credential] ".repeat(1000),
    );
    expect(redact("1795076857467 ".repeat(1000))).toBe(
      "1795076857467 ".repeat(1000),
    );
    expect(
      redact(
        "a 4111111111111111, password=hunter2; Bearer abcdefghijklmnop a@b.io end",
      ),
    ).toBe(
      "a [card number], password=[redacted]; Bearer [credential] [email] end",
    );
  });

  test("a long run of a token's characters costs time in proportion to its length", () => {
    // Read once more from each "eyJ", these took seconds (TokenPatternsGuard).
    const texts: Array<string> = [
      "-eyJ-".repeat(40_000),
      "eyJab-".repeat(40_000),
      "eyJ".repeat(80_000),
    ];
    const redacted: FastestRun<Array<string>> = fastestRun({
      run: (): Array<string> => {
        return texts.map(redact);
      },
      limitInMs: 5_000,
    });

    // No token is whole in any of them.
    expect(redacted.result).toEqual(texts);
    expect(redacted.inMs).toBeLessThan(5_000);
  });
});

// Each of the agent's patterns by its name: the first pattern after its `val NAME: Regex =`.
function agentPatterns(): Map<string, string> {
  const text: string = fs.readFileSync(
    path.join(REPOSITORY_DIRECTORY, AGENT_REDACTOR),
    "utf8",
  );
  const literals: Array<KotlinStringLiteral> = kotlinStringLiterals(
    text,
  ).filter((literal: KotlinStringLiteral): boolean => {
    return literal.isPattern;
  });
  const patterns: Map<string, string> = new Map<string, string>();

  for (const declaration of text.matchAll(/\bval\s+([A-Z_]+)\s*:\s*Regex\s*=/g)) {
    const literal: KotlinStringLiteral | undefined = literals.find(
      (candidate: KotlinStringLiteral): boolean => {
        return candidate.start > declaration.index;
      },
    );

    if (literal) {
      patterns.set(declaration[1]!, literal.value);
    }
  }

  return patterns;
}

// Each of the server's patterns by its name, as written.
function serverPatterns(): Map<string, JavaScriptPattern> {
  const text: string = fs.readFileSync(
    path.join(REPOSITORY_DIRECTORY, SERVER_REDACTOR),
    "utf8",
  );
  const source: ts.SourceFile = ts.createSourceFile(
    SERVER_REDACTOR,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const patterns: Map<string, JavaScriptPattern> = new Map<
    string,
    JavaScriptPattern
  >();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer?.kind === ts.SyntaxKind.RegularExpressionLiteral
    ) {
      const literal: string = node.initializer.getText(source);
      const end: number = literal.lastIndexOf("/");

      patterns.set(node.name.text, {
        source: literal.slice(1, end),
        flags: literal.slice(end + 1),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return patterns;
}

describe("its patterns", () => {
  test("are the agent's, as JavaScript writes them", () => {
    const agent: Map<string, string> = agentPatterns();
    const server: Map<string, JavaScriptPattern> = serverPatterns();

    expect([...agent.keys()].sort()).toEqual([
      "AUTHORIZATION",
      "CARD_START",
      "EMAIL_ADDRESS",
      "JWT",
      "SECRET_ASSIGNMENT",
    ]);

    for (const [name, kotlin] of agent) {
      // The token's is written otherwise for each engine (Redactor.kt says why): the next test reads it.
      if (name === "JWT") {
        continue;
      }

      const caseInsensitive: boolean = kotlin.includes("(?i)");

      expect({
        name,
        source: server.get(name)?.source,
        caseInsensitive: server.get(name)?.flags.includes("i"),
      }).toEqual({
        name,
        // Kotlin turns (?i) on in the pattern, after its look-behind, and JavaScript with a flag; ICU refuses a bare "}" in a class.
        source: kotlin.split("(?i)").join("").split("\\}").join("}"),
        caseInsensitive,
      });
    }
  });

  test("the agent's token pattern and the server's take out the same tokens", () => {
    const form: JavaScriptPattern = javaScriptForm(agentPatterns().get("JWT")!);
    const agent: RegExp = new RegExp(form.source, `${form.flags}g`);
    const server: RegExp = new RegExp(serverPatterns().get("JWT")!.source, "g");
    // A token's pieces more than once each, so that many texts hold one.
    const texts: Array<string> = generatedTexts(20000, 10835, [
      "eyJ",
      "eyJabcde",
      "eyJabcde",
      "-",
      "-eyJ",
      ".",
      ".abcde",
      ".abcde",
      "a",
      "abcde",
      "_",
      " ",
      "é",
      "中",
      "e\u0301",
      "\u200b",
      "\u017f",
      "eyJab-",
    ]);
    let withToken: number = 0;

    for (const text of texts) {
      const expected: string = text.replace(server, "$1[token]");

      if (expected !== text) {
        withToken++;
      }

      expect({ text, agent: text.replace(agent, "$1[token]") }).toEqual({
        text,
        agent: expected,
      });
    }

    expect(withToken).toBeGreaterThan(texts.length / 50);
  });
});
