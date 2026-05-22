import { createNunjucksEnv } from "./nunjucksEnv.js";

const env = createNunjucksEnv();

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return env.render(template, context);
}
