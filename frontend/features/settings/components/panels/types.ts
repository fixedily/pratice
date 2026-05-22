import type { SettingsOverviewResponse, MaintenanceUser } from "@/shared/lib/http";
import type { CheckState } from "@/features/settings/screens/settings-page";

export type SettingsPanelProps = {
  overview: SettingsOverviewResponse | null;
  overviewLoading: boolean;
  overviewError: string | null;
  user: MaintenanceUser | null | undefined;
  roleLabel: string;
  healthState: CheckState;
  maintenanceState: CheckState;
  readinessState: CheckState;
  onSave: (scope: string) => void;
  onRefreshOverview: () => void;
  onRunHealthCheck: () => void;
  onRunMaintenanceCheck: () => void;
  onRunReadinessCheck: () => void;
};
