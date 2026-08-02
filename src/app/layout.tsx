import type { Metadata } from "next";
import { SerwistProvider } from "@serwist/turbopack/react";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/sora/500.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "LIMS Jose",
  title: { default: "LIMS José", template: "%s · LIMS José" },
  description: "Sistema interno de gestión para laboratorio clínico",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "LIMS Jose" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport = { themeColor: "#096b8b" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <SerwistProvider
          swUrl="/serwist/sw.js"
          cacheOnNavigation
          reloadOnOnline={false}
        >
          {children}
        </SerwistProvider>
      </body>
    </html>
  );
}
