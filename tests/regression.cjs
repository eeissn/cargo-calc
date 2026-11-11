"use strict";

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

function runRegressionChecks(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const handlers = new Map();
  const elements = new Map();
  const storage = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        value: "", style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {} },
        appendChild() {}, removeChild() {}, setAttribute() {},
        addEventListener(name, handler) { handlers.set(id + ":" + name, handler); },
        click() { handlers.get(id + ":click")?.(); },
        createSVGPoint() { return { matrixTransform() { return this; } }; },
        getScreenCTM() { return { inverse() {} }; }
      });
    }
    return elements.get(id);
  }
  const document = {
    body: element("body"),
    getElementById: element,
    querySelectorAll() { return []; },
    createElementNS() { return element(Symbol().toString() + elements.size); }
  };
  const localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); }
  };
  const exposed = script.replace(/\}\)\(\);\s*$/, `
    return {
      placeZ, finalize, settle, findOverlaps, limitViolators, finishDrag, quantityAllowed,
      setDrag(value) { drag = value; },
      setPlan(newCargo, newUnits) {
        cargo = newCargo;
        units = newUnits;
        cargoIndex = new Map(cargo.map(c => [c.id, c]));
      },
      getUnits() { return units; },
      getCargo() { return cargo; },
      savePlan
    };
  })();`);
  function loadApp() {
    return Function("document", "window", "navigator", "localStorage", "setTimeout", "clearTimeout",
      "return " + exposed.trim())(document, element("window"), {}, localStorage, () => 1, () => {});
  }
  const d = { l: 100, w: 100, h: 100 };
  function cargo(id, l = 100, w = 100, h = 25, limit = null) {
    return { id, l, w, h, limit, q: 1, name: "Cargo " + id, type: "pallet" };
  }
  function unit(cid, x = 0, y = 0, z = 0) {
    return { uid: cid, cid, x, y, z, placed: true, rot: false, out: false };
  }
  let app = loadApp();
  const results = [];
  function check(name, condition) {
    if (!condition) throw Error(name);
    results.push(name);
  }

  let a = unit(1), b = unit(2);
  app.setPlan([cargo(1, 100, 100, 100), cargo(2)], [a, b]);
  check("rejects overlap when there is no alternative", !app.finalize(b, d));
  check("rejects a position outside the body", !app.placeZ({ ...b, x: -1 }, d).ok);

  a = unit(1); b = unit(2, 0, 0, 25);
  const c = unit(3, 30);
  app.setPlan([cargo(1, 30), cargo(2), cargo(3, 10)], [a, b, c]);
  app.settle(d);
  check("removes an upper item with less than half support", !b.placed && a.placed && c.placed);
  check("settling leaves no overlap", Object.keys(app.findOverlaps()).length === 0);

  a = unit(1); b = unit(2, 50); const upper = unit(3, 0, 0, 25);
  app.setPlan([cargo(1, 50), cargo(2, 50), cargo(3)], [a, b, upper]);
  app.settle(d);
  check("keeps an upper item bridging equal-height supports", upper.placed && upper.z === 25);
  a.placed = false;
  app.settle(d);
  check("accepts exactly half support", upper.placed && upper.z === 25);

  a = unit(1); b = unit(2, 0, 0, 25);
  app.setPlan([cargo(1, 100, 100, 25, 0), cargo(2)], [a, b]);
  app.settle(d);
  check("enforces zero items above a restricted base", a.placed && !b.placed);

  a = unit(1, 10);
  const original = { ...a };
  app.setPlan([cargo(1, 50)], [a]);
  a.x = 0; a.out = true;
  app.setDrag({ type: "unit", pointerId: 5, u: a, original, moved: true });
  app.finishDrag({ pointerId: 6, clientX: 0, clientY: 0 }, true);
  check("ignores cancellation from another pointer", a.out);
  app.finishDrag({ pointerId: 5, clientX: 0, clientY: 0 }, true);
  check("cancelling a drag restores the position", a.placed && a.x === 10 && !a.out);

  check("rejects unsafe or fractional quantities", !app.quantityAllowed(1e20, 0) && !app.quantityAllowed(2.5, 0));
  check("limits total quantity across cargo types", !app.quantityAllowed(1000, 0) && app.quantityAllowed(1000, 1));
  app.savePlan(d);
  app = loadApp();
  check("restores the saved plan on reload", app.getUnits().length === 1 && app.getUnits()[0].x === 10);

  const autoCargo = [cargo(1, 50, 50, 25, 1), cargo(2, 25, 50, 25)];
  autoCargo[0].q = 6; autoCargo[1].q = 2;
  const autoUnits = Array.from({ length: 8 }, (_, i) => ({ ...unit(i < 6 ? 1 : 2), uid: i + 1, placed: false }));
  app.setPlan(autoCargo, autoUnits);
  handlers.get("auto:click")();
  const placed = app.getUnits().filter(u => u.placed);
  check("automatic packing places all items in the sample", placed.length === 8);
  check("automatic packing respects overlap and stacking checks",
    !Object.keys(app.findOverlaps()).length && !Object.keys(app.limitViolators()).length);
  check("automatic packing keeps all items within the body", placed.every(u => {
    const c = autoCargo[u.cid - 1];
    return u.x >= 0 && u.y >= 0 && u.z >= 0 &&
      u.x + (u.rot ? c.w : c.l) <= d.l && u.y + (u.rot ? c.l : c.w) <= d.w && u.z + c.h <= d.h;
  }));
  app.setPlan([], []);
  handlers.get("demo:click")();
  const demoCargo = app.getCargo();
  const loaded = app.getUnits().filter(u => u.placed);
  const byId = new Map(demoCargo.map(c => [c.id, c]));
  const first = loaded.filter(u => byId.get(u.cid).stop === 1);
  const last = loaded.filter(u => byId.get(u.cid).stop === 2);
  check("mixed two-stop delivery loads all seven pieces", loaded.length === 7 && first.length === 2 && last.length === 5);
  check("first delivery has a clear rear band", last.every(u => {
    const c = byId.get(u.cid);
    return u.x + (u.rot ? c.w : c.l) <= Math.min(...first.map(v => v.x));
  }));
  check("mixed delivery totals 1060 kg without overlap or stack violations",
    loaded.reduce((sum, u) => sum + byId.get(u.cid).grams, 0) === 1060000 &&
    !Object.keys(app.findOverlaps()).length && !Object.keys(app.limitViolators()).length);
  app = loadApp();
  check("route constraints and manifest survive reload", app.getUnits().filter(u => u.placed).length === 7 &&
    element("payload").value == 1400 && element("door-w").value == 200 && element("full-support").checked);

  const restricted = [cargo(1, 80, 150, 75), cargo(2, 70, 75, 110), cargo(3, 75, 75), cargo(4, 75, 75)];
  restricted[0].grams = 70000;
  restricted[1].grams = 50000;
  restricted[2].grams = 50000;
  app.setPlan(restricted, restricted.map(c => ({ ...unit(c.id), placed: false })));
  element("len").value = 300; element("wid").value = 200; element("hei").value = 170;
  element("door-w").value = 100; element("door-h").value = 100; element("payload").value = 100;
  handlers.get("auto:click")();
  const restrictedLoad = app.getUnits().filter(u => u.placed);
  check("narrow door forces a turn and rejects overheight", restrictedLoad.length === 1 &&
    restrictedLoad[0].cid === 1 && restrictedLoad[0].rot);
  check("capacity rejects overweight and unknown mass", restrictedLoad.every(u => u.cid !== 3 && u.cid !== 4));

  a = unit(1); b = unit(2, 0, 0, 25);
  app.setPlan([cargo(1, 50), cargo(2)], [a, b]);
  app.settle({ ...d, fullSupport: true });
  check("full-support mode rejects a half-supported stack", !b.placed);
  const differentStop = cargo(2);
  differentStop.stop = 2;
  a = unit(1); b = unit(2, 0, 0, 25);
  app.setPlan([cargo(1), differentStop], [a, b]);
  app.settle(d);
  check("an upper item cannot block unloading its support at an earlier stop", !b.placed);
  return results;
}

