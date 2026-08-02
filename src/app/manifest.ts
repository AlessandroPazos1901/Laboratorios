import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LIMS Jose - Laboratorio Clinico",
    short_name: "LIMS Jose",
    description: "Gestion clinica segura con continuidad sin conexion.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f4f7f8",
    theme_color: "#096b8b",
    orientation: "landscape",
    icons: [
      { src: "/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
