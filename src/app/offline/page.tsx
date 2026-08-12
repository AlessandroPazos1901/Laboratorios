import { OfflineAppBootstrap } from "@/components/offline-app-bootstrap";

export const metadata = { title: "Trabajo sin internet" };

export default function OfflineFallbackPage() {
  return <OfflineAppBootstrap />;
}
