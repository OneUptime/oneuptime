import { parseSyslogMessage } from "../../Utils/SyslogParser";

describe("SyslogParser", () => {
  test("parses RFC5424 message with structured data", () => {
    const message: string =
      "<34>1 2025-03-02T14:48:05.003Z mymachine app-name 1234 ID47 " +
      "[exampleSDID@32473 iut=\"3\" eventSource=\"Application\" eventID=\"1011\"][meta key=\"value\"] " +
      "BOMAn application event log entry";

    const parsed = parseSyslogMessage(message);

    expect(parsed).not.toBeNull();
    expect(parsed?.priority).toBe(34);
    expect(parsed?.severity).toBe(2);
    expect(parsed?.facility).toBe(4);
    expect(parsed?.version).toBe(1);
    expect(parsed?.hostname).toBe("mymachine");
    expect(parsed?.appName).toBe("app-name");
    expect(parsed?.procId).toBe("1234");
    expect(parsed?.msgId).toBe("ID47");
    expect(parsed?.timestamp?.toISOString()).toBe(
      "2025-03-02T14:48:05.003Z",
    );
    expect(parsed?.structuredData?.["exampleSDID_32473"]?.["iut"]).toBe(
      "3",
    );
    expect(parsed?.structuredData?.["meta"]?.["key"]).toBe("value");
    expect(parsed?.message).toBe("An application event log entry");
  });

  test("parses RFC3164 message", () => {
    const message: string =
      "<13>Feb  5 17:32:18 mymachine su[12345]: 'su root' failed for lonvick on /dev/pts/8";

    const parsed = parseSyslogMessage(message);

    expect(parsed).not.toBeNull();
    expect(parsed?.priority).toBe(13);
    expect(parsed?.severity).toBe(5);
    expect(parsed?.facility).toBe(1);
    expect(parsed?.hostname).toBe("mymachine");
    expect(parsed?.appName).toBe("su");
    expect(parsed?.procId).toBe("12345");
    expect(parsed?.message).toBe("'su root' failed for lonvick on /dev/pts/8");
    expect(parsed?.timestamp).toBeInstanceOf(Date);
  });

  test("handles message without priority", () => {
    const message: string = "Simple message without metadata";
    const parsed = parseSyslogMessage(message);

    expect(parsed).not.toBeNull();
    expect(parsed?.priority).toBeUndefined();
    expect(parsed?.severity).toBeUndefined();
    expect(parsed?.facility).toBeUndefined();
    expect(parsed?.message).toBe("Simple message without metadata");
  });
});
