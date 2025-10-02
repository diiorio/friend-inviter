/** Utility that holds a value and tells its subscribers when the value changes. */
class Signal<T> {
  #value: T | undefined;
  #subscriptions: Set<(value: T | undefined) => void>;
  constructor(value?: T) {
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
  subscribe(callback: (value: T | undefined) => void) {
    this.#subscriptions.add(callback);
    return () => this.#subscriptions.delete(callback);
  }
}

const token: Signal<string | undefined> = new Signal();
token.subscribe((value) => {
  console.log("Storing", value);
});
const decoder = new TextDecoder("utf-8");

// Sniff requests to store authenticity token, used to make our own requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const buf: unknown = details.requestBody?.raw?.[0]?.bytes;
    if (buf instanceof ArrayBuffer) {
      const str = decoder.decode(buf);
      try {
        const json: unknown = JSON.parse(str);
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
    return {};
  },
  {
    types: ["xmlhttprequest"],
    urls: ["https://*.fetlife.com/*"],
  },
  ["requestBody"]
);

interface MessageTokenSync {
  action: "authenticity_token";
  mode: "sync";
}
interface MessageTokenSubscribe {
  action: "authenticity_token";
  mode: "subscribe";
  timeout: number;
}
/** Send authenticity token when content script asks for it */
chrome.runtime.onMessage.addListener(
  (msg: MessageTokenSync | MessageTokenSubscribe, sender, reply) => {
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

        const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
          console.log("Loading token timed out.");
          reply(undefined);
          unsubscribe();
        }, msg.timeout);
        return true;
      }
      default: {
        throw new Error(
          `Unimplemented mode: ${(msg as { mode: string }).mode}`
        );
      }
    }
  }
);
