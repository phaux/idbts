import { GlobalRegistrator } from "@happy-dom/global-registrator";
import "fake-indexeddb/auto";
import "observable-polyfill";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
