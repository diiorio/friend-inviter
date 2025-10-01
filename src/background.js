/** @type {typeof globalThis.browser} */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const browser = /** @type {any} */ (globalThis).chrome;

/**
 * Utility that holds a value and tells its subscribers when the value changes
 * @template T
 */
class Signal {
  /** @type {T | undefined} */
  #value;
  /** @type {Set<(value: T | undefined) => void>} */
  #subscriptions;
  /** @param {T} [value] */
  constructor(value) {
    this.#value = value;
    this.#subscriptions = new Set();
  }
  get value() {
    return this.#value;
  }
  set value(v) {
    if (v === this.#value) return;
    this.#value = v;
    if (this.#subscriptions.size) {
      for (const callback of this.#subscriptions) {
        callback(v);
      }
    }
  }
  subscribe(/** @type {(value: T | undefined) => void} */ callback) {
    this.#subscriptions.add(callback);
    return () => this.#subscriptions.delete(callback);
  }
}

/** @type {Signal<string|undefined>} */
const token = new Signal();
token.subscribe((value) => {
  console.log("Storing", value);
});
const decoder = new TextDecoder("utf-8");

// Sniff requests to store authenticity token, used to make our own requests
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    /** @type {unknown} */
    const buf = details.requestBody?.raw?.[0]?.bytes;
    if (buf instanceof ArrayBuffer) {
      let str = decoder.decode(buf);
      try {
        /** @type {unknown} */
        const json = JSON.parse(str);
        if (
          json &&
          typeof json === "object" &&
          "authenticity_token" in json &&
          typeof json.authenticity_token === "string"
        ) {
          token.value = json.authenticity_token;
        }
      } catch {
        // If it's not valid JSON, it's probably not a URL we care about
      }
    }
  },
  {
    types: ["xmlhttprequest"],
    urls: ["https://*.fetlife.com/*"],
  },
  ["requestBody"]
);

/**
 * @typedef MessageTokenSync
 * @property {'authenticity_token'} action
 * @property {'sync'} mode
 */
/**
 * @typedef MessageTokenSubscribe
 * @property {'authenticity_token'} action
 * @property {'subscribe'} mode
 * @property {number} timeout
 */
/** Send authenticity token when content script asks for it */
browser.runtime.onMessage.addListener(
  (
    /** @type {MessageTokenSync|MessageTokenSubscribe} */ msg,
    sender,
    reply
  ) => {
    console.log("A message!", msg);
    switch (msg.mode) {
      case "sync": {
        console.log("Sending sync", token.value);
        reply(token.value);
        return true;
      }
      case "subscribe": {
        const unsubscribe = token.subscribe((value) => {
          console.log("Sending updated", value);
          reply(value);
          clearTimeout(timeout);
          unsubscribe();
        });

        /** @type {ReturnType<typeof setTimeout>} */
        const timeout = setTimeout(() => {
          console.log("Loading token timed out.");
          reply(undefined);
          unsubscribe();
        }, msg.timeout);
        return true;
      }
      default: {
        throw new Error(
          `Unimplemented mode: ${/** @type {{mode:string}} */ (msg).mode}`
        );
      }
    }
  }
);
