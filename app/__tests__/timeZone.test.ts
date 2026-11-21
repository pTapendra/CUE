describe('the test environment', () => {
  it('runs in America/Chicago, not UTC', () => {
    expect(process.env.TZ).toBe('America/Chicago');
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(300); // CDT
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(360); // CST
  });
});
