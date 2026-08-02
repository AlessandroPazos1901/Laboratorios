/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const neverCacheClinicalData = [
  {
    matcher: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
      sameOrigin && url.pathname.startsWith("/api/"),
    method: "GET" as const,
    handler: new NetworkOnly({ networkTimeoutSeconds: 10 }),
  },
  {
    matcher: ({ url }: { url: URL }) =>
      url.hostname.endsWith(".supabase.co") || url.pathname.includes("/rest/v1/"),
    method: "GET" as const,
    handler: new NetworkOnly({ networkTimeoutSeconds: 10 }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  disableDevLogs: true,
  runtimeCaching: [...neverCacheClinicalData, ...defaultCache],
  fallbacks: {
    entries: [{
      url: "/offline",
      matcher({ request }) {
        return request.destination === "document";
      },
    }],
  },
});

serwist.addEventListeners();
