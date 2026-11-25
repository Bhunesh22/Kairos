import "server-only";
import { createGoogle } from "@ai-sdk/google";

const DEFAULT_MODEL = "gemini-flash-latest";

/** Gemini model for the agent loop and briefs. Flash keeps the tool loop fast and inside free-tier limits. */
export function getModel() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set. Add your Gemini API key to .env.local.");
  return createGoogle({ apiKey })(process.env.GEMINI_MODEL || DEFAULT_MODEL);
}
