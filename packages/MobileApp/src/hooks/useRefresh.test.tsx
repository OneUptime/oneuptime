import { act, renderHook } from "@testing-library/react-native";
import { useRefresh } from "./useRefresh";

describe("useRefresh", () => {
  test("keeps refresh feedback visible until the request finishes", async () => {
    let finish: () => void = (): void => {};
    const refresh: jest.Mock = jest.fn(() => {
      return new Promise<void>((resolve: () => void) => {
        finish = resolve;
      });
    });
    const { result } = await renderHook(() => {
      return useRefresh(refresh);
    });

    expect(result.current.refreshing).toBe(false);
    let request: Promise<void>;
    await act(() => {
      request = result.current.onRefresh();
    });
    expect(result.current.refreshing).toBe(true);
    await act(async () => {
      finish();
      await request;
    });
    expect(result.current.refreshing).toBe(false);
  });

  test("ignores repeated pulls during a request and permits a later refresh", async () => {
    let finish: () => void = (): void => {};
    const refresh: jest.Mock = jest.fn(() => {
      return new Promise<void>((resolve: () => void) => {
        finish = resolve;
      });
    });
    const { result } = await renderHook(() => {
      return useRefresh(refresh);
    });
    let request: Promise<void>;
    await act(() => {
      request = result.current.onRefresh();
      void result.current.onRefresh();
    });
    await act(async () => {
      await result.current.onRefresh();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await request;
    });
    await act(() => {
      request = result.current.onRefresh();
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    await act(async () => {
      finish();
      await request;
    });
    expect(result.current.refreshing).toBe(false);
  });

  test("releases the spinner and permits retry after a rejected request", async () => {
    const refresh: jest.Mock = jest
      .fn()
      .mockRejectedValueOnce(new Error("Offline"));
    const { result } = await renderHook(() => {
      return useRefresh(refresh);
    });
    await act(async () => {
      await expect(result.current.onRefresh()).rejects.toThrow("Offline");
    });
    expect(result.current.refreshing).toBe(false);
    refresh.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.onRefresh();
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(result.current.refreshing).toBe(false);
  });

  test("calls the current project callback after rerender", async () => {
    const first: jest.Mock = jest.fn().mockResolvedValue(undefined);
    const second: jest.Mock = jest.fn().mockResolvedValue(undefined);
    const { result, rerender } = await renderHook(
      ({ refresh }: { refresh: () => Promise<unknown> }) => {
        return useRefresh(refresh);
      },
      { initialProps: { refresh: first } },
    );
    await rerender({ refresh: second });
    await act(async () => {
      await result.current.onRefresh();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
