export function htmxSuccess(message: string): string {
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<span class="badge badge-complete" style="animation: fadeIn 0.3s">${safe}</span>`;
}

export function htmxError(message: string): string {
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<span class="badge badge-failed" style="animation: fadeIn 0.3s">${safe}</span>`;
}

export function isHtmxRequest(
  headers: Record<string, string | string[] | undefined> | undefined
): boolean {
  const v = headers?.["hx-request"];
  return v === "true" || (Array.isArray(v) && v[0] === "true");
}
