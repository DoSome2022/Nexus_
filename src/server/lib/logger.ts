/**
 * 最小結構化 logger（CLAUDE.backend.md 錯誤處理）
 * 正式 logger 服務（OpenTelemetry 等）留待後續 Task；現在輸出 JSON lines
 */
export const logger = {
  info: (msg: string, fields?: Record<string, unknown>) =>
    console.info(JSON.stringify({ level: "info", msg, ...fields })),
  warn: (msg: string, fields?: Record<string, unknown>) =>
    console.warn(JSON.stringify({ level: "warn", msg, ...fields })),
  error: (msg: string, fields?: Record<string, unknown>) =>
    console.error(JSON.stringify({ level: "error", msg, ...fields })),
};
