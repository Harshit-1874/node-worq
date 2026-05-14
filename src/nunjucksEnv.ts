import nunjucks from "nunjucks";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(fileURLToPath(import.meta.url));

/** Templates live next to dist/ (../templates from dist/). */
export function templatesRoot(): string {
  return join(pkgRoot, "..", "templates");
}

export function installWorqFilters(env: nunjucks.Environment): void {
  env.addFilter("sumattr", (arr: unknown, key: string): number => {
    if (!Array.isArray(arr)) return 0;
    return arr.reduce((s, row) => {
      if (row && typeof row === "object" && key in row) {
        const v = (row as Record<string, unknown>)[key];
        return s + (typeof v === "number" ? v : 0);
      }
      return s;
    }, 0);
  });

  env.addFilter("prettyjson", (val: unknown): string => {
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  });

  env.addFilter("dt", (val: unknown): string => {
    if (val == null || val === "") return "";
    const d = typeof val === "string" || typeof val === "number" ? new Date(val) : (val as Date);
    if (Number.isNaN(d.getTime())) return "";
    const iso = d.toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
  });

  env.addFilter("shortid", (id: unknown): string => {
    const s = String(id ?? "");
    return s.length <= 12 ? s : `${s.slice(0, 12)}...`;
  });

  env.addFilter("dump", (val: unknown): string => {
    try {
      return typeof val === "string" ? val : JSON.stringify(val);
    } catch {
      return String(val);
    }
  });
}

export function createNunjucksEnv(): nunjucks.Environment {
  const env = nunjucks.configure(templatesRoot(), {
    autoescape: true,
    noCache: process.env.NODE_ENV !== "production",
  });
  installWorqFilters(env);
  return env;
}
