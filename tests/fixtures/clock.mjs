// Loaded only by the local Playwright server and fixture process.
const instant = Date.parse("2026-11-25T20:00:00.000Z");
globalThis.Date = new Proxy(Date, {
  get(target, key, receiver) {
    return key === "now" ? () => instant : Reflect.get(target, key, receiver);
  },
  construct(target, args, constructor) {
    return Reflect.construct(
      target,
      args.length ? args : [instant],
      constructor,
    );
  },
  apply() {
    return new Date(instant).toString();
  },
});
