/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import "fake-indexeddb/auto";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

globalThis.BroadcastChannel = class FakeBroadcastChannel extends EventTarget {
  static readonly #channels = new Map<string, Set<FakeBroadcastChannel>>();
  readonly #name: string;

  constructor(name: string) {
    super();
    this.#name = name;
    if (!FakeBroadcastChannel.#channels.has(name)) {
      FakeBroadcastChannel.#channels.set(name, new Set());
    }
    FakeBroadcastChannel.#channels.get(name)!.add(this);
  }

  postMessage(data: any) {
    const channels = FakeBroadcastChannel.#channels.get(this.#name);
    if (channels) {
      for (const channel of channels) {
        if (channel === this) continue;
        queueMicrotask(() => channel.dispatchEvent(new MessageEvent("message", { data })));
      }
    }
  }

  close() {
    const channels = FakeBroadcastChannel.#channels.get(this.#name);
    if (channels) channels.delete(this);
  }
} as any;
