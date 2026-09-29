import Sleep from "../../Types/Sleep";

describe("Sleep.sleep", () => {
  test("should delay by given duration", async () => {
    Object.defineProperty(global, "performance", {
      writable: true,
    });

    jest.spyOn(global, "setTimeout");

    const delay: number = 100;

    await Sleep.sleep(delay);

    expect(setTimeout).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), delay);
  });
});
