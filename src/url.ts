/** Build full URL path for nav highlighting (mount path + route path). */
export function urlPathFromParts(baseUrl: string, routePath: string, basePath: string): string {
  const bp = basePath.replace(/\/$/, "");
  const combined = `${baseUrl}${routePath === "/" ? "" : routePath}` || "/";
  if (!bp) return combined || "/";
  return `${bp}${combined === "/" ? "" : combined}` || "/";
}
