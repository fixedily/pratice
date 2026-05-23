import { Suspense } from "react";

import SettingsPage from "@/features/settings/screens/settings-page";

export default function SettingsRoutePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <SettingsPage />
    </Suspense>
  );
}
