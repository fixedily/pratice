/** 从故障现象文案中移除创建时写入的元数据标签，仅用于界面展示。 */
export function formatSymptomForDisplay(symptom: string | null | undefined): string {
  if (!symptom) return "";
  return symptom
    .replace(/\s*\[诊断模式：[^\]]+\]/g, "")
    .replace(/\s*\[后续动作：[^\]]+\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
