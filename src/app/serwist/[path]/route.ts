import { createSerwistRoute } from "@serwist/turbopack";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  additionalPrecacheEntries: [
    { url: "/offline", revision: process.env.VERCEL_GIT_COMMIT_SHA ?? "development" },
  ],
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
});
