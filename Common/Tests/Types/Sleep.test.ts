import Sleep from '../../Types/Sleep';

describe('Sleep', () => {
    describe('sleep', () => {
        it('should delay by given duration', async () => {
            jest.useFakeTimers();
            jest.spyOn(global, 'setTimeout');

            const delay: number = 100;

            // See - https://stackoverflow.com/a/51132058
            Promise.resolve()
                .then(() => {
                    jest.advanceTimersByTime(delay);
                })
                .catch(() => {});

            await Sleep.sleep(delay);

            expect(setTimeout).toHaveBeenCalledTimes(1);
            expect(setTimeout).toHaveBeenLastCalledWith(
                expect.any(Function),
                delay
            );
        });
    });
});
