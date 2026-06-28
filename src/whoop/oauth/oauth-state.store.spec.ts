import { OAuthStateStore } from './oauth-state.store';

describe('OAuthStateStore', () => {
  it('выдаёт уникальные state и потребляет одноразово', () => {
    const store = new OAuthStateStore();
    const a = store.issue();
    const b = store.issue();
    expect(a).not.toBe(b);
    expect(store.consume(a)).toBe(true);
    expect(store.consume(a)).toBe(false); // повторно — нельзя
    expect(store.consume('unknown')).toBe(false);
  });

  it('отвергает протухший state', () => {
    jest.useFakeTimers();
    try {
      const store = new OAuthStateStore();
      const state = store.issue();
      jest.advanceTimersByTime(11 * 60 * 1000);
      expect(store.consume(state)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
