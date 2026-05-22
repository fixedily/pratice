export const CURRENT_KNOWLEDGE_BASE_STORAGE_KEY = "faultdiag_current_knowledge_base_id";

export function readStoredKnowledgeBaseId(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(CURRENT_KNOWLEDGE_BASE_STORAGE_KEY);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function writeStoredKnowledgeBaseId(id: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CURRENT_KNOWLEDGE_BASE_STORAGE_KEY, String(id));
}

export function clearStoredKnowledgeBaseId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CURRENT_KNOWLEDGE_BASE_STORAGE_KEY);
}