async function runOfflineChecks(source) {
  const listeners = new Map(), entries = new Map(), removed = [];
  const scope = "https://example.test/cargo-calc/";
  const indexUrl = scope + "index.html";
  const keyPrefix = "cargo-calc:" + scope + ":";
  let claimed = false, online = true;
  class MockRequest {
    constructor(url, options) { this.url = url; this.cache = options?.cache; }
  }
  const cache = {
    async addAll(requests) {
      for (const request of requests) entries.set(request.url ?? request, "initial shell");
    },
    async put(url, response) { entries.set(url, response); }
  };
  const caches = {
    async open() { return cache; },
    async keys() { return [keyPrefix + "old", keyPrefix + "v1", "other-app"]; },
    async delete(key) { removed.push(key); },
    async match(url) { return entries.get(url); }
  };
  const self = {
    registration: { scope },
    clients: { async claim() { claimed = true; } },
    addEventListener(name, callback) { listeners.set(name, callback); }
  };
  const response = { ok: true, clone() { return "updated shell"; } };
  Function("self", "caches", "fetch", "Request", "Response", "URL", source)(
    self, caches, async () => {
      if (!online) throw Error("network unavailable");
      return response;
    }, MockRequest, { error() { return "error"; } }, URL);
  const results = [];
  function check(name, condition) {
    if (!condition) throw Error(name);
    results.push(name);
  }
  async function lifecycle(name) {
    let wait;
    listeners.get(name)({ waitUntil(promise) { wait = promise; } });
    await wait;
  }
  function request(url) {
    let result;
    listeners.get("fetch")({
      request: { url, method: "GET", mode: "navigate" },
      respondWith(promise) { result = promise; }
    });
    return result;
  }
  await lifecycle("install");
  check("precaches the scoped shell and icon", entries.has(indexUrl) && entries.has(scope + "favicon-32.png"));
  await lifecycle("activate");
  check("claims clients and removes only old caches for this scope", claimed && removed.join() === keyPrefix + "old");
  check("refreshes the cached shell from online navigation", await request(scope) === response && entries.get(indexUrl) === "updated shell");
  online = false;
  check("serves the cached shell offline for both app URLs", await request(scope + "?test=1") === "updated shell" &&
    await request(indexUrl) === "updated shell");
  check("leaves unrelated paths alone", request(scope + "another.html") === undefined);
  return results;
}

async function main() {
  const root = join(__dirname, "..");
  const app = readFileSync(join(root, "index.html"), "utf8");
  const worker = readFileSync(join(root, "sw.js"), "utf8");
  const results = [...runRegressionChecks(app), ...await runOfflineChecks(worker)];
  for (const result of results) console.log("PASS " + result);
  console.log(results.length + " checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
