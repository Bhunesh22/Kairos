import "server-only";
import { createGoogle } from "@ai-sdk/google";
import { withFallback } from "./model-fallback";

/**
 * Tried in order when the previous one is overloaded (503), out of quota (429)
 * or retired (404). Quotas are per model, so a chain of current Flash models
 * also stretches the free tier. (Gemini 2.5 is closed to new API keys.)
 */
const DEFAULT_MODELS = ["gemini-flash-latest", "gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"];

/** GEMINI_MODEL may be one model ID or a comma-separated fallback chain. */
function modelIds(): string[] {
  const configured = (process.env.GEMINI_MODEL ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([...configured, ...DEFAULT_MODELS])];
}

function build(ids: string[]) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set. Add your Gemini API key to .env.");
  const google = createGoogle({ apiKey });
  return withFallback(
    ids.map((id) => google(id)),
    (from, err) => console.warn(`Gemini model ${from} unavailable, trying the next one:`, (err as Error).message),
  );
}

/** Gemini for the agent loop and briefs, with automatic fallback across Flash models. */
export function getModel() {
  return build(modelIds());
}

/** Lite models first: for quick classification calls like the scope check. */
export function getFastModel() {
  const ids = modelIds();
  return build([...ids.filter((id) => id.includes("lite")), ...ids.filter((id) => !id.includes("lite"))]);
}
