import { GlobalRegistrator } from "@happy-dom/global-registrator";
import "fake-indexeddb/auto";
import "observable-polyfill";

(global as any).IS_REACT_ACT_ENVIRONMENT = true;
GlobalRegistrator.register();
